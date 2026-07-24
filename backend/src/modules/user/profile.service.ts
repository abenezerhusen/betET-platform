import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { hashPassword, verifyPassword } from '../auth/password';
import {
  ensureUserReferralCode,
  revokeAllUserRefreshTokens,
} from '../auth/auth.repository';
import { getIp, getUa, getUserScope } from './user-shared';
import { notifySecurityEvent } from '../notifications/security-notifications';
import * as repo from './user.repository';
import type {
  BetsHistoryQuery,
  ChangePasswordInput,
  TransactionsHistoryQuery,
  UpdateProfileInput,
} from './user.dto';

function pickPublicUser(u: repo.PublicUserRow): Record<string, unknown> {
  return {
    id: u.id,
    tenant_id: u.tenant_id,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    kyc_status: u.kyc_status,
    metadata: u.metadata,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
  };
}

/**
 * GET /api/user/me
 * Profile + KYC status + every wallet (one row per currency) +
 * the user's personal referral code (auto-provisioned at registration,
 * lazily backfilled here for legacy accounts).
 */
export async function getMe(req: Request) {
  const scope = getUserScope(req);

  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const user = await repo.findPublicUserById(client, scope.userId);
      if (!user) throw new NotFoundError('User not found');
      const wallets = await repo.listUserWallets(
        client,
        scope.tenantId,
        scope.userId
      );

      // Lazily provision a referral code for legacy users who registered
      // before the code-auto-creation was added. Idempotent.
      const codeRow = await ensureUserReferralCode(client, {
        tenantId: scope.tenantId,
        userId: scope.userId,
        phone: user.phone,
      });

      // Referral stats: count of friends I've successfully referred + total
      // bonus earned from referrals.
      const stats = await client.query<{
        referrals_total: number;
        referrals_rewarded: number;
        bonus_earned: string;
      }>(
        `SELECT COUNT(*) FILTER (WHERE status IN ('pending','rewarded'))::int AS referrals_total,
                COUNT(*) FILTER (WHERE status = 'rewarded')::int AS referrals_rewarded,
                COALESCE(SUM(CASE WHEN status = 'rewarded' THEN bonus_amount ELSE 0 END), 0)::text AS bonus_earned
           FROM referrals
          WHERE tenant_id = $1 AND referrer_id = $2`,
        [scope.tenantId, scope.userId]
      );

      // Streak progress (spec § Tournaments → Streak Settings: user can see
      // their streak in profile).
      const streak = await client.query<{
        current_streak: number;
        longest_streak: number;
        last_bet_date: string | null;
        streak_bonus_earned: string;
      }>(
        `SELECT current_streak, longest_streak, last_bet_date::text, streak_bonus_earned::text
           FROM user_streaks
          WHERE tenant_id = $1 AND user_id = $2`,
        [scope.tenantId, scope.userId]
      );

      return {
        user,
        wallets,
        referral: {
          code: codeRow.code,
          referrals_total: stats.rows[0]?.referrals_total ?? 0,
          referrals_rewarded: stats.rows[0]?.referrals_rewarded ?? 0,
          bonus_earned: Number(stats.rows[0]?.bonus_earned ?? 0),
        },
        streak: {
          current: streak.rows[0]?.current_streak ?? 0,
          longest: streak.rows[0]?.longest_streak ?? 0,
          last_bet_date: streak.rows[0]?.last_bet_date ?? null,
          bonus_earned: Number(streak.rows[0]?.streak_bonus_earned ?? 0),
        },
      };
    }
  );

  return {
    profile: {
      ...pickPublicUser(data.user),
      referral_code: data.referral.code,
      referral_stats: {
        total: data.referral.referrals_total,
        rewarded: data.referral.referrals_rewarded,
        bonus_earned: data.referral.bonus_earned,
      },
      streak: data.streak,
    },
    wallets: data.wallets,
  };
}

export async function updateMe(req: Request, body: UpdateProfileInput) {
  const scope = getUserScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const before = await repo.findPublicUserById(client, scope.userId);
      if (!before) throw new NotFoundError('User not found');
      const after = await repo.updateUserProfile(client, scope.userId, body);
      if (!after) throw new BadRequestError('No fields to update');
      return { before, after };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: 'user.profile.update',
    resource: 'user',
    resourceId: scope.userId,
    payload: {
      before: {
        email: result.before.email,
        phone: result.before.phone,
        metadata: result.before.metadata,
      },
      after: {
        email: result.after.email,
        phone: result.after.phone,
        metadata: result.after.metadata,
      },
    },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  return pickPublicUser(result.after);
}

export async function changePassword(req: Request, body: ChangePasswordInput) {
  const scope = getUserScope(req);

  // Two-step: verify in one tx, then write hash + revoke tokens in another.
  // Failed verification still yields an audit row so brute-force attempts
  // against this endpoint are visible alongside login attempts.
  const verification = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const user = await repo.findFullUserById(client, scope.userId);
      if (!user) {
        return { ok: false as const, reason: 'user_not_found' };
      }
      if (!user.password_hash) {
        return { ok: false as const, reason: 'no_password_set' };
      }
      const valid = await verifyPassword(body.current_password, user.password_hash);
      if (!valid) {
        return { ok: false as const, reason: 'invalid_password' };
      }
      return { ok: true as const, user };
    }
  );

  if (!verification.ok) {
    await tryAudit({
      tenantId: scope.tenantId,
      actorId: scope.userId,
      actorType: 'user',
      action: 'user.password.change',
      resource: 'user',
      resourceId: scope.userId,
      payload: { reason: verification.reason },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'failure',
    });
    throw new UnauthorizedError('Current password is incorrect');
  }

  const newHash = await hashPassword(body.new_password);
  const revokedCount = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      await repo.setUserPasswordHash(client, scope.userId, newHash);
      // Invalidate all sessions on password change. The current session can
      // re-login if needed; this prevents stolen refresh tokens from
      // continuing to work after a password rotation.
      const revoked = await revokeAllUserRefreshTokens(client, scope.userId);
      return revoked;
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: 'user.password.change',
    resource: 'user',
    resourceId: scope.userId,
    payload: { revoked_refresh_tokens: revokedCount },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  void notifySecurityEvent({
    tenantId: scope.tenantId,
    userId: scope.userId,
    event: 'password_changed',
  });

  return { success: true, revoked_refresh_tokens: revokedCount };
}

export async function listMyTransactions(
  req: Request,
  params: TransactionsHistoryQuery
) {
  const scope = getUserScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      repo.listUserTransactions(client, scope.tenantId, scope.userId, {
        type: params.type ?? null,
        status: params.status ?? null,
        from: params.from ?? null,
        to: params.to ?? null,
        limit: params.limit,
        offset,
      })
  );

  return {
    items: data.rows,
    total: data.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.total / params.limit)),
  };
}

export async function listMyBets(req: Request, params: BetsHistoryQuery) {
  const scope = getUserScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      repo.listUserBets(client, scope.tenantId, scope.userId, {
        status: params.status ?? null,
        gameId: params.game_id ?? null,
        from: params.from ?? null,
        to: params.to ?? null,
        limit: params.limit,
        offset,
      })
  );

  return {
    items: data.rows,
    total: data.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.total / params.limit)),
  };
}
