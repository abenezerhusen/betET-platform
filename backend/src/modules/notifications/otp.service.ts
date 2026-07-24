/**
 * OTP service for auth flows (registration, login, password reset).
 *
 * Security properties (identical for SMS and Telegram Gateway providers):
 *
 *   - Codes are numeric, hashed (SHA-256) at rest — plaintext is NEVER
 *     persisted or exposed in production logs.
 *   - Time-limited: expire after `expiryMinutes` (default 5). Expired codes
 *     are rejected and cannot be reused.
 *   - Single-use: on success the row is marked consumed (`status = 'used'`)
 *     so the same code can never be accepted twice.
 *   - Resend protection: per-cooldown between sends, a max number of sends
 *     inside a rolling window, and a temporary block after the limit.
 *   - Verify protection: wrong attempts are counted; after the max the
 *     identifier is temporarily blocked and a fresh OTP must be requested.
 *   - Every OTP row doubles as a security log (user, identifier, provider,
 *     request/expiry time, status, attempts, ip, device info).
 *
 * When no provider is enabled, `requestOtp` returns `{ required: false }`
 * and the caller proceeds without OTP (spec: both disabled → normal
 * registration, no verification screen).
 */

import crypto from 'crypto';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import {
  loadNotificationSettings,
  anyProviderEnabled,
  type NotificationChannel,
  type OtpSecuritySettings,
} from './notification-config';
import { notify, NOTIFICATION_EVENTS } from './notification.service';

export type OtpPurpose = 'register' | 'login' | 'password_reset';

/** Lifecycle status stored on each OTP row. */
export type OtpStatus = 'pending' | 'verified' | 'used' | 'expired' | 'failed';

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode(length: number): string {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(length, '0');
}

const EVENT_BY_PURPOSE: Record<OtpPurpose, string> = {
  register: NOTIFICATION_EVENTS.REGISTRATION_OTP,
  login: NOTIFICATION_EVENTS.LOGIN_OTP,
  password_reset: NOTIFICATION_EVENTS.FORGOT_PASSWORD_OTP,
};

const MESSAGE_BY_PURPOSE: Record<OtpPurpose, string> = {
  register: 'Your verification code is {code}. It expires in {minutes} minutes.',
  login: 'Your login code is {code}. It expires in {minutes} minutes.',
  password_reset:
    'Your password reset code is {code}. It expires in {minutes} minutes.',
};

const TEMPLATE_BY_PURPOSE: Record<OtpPurpose, string> = {
  register: 'auth_register_otp',
  login: 'auth_login_otp',
  password_reset: 'auth_password_reset_otp',
};

