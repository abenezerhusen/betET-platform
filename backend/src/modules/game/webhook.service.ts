import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { tryAudit } from '../audit/audit.service';
import { logger } from '../../infrastructure/logger';
import { emitBetSettled, emitWalletUpdated } from '../../realtime/socket';
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  getRawBody,
  ipMatchesAllowlist,
  verifyHmacSignature,
} from './game-shared';
import * as repo from './game.repository';
import type {
  BalanceWebhookInput,
  CreditWebhookInput,
  DebitWebhookInput,
  RollbackWebhookInput,
} from './game.dto';

/* ------------------------------------------------------------------------- */
/* Errors                                                                    */
/* ------------------------------------------------------------------------- */

export class WebhookError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/* ------------------------------------------------------------------------- */
/* Common preamble — auth, IP, HMAC, session status                          */
/* ------------------------------------------------------------------------- */

interface AuthorizedContext {
  session: repo.GameSessionRow;
  game: repo.GameRow;
  tenantId: string;
  walletId: string;
  currency: string;
}

/**
 * Resolve the session bypassing RLS, look up the game and tenant, verify IP
 * allowlist, then HMAC-verify the raw body. Every webhook handler runs
 * through this gate before touching financial state.
 */
async function authorizeWebhook(
  req: Request,
  bodyParsed: { session_id: string; request_id: string }
): Promise<AuthorizedContext> {
  const rawBody = getRawBody(req);
  if (!rawBody) {
    throw new WebhookError(400, 'invalid_body', 'raw body unavailable');
  }
  const ip = req.ip ?? null;

  // STEP 1 — find the session (bypass RLS so we can identify the tenant).
  const sessionResolution = await withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client) => {
      const session = await repo.findGameSessionById(
        client,
        bodyParsed.session_id
      );
      if (!session) return { session: null, game: null };
      const game = await repo.findGameByIdAnyTenant(client, session.game_id);
      return { session, game };
    }
  );
  const { session, game } = sessionResolution;
  if (!session || !game) {
    throw new WebhookError(404, 'session_not_found', 'unknown session_id');
  }

  // STEP 2 — within the session's tenant, verify the session is active and
  // resolve the provider's webhook secret + IP allowlist.
  const security = await withTenantClient(
    { tenantId: session.tenant_id },
    async (client) => {
      const fresh = await repo.findGameSessionById(client, session.id);
      const providerCfg = await repo.resolveProviderConfig(
        client,
        session.tenant_id,
        game
      );
      return { fresh, providerCfg };
    }
  );

  if (!security.fresh || security.fresh.status !== 'active') {
    throw new WebhookError(409, 'session_not_active', 'session is not active', {
      status: security.fresh?.status ?? null,
    });
  }
  if (
    security.fresh.expires_at &&
    new Date(security.fresh.expires_at).getTime() < Date.now()
  ) {
    throw new WebhookError(409, 'session_expired', 'session token expired');
  }
  if (!security.providerCfg) {
    throw new WebhookError(
      503,
      'provider_unconfigured',
      'no webhook secret configured for this provider'
    );
  }

  // STEP 3 — IP allowlist (fail-closed: empty allowlist denies everyone).
  if (!ip || !ipMatchesAllowlist(ip, security.providerCfg.ip_allowlist)) {
    throw new WebhookError(403, 'ip_not_allowed', 'source IP not allowlisted', {
      ip,
    });
  }

  // STEP 4 — HMAC signature.
  const sigResult = verifyHmacSignature(
    security.providerCfg.webhook_secret,
    req.header(SIGNATURE_HEADER) ?? undefined,
    req.header(TIMESTAMP_HEADER) ?? undefined,
    rawBody
  );
  if (!sigResult.ok) {
    throw new WebhookError(401, 'invalid_signature', 'HMAC verification failed', {
      reason: sigResult.reason,
    });
  }

  const sessionMeta = (session.metadata ?? {}) as repo.SessionMetadata;
  if (!sessionMeta.wallet_id || !sessionMeta.currency) {
    throw new WebhookError(
      500,
      'session_metadata_corrupt',
      'session metadata missing wallet_id/currency'
    );
  }

  return {
    session: security.fresh,
    game,
    tenantId: session.tenant_id,
    walletId: sessionMeta.wallet_id,
    currency: sessionMeta.currency,
  };
}

