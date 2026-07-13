import type { PoolClient } from 'pg';

import { withTenantClient } from '../../infrastructure/db/tenant-client';

/**
 * Tenant-scoped Telebirr configuration. Stored in the `settings` table
 * under the single key `'telebirr'` so admins can edit the entire
 * configuration in one place from /api/admin/telebirr/settings.
 *
 * Defaults below are used when the row is missing — never fail-closed
 * because that would block the user deposit flow on first install.
 */
export interface TelebirrSettings {
  /** Minimum allowed deposit amount, ETB. */
  min_deposit: number;
  /** Maximum allowed deposit amount, ETB. */
  max_deposit: number;
  /** Minutes a deposit request stays in `waiting` before auto-expiring. */
  expiry_minutes: number;
  /** Letters prepended to every reference code (default 'TB'). */
  reference_code_prefix: string;
  /** Random alphanumerics appended after the prefix (default 4 → 6-char total). */
  reference_code_length: number;
  /** Above this amount the auto-matcher must always escalate to manual review. */
  auto_approve_threshold: number;
  /** Above this amount cashier voids require admin approval. */
  void_admin_approval_threshold: number;

  /* ------------------------------------------------------------------- */
  /* Fraud-prevention thresholds (RULE 3..8)                             */
  /* ------------------------------------------------------------------- */

  /** RULE 3 — accepted clock skew between device-reported received_at
   *  and server time. Outside this window the SMS is rejected. */
  sms_timestamp_skew_minutes: number;

  /** RULE 4 — single-SMS amount ceiling. Above this the matcher MUST
   *  escalate to manual review even when reference-code matched. */
  max_single_sms_amount: number;

  /** RULE 5 — daily volume cap per agent device. When exceeded the
   *  agent is auto-suspended pending admin review. */
  max_daily_agent_volume: number;

  /** RULE 6 — sender-phone velocity. If the same sender phone shows up
   *  in this many SMS within the velocity window the match is
   *  demoted from auto-credit to cashier review. */
  sender_phone_velocity_max: number;
  sender_phone_velocity_window_minutes: number;

  /** RULE 7 — telecom sender-id allowlist. Anything reported with a
   *  senderNumber not in this list is rejected as fake. */
  approved_sender_ids: string[];

  /** RULE 8 — refcode brute-force. If one IP submits this many
   *  distinct candidate refcodes (across deposit-initiate or
   *  unmatched-investigation flows) within the window, block. */
  refcode_brute_force_max: number;
  refcode_brute_force_window_minutes: number;

  /** Reconciliation: variance between expectedCredits and reported
   *  agent statement that triggers a manual-review reconciliation row. */
  reconciliation_variance_threshold: number;

  /* ------------------------------------------------------------------- */
  /* Payment-provider toggles                                            */
  /* ------------------------------------------------------------------- */

  /** Master switch for the Telebirr P2P provider. When false the
   *  payment_methods row stays in the catalogue but
   *  TelebirrP2PProvider.initiateDeposit hard-fails with
   *  `provider_disabled`. Defaults to true so a freshly migrated
   *  tenant has working deposits without admin intervention. */
  p2p_enabled: boolean;

  /** Withdrawal switch. Defaults to FALSE because withdrawals are
   *  manually processed by a cashier and require staffing — a tenant
   *  must opt in explicitly before users can request payouts. */
  withdrawal_enabled: boolean;
}

export const TELEBIRR_DEFAULTS: TelebirrSettings = {
  min_deposit: 50,
  max_deposit: 50_000,
  expiry_minutes: 30,
  reference_code_prefix: 'TB',
  reference_code_length: 4,
  auto_approve_threshold: 5_000,
  void_admin_approval_threshold: 10_000,

  sms_timestamp_skew_minutes: 10,
  max_single_sms_amount: 50_000,
  max_daily_agent_volume: 500_000,
  sender_phone_velocity_max: 5,
  sender_phone_velocity_window_minutes: 60,
  approved_sender_ids: ['Telebirr', 'TELEBIRR', 'telebirr', '127', '8978', '6040', '8282'],
  refcode_brute_force_max: 20,
  refcode_brute_force_window_minutes: 60,
  reconciliation_variance_threshold: 100,

  p2p_enabled: true,
  withdrawal_enabled: false,
};

export const TELEBIRR_SETTINGS_KEY = 'telebirr';

/**
 * Load settings from a live client (caller already inside a tenant
 * transaction). Used by the deposit/void/matching flows that already
 * have an open client — avoids opening a second pool connection per
 * request.
 */
