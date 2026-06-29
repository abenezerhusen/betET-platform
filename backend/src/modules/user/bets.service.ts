import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { assertSiteAvailable } from '../../middleware/maintenance-mode';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { Events, emitToUser, emitWalletUpdated } from '../../realtime/socket';
import {
  getIdempotencyKey,
  getIp,
  getUa,
  getUserScope,
} from './user-shared';
import * as repo from './user.repository';
import type { PlaceBetInput, CouponCodeParam } from './user.dto';
import { updateUserStreakProgress } from '../admin/streaks/streaks.module';
import { applyBetWageringProgress } from '../promotions/bet-hooks';

interface PlaceBetResult {
  bet: repo.BetRow;
  wallet: repo.WalletRow;
  transaction: repo.TransactionRow;
  idempotent: boolean;
}

function recentWithinFiveMinutes(placedAt: Date): boolean {
  const ms = Date.now() - new Date(placedAt).getTime();
  return ms <= 5 * 60 * 1000;
}

export async function placeBet(
  req: Request,
  body: PlaceBetInput
): Promise<PlaceBetResult> {
  await assertSiteAvailable(req);
  const scope = getUserScope(req);
  const idempotencyKey = getIdempotencyKey(req, body.idempotency_key);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client): Promise<PlaceBetResult> => {
      // Idempotency: if we already produced a bet for this key recently,
      // return it and skip balance mutation.
      if (idempotencyKey) {
        const existingBet = await repo.findBetByIdempotencyKey(
          client,
          scope.tenantId,
          scope.userId,
          idempotencyKey
        );
        if (existingBet && recentWithinFiveMinutes(existingBet.placed_at)) {
          const wallet = await repo.findUserWalletForUpdate(
            client,
            scope.tenantId,
            scope.userId,
            existingBet.currency
          );
          const existingTx = await repo.findTransactionByReference(
            client,
            scope.tenantId,
            idempotencyKey
          );
          if (wallet && existingTx) {
            return {
              bet: existingBet,
              wallet,
              transaction: existingTx,
              idempotent: true,
            };
          }
        }
      }

      // 1. Eligibility checks (account + KYC if required).
      const user = await repo.findFullUserById(client, scope.userId);
      if (!user) throw new NotFoundError('User not found');
      if (user.status !== 'active') {
        throw new BadRequestError(`Account is ${user.status}`, {
          reason: 'user_not_active',
        });
      }
      const security = await repo.getSecuritySettings(client, scope.tenantId);
      if (security.require_kyc_for_bet && user.kyc_status !== 'verified') {
        throw new BadRequestError('KYC verification required to place bets', {
          reason: 'kyc_not_verified',
          kyc_status: user.kyc_status,
        });
      }

      // 2. Game must be active and belong to this tenant.
      const game = await repo.findActiveGameById(
        client,
        scope.tenantId,
        body.game_id
      );
      if (!game) throw new NotFoundError('Game not found');
      if (game.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Game belongs to a different tenant');
      }
      if (!game.is_active || game.status !== 'available') {
        throw new BadRequestError('Game is not currently available', {
          is_active: game.is_active,
          status: game.status,
        });
      }

      // 3. Stake limits.
      const limits = await repo.getBetLimits(client, scope.tenantId);
      const stakeNum = Number(body.stake);
      if (stakeNum > limits.max_bet) {
        throw new BadRequestError(`Stake exceeds maximum bet (${limits.max_bet})`, {
          reason: 'exceeds_max_bet',
          max: limits.max_bet,
        });
      }
      const potentialWin = body.potential_win ?? '0';
      const potentialNum = Number(potentialWin);
      if (potentialNum > limits.max_payout) {
        throw new BadRequestError(
          `Potential win exceeds maximum payout (${limits.max_payout})`,
          { reason: 'exceeds_max_payout', max: limits.max_payout }
        );
      }

      // 4. Resolve currency + acquire wallet lock.
      const defaultCurrency = await repo.getDefaultCurrency(
        client,
        scope.tenantId
      );
      const currency = body.currency ?? defaultCurrency;
      const before = await repo.findUserWalletForUpdate(
        client,
        scope.tenantId,
        scope.userId,
        currency
      );
      if (!before) {
        throw new BadRequestError('No wallet for the requested currency', {
          currency,
        });
      }
      if (before.status !== 'active') {
        throw new BadRequestError(`Wallet is ${before.status}`, {
          wallet_status: before.status,
        });
      }

      // 5. ATOMIC: move stake from balance into locked_balance.
      const after = await repo.lockWalletFunds(client, before.id, body.stake);
      if (!after) {
        throw new BadRequestError('Insufficient balance', {
          reason: 'insufficient_balance',
          balance: before.balance,
          requested: body.stake,
        });
      }

      // 6. Insert the bet row first so the ledger entry can reference its id.
      const bet = await repo.insertBet(client, {
        tenantId: scope.tenantId,
        userId: scope.userId,
        gameId: game.id,
        sessionId: body.session_id ?? null,
        idempotencyKey: idempotencyKey ?? null,
        stake: body.stake,
        potentialWin: potentialWin,
        currency: before.currency,
        metadata: {
          selection: body.selection ?? null,
          ...(body.metadata ?? {}),
          placed_via: 'user_panel',
        },
      });

      // 7. Append wallet ledger entry.
      const tx = await repo.insertTransaction(client, {
        tenantId: scope.tenantId,
        walletId: before.id,
        userId: scope.userId,
        type: 'bet_stake',
        amount: `-${body.stake}`,
        beforeBalance: before.balance,
        afterBalance: after.balance,
        currency: before.currency,
        reference: idempotencyKey,
        status: 'completed',
        metadata: {
          bet_id: bet.id,
          game_id: game.id,
          session_id: body.session_id ?? null,
          locked_into_locked_balance: body.stake,
        },
      });

      return { bet, wallet: after, transaction: tx, idempotent: false };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: 'user.bet.place',
    resource: 'bet',
    resourceId: result.bet.id,
    payload: {
      idempotent: result.idempotent,
      idempotency_key: idempotencyKey,
      bet_id: result.bet.id,
      game_id: result.bet.game_id,
      session_id: result.bet.session_id,
      stake: result.bet.stake,
      potential_win: result.bet.potential_win,
      currency: result.bet.currency,
      transaction_id: result.transaction.id,
      wallet_id: result.wallet.id,
      before_balance: result.transaction.before_balance,
      after_balance: result.transaction.after_balance,
    },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  // Real-time push: bet placed + wallet balances changed.
  emitToUser(scope.tenantId, scope.userId, Events.BET_PLACED, {
    bet: result.bet,
    wallet: result.wallet,
    transaction_id: result.transaction.id,
  });
  emitWalletUpdated(scope.tenantId, scope.userId, {
    reason: 'bet_placed',
    wallet: result.wallet,
    bet_id: result.bet.id,
  });

  // Best-effort streak progression on each successful settled bet attempt.
  // For now we increment on accepted bet placement; settlement-specific
  // integration can refine this trigger without changing the streak schema.
  void updateUserStreakProgress({
    tenantId: scope.tenantId,
    userId: scope.userId,
    betAmount: Number(body.stake),
  });

  // Drive bonus wagering progress: any active deposit-match / cashback
  // assignment for this user advances toward its wagering_required and
  // converts to real cash on completion.
  void applyBetWageringProgress({
    tenantId: scope.tenantId,
    userId: scope.userId,
    betId: result.bet.id,
    stake: Number(body.stake),
    odds: Number(
      (body.metadata as { odds?: number | string } | undefined)?.odds ??
        (Number(result.bet.potential_win) / Math.max(Number(body.stake), 1) || 0)
    ),
  });

  return result;
}