/* ------------------------------------------------------------------------- */
/* Reference key helpers                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Build a stable, tenant-scoped reference for the provider's transaction id.
 * Includes the kind (debit|credit|rollback) so the same provider txn id
 * used across kinds doesn't collide.
 */
function buildReference(
  game: repo.GameRow,
  kind: 'debit' | 'credit' | 'rollback',
  providerTxnId: string
): string {
  return `game:${game.provider}:${kind}:${providerTxnId}`;
}

/* ------------------------------------------------------------------------- */
/* Balance                                                                   */
/* ------------------------------------------------------------------------- */

export async function handleBalance(req: Request, body: BalanceWebhookInput) {
  const ctx = await authorizeWebhook(req, body);

  const wallet = await withTenantClient(
    { tenantId: ctx.tenantId },
    async (client) => {
      const w = await repo.findWalletByIdForUpdate(client, ctx.walletId);
      if (!w) throw new WebhookError(404, 'wallet_not_found', 'wallet missing');
      return w;
    }
  );

  return {
    request_id: body.request_id,
    session_id: ctx.session.id,
    user_id: wallet.user_id,
    currency: wallet.currency,
    balance: wallet.balance,
    bonus_balance: wallet.bonus_balance,
    locked_balance: wallet.locked_balance,
    status: 'ok' as const,
  };
}

/* ------------------------------------------------------------------------- */
/* Debit (game places bet)                                                   */
/* ------------------------------------------------------------------------- */

export async function handleDebit(req: Request, body: DebitWebhookInput) {
  const ctx = await authorizeWebhook(req, body);
  const reference = buildReference(ctx.game, 'debit', body.transaction_id);

  const result = await withTenantClient(
    { tenantId: ctx.tenantId },
    async (client) => {
      // Idempotency: if we've already processed this debit, return the
      // original outcome. No state change.
      const existing = await repo.findTransactionByReference(
        client,
        ctx.tenantId,
        reference
      );
      if (existing) {
        const wallet = await repo.findWalletByIdForUpdate(client, ctx.walletId);
        if (!wallet) {
          throw new WebhookError(500, 'wallet_missing', 'wallet vanished');
        }
        return { wallet, transaction: existing, idempotent: true as const, bet: null };
      }

      const wallet = await repo.findWalletByIdForUpdate(client, ctx.walletId);
      if (!wallet) {
        throw new WebhookError(404, 'wallet_not_found', 'wallet missing');
      }
      if (wallet.status !== 'active') {
        throw new WebhookError(409, 'wallet_not_active', `wallet ${wallet.status}`);
      }

      // Currency mismatch check — providers sometimes send currency for
      // belt-and-suspenders. Fail loud rather than convert.
      if (body.currency && body.currency !== wallet.currency) {
        throw new WebhookError(400, 'currency_mismatch', 'currency does not match', {
          expected: wallet.currency,
          got: body.currency,
        });
      }

      const after = await repo.applyWalletBalanceDebit(
        client,
        wallet.id,
        body.amount
      );
      if (!after) {
        throw new WebhookError(409, 'insufficient_balance', 'balance too low', {
          balance: wallet.balance,
          requested: body.amount,
        });
      }

      // Create a bet row so the game-engine flow has a settle target. Casino
      // rounds typically resolve immediately via the credit webhook, so the
      // initial status is 'accepted'.
      const bet = await repo.insertBet(client, {
        tenantId: ctx.tenantId,
        userId: wallet.user_id,
        gameId: ctx.game.id,
        sessionId: ctx.session.id,
        stake: body.amount,
        currency: wallet.currency,
        metadata: {
          source: 'game_webhook',
          provider: ctx.game.provider,
          provider_transaction_id: body.transaction_id,
          round_id: body.round_id ?? null,
          request_id: body.request_id,
          ...(body.metadata ?? {}),
        },
      });

      const tx = await repo.insertTransaction(client, {
        tenantId: ctx.tenantId,
        walletId: wallet.id,
        userId: wallet.user_id,
        type: 'bet_stake',
        amount: `-${body.amount}`,
        beforeBalance: wallet.balance,
        afterBalance: after.balance,
        currency: wallet.currency,
        reference,
        status: 'completed',
        metadata: {
          provider: ctx.game.provider,
          provider_transaction_id: body.transaction_id,
          round_id: body.round_id ?? null,
          session_id: ctx.session.id,
          game_id: ctx.game.id,
          bet_id: bet.id,
        },
      });

      return { wallet: after, transaction: tx, idempotent: false as const, bet };
    }
  );

  await tryAudit({
    tenantId: ctx.tenantId,
    actorId: result.wallet.user_id,
    actorType: 'system',
    action: 'game.webhook.debit',
    resource: 'transaction',
    resourceId: result.transaction.id,
    payload: {
      idempotent: result.idempotent,
      provider: ctx.game.provider,
      provider_transaction_id: body.transaction_id,
      session_id: ctx.session.id,
      game_id: ctx.game.id,
      amount: body.amount,
      currency: result.wallet.currency,
      bet_id: result.bet?.id ?? null,
      before_balance: result.transaction.before_balance,
      after_balance: result.transaction.after_balance,
    },
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    status: 'success',
  });

  emitWalletUpdated(ctx.tenantId, result.wallet.user_id, {
    reason: 'game_debit',
    wallet: result.wallet,
    session_id: ctx.session.id,
  });

  return {
    request_id: body.request_id,
    session_id: ctx.session.id,
    transaction_id: result.transaction.id,
    provider_transaction_id: body.transaction_id,
    bet_id: result.bet?.id ?? null,
    currency: result.wallet.currency,
    balance: result.wallet.balance,
    bonus_balance: result.wallet.bonus_balance,
    idempotent: result.idempotent,
    status: 'ok' as const,
  };
}