export interface RequestOtpParams {
  tenantId: string;
  purpose: OtpPurpose;
  /** Phone (SMS) or chat identifier the OTP is delivered to. */
  identifier: string;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export type RequestOtpStatus = 'sent' | 'cooldown' | 'blocked' | 'skipped';

export interface RequestOtpResult {
  /** False when no provider is enabled → caller should skip OTP. */
  required: boolean;
  sent: boolean;
  channel: NotificationChannel | null;
  expiresInMinutes: number;
  /** Outcome of the resend-protection gate. */
  status: RequestOtpStatus;
  /** Seconds until the next send is allowed (cooldown / block). */
  retryAfterSeconds?: number;
  /** Remaining sends before the resend block kicks in. */
  resendRemaining?: number;
  /** Seconds the client should wait before offering a resend. */
  cooldownSeconds?: number;
  /** Non-production only: plaintext code surfaced for QA. */
  devCode?: string;
}

export async function isOtpRequired(tenantId: string): Promise<boolean> {
  const settings = await loadNotificationSettings(tenantId);
  return anyProviderEnabled(settings);
}

interface ResendGate {
  decision: 'ok' | 'cooldown' | 'blocked';
  retryAfterSeconds?: number;
  sendsInWindow: number;
}

/**
 * Evaluate resend cooldown / window-limit / active block for an identifier.
 * Runs inside a tenant client so RLS is enforced.
 */
async function evaluateResendGate(
  tenantId: string,
  purpose: OtpPurpose,
  identifier: string,
  otp: OtpSecuritySettings,
  now: number
): Promise<ResendGate> {
  return withTenantClient({ tenantId }, async (client) => {
    const latest = await client.query<{
      created_at: Date;
      resend_blocked_until: Date | null;
    }>(
      `SELECT created_at, resend_blocked_until
         FROM notification_otps
        WHERE tenant_id = $1 AND purpose = $2 AND identifier = $3
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, purpose, identifier]
    );
    const row = latest.rows[0];

    if (row?.resend_blocked_until) {
      const until = new Date(row.resend_blocked_until).getTime();
      if (until > now) {
        return {
          decision: 'blocked',
          retryAfterSeconds: Math.ceil((until - now) / 1000),
          sendsInWindow: 0,
        };
      }
    }

    if (row) {
      const nextAllowed =
        new Date(row.created_at).getTime() + otp.resendCooldownSeconds * 1000;
      if (nextAllowed > now) {
        return {
          decision: 'cooldown',
          retryAfterSeconds: Math.ceil((nextAllowed - now) / 1000),
          sendsInWindow: 0,
        };
      }
    }

    const windowStart = new Date(now - otp.resendWindowMinutes * 60 * 1000);
    const cnt = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM notification_otps
        WHERE tenant_id = $1 AND purpose = $2 AND identifier = $3
          AND created_at >= $4`,
      [tenantId, purpose, identifier, windowStart]
    );
    const sendsInWindow = Number(cnt.rows[0]?.count ?? '0');

    if (sendsInWindow >= otp.maxResendPerWindow) {
      const until = new Date(now + otp.resendBlockMinutes * 60 * 1000);
      await client.query(
        `UPDATE notification_otps
            SET resend_blocked_until = $4, status = 'failed'
          WHERE tenant_id = $1 AND purpose = $2 AND identifier = $3
            AND consumed_at IS NULL`,
        [tenantId, purpose, identifier, until]
      );
      return {
        decision: 'blocked',
        retryAfterSeconds: otp.resendBlockMinutes * 60,
        sendsInWindow,
      };
    }

    return { decision: 'ok', sendsInWindow };
  });
}

export async function requestOtp(
  params: RequestOtpParams
): Promise<RequestOtpResult> {
  const identifier = params.identifier.trim();
  const settings = await loadNotificationSettings(params.tenantId);
  const otp = settings.otp;

  if (!anyProviderEnabled(settings)) {
    return {
      required: false,
      sent: false,
      channel: null,
      expiresInMinutes: otp.expiryMinutes,
      status: 'skipped',
    };
  }

  const channel = settings.defaultProvider;
  const now = Date.now();

  const gate = await evaluateResendGate(
    params.tenantId,
    params.purpose,
    identifier,
    otp,
    now
  );
  if (gate.decision !== 'ok') {
    return {
      required: true,
      sent: false,
      channel,
      expiresInMinutes: otp.expiryMinutes,
      status: gate.decision,
      retryAfterSeconds: gate.retryAfterSeconds,
    };
  }

  const code = generateCode(otp.codeLength);
  const codeHash = hashCode(code);
  const expiresAt = new Date(now + otp.expiryMinutes * 60 * 1000);

  await withTenantClient({ tenantId: params.tenantId }, async (client) => {
    // Enforce a single active code: expire any outstanding ones.
    await client.query(
      `UPDATE notification_otps
          SET consumed_at = now(), status = 'expired'
        WHERE tenant_id = $1
          AND purpose = $2
          AND identifier = $3
          AND consumed_at IS NULL`,
      [params.tenantId, params.purpose, identifier]
    );
    await client.query(
      `INSERT INTO notification_otps
         (tenant_id, purpose, identifier, channel, provider, code_hash,
          expires_at, status, resend_count, user_id, ip, user_agent, device_info)
       VALUES ($1,$2,$3,$4,$4,$5,$6,'pending',$7,$8,$9,$10,$10)`,
      [
        params.tenantId,
        params.purpose,
        identifier,
        channel ?? 'sms',
        codeHash,
        expiresAt,
        gate.sendsInWindow + 1,
        params.userId ?? null,
        params.ip ?? null,
        params.userAgent ?? null,
      ]
    );
  });

  const result = await notify({
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    to: identifier,
    category: 'auth',
    event: EVENT_BY_PURPOSE[params.purpose],
    channel: 'default',
    templateCode: TEMPLATE_BY_PURPOSE[params.purpose],
    message: MESSAGE_BY_PURPOSE[params.purpose],
    variables: { code, minutes: otp.expiryMinutes },
  });

  if (process.env.NODE_ENV !== 'production') {
    // Never log the plaintext code. Only metadata is recorded.
    logger.info(
      { tenantId: params.tenantId, purpose: params.purpose, channel },
      'otp issued'
    );
  }

  return {
    required: true,
    sent: result.status === 'sent',
    channel,
    expiresInMinutes: otp.expiryMinutes,
    status: 'sent',
    resendRemaining: Math.max(0, otp.maxResendPerWindow - (gate.sendsInWindow + 1)),
    cooldownSeconds: otp.resendCooldownSeconds,
    ...(process.env.NODE_ENV !== 'production' ? { devCode: code } : {}),
  };
}

export interface VerifyOtpResult {
  ok: boolean;
  reason?: 'not_found' | 'expired' | 'blocked' | 'mismatch';
  /** Remaining attempts before a verification block. */
  attemptsRemaining?: number;
  /** Seconds until verification is allowed again (when blocked). */
  retryAfterSeconds?: number;
}

export async function verifyOtp(params: {
  tenantId: string;
  purpose: OtpPurpose;
  identifier: string;
  code: string;
  /**
   * When false, a correct code is validated but NOT consumed — the row stays
   * active so a later call can consume it. Used for a two-step UI (verify the
   * code, then set the password) while preserving single-use semantics: the
   * code is only marked `used` on the final consuming call. Defaults to true.
   */
  consume?: boolean;
}): Promise<VerifyOtpResult> {
  const identifier = params.identifier.trim();
  const code = params.code.trim();
  const settings = await loadNotificationSettings(params.tenantId);
  const otp = settings.otp;

  return withTenantClient({ tenantId: params.tenantId }, async (client) => {
    const r = await client.query<{
      id: string;
      code_hash: string;
      expires_at: Date;
      attempts: number;
      verify_blocked_until: Date | null;
    }>(
      `SELECT id, code_hash, expires_at, attempts, verify_blocked_until
         FROM notification_otps
        WHERE tenant_id = $1
          AND purpose = $2
          AND identifier = $3
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [params.tenantId, params.purpose, identifier]
    );
    const row = r.rows[0];
    if (!row) return { ok: false, reason: 'not_found' as const };

    const now = Date.now();

    if (row.verify_blocked_until) {
      const until = new Date(row.verify_blocked_until).getTime();
      if (until > now) {
        return {
          ok: false,
          reason: 'blocked' as const,
          retryAfterSeconds: Math.ceil((until - now) / 1000),
        };
      }
    }

    if (new Date(row.expires_at).getTime() < now) {
      await client.query(
        `UPDATE notification_otps
            SET status = 'expired', consumed_at = now()
          WHERE id = $1`,
        [row.id]
      );
      return { ok: false, reason: 'expired' as const };
    }

    if (row.attempts >= otp.maxVerifyAttempts) {
      const until = new Date(now + otp.verifyBlockMinutes * 60 * 1000);
      await client.query(
        `UPDATE notification_otps
            SET verify_blocked_until = $2, status = 'failed'
          WHERE id = $1`,
        [row.id, until]
      );
      return {
        ok: false,
        reason: 'blocked' as const,
        retryAfterSeconds: otp.verifyBlockMinutes * 60,
      };
    }

    const matches = hashCode(code) === row.code_hash;
    if (!matches) {
      const attempts = row.attempts + 1;
      const blocked = attempts >= otp.maxVerifyAttempts;
      const until = blocked
        ? new Date(now + otp.verifyBlockMinutes * 60 * 1000)
        : null;
      await client.query(
        `UPDATE notification_otps
            SET attempts = $2,
                status = $3,
                verify_blocked_until = COALESCE($4, verify_blocked_until)
          WHERE id = $1`,
        [row.id, attempts, blocked ? 'failed' : 'pending', until]
      );
      return {
        ok: false,
        reason: blocked ? ('blocked' as const) : ('mismatch' as const),
        attemptsRemaining: Math.max(0, otp.maxVerifyAttempts - attempts),
        ...(blocked ? { retryAfterSeconds: otp.verifyBlockMinutes * 60 } : {}),
      };
    }

    // Verify-only (peek): the code is correct but the caller does not want to
    // consume it yet. Record the verification timestamp for the security log
    // but keep the row active so the consuming call still succeeds.
    if (params.consume === false) {
      await client.query(
        `UPDATE notification_otps
            SET verified_at = COALESCE(verified_at, now()),
                status = 'verified'
          WHERE id = $1`,
        [row.id]
      );
      return { ok: true };
    }

    await client.query(
      `UPDATE notification_otps
          SET consumed_at = now(), status = 'used', verified_at = now()
        WHERE id = $1`,
      [row.id]
    );
    return { ok: true };
  });
}
