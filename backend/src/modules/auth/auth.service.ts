import crypto from 'crypto';
import { env } from '../../config/env';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import { withCache, Keys, Scopes } from '../../infrastructure/cache';
import {
  BadRequestError,
  ForbiddenError,
  HttpError,
  LockedError,
  UnauthorizedError,
} from '../../http/errors/http-error';
import { writeAudit, type AuditEvent } from '../audit/audit.repository';
import { tryAudit as tryAuditEvent } from '../audit/audit.service';
import * as repo from './auth.repository';
import { getDummyHash, hashPassword, verifyPassword } from './password';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from './tokens.service';
import {
  sendEmailBestEffort,
  sendSmsBestEffort,
} from '../notifications/notifications.service';
import { loadPermissionsForRole } from './permissions.helper';

/* ------------------------------------------------------------------------- *
 * Types
 * ------------------------------------------------------------------------- */

export interface LoginInput {
  email?: string | null;
  phone?: string | null;
  username?: string | null;
  branchId?: string | null;
  password: string;
  ip: string | null;
  userAgent: string | null;
  /**
   * Restrict which roles are allowed to authenticate via this entry point.
   * The check runs **after** password verification but **before** token
   * issuance — so a wrong-role login never receives a refresh token nor
   * leaves a "success" audit trail. Used to split the User Panel login
   * (only 'user'/'affiliate') from the Admin Panel login (admin tier).
   */
  allowedRoles?: ReadonlySet<string>;
}

export interface RegisterInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  password: string;
  referralCode?: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  user: {
    id: string;
    tenant_id: string;
    role: string;
    email: string | null;
    phone: string | null;
    /**
     * Section 22 — flattened permission IDs for the role.
     * Super admin carries ['*']; the frontend treats it as a wildcard.
     */
    permissions: string[];
  };
}

type Outcome<T> =
  | { kind: 'success'; value: T; audit: AuditEvent }
  | { kind: 'failure'; error: HttpError; audit: AuditEvent };

interface RuntimeAuthSecuritySettings {
  sessionTimeoutMinutes: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
}

async function loadRuntimeAuthSecuritySettings(
  tenantId: string
): Promise<RuntimeAuthSecuritySettings> {
  const key = Keys.tenantSetting(tenantId, 'security.config.auth_runtime');
  const scope = Scopes.tenantSettings(tenantId);
  return withCache(
    key,
    async () =>
      withTenantClient({ tenantId }, async (client) => {
        const row = await repo.getAuthSecuritySettings(client, tenantId);
        return {
          sessionTimeoutMinutes: row.session_timeout_minutes,
          maxFailedLogins: row.max_failed_logins,
          lockoutMinutes: row.lockout_minutes,
        };
      }),
    { ttl: 60, scope }
  );
}

/* ------------------------------------------------------------------------- *
 * Audit helper
 *
 * Audit writes always happen in a transaction SEPARATE from the work
 * transaction so that:
 *   - state changes (incrementFailedAttempts, revokeFamily, insertRefreshToken)
 *     committed by the work txn are not lost when the service later throws,
 *   - audit log inserts are not lost when the work txn rolls back.
 *
 * Audit failures are logged but never propagated; they must not turn a
 * successful login into a 5xx.
 * ------------------------------------------------------------------------- */

async function tryAudit(tenantId: string, event: AuditEvent): Promise<void> {
  try {
    await withTenantClient({ tenantId }, async (client) => {
      await writeAudit(client, event);
    });
  } catch (err) {
    logger.error(
      { err, action: event.action, status: event.status, resource: event.resource },
      'failed to write audit log'
    );
  }
}

/* ------------------------------------------------------------------------- *
 * Login
 * ------------------------------------------------------------------------- */