/* ------------------------------------------------------------------------- */
/* Credit (game pays a win)                                                  */
/* ------------------------------------------------------------------------- */

export async function handleCredit(req: Request, body: CreditWebhookInput) {
  const ctx = await authorizeWebhook(req, body);
  const reference = buildReference(ctx.game, 'credit', body.transaction_id);

  const result = await withTenantClient(
    { tenantId: ctx.tenantId },
    async (client) => {
      const existing = await repo.findTransactionByReference(
        client,
        ctx.tenantId,
        reference
      );
      if (existing) {
        const wallet = await repo.findWalletByIdForUpdate(client, ctx.walletId);
        if (!wallet) throw new WebhookError(500, 'wallet_missing', 'wallet vanished');
        return { wallet, transaction: existing, idempotent: true as const, bet: null };
      }

      const wallet = await repo.findWalletByIdForUpdate(client, ctx.walletId);
      if (!wallet) {
        throw new WebhookError(404, 'wallet_not_found', 'wallet missing');
      }
      if (wallet.status !== 'active') {
        throw new WebhookError(409, 'wallet_not_active', `wallet ${wallet.status}`);
      }
      if (body.currency && body.currency !== wallet.currency) {
        throw new WebhookError(400, 'currency_mismatch', 'currency does not match', {
          expected: wallet.currency,
          got: body.currency,
        });
      }

      const after = await repo.applyWalletBalanceCredit(
        client,
        wallet.id,
        body.amount
      );

      // If this credit references a previous debit, link it back to the
      // bet row so reporting can show stake -> payout pairs.
      let settledBet: repo.BetRow | null = null;
      if (body.reference_transaction_id) {
        const debitRef = buildReference(
          ctx.game,
          'debit',
          body.reference_transaction_id
        );
        const debitTx = await repo.findTransactionByReference(
          client,
          ctx.tenantId,
          debitRef
        );
        const debitMeta = (debitTx?.metadata ?? {}) as { bet_id?: string };
        if (debitMeta.bet_id) {
          const bet = await repo.findBetById(client, ctx.tenantId, debitMeta.bet_id);
          if (bet && bet.status === 'accepted') {
            await repo.settleBetWon(client, bet.id, body.amount, {
              provider: ctx.game.provider,
              provider_transaction_id: body.transaction_id,
              round_id: body.round_id ?? null,
            });
            settledBet = bet;
          }
        }
      }

      const tx = await repo.insertTransaction(client, {
        tenantId: ctx.tenantId,
        walletId: wallet.id,
        userId: wallet.user_id,
        type: 'bet_win',
        amount: body.amount,
        beforeBalance: wallet.balance,
        afterBalance: after.balance,
        currency: wallet.currency,
        reference,
        status: 'completed',
        metadata: {
          provider: ctx.game.provider,
          provider_transaction_id: body.transaction_id,
          round_id: body.round_id ?? null,
          session_id: ctx.session.id,
          game_id: ctx.game.id,
          reference_transaction_id: body.reference_transaction_id ?? null,
          bet_id: settledBet?.id ?? null,
        },
      });

      return { wallet: after, transaction: tx, idempotent: false as const, bet: settledBet };
    }
  );

  await tryAudit({
    tenantId: ctx.tenantId,
    actorId: result.wallet.user_id,
    actorType: 'system',
    action: 'game.webhook.credit',
    resource: 'transaction',
    resourceId: result.transaction.id,
    payload: {
      idempotent: result.idempotent,
      provider: ctx.game.provider,
      provider_transaction_id: body.transaction_id,
      session_id: ctx.session.id,
      game_id: ctx.game.id,
      amount: body.amount,
      currency: result.wallet.currency,
      bet_id: result.bet?.id ?? null,
      before_balance: result.transaction.before_balance,
      after_balance: result.transaction.after_balance,
    },
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    status: 'success',
  });

  emitWalletUpdated(ctx.tenantId, result.wallet.user_id, {
    reason: 'game_credit',
    wallet: result.wallet,
    session_id: ctx.session.id,
    bet_id: result.bet?.id ?? null,
  });
  if (result.bet) {
    emitBetSettled(ctx.tenantId, result.wallet.user_id, {
      bet_id: result.bet.id,
      status: 'won',
      payout: body.amount,
      currency: result.wallet.currency,
      game_id: ctx.game.id,
      session_id: ctx.session.id,
    });
  }

  return {
    request_id: body.request_id,
    session_id: ctx.session.id,
    transaction_id: result.transaction.id,
    provider_transaction_id: body.transaction_id,
    bet_id: result.bet?.id ?? null,
    currency: result.wallet.currency,
    balance: result.wallet.balance,
    bonus_balance: result.wallet.bonus_balance,
    idempotent: result.idempotent,
    status: 'ok' as const,
  };
}

