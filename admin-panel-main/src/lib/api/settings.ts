/** /api/admin/settings — generic key-value store + bulk update */
import { http } from './client';

export interface SettingRow {
  id?: string;
  tenant_id?: string | null;
  key: string;
  value: unknown;
  updated_at?: string;
}

export function listSettings(query: { keys?: string; prefix?: string } = {}) {
  return http.get<{ items: SettingRow[] }>('/api/admin/settings', { query });
}

export function getSetting(key: string) {
  return http.get<SettingRow>(`/api/admin/settings/${encodeURIComponent(key)}`);
}

export function upsertSetting(key: string, value: unknown) {
  return http.put<SettingRow>(`/api/admin/settings/${encodeURIComponent(key)}`, { value });
}

export function bulkUpdateSettings(values: Record<string, unknown>) {
  return http.put<{ items: SettingRow[] }>('/api/admin/settings', values);
}

export function deleteSetting(key: string) {
  return http.delete<{ key: string }>(`/api/admin/settings/${encodeURIComponent(key)}`);
}

/* ------------------------------------------------------------------------- */
/* Section 14/19 — typed General Config block                                */
/* ------------------------------------------------------------------------- */

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
  // Company Info
  platform_name?: string;
  logo_url?: string;
  currency?: string;
  country?: string;
  country_code?: string;
  timezone?: string;
  website_url?: string;
  offline_bet_support?: boolean;
  offline_payout?: boolean;
  enable_language_selection?: boolean;
  // Social
  social_facebook?: string;
  social_telegram?: string;
  social_tiktok?: string;
  social_instagram?: string;
  social_twitter?: string;
  // Contacts
  contact_email?: string;
  contact_phone?: string;
  support_phone?: string;
  support_email?: string;
  // Copy
  underage_disclaimer?: string;
  about_us?: string;
  // Legacy / shared
  vip_threshold?: number;
  min_withdrawal?: number;
  max_withdrawal?: number;
  // SMS — per-event toggles (Section 19)
  sms_events?: string[];
  sms_max_win_limit?: number;
  // Cashier Config (Section 19)
  cashier_max_daily_cancel_volume?: number;
  cashier_max_stake_cancel?: number;
  cashier_cancel_window_minutes?: number;
  cashier_enable_withdraw_request?: boolean;
  cashier_enable_duplicate_slip?: boolean;
  cashier_max_daily_cancel_count?: number;
  // Operation Hours
  operation_hours?: OperationHours;
  operation_hours_enforce_bets?: boolean;
}

/* ------------------------------------------------------------------------- */
/* Section 20 — typed Main Config block                                      */
/* ------------------------------------------------------------------------- */

export interface MainConfig {
  // Stake limits (legacy + spec)
  min_bet_stake?: number;
  max_bet_stake?: number;
  max_accumulator_legs?: number;
  max_total_odds?: number;
  tax_on_winnings_pct?: number;
  winning_tax_rate?: number;
  winning_tax_threshold?: number;
  cashout_enabled?: boolean;
  live_betting_enabled?: boolean;
  max_payout_per_slip?: number;
  // Transaction tab — Deposits
  min_deposit_amount?: number;
  max_deposit_amount?: number;
  branch_max_single_deposit?: number;
  enable_online_deposit?: boolean;
  enable_user_identifier?: boolean;
  // Transaction tab — Transfers
  min_transfer_amount?: number;
  max_transfer_amount?: number;
  max_daily_transfer_amount?: number;
  enable_transfer?: boolean;
  transfer_contact_confirmation?: boolean;
  // Transaction tab — Withdrawals
  min_withdrawal_amount?: number;
  max_daily_withdrawal_amount?: number;
  branch_max_daily_withdrawal?: number;
  online_max_single_withdrawal?: number;
  branch_max_single_withdrawal?: number;
  branch_withdrawal_rule?: string;
  enable_branch_withdrawal?: boolean;
  enable_online_withdrawal?: boolean;
  withdrawal_contact_confirmation?: boolean;
  allow_full_balance_withdrawal?: boolean;
  // Wallet
  deposit_limit?: number;
  // Mobile App
  android_app_store_url?: string;
  ios_app_store_url?: string;
}

