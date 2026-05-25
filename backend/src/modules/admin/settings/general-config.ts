/**
 * Section 19/20 — single source of truth for the General + Main config
 * blocks used by runtime services (notifications, bet placement,
 * operation-hour enforcement, etc.).
 *
 * The admin panel may save these settings in several places:
 *   - general.config     (top-level platform settings + SMS toggles +
 *                         cashier limits + operation hours)
 *   - general.top_bets   (array of leagues featured on the user lobby)
 *   - general.top_matches (array of featured matches)
 *   - general.promotions (array of hero banners)
 *   - main.config        (transaction, slip, cashout, tax rules — read
 *                         by the betting-config module too)
 *
 * Read paths are tolerant: missing keys collapse to defaults, missing
 * fields fall back to legacy keys (e.g. `support_phone` if
 * `contact_phone` is absent).
 */

import type { PoolClient } from 'pg';

export interface OperationHoursDay {
  open: string;          // "HH:MM"
  close: string;         // "HH:MM"
  closed?: boolean;
}

export interface OperationHours {
  mon?: OperationHoursDay;
  tue?: OperationHoursDay;
  wed?: OperationHoursDay;
  thu?: OperationHoursDay;
  fri?: OperationHoursDay;
  sat?: OperationHoursDay;
  sun?: OperationHoursDay;
}

export interface GeneralConfig {
  platform_name: string;
  logo_url: string;
  currency: string;
  country: string;
  country_code: string;
  timezone: string;
  website_url: string;
  offline_bet_support: boolean;
  offline_payout: boolean;
  enable_language_selection: boolean;
  social_facebook: string;
  social_telegram: string;
  social_tiktok: string;
  social_instagram: string;
  social_twitter: string;
  contact_email: string;
  contact_phone: string;
  support_phone: string;
  support_email: string;
  underage_disclaimer: string;
  about_us: string;
  /** Set of event codes for which SMS is allowed. Empty set means no
   *  per-event gating (all events allowed when SMS provider is enabled). */
  sms_events: Set<string>;
  /** Only send win-related SMS when payout >= this threshold. 0 disables the gate. */
  sms_max_win_limit: number;
  /** Cashier limits (Section 19). */
  cashier_max_daily_cancel_volume: number;
  cashier_max_stake_cancel: number;
  cashier_cancel_window_minutes: number;
  cashier_enable_withdraw_request: boolean;
  cashier_enable_duplicate_slip: boolean;
  cashier_max_daily_cancel_count: number;
  /** Optional operation hours. */
  operation_hours: OperationHours;
  operation_hours_enforce_bets: boolean;
}

const DEFAULTS: GeneralConfig = {
  platform_name: '',
  logo_url: '',
  currency: 'ETB',
  country: '',
  country_code: '',
  timezone: 'Africa/Addis_Ababa',
  website_url: '',
  offline_bet_support: true,
  offline_payout: true,
  enable_language_selection: false,
  social_facebook: '',
  social_telegram: '',
  social_tiktok: '',
  social_instagram: '',
  social_twitter: '',
  contact_email: '',
  contact_phone: '',
  support_phone: '',
  support_email: '',
  underage_disclaimer: '',
  about_us: '',
  sms_events: new Set<string>(),
  sms_max_win_limit: 0,
  cashier_max_daily_cancel_volume: 0,
  cashier_max_stake_cancel: 0,
  cashier_cancel_window_minutes: 5,
  cashier_enable_withdraw_request: true,
  cashier_enable_duplicate_slip: false,
  cashier_max_daily_cancel_count: 0,
  operation_hours: {},
  operation_hours_enforce_bets: false,
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function asString(v: unknown, fallback: string): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v;
  return String(v);
}
function asBool(v: unknown, fallback: boolean): boolean {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  if (typeof v === 'number') return v !== 0;
  return fallback;
}
function asNumber(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function readJsonRow(
  client: PoolClient,
  tenantId: string,
  key: string
): Promise<Record<string, unknown> | unknown[]> {
  const r = await client.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, key]
  );
  const v = r.rows[0]?.value;
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  return {};
}

/* -------------------------------------------------------------------------- */
/* Public reader                                                              */
/* -------------------------------------------------------------------------- */