/* ------------------------------------------------------------------------- */
/* Rollback (reverse a previous debit)                                       */
/* ------------------------------------------------------------------------- */

export async function handleRollback(req: Request, body: RollbackWebhookInput) {
  const ctx = await authorizeWebhook(req, body);
  const reference = buildReference(ctx.game, 'rollback', body.transaction_id);
  const debitReference = buildReference(
    ctx.game,
    'debit',
    body.reference_transaction_id
  );

  const result = await withTenantClient(
    { tenantId: ctx.tenantId },
    async (client) => {
      const existing = await repo.findTransactionByReference(
        client,
        ctx.tenantId,
        reference
      );
      if (existing) {
        const wallet = await repo.findWalletByIdForUpdate(client, ctx.walletId);
        if (!wallet) throw new WebhookError(500, 'wallet_missing', 'wallet vanished');
        return { wallet, transaction: existing, idempotent: true as const, bet: null };
      }

      const original = await repo.findTransactionByReference(
        client,
        ctx.tenantId,
        debitReference
      );
      if (!original) {
        throw new WebhookError(
          404,
          'original_transaction_not_found',
          'cannot rollback unknown debit',
          { reference_transaction_id: body.reference_transaction_id }
        );
      }
      if (original.status === 'reversed') {
        // Treat as idempotent — original already rolled back.
        const wallet = await repo.findWalletByIdForUpdate(client, ctx.walletId);
        if (!wallet) throw new WebhookError(500, 'wallet_missing', 'wallet vanished');
        return { wallet, transaction: original, idempotent: true as const, bet: null };
      }
      if (original.type !== 'bet_stake') {
        throw new WebhookError(
          400,
          'invalid_rollback_target',
          'reference_transaction_id is not a bet stake'
        );
      }

      // Refund amount = absolute value of the original debit.
      const refundAmount = original.amount.startsWith('-')
        ? original.amount.slice(1)
        : original.amount;

      const wallet = await repo.findWalletByIdForUpdate(client, ctx.walletId);
      if (!wallet) {
        throw new WebhookError(404, 'wallet_not_found', 'wallet missing');
      }
      if (wallet.status !== 'active') {
        throw new WebhookError(409, 'wallet_not_active', `wallet ${wallet.status}`);
      }

      const after = await repo.applyWalletBalanceCredit(
        client,
        wallet.id,
        refundAmount
      );

      // Append a 'bet_refund' ledger entry referencing the rollback id.
      const tx = await repo.insertTransaction(client, {
        tenantId: ctx.tenantId,
        walletId: wallet.id,
        userId: wallet.user_id,
        type: 'bet_refund',
        amount: refundAmount,
        beforeBalance: wallet.balance,
        afterBalance: after.balance,
        currency: wallet.currency,
        reference,
        status: 'completed',
        metadata: {
          provider: ctx.game.provider,
          provider_transaction_id: body.transaction_id,
          provider_reference_transaction_id: body.reference_transaction_id,
          rollback_of_transaction_id: original.id,
          session_id: ctx.session.id,
          game_id: ctx.game.id,
        },
      });

      // Mark the original debit as reversed and void the linked bet.
      await repo.markTransactionReversed(client, original.id, reference);
      let voidedBet: repo.BetRow | null = null;
      const origMeta = (original.metadata ?? {}) as { bet_id?: string };
      if (origMeta.bet_id) {
        const bet = await repo.findBetById(client, ctx.tenantId, origMeta.bet_id);
        if (bet && bet.status !== 'void' && bet.status !== 'cancelled') {
          await repo.voidBet(client, bet.id, 'provider_rollback');
          voidedBet = bet;
        }
      }

      return { wallet: after, transaction: tx, idempotent: false as const, bet: voidedBet };
    }
  );

  await tryAudit({
    tenantId: ctx.tenantId,
    actorId: result.wallet.user_id,
    actorType: 'system',
    action: 'game.webhook.rollback',
    resource: 'transaction',
    resourceId: result.transaction.id,
    payload: {
      idempotent: result.idempotent,
      provider: ctx.game.provider,
      provider_transaction_id: body.transaction_id,
      provider_reference_transaction_id: body.reference_transaction_id,
      session_id: ctx.session.id,
      game_id: ctx.game.id,
      currency: result.wallet.currency,
      bet_id: result.bet?.id ?? null,
      before_balance: result.transaction.before_balance,
      after_balance: result.transaction.after_balance,
    },
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    status: 'success',
  });

  emitWalletUpdated(ctx.tenantId, result.wallet.user_id, {
    reason: 'game_rollback',
    wallet: result.wallet,
    session_id: ctx.session.id,
    bet_id: result.bet?.id ?? null,
  });
  if (result.bet) {
    emitBetSettled(ctx.tenantId, result.wallet.user_id, {
      bet_id: result.bet.id,
      status: 'void',
      payout: null,
      currency: result.wallet.currency,
      game_id: ctx.game.id,
      session_id: ctx.session.id,
    });
  }

  return {
    request_id: body.request_id,
    session_id: ctx.session.id,
    transaction_id: result.transaction.id,
    provider_transaction_id: body.transaction_id,
    currency: result.wallet.currency,
    balance: result.wallet.balance,
    bonus_balance: result.wallet.bonus_balance,
    idempotent: result.idempotent,
    status: 'ok' as const,
  };
}