export async function getBet(req: Request, id: string) {
  const scope = getUserScope(req);

  const bet = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => repo.findBetById(client, scope.tenantId, id)
  );
  if (!bet) throw new NotFoundError('Bet not found');
  if (bet.user_id !== scope.userId) {
    throw new ForbiddenError('You do not own this bet');
  }
  return bet;
}

export async function getBetByCouponCode(req: Request, code: CouponCodeParam['code']) {
  const scope = getUserScope(req);
  const trimmed = code.trim();
  if (!trimmed) throw new BadRequestError('Coupon code is required');

  const bet = await withTenantClient({ tenantId: scope.tenantId }, async (client) => {
    const byUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmed
    )
      ? await repo.findBetById(client, scope.tenantId, trimmed)
      : null;
    if (byUuid) return byUuid;

    const byRef = await repo.findTransactionByReference(client, scope.tenantId, trimmed);
    if (!byRef) return null;
    const betId = (byRef.metadata as { bet_id?: string } | null)?.bet_id;
    if (!betId) return null;
    return repo.findBetById(client, scope.tenantId, betId);
  });

  if (!bet) throw new NotFoundError('Coupon not found');
  if (bet.user_id !== scope.userId) {
    throw new ForbiddenError('You do not own this coupon');
  }

  return {
    coupon_code: trimmed,
    bet_id: bet.id,
    status: bet.status,
    stake: bet.stake,
    potential_win: bet.potential_win,
    payout: bet.payout,
    currency: bet.currency,
    game_id: bet.game_id,
    placed_at: bet.placed_at,
    settled_at: bet.settled_at,
    selection: (bet.metadata as { selection?: unknown } | null)?.selection ?? null,
    metadata: bet.metadata ?? {},
  };
}
