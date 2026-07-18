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

  /** USSD template the paired phone dials to send a Telebirr payout.
   *  Tokens {recipient}, {amount}, {pin} are substituted server-side
   *  when a withdraw command is dispatched. Kept configurable so the
   *  exact Telebirr send-money code can be tuned WITHOUT rebuilding the
   *  Android app. (Legacy one-shot path; superseded by the interactive
   *  menu flow below on devices with the accessibility automation.) */
  withdrawal_ussd_template: string;

  /* ------------------------------------------------------------------- */
  /* Interactive USSD menu flow (multi-step Telebirr "send money")        */
  /* ------------------------------------------------------------------- */

  /** The USSD code that opens the Telebirr menu (default `*127#`). */
  withdrawal_ussd_initial: string;

  /** Ordered list of replies the phone types into each successive USSD
   *  menu prompt. Tokens {recipient}, {amount}, {comment}, {pin} are
   *  substituted at dispatch time. Configurable so menu changes are
   *  fixed in admin/DB WITHOUT rebuilding the app. */
  withdrawal_ussd_steps: string[];

  /** The value typed into the "comment/reason" step (default `fee`). */
  withdrawal_ussd_comment: string;
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
  // Telebirr send-money one-shot USSD. Adjust in admin/DB to match the exact
  // code for this SIM/telecom. Tokens are replaced at dispatch time.
  withdrawal_ussd_template: '*127*1*{recipient}*{amount}*{pin}#',
  // Interactive Telebirr "send money" menu flow. Default reflects the
  // observed live sequence: *127# -> 2 -> 1 -> 1 (by phone) -> recipient ->
  // 1 (confirm) -> amount -> comment -> 1 (confirm) -> PIN.
  withdrawal_ussd_initial: '*127#',
  withdrawal_ussd_steps: [
    '2',
    '1',
    '1',
    '{recipient}',
    '1',
    '{amount}',
    '{comment}',
    '1',
    '{pin}',
  ],
  withdrawal_ussd_comment: 'fee',
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
    withdrawal_ussd_template:
      typeof raw.withdrawal_ussd_template === 'string' &&
      raw.withdrawal_ussd_template.trim().length > 0
        ? raw.withdrawal_ussd_template.trim()
        : TELEBIRR_DEFAULTS.withdrawal_ussd_template,
    withdrawal_ussd_initial:
      typeof raw.withdrawal_ussd_initial === 'string' &&
      raw.withdrawal_ussd_initial.trim().length > 0
        ? raw.withdrawal_ussd_initial.trim()
        : TELEBIRR_DEFAULTS.withdrawal_ussd_initial,
    withdrawal_ussd_steps:
      Array.isArray(raw.withdrawal_ussd_steps) &&
      raw.withdrawal_ussd_steps.length > 0 &&
      raw.withdrawal_ussd_steps.every((s) => typeof s === 'string')
        ? raw.withdrawal_ussd_steps.map((s) => String(s))
        : [...TELEBIRR_DEFAULTS.withdrawal_ussd_steps],
    withdrawal_ussd_comment:
      typeof raw.withdrawal_ussd_comment === 'string' &&
      raw.withdrawal_ussd_comment.trim().length > 0
        ? raw.withdrawal_ussd_comment.trim()
        : TELEBIRR_DEFAULTS.withdrawal_ussd_comment,
  };
}

/**
 * Substitute {recipient}/{amount}/{pin} into the configured USSD template.
 * Amount is normalised to a plain integer-or-decimal string (no thousands
 * separators) so the dialer receives exactly what Telebirr expects.
 */
export function buildWithdrawalUssd(
  template: string,
  params: { recipient: string; amount: string | number; pin: string }
): string {
  // Telebirr's transfer USSD expects a plain number (e.g. `100`, or `100.5`),
  // NOT a fixed 2-decimal string like `100.00` — the trailing `.00` makes the
  // operator reject the request (USSD failure code -1). Normalise to the
  // shortest exact numeric form: whole numbers lose the decimals entirely.
  const cleaned = String(params.amount).replace(/[^0-9.]/g, '');
  const num = Number(cleaned);
  const amountStr =
    Number.isFinite(num) && num > 0 ? String(num) : cleaned;
  return template
    .replaceAll('{recipient}', params.recipient)
    .replaceAll('{amount}', amountStr)
    .replaceAll('{pin}', params.pin);
}

/** Normalise an amount for USSD input: whole numbers drop the decimals. */
function normaliseUssdAmount(amount: string | number): string {
  const cleaned = String(amount).replace(/[^0-9.]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? String(num) : cleaned;
}

/**
 * Resolve the interactive USSD "send money" menu flow the phone will
 * auto-navigate: returns the initial code and the ordered list of replies
 * with {recipient}/{amount}/{comment}/{pin} substituted.
 */
export function buildWithdrawalUssdFlow(
  settings: Pick<
    TelebirrSettings,
    | 'withdrawal_ussd_initial'
    | 'withdrawal_ussd_steps'
    | 'withdrawal_ussd_comment'
  >,
  params: { recipient: string; amount: string | number; pin: string }
): { initial: string; steps: string[] } {
  const amountStr = normaliseUssdAmount(params.amount);
  const steps = settings.withdrawal_ussd_steps.map((s) =>
    s
      .replaceAll('{recipient}', params.recipient)
      .replaceAll('{amount}', amountStr)
      .replaceAll('{comment}', settings.withdrawal_ussd_comment)
      .replaceAll('{pin}', params.pin)
  );
  return { initial: settings.withdrawal_ussd_initial, steps };
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