export async function login(tenantId: string, input: LoginInput): Promise<TokenPair> {
  const security = await loadRuntimeAuthSecuritySettings(tenantId);
  const outcome = await withTenantClient({ tenantId }, async (client): Promise<
    Outcome<TokenPair>
  > => {
    const user = await repo.findUserForLogin(
      client,
      tenantId,
      input.email ?? null,
      input.phone ?? null,
      input.username ?? null
    );

    if (!user) {
      // Constant-time bcrypt compare against a dummy hash to mitigate
      // user-enumeration via response timing.
      await verifyPassword(input.password, await getDummyHash());
      return {
        kind: 'failure',
        error: new UnauthorizedError('Invalid credentials'),
        audit: {
          tenantId,
          actorId: null,
          actorType: 'anonymous',
          action: 'auth.login',
          resource: 'user',
          resourceId: null,
          payload: {
            reason: 'user_not_found',
            identifier_type: input.email
              ? 'email'
              : input.phone
                ? 'phone'
                : 'username',
          },
          ip: input.ip,
          userAgent: input.userAgent,
          status: 'failure',
        },
      };
    }

    // Spec: Super Admin can always log in even when locked (emergency access).
    // For every other role we honour the temporary account lock.
    if (
      user.locked_until &&
      user.locked_until > new Date() &&
      user.role !== 'superadmin'
    ) {
      return {
        kind: 'failure',
        error: new LockedError('Account is temporarily locked', {
          locked_until: user.locked_until.toISOString(),
        }),
        audit: {
          tenantId,
          actorId: user.id,
          actorType: 'user',
          action: 'auth.login',
          resource: 'user',
          resourceId: user.id,
          payload: {
            reason: 'account_locked',
            locked_until: user.locked_until.toISOString(),
          },
          ip: input.ip,
          userAgent: input.userAgent,
          status: 'failure',
        },
      };
    }

    if (user.status !== 'active') {
      return {
        kind: 'failure',
        error: new ForbiddenError(`Account is ${user.status}`, {
          account_status: user.status,
        }),
        audit: {
          tenantId,
          actorId: user.id,
          actorType: 'user',
          action: 'auth.login',
          resource: 'user',
          resourceId: user.id,
          payload: { reason: 'account_inactive', status: user.status },
          ip: input.ip,
          userAgent: input.userAgent,
          status: 'failure',
        },
      };
    }

    if (!user.password_hash) {
      return {
        kind: 'failure',
        error: new UnauthorizedError('Invalid credentials'),
        audit: {
          tenantId,
          actorId: user.id,
          actorType: 'user',
          action: 'auth.login',
          resource: 'user',
          resourceId: user.id,
          payload: { reason: 'no_password_set' },
          ip: input.ip,
          userAgent: input.userAgent,
          status: 'failure',
        },
      };
    }

    const passwordOk = await verifyPassword(input.password, user.password_hash);
    if (!passwordOk) {
      const newAttempts = user.failed_login_attempts + 1;
      let lockUntil: Date | null = null;
      if (newAttempts >= security.maxFailedLogins) {
        lockUntil = new Date(
          Date.now() + security.lockoutMinutes * 60 * 1000
        );
      }
      // IMPORTANT: this UPDATE must commit so the lock-out actually works.
      await repo.incrementFailedAttempts(client, user.id, lockUntil);

      const error: HttpError = lockUntil
        ? new LockedError('Account locked due to too many failed attempts', {
            locked_until: lockUntil.toISOString(),
          })
        : new UnauthorizedError('Invalid credentials');

      return {
        kind: 'failure',
        error,
        audit: {
          tenantId,
          actorId: user.id,
          actorType: 'user',
          action: 'auth.login',
          resource: 'user',
          resourceId: user.id,
          payload: {
            reason: 'invalid_password',
            attempts: newAttempts,
            locked: Boolean(lockUntil),
            ...(lockUntil ? { locked_until: lockUntil.toISOString() } : {}),
          },
          ip: input.ip,
          userAgent: input.userAgent,
          status: 'failure',
        },
      };
    }

    if (input.branchId) {
      const md = (user.metadata as Record<string, unknown> | null) ?? {};
      const expectedBranchCode =
        typeof md.branch_code === 'string' ? md.branch_code.trim() : '';
      const expectedLegacyBranchCode =
        typeof md.branch_id === 'string' ? md.branch_id.trim() : '';
      const expectedBranchUserId =
        typeof md.branch_user_id === 'string' ? md.branch_user_id.trim() : '';
      const provided = input.branchId.trim();
      let isMatch =
        (expectedBranchCode && expectedBranchCode === provided) ||
        (expectedLegacyBranchCode && expectedLegacyBranchCode === provided) ||
        (expectedBranchUserId && expectedBranchUserId === provided);

      // Many sales/cashier accounts store branch linkage as branch user UUID
      // while operators type a human branch code/username. Treat them as equal
      // if the provided identifier resolves to the same branch user record.
      if (!isMatch && expectedLegacyBranchCode) {
        isMatch = await repo.branchIdentifierMatchesBranchUserId(
          client,
          tenantId,
          expectedLegacyBranchCode,
          provided
        );
      }
      if (!isMatch && expectedBranchUserId) {
        isMatch = await repo.branchIdentifierMatchesBranchUserId(
          client,
          tenantId,
          expectedBranchUserId,
          provided
        );
      }

      // Cashier accounts may be created without explicit branch metadata.
      // In that case, accept any valid branch identifier from the same tenant.
      if (!isMatch && ['cashier', 'sales'].includes(user.role)) {
        isMatch = await repo.branchIdentifierExists(client, tenantId, provided);
      }
      if (!isMatch) {
        return {
          kind: 'failure',
          error: new ForbiddenError('Invalid Branch ID for this account'),
          audit: {
            tenantId,
            actorId: user.id,
            actorType: 'user',
            action: 'auth.login',
            resource: 'user',
            resourceId: user.id,
            payload: {
              reason: 'branch_mismatch',
              provided_branch_id: provided,
              expected_branch_id:
                expectedBranchCode ||
                expectedLegacyBranchCode ||
                expectedBranchUserId ||
                null,
            },
            ip: input.ip,
            userAgent: input.userAgent,
            status: 'failure',
          },
        };
      }
    }

    // Role-gate: the controller can pass an allowedRoles set to restrict
    // which roles may authenticate through this entry point. We perform
    // the check AFTER password verification (so we never leak whether a
    // given identifier exists) and BEFORE token issuance (so an unwanted
    // role never receives credentials, nor leaves a "success" audit row).
    if (input.allowedRoles && !input.allowedRoles.has(user.role)) {
      return {
        kind: 'failure',
        error: new ForbiddenError(
          'This account cannot sign in here. Please use the correct login page for your role.',
          { account_role: user.role }
        ),
        audit: {
          tenantId,
          actorId: user.id,
          actorType: 'user',
          action: 'auth.login',
          resource: 'user',
          resourceId: user.id,
          payload: {
            reason: 'role_not_allowed',
            account_role: user.role,
          },
          ip: input.ip,
          userAgent: input.userAgent,
          status: 'failure',
        },
      };
    }

    // Success path.
    await repo.resetFailedAttempts(client, user.id);

    const familyId = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();
    const accessJti = crypto.randomUUID();

    // Section 22 — resolve permissions from the `roles` row before
    // issuing the access token so the JWT carries them inline.
    const permissions = await loadPermissionsForRole(client, tenantId, user.role);

    const refreshOut = signRefreshToken({
      sub: user.id,
      tid: tenantId,
      fid: familyId,
      jti: refreshJti,
    });
    const accessOut = signAccessToken({
      sub: user.id,
      tid: tenantId,
      role: user.role,
      permissions,
      jti: accessJti,
      expiresIn: `${security.sessionTimeoutMinutes}m`,
    });

    await repo.insertRefreshToken(client, {
      tenantId,
      userId: user.id,
      jti: refreshJti,
      familyId,
      parentId: null,
      tokenHash: refreshOut.tokenHash,
      expiresAt: refreshOut.expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    const tokens: TokenPair = {
      access_token: accessOut.token,
      refresh_token: refreshOut.token,
      access_token_expires_at: accessOut.expiresAt.toISOString(),
      refresh_token_expires_at: refreshOut.expiresAt.toISOString(),
      user: {
        id: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        email: user.email,
        phone: user.phone,
        permissions,
      },
    };

    return {
      kind: 'success',
      value: tokens,
      audit: {
        tenantId,
        actorId: user.id,
        actorType: 'user',
        action: 'auth.login',
        resource: 'user',
        resourceId: user.id,
        payload: {
          access_jti: accessJti,
          refresh_jti: refreshJti,
          family_id: familyId,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        status: 'success',
      },
    };
  });

  await tryAudit(tenantId, outcome.audit);
  if (outcome.kind === 'failure') throw outcome.error;
  return outcome.value;
}

export async function register(tenantId: string, input: RegisterInput) {
  const created = await withTenantClient({ tenantId }, async (client) => {
    const existing = await repo.findUserForLogin(
      client,
      tenantId,
      input.email ?? null,
      input.phone ?? null,
      null
    );
    if (existing) {
      throw new BadRequestError('User already exists');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await repo.insertPublicUser(client, {
      tenantId,
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash,
      fullName: input.fullName,
    });
    if (input.referralCode?.trim()) {
      const code = input.referralCode.trim();
      // Resolve the code to a referrer. Order matters: friend codes
      // (`referral_codes`) come first, then commercial affiliates.
      const userCode = await repo.findActiveReferralCode(client, tenantId, code);
      if (userCode && userCode.user_id !== user.id) {
        await repo.insertReferralLink(client, {
          tenantId,
          referrerId: userCode.user_id,
          referredId: user.id,
          code: userCode.code,
        });
        await repo.incrementReferralCodeUses(client, userCode.id);
      } else {
        const affiliate = await repo.findActiveAffiliateByCode(
          client,
          tenantId,
          code
        );
        if (affiliate?.user_id) {
          await repo.insertReferralLink(client, {
            tenantId,
            referrerId: affiliate.user_id,
            referredId: user.id,
            code: affiliate.code,
          });
        }
      }
    }
    // Every new account gets a personal share-with-friends referral code.
    await repo.ensureUserReferralCode(client, {
      tenantId,
      userId: user.id,
      phone: user.phone,
    });
    return user;
  });

  await tryAudit(tenantId, {
    tenantId,
    actorId: created.id,
    actorType: 'user',
    action: 'auth.register',
    resource: 'user',
    resourceId: created.id,
    payload: {
      role: created.role,
      phone: created.phone,
      email: created.email,
      referral_code: input.referralCode ?? null,
    },
    ip: input.ip,
    userAgent: input.userAgent,
    status: 'success',
  });

  const fullName =
    (created.metadata as { full_name?: string } | null)?.full_name ??
    input.fullName;
  await Promise.all([
    sendSmsBestEffort({
      tenantId,
      to: created.phone,
      templateCode: 'auth_register_welcome',
      message: `Welcome {name}! Your account has been created successfully.`,
      variables: { name: fullName },
    }),
    sendEmailBestEffort({
      tenantId,
      to: created.email,
      subject: 'Welcome to PlayCore',
      body: `Hi ${fullName}, your account is ready.`,
    }),
  ]);

  return created;
}

/* ------------------------------------------------------------------------- *
 * Refresh
 * ------------------------------------------------------------------------- */

export async function refresh(
  refreshTokenStr: string,
  ip: string | null,
  userAgent: string | null
): Promise<TokenPair> {
  let claims: ReturnType<typeof verifyRefreshToken>;
  try {
    claims = verifyRefreshToken(refreshTokenStr);
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    throw name === 'TokenExpiredError'
      ? new UnauthorizedError('Refresh token expired')
      : new UnauthorizedError('Invalid refresh token');
  }

  const tenantId = claims.tid;
  const userId = claims.sub;
  const jti = claims.jti;
  const presentedHash = hashToken(refreshTokenStr);

  const outcome = await withTenantClient({ tenantId }, async (client): Promise<
    Outcome<TokenPair>
  > => {
    const stored = await repo.findRefreshTokenByJti(client, jti);

    if (!stored) {
      return {
        kind: 'failure',
        error: new UnauthorizedError('Invalid refresh token'),
        audit: {
          tenantId,
          actorId: userId,
          actorType: 'user',
          action: 'auth.refresh',
          resource: 'refresh_token',
          resourceId: jti,
          payload: { reason: 'token_unknown' },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }

    // Hash mismatch implies forgery / leak -> revoke entire family.
    if (stored.token_hash !== presentedHash) {
      await repo.revokeFamily(client, stored.family_id);
      return {
        kind: 'failure',
        error: new UnauthorizedError('Refresh token compromised'),
        audit: {
          tenantId,
          actorId: userId,
          actorType: 'user',
          action: 'auth.refresh',
          resource: 'refresh_token',
          resourceId: stored.id,
          payload: {
            reason: 'token_hash_mismatch_revoke_family',
            family_id: stored.family_id,
          },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }

    if (stored.status !== 'active') {
      // Replay of a rotated token: assume leak, revoke whole family.
      if (stored.status === 'rotated') {
        await repo.revokeFamily(client, stored.family_id);
      }
      return {
        kind: 'failure',
        error: new UnauthorizedError('Refresh token is not active'),
        audit: {
          tenantId,
          actorId: userId,
          actorType: 'user',
          action: 'auth.refresh',
          resource: 'refresh_token',
          resourceId: stored.id,
          payload: {
            reason: 'token_not_active',
            status: stored.status,
            family_id: stored.family_id,
          },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }

    if (stored.expires_at < new Date()) {
      return {
        kind: 'failure',
        error: new UnauthorizedError('Refresh token expired'),
        audit: {
          tenantId,
          actorId: userId,
          actorType: 'user',
          action: 'auth.refresh',
          resource: 'refresh_token',
          resourceId: stored.id,
          payload: { reason: 'token_expired' },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }

    const user = await repo.findUserById(client, userId);
    if (!user) {
      await repo.revokeFamily(client, stored.family_id);
      return {
        kind: 'failure',
        error: new UnauthorizedError('User not found'),
        audit: {
          tenantId,
          actorId: userId,
          actorType: 'user',
          action: 'auth.refresh',
          resource: 'refresh_token',
          resourceId: stored.id,
          payload: { reason: 'user_not_found', family_id: stored.family_id },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }
    if (user.status !== 'active') {
      await repo.revokeFamily(client, stored.family_id);
      return {
        kind: 'failure',
        error: new ForbiddenError(`Account is ${user.status}`),
        audit: {
          tenantId,
          actorId: user.id,
          actorType: 'user',
          action: 'auth.refresh',
          resource: 'refresh_token',
          resourceId: stored.id,
          payload: { reason: 'account_inactive', status: user.status },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }
    // Same emergency-access rule as login: never block super-admin refresh.
    if (
      user.locked_until &&
      user.locked_until > new Date() &&
      user.role !== 'superadmin'
    ) {
      await repo.revokeFamily(client, stored.family_id);
      return {
        kind: 'failure',
        error: new LockedError('Account is temporarily locked', {
          locked_until: user.locked_until.toISOString(),
        }),
        audit: {
          tenantId,
          actorId: user.id,
          actorType: 'user',
          action: 'auth.refresh',
          resource: 'refresh_token',
          resourceId: stored.id,
          payload: {
            reason: 'account_locked',
            locked_until: user.locked_until.toISOString(),
          },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }

    // Rotate.
    await repo.rotateRefreshToken(client, stored.id);

    const newRefreshJti = crypto.randomUUID();
    const newAccessJti = crypto.randomUUID();

    // Section 22 — re-resolve permissions on refresh so admins
    // immediately pick up any role permission edits made while their
    // session was active.
    const permissions = await loadPermissionsForRole(client, tenantId, user.role);

    const refreshOut = signRefreshToken({
      sub: user.id,
      tid: tenantId,
      fid: stored.family_id,
      jti: newRefreshJti,
    });
    const accessOut = signAccessToken({
      sub: user.id,
      tid: tenantId,
      role: user.role,
      permissions,
      jti: newAccessJti,
    });

    await repo.insertRefreshToken(client, {
      tenantId,
      userId: user.id,
      jti: newRefreshJti,
      familyId: stored.family_id,
      parentId: stored.id,
      tokenHash: refreshOut.tokenHash,
      expiresAt: refreshOut.expiresAt,
      ip,
      userAgent,
    });

    const tokens: TokenPair = {
      access_token: accessOut.token,
      refresh_token: refreshOut.token,
      access_token_expires_at: accessOut.expiresAt.toISOString(),
      refresh_token_expires_at: refreshOut.expiresAt.toISOString(),
      user: {
        id: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        email: user.email,
        phone: user.phone,
        permissions,
      },
    };

    return {
      kind: 'success',
      value: tokens,
      audit: {
        tenantId,
        actorId: user.id,
        actorType: 'user',
        action: 'auth.refresh',
        resource: 'refresh_token',
        resourceId: stored.id,
        payload: {
          rotated_to_jti: newRefreshJti,
          family_id: stored.family_id,
        },
        ip,
        userAgent,
        status: 'success',
      },
    };
  });

  await tryAudit(tenantId, outcome.audit);
  if (outcome.kind === 'failure') throw outcome.error;
  return outcome.value;
}

/* ------------------------------------------------------------------------- *
 * Logout
 * ------------------------------------------------------------------------- */

export async function logout(
  refreshTokenStr: string,
  ip: string | null,
  userAgent: string | null
): Promise<void> {
  let claims: ReturnType<typeof verifyRefreshToken>;
  try {
    claims = verifyRefreshToken(refreshTokenStr);
  } catch {
    // Logout is idempotent. Swallow invalid-token errors silently.
    return;
  }

  const tenantId = claims.tid;
  const userId = claims.sub;
  const jti = claims.jti;

  const audit = await withTenantClient({ tenantId }, async (client) => {
    const stored = await repo.findRefreshTokenByJti(client, jti);
    if (stored) {
      await repo.revokeRefreshToken(client, stored.id);
    }
    const event: AuditEvent = {
      tenantId,
      actorId: userId,
      actorType: 'user',
      action: 'auth.logout',
      resource: 'refresh_token',
      resourceId: stored?.id ?? null,
      payload: { jti },
      ip,
      userAgent,
      status: 'success',
    };
    return event;
  });

  await tryAudit(tenantId, audit);
}

/* ------------------------------------------------------------------------- *
 * Forgot password
 * ------------------------------------------------------------------------- */

export async function forgotPassword(
  tenantId: string,
  email: string | null,
  phone: string | null,
  ip: string | null,
  userAgent: string | null
): Promise<{ devToken?: string }> {
  const outcome = await withTenantClient({ tenantId }, async (client): Promise<{
    audit: AuditEvent;
    devToken?: string;
    resetToken?: string;
    email?: string | null;
    phone?: string | null;
  }> => {
    const user = await repo.findUserForLogin(client, tenantId, email, phone, null);

    if (!user) {
      return {
        audit: {
          tenantId,
          actorId: null,
          actorType: 'anonymous',
          action: 'auth.forgot_password',
          resource: 'user',
          resourceId: null,
          payload: {
            reason: 'user_not_found',
            identifier_type: email ? 'email' : 'phone',
          },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000
    );

    await repo.insertPasswordResetToken(client, {
      tenantId,
      userId: user.id,
      tokenHash,
      expiresAt,
      ip,
      userAgent,
    });

    return {
      audit: {
        tenantId,
        actorId: user.id,
        actorType: 'user',
        action: 'auth.forgot_password',
        resource: 'user',
        resourceId: user.id,
        payload: { expires_at: expiresAt.toISOString() },
        ip,
        userAgent,
        status: 'success',
      },
      devToken: rawToken,
      resetToken: rawToken,
      email: user.email,
      phone: user.phone,
    };
  });

  await tryAudit(tenantId, outcome.audit);

  if (outcome.resetToken) {
    await Promise.all([
      sendSmsBestEffort({
        tenantId,
        to: outcome.phone,
        templateCode: 'auth_password_reset',
        message: 'Password reset token: {token}. It expires in {minutes} minutes.',
        variables: {
          token: outcome.resetToken,
          minutes: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
        },
      }),
      sendEmailBestEffort({
        tenantId,
        to: outcome.email,
        subject: 'Password reset token',
        body: `Your password reset token is ${outcome.resetToken}. It expires in ${env.PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.`,
      }),
    ]);
  }

  if (env.NODE_ENV !== 'production' && outcome.devToken) {
    // Production must deliver this token via SMS/email through the
    // notifications module. We log it in dev/test only for QA.
    logger.info(
      { audit_action: 'auth.forgot_password' },
      'password_reset_token_issued (dev only)'
    );
    return { devToken: outcome.devToken };
  }
  return {};
}

/* ------------------------------------------------------------------------- *
 * Reset password
 * ------------------------------------------------------------------------- */

export async function resetPassword(
  tenantId: string,
  token: string,
  newPassword: string,
  ip: string | null,
  userAgent: string | null
): Promise<void> {
  const tokenHash = hashToken(token);

  const outcome = await withTenantClient({ tenantId }, async (client): Promise<
    Outcome<undefined>
  > => {
    const row = await repo.findValidPasswordResetToken(client, tokenHash);
    if (!row) {
      return {
        kind: 'failure',
        error: new UnauthorizedError('Invalid or expired token'),
        audit: {
          tenantId,
          actorId: null,
          actorType: 'anonymous',
          action: 'auth.reset_password',
          resource: 'password_reset_token',
          resourceId: null,
          payload: { reason: 'invalid_or_expired' },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }

    const passwordHash = await hashPassword(newPassword);
    await repo.updateUserPassword(client, row.user_id, passwordHash);
    await repo.markPasswordResetTokenUsed(client, row.id);
    // Invalidate every active session for this user.
    await repo.revokeAllUserRefreshTokens(client, row.user_id);
    // Clear lockout state on successful self-service reset.
    await repo.resetFailedAttempts(client, row.user_id);

    return {
      kind: 'success',
      value: undefined,
      audit: {
        tenantId,
        actorId: row.user_id,
        actorType: 'user',
        action: 'auth.reset_password',
        resource: 'user',
        resourceId: row.user_id,
        payload: { reset_token_id: row.id },
        ip,
        userAgent,
        status: 'success',
      },
    };
  });

  await tryAudit(tenantId, outcome.audit);
  if (outcome.kind === 'failure') throw outcome.error;
}

/* ------------------------------------------------------------------------- *
 * Cashier helpers (Section 16)
 * ------------------------------------------------------------------------- */

/**
 * Resolve the branch the cashier belongs to (from `users.metadata`).
 *
 * Cashiers / sales accounts are linked to their branch through
 * `metadata.branch_id` (UUID of the user row whose role='branch'). This
 * helper turns that link into a small response object the cashier panel
 * renders in the header after login.
 */
export async function getBranchForCashier(
  tenantId: string,
  cashierUserId: string
): Promise<{
  id: string;
  user_id: string;
  branch_code: string | null;
  label: string | null;
} | null> {
  return withTenantClient({ tenantId }, async (client) => {
    const userRes = await client.query<{
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT metadata FROM users WHERE id = $1 LIMIT 1`,
      [cashierUserId]
    );
    const meta = userRes.rows[0]?.metadata ?? {};
    const branchUserId =
      typeof meta.branch_id === 'string' ? meta.branch_id : null;
    const branchCode =
      typeof meta.branch_code === 'string' ? meta.branch_code : null;
    if (!branchUserId && !branchCode) return null;

    // Pull the branch row (a user with role='branch') for its display
    // name. Tenancy is implicit (RLS) but we re-assert via tenant_id.
    const branchRes = await client.query<{
      id: string;
      email: string | null;
      phone: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT id, email, phone, metadata
         FROM users
        WHERE tenant_id = $1
          AND role = 'branch'
          AND (${branchUserId ? 'id = $2' : '$2::uuid IS NULL'} OR metadata->>'branch_code' = $3)
        LIMIT 1`,
      [tenantId, branchUserId, branchCode]
    );
    const b = branchRes.rows[0];
    if (!b) {
      return {
        id: branchUserId ?? '',
        user_id: branchUserId ?? '',
        branch_code: branchCode,
        label: branchCode,
      };
    }
    const bm = (b.metadata ?? {}) as Record<string, unknown>;
    return {
      id: b.id,
      user_id: b.id,
      branch_code:
        (typeof bm.branch_code === 'string' && bm.branch_code) || branchCode,
      label:
        (typeof bm.label === 'string' && bm.label) ||
        (typeof bm.name === 'string' && bm.name) ||
        b.email ||
        b.phone ||
        null,
    };
  });
}

interface ChangePasswordForUserInput {
  userId: string;
  tenantId: string;
  currentPassword: string;
  newPassword: string;
  ip: string | null;
  userAgent: string | null;
  /**
   * If set, only users whose role is in this set may change their
   * password through this entry point. We use this from the cashier
   * panel so an admin token can't bypass the staff flow.
   */
  allowedRoles?: ReadonlySet<string>;
}

/**
 * Self-service password change for an authenticated user.
 *
 * Verifies the current password, hashes the new one, persists it, and
 * invalidates every active refresh token (so the user must sign in
 * again on every device — a defensive default for shop-floor accounts).
 */
export async function changePasswordForUser(
  input: ChangePasswordForUserInput
): Promise<void> {
  const { userId, tenantId, currentPassword, newPassword } = input;
  await withTenantClient({ tenantId }, async (client) => {
    const user = await repo.findUserById(client, userId);
    if (!user || user.tenant_id !== tenantId) {
      throw new UnauthorizedError('Invalid credentials');
    }
    if (input.allowedRoles && !input.allowedRoles.has(user.role)) {
      throw new ForbiddenError('Account role is not allowed for this operation');
    }
    const ok = user.password_hash
      ? await verifyPassword(currentPassword, user.password_hash)
      : false;
    if (!ok) {
      throw new UnauthorizedError('Current password is incorrect');
    }
    const hash = await hashPassword(newPassword);
    await repo.updateUserPassword(client, user.id, hash);
    await repo.revokeAllUserRefreshTokens(client, user.id);
  });

  await tryAuditEvent({
    tenantId,
    actorId: userId,
    actorType: 'user',
    action: 'auth.password.change',
    resource: 'user',
    resourceId: userId,
    payload: {},
    ip: input.ip,
    userAgent: input.userAgent,
    status: 'success',
  });
}

export { HttpError };
