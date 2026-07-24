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
import {
  requestOtp,
  verifyOtp,
  isOtpRequired,
  type VerifyOtpResult,
} from '../notifications/otp.service';
import { loadEffectivePermissionsForUser } from './permissions.helper';

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
  /** OTP verification code — required only when a notification provider
   *  is enabled (SMS or Telegram). Ignored when both are disabled. */
  otpCode?: string | null;
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

    // Section 22 + Section 23 — resolve permissions before issuing the
    // access token. The effective list honours any per-user override that
    // was saved through the Role Settings modal; otherwise we fall back
    // to the role-level defaults from the `roles` table.
    const permissions = await loadEffectivePermissionsForUser(client, tenantId, {
      role: user.role,
      metadata: (user.metadata ?? null) as Record<string, unknown> | null,
    });

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
  // Registration OTP gate. When a provider is enabled (SMS or Telegram),
  // the phone/email must be verified with an OTP before the account is
  // created. When both providers are disabled, registration proceeds
  // directly (no verification screen) — exactly the legacy behaviour.
  const otpIdentifier = input.phone ?? input.email ?? null;
  if (await isOtpRequired(tenantId)) {
    const code = input.otpCode?.trim();
    if (!code || !otpIdentifier) {
      throw new BadRequestError('Verification code required', {
        reason: 'otp_required',
      });
    }
    const verdict = await verifyOtp({
      tenantId,
      purpose: 'register',
      identifier: otpIdentifier,
      code,
    });
    if (!verdict.ok) {
      throw new BadRequestError('Invalid or expired verification code', {
        reason: verdict.reason ?? 'otp_invalid',
        ...(verdict.attemptsRemaining !== undefined
          ? { attempts_remaining: verdict.attemptsRemaining }
          : {}),
        ...(verdict.retryAfterSeconds !== undefined
          ? { retry_after_seconds: verdict.retryAfterSeconds }
          : {}),
      });
    }
  }

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
      subject: 'Welcome to 1birr.bet',
      body: `Hi ${fullName}, your account is ready.`,
    }),
  ]);

  return created;
}

/* ------------------------------------------------------------------------- *
 * Registration OTP request
 * ------------------------------------------------------------------------- */

/**
 * Sends a registration OTP to the supplied phone/email when a notification
 * provider is enabled. Returns `{ required: false }` when both providers
 * are disabled so the caller can register without a verification step.
 */
export async function requestRegistrationOtp(
  tenantId: string,
  email: string | null,
  phone: string | null,
  ip: string | null,
  userAgent: string | null
) {
  const identifier = phone ?? email;
  if (!identifier) {
    throw new BadRequestError('Phone or email required');
  }

  // Reject duplicates up-front so users don't waste an OTP on a taken
  // identifier (mirrors the check inside register()).
  const existing = await withTenantClient({ tenantId }, async (client) =>
    repo.findUserForLogin(client, tenantId, email, phone, null)
  );
  if (existing) {
    throw new BadRequestError('User already exists');
  }

  return requestOtp({
    tenantId,
    purpose: 'register',
    identifier,
    ip,
    userAgent,
  });
}

/* ------------------------------------------------------------------------- *
 * Password reset via OTP
 * ------------------------------------------------------------------------- */

/**
 * Sends a password-reset OTP through the active provider. Always returns a
 * generic result (never reveals whether the account exists). When no
 * provider is enabled, `required` is false and the UI should hide the
 * forgot-password entry entirely.
 */
export async function requestPasswordResetOtp(
  tenantId: string,
  email: string | null,
  phone: string | null,
  ip: string | null,
  userAgent: string | null
): Promise<{
  required: boolean;
  sent: boolean;
  channel: string | null;
  status: 'sent' | 'cooldown' | 'blocked' | 'skipped';
  retryAfterSeconds?: number;
  cooldownSeconds?: number;
  devCode?: string;
}> {
  const required = await isOtpRequired(tenantId);
  if (!required) {
    return { required: false, sent: false, channel: null, status: 'skipped' };
  }

  const identifier = phone ?? email;
  if (!identifier) {
    return { required: true, sent: false, channel: null, status: 'sent' };
  }

  const user = await withTenantClient({ tenantId }, async (client) =>
    repo.findUserForLogin(client, tenantId, email, phone, null)
  );
  if (!user) {
    // Do not reveal non-existence; pretend a code was dispatched.
    return { required: true, sent: false, channel: null, status: 'sent' };
  }

  const res = await requestOtp({
    tenantId,
    purpose: 'password_reset',
    identifier,
    userId: user.id,
    ip,
    userAgent,
  });
  return {
    required: true,
    sent: res.sent,
    channel: res.channel,
    status: res.status,
    ...(res.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: res.retryAfterSeconds }
      : {}),
    ...(res.cooldownSeconds !== undefined
      ? { cooldownSeconds: res.cooldownSeconds }
      : {}),
    ...(res.devCode ? { devCode: res.devCode } : {}),
  };
}

