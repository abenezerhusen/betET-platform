import type { PoolClient } from 'pg';

export interface UserLoginRow {
  id: string;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  metadata: Record<string, unknown> | null;
  role: string;
  status: string;
  kyc_status: string;
  failed_login_attempts: number;
  locked_until: Date | null;
}

export interface RefreshTokenRow {
  id: string;
  tenant_id: string;
  user_id: string;
  jti: string;
  family_id: string;
  parent_id: string | null;
  token_hash: string;
  status: string;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}

export interface PasswordResetRow {
  id: string;
  tenant_id: string;
  user_id: string;
  expires_at: Date;
}

export interface PublicUserRow {
  id: string;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  kyc_status: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface AuthSecuritySettingsRow {
  session_timeout_minutes: number;
  max_failed_logins: number;
  lockout_minutes: number;
}

export async function findUserForLogin(
  client: PoolClient,
  tenantId: string,
  email: string | null,
  phone: string | null,
  username: string | null
): Promise<UserLoginRow | null> {
  const r = await client.query<UserLoginRow>(
    `SELECT id, tenant_id, email, phone, password_hash, metadata, role, status,
            kyc_status, failed_login_attempts, locked_until
     FROM users
     WHERE tenant_id = $1
       AND (
            ($2::citext IS NOT NULL AND email = $2::citext)
         OR ($3::text   IS NOT NULL AND phone = $3::text)
         OR ($4::text   IS NOT NULL AND metadata->>'username' = $4::text)
       )
     LIMIT 1`,
    [tenantId, email, phone, username]
  );
  return r.rows[0] ?? null;
}

export async function branchIdentifierExists(
  client: PoolClient,
  tenantId: string,
  branchIdentifier: string
): Promise<boolean> {
  const r = await client.query<{ id: string }>(
    `SELECT id
       FROM users
      WHERE tenant_id = $1
        AND role = 'branch'
        AND (
          id::text = $2
          OR LOWER(COALESCE(metadata->>'branch_id', '')) = LOWER($2)
          OR LOWER(COALESCE(metadata->>'username', '')) = LOWER($2)
          OR email::text = $2::citext
          OR phone = $2
        )
      LIMIT 1`,
    [tenantId, branchIdentifier]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function branchIdentifierMatchesBranchUserId(
  client: PoolClient,
  tenantId: string,
  branchUserId: string,
  branchIdentifier: string
): Promise<boolean> {
  const r = await client.query<{ id: string }>(
    `SELECT id
       FROM users
      WHERE tenant_id = $1
        AND role = 'branch'
        AND id = $2
        AND (
          id::text = $3
          OR LOWER(COALESCE(metadata->>'branch_id', '')) = LOWER($3)
          OR LOWER(COALESCE(metadata->>'username', '')) = LOWER($3)
          OR email::text = $3::citext
          OR phone = $3
        )
      LIMIT 1`,
    [tenantId, branchUserId, branchIdentifier]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function getAuthSecuritySettings(
  client: PoolClient,
  tenantId: string
): Promise<AuthSecuritySettingsRow> {
  const r = await client.query<{ value: Record<string, unknown> }>(
    `SELECT value
       FROM settings
      WHERE tenant_id = $1
        AND key = 'security.config'
      LIMIT 1`,
    [tenantId]
  );
  const value = r.rows[0]?.value ?? {};
  // The schema accepts two equivalent vocabularies:
  //   legacy:  session_timeout_minutes / max_failed_logins / lockout_minutes
  //   spec:    session_duration_hours / max_login_attempts / lockout_duration_minutes
  // We coerce both into the same legacy fields the rest of auth.* expects.
  const sessionMinutes = Number(value.session_timeout_minutes);
  const sessionHours = Number(value.session_duration_hours);
  const maxFailedLegacy = Number(value.max_failed_logins);
  const maxFailedSpec = Number(value.max_login_attempts);
  const lockoutLegacy = Number(value.lockout_minutes);
  const lockoutSpec = Number(value.lockout_duration_minutes);

  const session = Number.isFinite(sessionMinutes) && sessionMinutes > 0
    ? sessionMinutes
    : Number.isFinite(sessionHours) && sessionHours > 0
      ? sessionHours * 60
      : NaN;
  const maxFailed = Number.isFinite(maxFailedLegacy) && maxFailedLegacy > 0
    ? maxFailedLegacy
    : Number.isFinite(maxFailedSpec) && maxFailedSpec > 0
      ? maxFailedSpec
      : NaN;
  const lockout = Number.isFinite(lockoutLegacy) && lockoutLegacy > 0
    ? lockoutLegacy
    : Number.isFinite(lockoutSpec) && lockoutSpec > 0
      ? lockoutSpec
      : NaN;

  // Spec defaults: 5 failed attempts → 15 minute lockout, 60 min session.
  return {
    session_timeout_minutes:
      Number.isFinite(session) && session > 0 ? Math.floor(session) : 60,
    max_failed_logins:
      Number.isFinite(maxFailed) && maxFailed > 0 ? Math.floor(maxFailed) : 5,
    lockout_minutes:
      Number.isFinite(lockout) && lockout > 0 ? Math.floor(lockout) : 15,
  };
}

export async function findUserById(
  client: PoolClient,
  userId: string
): Promise<UserLoginRow | null> {
  const r = await client.query<UserLoginRow>(
    `SELECT id, tenant_id, email, phone, password_hash, metadata, role, status,
            kyc_status, failed_login_attempts, locked_until
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  return r.rows[0] ?? null;
}

export async function incrementFailedAttempts(
  client: PoolClient,
  userId: string,
  lockUntil: Date | null
): Promise<number> {
  const r = await client.query<{ failed_login_attempts: number }>(
    `UPDATE users
        SET failed_login_attempts = failed_login_attempts + 1,
            last_failed_login_at  = now(),
            locked_until          = COALESCE($2::timestamptz, locked_until)
      WHERE id = $1
      RETURNING failed_login_attempts`,
    [userId, lockUntil]
  );
  return r.rows[0]?.failed_login_attempts ?? 0;
}

export async function resetFailedAttempts(
  client: PoolClient,
  userId: string
): Promise<void> {
  await client.query(
    `UPDATE users
        SET failed_login_attempts = 0,
            last_failed_login_at  = NULL,
            locked_until          = NULL,
            last_login_at         = now()
      WHERE id = $1`,
    [userId]
  );
}

export async function insertRefreshToken(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    jti: string;
    familyId: string;
    parentId: string | null;
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  }
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO refresh_tokens
        (tenant_id, user_id, jti, family_id, parent_id,
         token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      params.tenantId,
      params.userId,
      params.jti,
      params.familyId,
      params.parentId,
      params.tokenHash,
      params.expiresAt,
      params.ip,
      params.userAgent,
    ]
  );
  return r.rows[0].id;
}

export async function findRefreshTokenByJti(
  client: PoolClient,
  jti: string
): Promise<RefreshTokenRow | null> {
  const r = await client.query<RefreshTokenRow>(
    `SELECT id, tenant_id, user_id, jti, family_id, parent_id,
            token_hash, status, expires_at, used_at, revoked_at
       FROM refresh_tokens
      WHERE jti = $1
      LIMIT 1`,
    [jti]
  );
  return r.rows[0] ?? null;
}

export async function rotateRefreshToken(
  client: PoolClient,
  id: string
): Promise<void> {
  await client.query(
    `UPDATE refresh_tokens
        SET status = 'rotated',
            used_at = now()
      WHERE id = $1 AND status = 'active'`,
    [id]
  );
}

export async function revokeRefreshToken(
  client: PoolClient,
  id: string
): Promise<void> {
  await client.query(
    `UPDATE refresh_tokens
        SET status = 'revoked',
            revoked_at = now()
      WHERE id = $1 AND status IN ('active','rotated')`,
    [id]
  );
}

export async function revokeFamily(
  client: PoolClient,
  familyId: string
): Promise<void> {
  await client.query(
    `UPDATE refresh_tokens
        SET status = 'revoked',
            revoked_at = now()
      WHERE family_id = $1 AND status IN ('active','rotated')`,
    [familyId]
  );
}

export async function revokeAllUserRefreshTokens(
  client: PoolClient,
  userId: string
): Promise<void> {
  await client.query(
    `UPDATE refresh_tokens
        SET status = 'revoked',
            revoked_at = now()
      WHERE user_id = $1 AND status IN ('active','rotated')`,
    [userId]
  );
}

export async function insertPasswordResetToken(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  }
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO password_reset_tokens
        (tenant_id, user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      params.tenantId,
      params.userId,
      params.tokenHash,
      params.expiresAt,
      params.ip,
      params.userAgent,
    ]
  );
  return r.rows[0].id;
}

export async function findValidPasswordResetToken(
  client: PoolClient,
  tokenHash: string
): Promise<PasswordResetRow | null> {
  const r = await client.query<PasswordResetRow>(
    `SELECT id, tenant_id, user_id, expires_at
       FROM password_reset_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [tokenHash]
  );
  return r.rows[0] ?? null;
}

export async function markPasswordResetTokenUsed(
  client: PoolClient,
  id: string
): Promise<void> {
  await client.query(
    `UPDATE password_reset_tokens
        SET used_at = now()
      WHERE id = $1
        AND used_at IS NULL`,
    [id]
  );
}

export async function updateUserPassword(
  client: PoolClient,
  userId: string,
  passwordHash: string
): Promise<void> {
  await client.query(
    `UPDATE users
        SET password_hash = $2,
            updated_at = now()
      WHERE id = $1`,
    [userId, passwordHash]
  );
}

export async function insertPublicUser(
  client: PoolClient,
  params: {
    tenantId: string;
    email: string | null;
    phone: string | null;
    passwordHash: string;
    fullName: string;
  }
): Promise<PublicUserRow> {
  const r = await client.query<PublicUserRow>(
    `INSERT INTO users
      (tenant_id, email, phone, password_hash, role, status, kyc_status, metadata)
     VALUES
      ($1, $2::citext, $3, $4, 'user', 'active', 'pending', $5::jsonb)
     RETURNING id, tenant_id, email, phone, role, status, kyc_status, metadata, created_at`,
    [
      params.tenantId,
      params.email,
      params.phone,
      params.passwordHash,
      JSON.stringify({ full_name: params.fullName }),
    ]
  );
  return r.rows[0];
}

export async function findActiveAffiliateByCode(
  client: PoolClient,
  tenantId: string,
  code: string
): Promise<{ id: string; code: string; user_id: string | null } | null> {
  const r = await client.query<{ id: string; code: string; user_id: string | null }>(
    `SELECT id, code, user_id
       FROM affiliates
      WHERE tenant_id = $1
        AND code = $2
        AND status = 'active'
      LIMIT 1`,
    [tenantId, code]
  );
  return r.rows[0] ?? null;
}

export async function insertReferralLink(
  client: PoolClient,
  params: {
    tenantId: string;
    referrerId: string;
    referredId: string;
    code: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO referrals (tenant_id, referrer_id, referred_id, code, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (referred_id) DO NOTHING`,
    [params.tenantId, params.referrerId, params.referredId, params.code]
  );
}

/**
 * Lookup an active user-level referral code (from `referral_codes`). Used
 * during registration to resolve the referring user when a friend's code
 * is supplied. Returns null when the code belongs to no active row.
 */
export async function findActiveReferralCode(
  client: PoolClient,
  tenantId: string,
  code: string
): Promise<{ id: string; user_id: string; code: string } | null> {
  const r = await client.query<{
    id: string;
    user_id: string;
    code: string;
  }>(
    `SELECT id, user_id, code
       FROM referral_codes
      WHERE tenant_id = $1
        AND code = $2
        AND is_active = true
        AND (max_uses IS NULL OR uses < max_uses)
      LIMIT 1`,
    [tenantId, code]
  );
  return r.rows[0] ?? null;
}

/**
 * Bump the use counter on a referral code. Called when a friend
 * registers successfully against the code.
 */
export async function incrementReferralCodeUses(
  client: PoolClient,
  id: string
): Promise<void> {
  await client.query(
    `UPDATE referral_codes
        SET uses = uses + 1, updated_at = now()
      WHERE id = $1`,
    [id]
  );
}

/**
 * Idempotently provision a `referral_codes` row for the user. Used at
 * registration so every account has a shareable code from day one. The
 * generated code is 8 chars of hex (uppercase) prefixed by the first
 * two phone digits when available, falling back to 'U'.
 */
export async function ensureUserReferralCode(
  client: PoolClient,
  params: { tenantId: string; userId: string; phone?: string | null }
): Promise<{ id: string; code: string }> {
  const existing = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM referral_codes
      WHERE tenant_id = $1 AND user_id = $2 AND is_active = true
      ORDER BY created_at ASC LIMIT 1`,
    [params.tenantId, params.userId]
  );
  if (existing.rows[0]) return existing.rows[0];

  // Retry on the (tenant_id, code) uniqueness constraint.
  for (let attempt = 0; attempt < 5; attempt++) {
    const prefix = (params.phone ?? '').replace(/[^0-9]/g, '').slice(-2) || 'U';
    const random = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()
      .padEnd(6, 'X');
    const code = `${prefix}${random}`.slice(0, 12);
    try {
      const ins = await client.query<{ id: string; code: string }>(
        `INSERT INTO referral_codes (tenant_id, user_id, code, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING id, code`,
        [params.tenantId, params.userId, code]
      );
      return ins.rows[0];
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
    }
  }
  // Last attempt: include the user id suffix to guarantee uniqueness.
  const fallback = `U${params.userId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const ins = await client.query<{ id: string; code: string }>(
    `INSERT INTO referral_codes (tenant_id, user_id, code, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (tenant_id, code) DO NOTHING
     RETURNING id, code`,
    [params.tenantId, params.userId, fallback]
  );
  if (!ins.rows[0]) {
    // Already exists — fetch it.
    const r = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM referral_codes WHERE tenant_id = $1 AND code = $2`,
      [params.tenantId, fallback]
    );
    return r.rows[0];
  }
  return ins.rows[0];
}
