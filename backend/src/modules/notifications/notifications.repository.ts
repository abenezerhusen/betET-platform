import type { PoolClient } from 'pg';

export interface TelegramGatewayConfig {
  enabled?: boolean;
  bot_token?: string;
  gateway_token?: string;
  chat_config?: string;
  api_url?: string;
}

/**
 * OTP security policy — configurable, provider-agnostic. Every field is
 * optional in storage; `notification-config` applies safe defaults so the
 * same rules apply to SMS and Telegram OTPs. Surfaced for a future Admin
 * Panel screen so the values can be tuned without a code change.
 */
export interface OtpSecurityConfig {
  /** OTP validity window in minutes (default 5). */
  expiry_minutes?: number;
  /** Numeric code length (default 6). */
  code_length?: number;
  /** Minimum seconds between two resend requests (default 60). */
  resend_cooldown_seconds?: number;
  /** Max sends allowed inside `resend_window_minutes` (default 3). */
  max_resend_per_window?: number;
  /** Rolling window used to count resends (default 15). */
  resend_window_minutes?: number;
  /** How long new requests are blocked after exceeding the limit (default 15). */
  resend_block_minutes?: number;
  /** Max wrong verification attempts before blocking (default 5). */
  max_verify_attempts?: number;
  /** How long verification is blocked after too many failures (default 15). */
  verify_block_minutes?: number;
}

export interface SmsProviderConfig {
  provider?: string;
  sender_id?: string;
  api_url?: string;
  api_key?: string;
  username?: string;
  default_language?: string;
  /** Master SMS on/off toggle. When omitted, SMS enablement falls back to
   *  the legacy heuristic (provider && sender_id) for backward compat. */
  sms_enabled?: boolean;
  /** Telegram Gateway provider config (second notification channel). */
  telegram?: TelegramGatewayConfig;
  /** Preferred provider when more than one channel is enabled. */
  default_provider?: 'sms' | 'telegram';
  /** OTP security policy (expiry, resend + verify limits). */
  otp?: OtpSecurityConfig;
  features?: Record<string, boolean>;
}

export interface SmsTemplateRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  body: string;
  language: string;
  is_active: boolean;
}

export async function getSmsProviderConfig(
  client: PoolClient,
  tenantId: string
): Promise<SmsProviderConfig | null> {
  const r = await client.query<{ value: SmsProviderConfig }>(
    `SELECT value
       FROM settings
      WHERE tenant_id = $1
        AND key = 'sms.provider.config'
      LIMIT 1`,
    [tenantId]
  );
  return r.rows[0]?.value ?? null;
}

export interface NotificationLogInsert {
  tenantId: string;
  userId?: string | null;
  channel: string;
  provider?: string | null;
  category: string;
  eventType: string;
  recipient?: string | null;
  message?: string | null;
  status: string;
  error?: string | null;
  metadata?: Record<string, unknown>;
  sentAt?: Date | null;
}

export async function insertNotificationLog(
  client: PoolClient,
  entry: NotificationLogInsert
): Promise<void> {
  await client.query(
    `INSERT INTO notification_logs
       (tenant_id, user_id, channel, provider, category, event_type,
        recipient, message, status, error, metadata, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
    [
      entry.tenantId,
      entry.userId ?? null,
      entry.channel,
      entry.provider ?? null,
      entry.category,
      entry.eventType,
      entry.recipient ?? null,
      entry.message ?? null,
      entry.status,
      entry.error ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.sentAt ?? null,
    ]
  );
}

export async function findSmsTemplate(
  client: PoolClient,
  tenantId: string,
  code: string,
  language?: string
): Promise<SmsTemplateRow | null> {
  if (language) {
    const exact = await client.query<SmsTemplateRow>(
      `SELECT id, tenant_id, code, name, body, language, is_active
         FROM sms_templates
        WHERE tenant_id = $1
          AND code = $2
          AND language = $3
          AND is_active = true
        LIMIT 1`,
      [tenantId, code, language]
    );
    if (exact.rows[0]) return exact.rows[0];
  }

  const fallback = await client.query<SmsTemplateRow>(
    `SELECT id, tenant_id, code, name, body, language, is_active
       FROM sms_templates
      WHERE tenant_id = $1
        AND code = $2
        AND is_active = true
      ORDER BY CASE WHEN language = 'en' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    [tenantId, code]
  );
  return fallback.rows[0] ?? null;
}