/**
 * Verifies a password-reset OTP WITHOUT consuming it. Used by the two-step
 * reset UI: the user enters the code, we confirm it is valid (right code,
 * not expired, not blocked), and only then reveal the new-password screen.
 * The code stays active so `resetPasswordWithOtp` can consume it on submit.
 */
export async function verifyPasswordResetOtp(
  tenantId: string,
  email: string | null,
  phone: string | null,
  code: string
): Promise<VerifyOtpResult> {
  const identifier = phone ?? email;
  if (!identifier) {
    throw new BadRequestError('Phone or email required');
  }
  return verifyOtp({
    tenantId,
    purpose: 'password_reset',
    identifier,
    code,
    consume: false,
  });
}

/**
 * Verifies a password-reset OTP and sets the new password. Revokes all
 * sessions and clears lockout on success (same side effects as the
 * token-based reset).
 */
export async function resetPasswordWithOtp(
  tenantId: string,
  email: string | null,
  phone: string | null,
  code: string,
  newPassword: string,
  ip: string | null,
  userAgent: string | null
): Promise<void> {
  const identifier = phone ?? email;
  if (!identifier) {
    throw new BadRequestError('Phone or email required');
  }

  const verdict = await verifyOtp({
    tenantId,
    purpose: 'password_reset',
    identifier,
    code,
  });
  if (!verdict.ok) {
    throw new UnauthorizedError('Invalid or expired verification code', {
      reason: verdict.reason ?? 'otp_invalid',
      ...(verdict.attemptsRemaining !== undefined
        ? { attempts_remaining: verdict.attemptsRemaining }
        : {}),
      ...(verdict.retryAfterSeconds !== undefined
        ? { retry_after_seconds: verdict.retryAfterSeconds }
        : {}),
    });
  }

  const outcome = await withTenantClient({ tenantId }, async (client): Promise<
    Outcome<undefined>
  > => {
    const user = await repo.findUserForLogin(client, tenantId, email, phone, null);
    if (!user) {
      return {
        kind: 'failure',
        error: new UnauthorizedError('Invalid or expired verification code'),
        audit: {
          tenantId,
          actorId: null,
          actorType: 'anonymous',
          action: 'auth.reset_password_otp',
          resource: 'user',
          resourceId: null,
          payload: { reason: 'user_not_found' },
          ip,
          userAgent,
          status: 'failure',
        },
      };
    }

    const passwordHash = await hashPassword(newPassword);
    await repo.updateUserPassword(client, user.id, passwordHash);
    await repo.revokeAllUserRefreshTokens(client, user.id);
    await repo.resetFailedAttempts(client, user.id);

    return {
      kind: 'success',
      value: undefined,
      audit: {
        tenantId,
        actorId: user.id,
        actorType: 'user',
        action: 'auth.reset_password_otp',
        resource: 'user',
        resourceId: user.id,
        payload: { via: 'otp' },
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

    // Section 22 + Section 23 — re-resolve permissions on refresh so any
    // role-level OR per-user permission edits made while the session was
    // active are picked up immediately on the next token rotation.
    const permissions = await loadEffectivePermissionsForUser(client, tenantId, {
      role: user.role,
      metadata: (user.metadata ?? null) as Record<string, unknown> | null,
    });

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
    const branchIdRaw =
      typeof meta.branch_id === 'string' ? meta.branch_id : null;
    const branchCodeMeta =
      typeof meta.branch_code === 'string' ? meta.branch_code : null;
    const branchLabelMeta =
      typeof meta.branch_label === 'string' ? meta.branch_label : null;
    if (!branchIdRaw && !branchCodeMeta) return null;

    // `metadata.branch_id` can hold EITHER a UUID FK to a role='branch'
    // user (newer admin flow) OR a human label like "PC001" (seed / legacy
    // data). Only treat it as a UUID when it actually parses as one — this
    // mirrors how the cashier tickets module resolves the branch and avoids
    // a 22P02 "invalid input syntax for type uuid" crash on login.
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const branchUuid = branchIdRaw && UUID_RE.test(branchIdRaw) ? branchIdRaw : null;
    // When branch_id is not a UUID, treat it as the branch code/label.
    const branchCode =
      branchCodeMeta ?? (branchIdRaw && !branchUuid ? branchIdRaw : null);

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
          AND (
            ($2::uuid IS NOT NULL AND id = $2::uuid)
            OR ($3::text IS NOT NULL AND metadata->>'branch_code' = $3)
          )
        LIMIT 1`,
      [tenantId, branchUuid, branchCode]
    );
    const b = branchRes.rows[0];
    if (!b) {
      // No dedicated branch user row — surface the label the cashier was
      // configured with so the panel header still shows the branch.
      const label = branchLabelMeta ?? branchCode ?? branchIdRaw;
      return {
        id: branchUuid ?? '',
        user_id: branchUuid ?? '',
        branch_code: branchCode,
        label,
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

/**
 * Re-verify the authenticated user's own password without issuing a new
 * token. Used by the cashier panel's Dashboard "unlock" prompt and by
 * any other step-up flow that wants to confirm the current operator is
 * still in front of the terminal.
 *
 * Returns true iff the supplied plaintext matches the stored hash and
 * the account is still in good standing. Does NOT count toward the
 * failed-login lockout (the user already has a valid session and we
 * don't want a typo'd unlock to lock the shift).
 */
export async function verifyCurrentPassword(input: {
  userId: string;
  tenantId: string;
  password: string;
  allowedRoles?: ReadonlySet<string>;
}): Promise<boolean> {
  const { userId, tenantId, password } = input;
  return withTenantClient({ tenantId }, async (client) => {
    const user = await repo.findUserById(client, userId);
    if (!user || user.tenant_id !== tenantId) return false;
    if (input.allowedRoles && !input.allowedRoles.has(user.role)) return false;
    if (!user.password_hash) return false;
    return verifyPassword(password, user.password_hash);
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

/**
 * Development-only helper — mint a player access token for local testing.
 *
 * The internal game engine (Aviator / Fast Keno / Multi Hot 5) needs a
 * player JWT to load the wallet and live rounds. On a live deployment the
 * user panel hands this token to the iframe; when a developer opens the
 * engine directly at http://localhost:3002 there is no token, so the game
 * would otherwise hang on its loading screen.
 *
 * This issues a short-lived access token for a real seeded player so the
 * game opens and is fully playable against the player's actual wallet. It
 * is gated to NODE_ENV !== 'production' by the route layer, so it can never
 * be reached on a production build.
 *
 * Player selection order:
 *   1. The canonical seeded test player (`user@playcore.local`).
 *   2. Otherwise the most-recently-created active `user`/`affiliate`.
 */
export async function issueDevGameToken(
  tenantId: string
): Promise<{
  access_token: string;
  access_token_expires_at: string;
  user: { id: string; tenant_id: string; role: string; email: string | null; phone: string | null };
} | null> {
  return withTenantClient({ tenantId }, async (client) => {
    const r = await client.query<{
      id: string;
      tenant_id: string;
      role: string;
      email: string | null;
      phone: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT id, tenant_id, role, email, phone, metadata
         FROM users
        WHERE tenant_id = $1
          AND role IN ('user', 'affiliate')
          AND status = 'active'
        ORDER BY (email = 'user@playcore.local') DESC, created_at DESC
        LIMIT 1`,
      [tenantId]
    );
    const user = r.rows[0];
    if (!user) return null;

    const permissions = await loadEffectivePermissionsForUser(client, tenantId, {
      role: user.role,
      metadata: user.metadata,
    });

    const accessOut = signAccessToken({
      sub: user.id,
      tid: tenantId,
      role: user.role,
      permissions,
      expiresIn: '12h',
    });

    return {
      access_token: accessOut.token,
      access_token_expires_at: accessOut.expiresAt.toISOString(),
      user: {
        id: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        email: user.email,
        phone: user.phone,
      },
    };
  });
}

export { HttpError };