/* ------------------------------------------------------------------------- */
/* Audit-log helper for rejected webhooks                                    */
/* ------------------------------------------------------------------------- */

export async function auditRejectedWebhook(
  req: Request,
  kind: string,
  err: WebhookError,
  body: { session_id?: string; transaction_id?: string; request_id?: string }
): Promise<void> {
  // Best-effort: try to identify the tenant for the audit row. Many failures
  // happen before we can resolve a tenant (e.g. unknown session_id), in
  // which case the row is logged with tenant_id=null via bypassRls.
  let tenantId: string | null = null;
  if (body.session_id) {
    try {
      const found = await withTenantClient(
        { tenantId: null, bypassRls: true },
        async (client) => repo.findGameSessionById(client, body.session_id!)
      );
      tenantId = found?.tenant_id ?? null;
    } catch (lookupErr) {
      logger.warn({ err: lookupErr }, 'audit lookup failed for rejected webhook');
    }
  }

  await tryAudit(
    {
      tenantId,
      actorId: null,
      actorType: 'system',
      action: `game.webhook.${kind}.rejected`,
      resource: 'game_webhook',
      resourceId: body.session_id ?? null,
      payload: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        request_id: body.request_id ?? null,
        transaction_id: body.transaction_id ?? null,
      },
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
      status: 'failure',
    },
    { bypassRls: tenantId === null }
  );
}