export async function loadGeneralConfig(
  client: PoolClient,
  tenantId: string
): Promise<GeneralConfig> {
  const raw = (await readJsonRow(client, tenantId, 'general.config')) as Record<string, unknown>;

  const smsEventsRaw = Array.isArray(raw.sms_events) ? raw.sms_events : [];
  const smsEvents = new Set<string>();
  for (const ev of smsEventsRaw) {
    if (typeof ev === 'string') {
      const trimmed = ev.trim();
      if (trimmed) smsEvents.add(trimmed.toLowerCase());
    }
  }

  const opHoursRaw = (raw.operation_hours ?? {}) as Record<string, OperationHoursDay>;
  const operation_hours: OperationHours = {};
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const) {
    const entry = opHoursRaw[day];
    if (entry && typeof entry === 'object' && typeof entry.open === 'string' && typeof entry.close === 'string') {
      operation_hours[day] = {
        open: entry.open,
        close: entry.close,
        closed: Boolean(entry.closed),
      };
    }
  }

  return {
    platform_name: asString(raw.platform_name, DEFAULTS.platform_name),
    logo_url: asString(raw.logo_url, DEFAULTS.logo_url),
    currency: asString(raw.currency, DEFAULTS.currency),
    country: asString(raw.country, DEFAULTS.country),
    country_code: asString(raw.country_code, DEFAULTS.country_code),
    timezone: asString(raw.timezone, DEFAULTS.timezone),
    website_url: asString(raw.website_url, DEFAULTS.website_url),
    offline_bet_support: asBool(raw.offline_bet_support, DEFAULTS.offline_bet_support),
    offline_payout: asBool(raw.offline_payout, DEFAULTS.offline_payout),
    enable_language_selection: asBool(raw.enable_language_selection, DEFAULTS.enable_language_selection),
    social_facebook: asString(raw.social_facebook, ''),
    social_telegram: asString(raw.social_telegram, ''),
    social_tiktok: asString(raw.social_tiktok, ''),
    social_instagram: asString(raw.social_instagram, ''),
    social_twitter: asString(raw.social_twitter, ''),
    contact_email: asString(raw.contact_email ?? raw.support_email, DEFAULTS.contact_email),
    contact_phone: asString(raw.contact_phone ?? raw.support_phone, DEFAULTS.contact_phone),
    support_phone: asString(raw.support_phone, DEFAULTS.support_phone),
    support_email: asString(raw.support_email, DEFAULTS.support_email),
    underage_disclaimer: asString(raw.underage_disclaimer, DEFAULTS.underage_disclaimer),
    about_us: asString(raw.about_us, DEFAULTS.about_us),
    sms_events: smsEvents,
    sms_max_win_limit: asNumber(raw.sms_max_win_limit, DEFAULTS.sms_max_win_limit),
    cashier_max_daily_cancel_volume: asNumber(
      raw.cashier_max_daily_cancel_volume,
      DEFAULTS.cashier_max_daily_cancel_volume
    ),
    cashier_max_stake_cancel: asNumber(
      raw.cashier_max_stake_cancel,
      DEFAULTS.cashier_max_stake_cancel
    ),
    cashier_cancel_window_minutes: asNumber(
      raw.cashier_cancel_window_minutes,
      DEFAULTS.cashier_cancel_window_minutes
    ),
    cashier_enable_withdraw_request: asBool(
      raw.cashier_enable_withdraw_request,
      DEFAULTS.cashier_enable_withdraw_request
    ),
    cashier_enable_duplicate_slip: asBool(
      raw.cashier_enable_duplicate_slip,
      DEFAULTS.cashier_enable_duplicate_slip
    ),
    cashier_max_daily_cancel_count: asNumber(
      raw.cashier_max_daily_cancel_count,
      DEFAULTS.cashier_max_daily_cancel_count
    ),
    operation_hours,
    operation_hours_enforce_bets: asBool(
      raw.operation_hours_enforce_bets,
      DEFAULTS.operation_hours_enforce_bets
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* SMS event helper                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Canonical event codes used across the platform (Section 19 SMS tab).
 * Notification dispatch maps individual sendSmsBestEffort call sites to
 * one of these codes; if the admin disables the code on the General
 * Config page, the SMS is silently skipped.
 */
export type SmsEventCode =
  | 'registration_confirmation'
  | 'phone_confirmation'
  | 'password_reset'
  | 'bet_placed'
  | 'bet_for_me_placed'
  | 'branch_withdrawal'
  | 'deposit_success'
  | 'bet_cancellation'
  | 'bet_win'
  | 'branch_deposit';

/** Returns true if the admin allows SMS for this event code. When no
 *  per-event configuration has been saved at all, the function returns
 *  TRUE so legacy behaviour (every SMS site emits) is preserved. */
export function isSmsEventEnabled(
  cfg: GeneralConfig,
  code: SmsEventCode | string | undefined
): boolean {
  if (!code) return true;
  // No per-event toggles configured → allow everything (legacy mode).
  if (cfg.sms_events.size === 0) return true;
  return cfg.sms_events.has(String(code).toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* Operation Hours                                                            */
/* -------------------------------------------------------------------------- */

const DAY_KEYS: Array<keyof OperationHours> = [
  'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat',
];

/**
 * Returns true if the configured operation-hour window currently allows
 * activity (bet placement, ticket sale, etc.). Returns true if no
 * configuration exists, so legacy 24/7 behaviour is preserved.
 *
 * The check uses the tenant timezone when available; otherwise it falls
 * back to the host clock. `now` is overridable for tests.
 */
export function isWithinOperationHours(
  cfg: GeneralConfig,
  now: Date = new Date()
): boolean {
  const hours = cfg.operation_hours;
  if (!hours || Object.keys(hours).length === 0) return true;

  // Resolve "now" in the configured timezone. Intl gives us components.
  const tz = cfg.timezone || 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  const map: Record<string, keyof OperationHours> = {
    Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat',
  };
  const key = map[weekdayShort];
  if (!key) return true;
  const today = hours[key];
  if (!today) return true; // No entry → not enforced for this day.
  if (today.closed) return false;

  const [openH, openM] = today.open.split(':').map((s) => Number(s) || 0);
  const [closeH, closeM] = today.close.split(':').map((s) => Number(s) || 0);
  const nowMinutes = hh * 60 + mm;
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  if (openMinutes === closeMinutes) return true; // 24h window.
  if (openMinutes < closeMinutes) {
    return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
  }
  // Window crosses midnight (e.g. open 18:00, close 02:00).
  return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
}

/* -------------------------------------------------------------------------- */
/* DAY_KEYS export so admin UIs can iterate consistently.                     */
/* -------------------------------------------------------------------------- */

export { DAY_KEYS };