/* ------------------------------------------------------------------------- */
/* Section 19 — Top Bets / Top Matches / Promotions                          */
/* ------------------------------------------------------------------------- */

export interface TopBetEntry {
  id?: string;
  league: string;
  league_group?: string;
  leagueGroup?: string;
  sport_type?: string;
  sportType?: string;
}

export interface TopMatchEntry {
  id?: string;
  match?: string;
  match_id?: string;
  home_team?: string;
  away_team?: string;
  league?: string;
  country?: string;
  sport_type?: string;
  sportType?: string;
  schedule?: string;
  starts_at?: string;
}

export interface PromotionBanner {
  id?: string;
  image_url: string;
  bonus_type?: string;
  title: string;
  description?: string;
  cta_url?: string;
  is_active?: boolean;
  display_order?: number;
}

export interface PaymentConfig {
  min_deposit_amount?: number;
  max_deposit_amount?: number;
  min_withdrawal_amount?: number;
  max_withdrawal_amount?: number;
  withdrawal_processing_hours?: number;
  require_id_verification_above?: number;
}

export interface SecurityConfig {
  require_2fa_admin?: boolean;
  require_2fa_cashier?: boolean;
  require_2fa_users?: boolean;
  session_duration_hours?: number;
  session_timeout_minutes?: number;
  max_login_attempts?: number;
  lockout_duration_minutes?: number;
  ip_whitelist_enabled?: boolean;
  ip_allowlist?: string[];
}

export interface SmsAliasConfig {
  provider?: string;
  api_key?: string;
  username?: string;
  sender_id?: string;
  api_url?: string;
  email_provider?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_password?: string;
  sms_events?: string[];
  email_events?: string[];
}

export const getGeneralConfig = () => http.get<GeneralConfig>('/api/admin/settings/general');
export const updateGeneralConfig = (v: GeneralConfig) =>
  http.put<GeneralConfig>('/api/admin/settings/general', v);

export const getMainConfig = () => http.get<MainConfig>('/api/admin/settings/main');
export const updateMainConfig = (v: MainConfig) =>
  http.put<MainConfig>('/api/admin/settings/main', v);

export const getPaymentConfig = () => http.get<PaymentConfig>('/api/admin/settings/payment');
export const updatePaymentConfig = (v: PaymentConfig) =>
  http.put<PaymentConfig>('/api/admin/settings/payment', v);

export const getSecurityConfig = () => http.get<SecurityConfig>('/api/admin/settings/security');
export const updateSecurityConfig = (v: SecurityConfig) =>
  http.put<SecurityConfig>('/api/admin/settings/security', v);

export const getSmsAliasConfig = () => http.get<SmsAliasConfig>('/api/admin/settings/sms');
export const updateSmsAliasConfig = (v: SmsAliasConfig) =>
  http.put<SmsAliasConfig>('/api/admin/settings/sms', v);

/* Section 19 — Top Bets / Top Matches / Promotions list endpoints. */
export const listTopBets = () =>
  http.get<{ items: TopBetEntry[] }>('/api/admin/settings/top-bets');
export const saveTopBets = (items: TopBetEntry[]) =>
  http.post<{ items: TopBetEntry[] }>('/api/admin/settings/top-bets', { items });

export const listTopMatches = () =>
  http.get<{ items: TopMatchEntry[] }>('/api/admin/settings/top-matches');
export const saveTopMatches = (items: TopMatchEntry[]) =>
  http.post<{ items: TopMatchEntry[] }>('/api/admin/settings/top-matches', { items });

export const listPromotions = () =>
  http.get<{ items: PromotionBanner[] }>('/api/admin/settings/promotions');
export const savePromotions = (items: PromotionBanner[]) =>
  http.post<{ items: PromotionBanner[] }>('/api/admin/settings/promotions', { items });
