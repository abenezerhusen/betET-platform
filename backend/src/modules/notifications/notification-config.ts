/**
 * Central resolver for the multi-provider notification configuration.
 *
 * All provider settings live in the existing `sms.provider.config` settings
 * key (JSONB) so the two admin surfaces (Settings → SMS Config and
 * Settings → General → SMS Config tab) stay a single source of truth. This
 * module reads that raw config and normalizes it into a strongly-typed
 * shape with the provider-selection rules described in the spec:
 *
 *   - SMS only enabled          → use SMS
 *   - Telegram only enabled     → use Telegram
 *   - Both enabled              → use the admin-selected default provider
 *   - Neither enabled           → no provider (OTP not required, etc.)
 *
 * Nothing here calls any external API; that is the provider layer's job.
 */

import type { PoolClient } from 'pg';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import * as repo from './notifications.repository';

export type NotificationChannel = 'sms' | 'telegram';

export interface SmsChannelSettings {
  enabled: boolean;
  provider: string | null;
  sender_id: string | null;
  api_url: string | null;
  api_key: string | null;
  username: string | null;
  /** True when the channel has enough config to actually transmit. */
  configured: boolean;
}

export interface TelegramChannelSettings {
  enabled: boolean;
  bot_token: string | null;
  gateway_token: string | null;
  chat_config: string | null;
  api_url: string | null;
  configured: boolean;
}

/**
 * Fully-resolved OTP security policy. Applied identically to SMS and
 * Telegram OTPs and to every purpose (register / login / password_reset).
 */
export interface OtpSecuritySettings {
  expiryMinutes: number;
  codeLength: number;
  resendCooldownSeconds: number;
  maxResendPerWindow: number;
  resendWindowMinutes: number;
  resendBlockMinutes: number;
  maxVerifyAttempts: number;
  verifyBlockMinutes: number;
}

export const OTP_SECURITY_DEFAULTS: OtpSecuritySettings = {
  expiryMinutes: 5,
  codeLength: 6,
  resendCooldownSeconds: 60,
  maxResendPerWindow: 3,
  resendWindowMinutes: 15,
  resendBlockMinutes: 15,
  maxVerifyAttempts: 5,
  verifyBlockMinutes: 15,
};

