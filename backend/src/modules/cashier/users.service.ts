import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { getCashierScope, getIp, getUa } from './cashier-shared';
import * as repo from './cashier.repository';
import type { UserSearchInput, UserWalletQuery } from './cashier.dto';

function pickPublicUser(u: repo.UserSummaryRow): Record<string, unknown> {
  return {
    id: u.id,
    tenant_id: u.tenant_id,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    kyc_status: u.kyc_status,
    metadata: u.metadata,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}

export async function searchUsers(req: Request, body: UserSearchInput) {
  const scope = getCashierScope(req);

  const rows = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      repo.searchUsers(client, scope.tenantId, {
        query: body.query ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        userId: body.user_id ?? null,
        limit: body.limit,
      })
  );

  return { items: rows.map(pickPublicUser), count: rows.length };
}

export async function getUserWallet(
  req: Request,
  userId: string,
  query: UserWalletQuery
) {
  const scope = getCashierScope(req);
  const offset = (query.page - 1) * query.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const user = await repo.findUserById(client, userId);
      if (!user) throw new NotFoundError('User not found');
      if (user.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }
      const currency =
        query.currency ?? (await repo.getDefaultCurrency(client, scope.tenantId));
      const wallet = await repo.findWalletForUpdate(
        client,
        scope.tenantId,
        userId,
        currency
      );
      const history = await repo.listTransactionsForUser(
        client,
        scope.tenantId,
        userId,
        { limit: query.limit, offset }
      );
      return { user, wallet, history };
    }
  );

  return {
    user: pickPublicUser(data.user),
    wallet: data.wallet,
    transactions: {
      items: data.history.rows,
      total: data.history.total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(data.history.total / query.limit)),
    },
  };
}

export async function verifyUserId(req: Request, userId: string) {
  const scope = getCashierScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const before = await repo.findUserById(client, userId);
      if (!before) throw new NotFoundError('User not found');
      if (before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }
      const after = await repo.setUserKyc(client, userId, 'verified');
      if (!after) throw new NotFoundError('User not found');
      return { before, after };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.cashierId,
    actorType: 'cashier',
    action: 'cashier.user.kyc_approve',
    resource: 'user',
    resourceId: userId,
    payload: {
      before: { kyc_status: result.before.kyc_status },
      after: { kyc_status: result.after.kyc_status },
    },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  return pickPublicUser(result.after);
}

export async function getCouponDetails(req: Request, code: string) {
  const scope = getCashierScope(req);
  const trimmed = code.trim();
  if (!trimmed) throw new NotFoundError('Coupon not found');

  const out = await withTenantClient({ tenantId: scope.tenantId }, async (client) => {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const tx = await repo.findTransactionByReference(client, scope.tenantId, trimmed);
    const betIdFromTx = (tx?.metadata as { bet_id?: string } | null)?.bet_id;
    const betId = betIdFromTx ?? (isUuid ? trimmed : null);
    if (!betId) return null;
    const betRes = await client.query<{
      id: string;
      user_id: string;
      game_id: string | null;
      stake: string;
      potential_win: string;
      payout: string | null;
      currency: string;
      status: string;
      placed_at: Date;
      settled_at: Date | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, user_id, game_id, stake::text, potential_win::text, payout::text,
              currency, status, placed_at, settled_at, metadata
         FROM bets
        WHERE tenant_id = $1 AND id = $2
        LIMIT 1`,
      [scope.tenantId, betId]
    );
    const bet = betRes.rows[0];
    if (!bet) return null;
    const user = await repo.findUserById(client, bet.user_id);
    if (!user) return null;
    return {
      coupon_code: tx?.reference ?? trimmed,
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
      user: pickPublicUser(user),
      transaction_reference: tx?.reference ?? null,
    };
  });

  if (!out) throw new NotFoundError('Coupon not found');
  return out;
}