export async function loadTelebirrSettings(
  client: PoolClient,
  tenantId: string
): Promise<TelebirrSettings> {
  const r = await client.query<{ value: Partial<TelebirrSettings> | null }>(
    `SELECT value FROM settings
      WHERE tenant_id = $1 AND key = $2
      LIMIT 1`,
    [tenantId, TELEBIRR_SETTINGS_KEY]
  );
  return mergeWithDefaults(r.rows[0]?.value ?? null);
}

/** Convenience wrapper for callers without an open client. */
export async function getTelebirrSettings(
  tenantId: string
): Promise<TelebirrSettings> {
  return withTenantClient({ tenantId }, async (client) =>
    loadTelebirrSettings(client, tenantId)
  );
}

function mergeWithDefaults(
  raw: Partial<TelebirrSettings> | null
): TelebirrSettings {
  if (!raw) return { ...TELEBIRR_DEFAULTS };
  return {
    min_deposit: numOrDefault(raw.min_deposit, TELEBIRR_DEFAULTS.min_deposit),
    max_deposit: numOrDefault(raw.max_deposit, TELEBIRR_DEFAULTS.max_deposit),
    expiry_minutes: intOrDefault(
      raw.expiry_minutes,
      TELEBIRR_DEFAULTS.expiry_minutes
    ),
    reference_code_prefix:
      typeof raw.reference_code_prefix === 'string' &&
      /^[A-Z0-9]{0,4}$/.test(raw.reference_code_prefix)
        ? raw.reference_code_prefix.toUpperCase()
        : TELEBIRR_DEFAULTS.reference_code_prefix,
    reference_code_length: clamp(
      intOrDefault(
        raw.reference_code_length,
        TELEBIRR_DEFAULTS.reference_code_length
      ),
      3,
      6
    ),
    auto_approve_threshold: numOrDefault(
      raw.auto_approve_threshold,
      TELEBIRR_DEFAULTS.auto_approve_threshold
    ),
    void_admin_approval_threshold: numOrDefault(
      raw.void_admin_approval_threshold,
      TELEBIRR_DEFAULTS.void_admin_approval_threshold
    ),
    sms_timestamp_skew_minutes: clamp(
      intOrDefault(
        raw.sms_timestamp_skew_minutes,
        TELEBIRR_DEFAULTS.sms_timestamp_skew_minutes
      ),
      1,
      120
    ),
    max_single_sms_amount: numOrDefault(
      raw.max_single_sms_amount,
      TELEBIRR_DEFAULTS.max_single_sms_amount
    ),
    max_daily_agent_volume: numOrDefault(
      raw.max_daily_agent_volume,
      TELEBIRR_DEFAULTS.max_daily_agent_volume
    ),
    sender_phone_velocity_max: clamp(
      intOrDefault(
        raw.sender_phone_velocity_max,
        TELEBIRR_DEFAULTS.sender_phone_velocity_max
      ),
      1,
      1000
    ),
    sender_phone_velocity_window_minutes: clamp(
      intOrDefault(
        raw.sender_phone_velocity_window_minutes,
        TELEBIRR_DEFAULTS.sender_phone_velocity_window_minutes
      ),
      1,
      24 * 60
    ),
    approved_sender_ids: sanitiseSenderList(raw.approved_sender_ids),
    refcode_brute_force_max: clamp(
      intOrDefault(
        raw.refcode_brute_force_max,
        TELEBIRR_DEFAULTS.refcode_brute_force_max
      ),
      1,
      10_000
    ),
    refcode_brute_force_window_minutes: clamp(
      intOrDefault(
        raw.refcode_brute_force_window_minutes,
        TELEBIRR_DEFAULTS.refcode_brute_force_window_minutes
      ),
      1,
      24 * 60
    ),
    reconciliation_variance_threshold: numOrDefault(
      raw.reconciliation_variance_threshold,
      TELEBIRR_DEFAULTS.reconciliation_variance_threshold
    ),
    p2p_enabled: boolOrDefault(raw.p2p_enabled, TELEBIRR_DEFAULTS.p2p_enabled),
    withdrawal_enabled: boolOrDefault(
      raw.withdrawal_enabled,
      TELEBIRR_DEFAULTS.withdrawal_enabled
    ),
  };
}

function sanitiseSenderList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...TELEBIRR_DEFAULTS.approved_sender_ids];
  // Keep tenants from accidentally clearing the allowlist (would block
  // every SMS); fall back to defaults if the cleansed list is empty.
  const cleaned = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= 32);
  return cleaned.length === 0
    ? [...TELEBIRR_DEFAULTS.approved_sender_ids]
    : cleaned;
}

function numOrDefault(v: unknown, d: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return d;
  return v;
}
function intOrDefault(v: unknown, d: number): number {
  const n = numOrDefault(v, d);
  return Math.round(n);
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function boolOrDefault(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}