export interface NotificationSettings {
  sms: SmsChannelSettings;
  telegram: TelegramChannelSettings;
  /** Resolved default provider used when both channels are enabled. */
  defaultProvider: NotificationChannel | null;
  emailEnabled: boolean;
  /** OTP security policy (safe defaults applied when unset). */
  otp: OtpSecuritySettings;
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** Coerce a raw config value into a bounded positive integer, else default. */
function posInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Resolve the OTP security policy from raw config, clamping every value to
 * a sane range so a bad admin entry can never disable the protections.
 */
export function resolveOtpSettings(
  cfg: repo.SmsProviderConfig | null
): OtpSecuritySettings {
  const raw = cfg?.otp ?? {};
  const d = OTP_SECURITY_DEFAULTS;
  return {
    expiryMinutes: posInt(raw.expiry_minutes, d.expiryMinutes, 1, 60),
    codeLength: posInt(raw.code_length, d.codeLength, 4, 8),
    resendCooldownSeconds: posInt(
      raw.resend_cooldown_seconds,
      d.resendCooldownSeconds,
      10,
      3600
    ),
    maxResendPerWindow: posInt(raw.max_resend_per_window, d.maxResendPerWindow, 1, 20),
    resendWindowMinutes: posInt(raw.resend_window_minutes, d.resendWindowMinutes, 1, 240),
    resendBlockMinutes: posInt(raw.resend_block_minutes, d.resendBlockMinutes, 1, 1440),
    maxVerifyAttempts: posInt(raw.max_verify_attempts, d.maxVerifyAttempts, 1, 20),
    verifyBlockMinutes: posInt(raw.verify_block_minutes, d.verifyBlockMinutes, 1, 1440),
  };
}

/**
 * Resolve whether SMS is enabled. Prefers the explicit `sms_enabled`
 * toggle. When it has never been set (legacy tenants) we fall back to the
 * historical heuristic so existing SMS behaviour is preserved, unless the
 * admin explicitly turned it off via `features.sms === false`.
 */
function resolveSmsEnabled(cfg: repo.SmsProviderConfig | null): boolean {
  if (!cfg) return false;
  if (cfg.features && cfg.features.sms === false) return false;
  if (typeof cfg.sms_enabled === 'boolean') return cfg.sms_enabled;
  // Legacy fallback: enabled when a provider + sender were configured.
  return Boolean(clean(cfg.provider) && clean(cfg.sender_id));
}

export function normalizeNotificationSettings(
  cfg: repo.SmsProviderConfig | null
): NotificationSettings {
  const smsEnabled = resolveSmsEnabled(cfg);
  const smsSenderId = clean(cfg?.sender_id);
  const smsApiUrl = clean(cfg?.api_url);
  const smsApiKey = clean(cfg?.api_key);
  const smsProvider = clean(cfg?.provider);

  const sms: SmsChannelSettings = {
    enabled: smsEnabled,
    provider: smsProvider,
    sender_id: smsSenderId,
    api_url: smsApiUrl,
    api_key: smsApiKey,
    username: clean(cfg?.username),
    // Transmittable when we have an endpoint + credentials + sender.
    configured: Boolean(smsApiUrl && smsApiKey && smsSenderId),
  };

  const tg = cfg?.telegram ?? {};
  const tgBot = clean(tg.bot_token);
  const tgGateway = clean(tg.gateway_token);
  const tgApiUrl = clean(tg.api_url);
  const telegram: TelegramChannelSettings = {
    enabled: tg.enabled === true,
    bot_token: tgBot,
    gateway_token: tgGateway,
    chat_config: clean(tg.chat_config),
    api_url: tgApiUrl,
    // Transport is not implemented yet; "configured" means credentials
    // exist so the future integration can transmit without code changes.
    configured: Boolean(tgApiUrl && (tgBot || tgGateway)),
  };

  // Resolve the default provider used when both channels are enabled.
  let defaultProvider: NotificationChannel | null = null;
  if (sms.enabled && telegram.enabled) {
    defaultProvider =
      cfg?.default_provider === 'telegram' ? 'telegram' : 'sms';
  } else if (sms.enabled) {
    defaultProvider = 'sms';
  } else if (telegram.enabled) {
    defaultProvider = 'telegram';
  }

  return {
    sms,
    telegram,
    defaultProvider,
    emailEnabled: Boolean(cfg?.features?.email),
    otp: resolveOtpSettings(cfg),
  };
}

export async function loadNotificationSettings(
  tenantId: string,
  client?: PoolClient
): Promise<NotificationSettings> {
  const read = async (c: PoolClient) =>
    normalizeNotificationSettings(await repo.getSmsProviderConfig(c, tenantId));
  if (client) return read(client);
  return withTenantClient({ tenantId }, read);
}

/** True when at least one notification channel is enabled. */
export function anyProviderEnabled(settings: NotificationSettings): boolean {
  return settings.sms.enabled || settings.telegram.enabled;
}

/**
 * Auth-related view of the notification config, consumed by the auth
 * service and exposed (public-safe subset) to the user panel so the UI
 * knows whether to require an OTP step / show the forgot-password entry.
 */
export interface AuthNotificationConfig {
  sms_enabled: boolean;
  telegram_enabled: boolean;
  default_provider: NotificationChannel | null;
  /** OTP is required whenever at least one provider is enabled. */
  otp_required: boolean;
  otp_channel: NotificationChannel | null;
  /** Forgot-password is available only when a provider can deliver the OTP. */
  forgot_password_enabled: boolean;
}

export function deriveAuthConfig(
  settings: NotificationSettings
): AuthNotificationConfig {
  const any = anyProviderEnabled(settings);
  return {
    sms_enabled: settings.sms.enabled,
    telegram_enabled: settings.telegram.enabled,
    default_provider: settings.defaultProvider,
    otp_required: any,
    otp_channel: settings.defaultProvider,
    forgot_password_enabled: any,
  };
}

/**
 * Choose the channel to use for a send. Honors an explicit preferred
 * channel when that channel is enabled; otherwise falls back to the
 * resolved default provider.
 */
export function resolveChannel(
  settings: NotificationSettings,
  preferred?: NotificationChannel | 'default' | null
): NotificationChannel | null {
  if (preferred === 'sms') return settings.sms.enabled ? 'sms' : null;
  if (preferred === 'telegram') {
    return settings.telegram.enabled ? 'telegram' : null;
  }
  return settings.defaultProvider;
}
