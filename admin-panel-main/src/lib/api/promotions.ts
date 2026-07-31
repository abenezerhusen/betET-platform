/** /api/admin/promotions — raffles, referrals, affiliates */
import { http } from './client';

export interface Raffle {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  ticket_price: number;
  currency: string;
  prize_pool: number;
  max_tickets?: number | null;
  draw_at?: string | null;
  status: 'draft' | 'open' | 'drawn' | 'cancelled';
  rules: Record<string, unknown>;
  tickets_count?: number;
  created_at: string;
  updated_at: string;
}

export function listRaffles(query: {
  status?: Raffle['status'];
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: Raffle[]; total?: number; page: number; limit: number }>(
    '/api/admin/promotions/raffles',
    { query }
  );
}

export function createRaffle(input: Partial<Raffle>) {
  return http.post<Raffle>('/api/admin/promotions/raffles', input);
}

export function updateRaffle(id: string, input: Partial<Raffle>) {
  return http.put<Raffle>(`/api/admin/promotions/raffles/${id}`, input);
}

export function deleteRaffle(id: string) {
  return http.delete<{ id: string }>(`/api/admin/promotions/raffles/${id}`);
}

export function listRaffleTickets(id: string) {
  return http.get<{ items: Array<Record<string, unknown>> }>(
    `/api/admin/promotions/raffles/${id}/tickets`
  );
}

export function addRaffleTicket(id: string, input: { user_id: string; ticket_number?: string }) {
  return http.post<Record<string, unknown>>(
    `/api/admin/promotions/raffles/${id}/tickets`,
    input
  );
}

export function drawRaffle(id: string) {
  return http.post<Record<string, unknown>>(`/api/admin/promotions/raffles/${id}/draw`);
}

export function listReferralCodes() {
  return http.get<{ items: Array<Record<string, unknown>> }>(
    '/api/admin/promotions/referral-codes'
  );
}

export function createReferralCode(input: {
  user_id: string;
  code?: string;
  max_uses?: number;
  is_active?: boolean;
}) {
  return http.post<Record<string, unknown>>('/api/admin/promotions/referral-codes', input);
}

export function listReferrals(query: {
  status?: 'pending' | 'rewarded' | 'expired' | 'cancelled';
  referrer_id?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: Array<Record<string, unknown>>; total?: number }>(
    '/api/admin/promotions/referrals',
    { query }
  );
}

export function rewardReferral(id: string) {
  return http.post<Record<string, unknown>>(`/api/admin/promotions/referrals/${id}/reward`);
}

export interface AdminReferralRow {
  id: string;
  referrer: string;
  referred_user: string;
  referred_phone?: string;
  date_joined?: string;
  deposit_made?: number;
  qualified?: boolean;
  bonus_status?: 'pending' | 'paid';
  reward?: number;
}

export function listAdminAffiliateReferrals(query: {
  status?: 'all' | 'pending' | 'paid';
  referrer_id?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ data: AdminReferralRow[]; total: number; page: number; limit: number }>(
    '/api/admin/affiliates/referrals',
    { query }
  );
}

/** Load referrals where this user is the referrer — used in UserDetailsModal. */
export function getUserReferrals(userId: string) {
  return listAdminAffiliateReferrals({ referrer_id: userId, limit: 100 });
}

export function approveAdminAffiliateReferral(id: string) {
  return http.post<{ id: string; status: string }>(`/api/admin/affiliates/referrals/${id}/approve`);
}

export function payAdminAffiliateReferral(id: string) {
  return http.post<{ id: string; status: string }>(`/api/admin/affiliates/referrals/${id}/pay`);
}

export function getReferralConfig() {
  return http.get<{
    is_enabled?: boolean;
    reward_amount: number;
    min_deposit_to_qualify: number;
    reward_type: 'cash' | 'free_bet';
  }>('/api/admin/promotions/referral-config');
}

export function updateReferralConfig(input: {
  is_enabled?: boolean;
  reward_amount: number;
  min_deposit_to_qualify: number;
  reward_type: 'cash' | 'free_bet';
}) {
  return http.put('/api/admin/promotions/referral-config', input);
}

export interface Affiliate {
  id: string;
  tenant_id: string;
  user_id?: string | null;
  name: string;
  code: string;
  plan: 'revenue_share' | 'cpa' | 'hybrid';
  commission_pct: number;
  cpa_amount: number;
  status: 'active' | 'paused' | 'terminated';
  earnings_total?: string | null;
  created_at: string;
  updated_at: string;
}

export function listAffiliates(query: {
  status?: Affiliate['status'];
  search?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{
    items: Array<Affiliate & {
      phone?: string;
      total_referrals?: number;
      active_users?: number;
      revenue_generated?: string;
    }>;
    total?: number;
    page: number;
    limit: number;
  }>('/api/admin/affiliates', { query });
}

export function createAffiliate(input: Partial<Affiliate> & { phone?: string }) {
  return http.post<Affiliate>('/api/admin/affiliates', input);
}

export function updateAffiliate(id: string, input: Partial<Affiliate>) {
  return http.put<Affiliate>(`/api/admin/promotions/affiliates/${id}`, input);
}

export function deleteAffiliate(id: string) {
  return http.delete<{ ok: boolean }>(`/api/admin/promotions/affiliates/${id}`);
}

export function recordAffiliateClick(code: string, body: { ip?: string; user_agent?: string; referrer?: string } = {}) {
  return http.post<{ ok: boolean }>(`/api/admin/promotions/affiliates/clicks/${code}`, body);
}

/* ------------------------------------------------------------------ */
/* Affiliate payments + commission config (spec section 11)            */
/* ------------------------------------------------------------------ */

export interface AffiliatePaymentRow {
  id: string;
  affiliate: string;
  affiliate_id: string | null;
  amount: number;
  method: string;
  status: 'pending' | 'paid';
  reference: string;
  date: string | null;
  note: string;
  currency: string;
}

export function listAffiliatePayments(query: {
  status?: 'pending' | 'paid' | 'all';
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: AffiliatePaymentRow[]; page: number; limit: number }>(
    '/api/admin/affiliates/payments',
    { query }
  );
}

export function payAffiliate(id: string, input: {
  amount: number;
  method?: string;
  reference?: string;
  note?: string;
}) {
  return http.post<{
    affiliate_id: string;
    amount_paid: number;
    remaining_earnings: number;
    method: string;
    reference: string | null;
  }>(`/api/admin/affiliates/${id}/payout`, input);
}

export interface CommissionConfig {
  sportsbook: { revenue_share_pct: number; cpa_amount: number; hold_days: number };
  casino: { revenue_share_pct: number; cpa_amount: number; hold_days: number };
  payments_list?: Array<{
    type: 'revenue_share' | 'cpa' | 'hybrid';
    product: 'sportsbook' | 'casino';
    rate: number;
    threshold: number;
    hold_days: number;
    active: boolean;
  }>;
}

export function getCommissionConfig() {
  return http.get<CommissionConfig>('/api/admin/affiliates/commission-config');
}

export function updateCommissionConfig(input: CommissionConfig) {
  return http.put<CommissionConfig>('/api/admin/affiliates/commission-config', input);
}

/* ------------------------------------------------------------------ */
/* Spec-aligned raffles (/api/admin/raffles)                            */
/* ------------------------------------------------------------------ */

export interface AdminRaffle {
  id: string;
  name: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  min_deposit: number;
  prize_pool: number;
  currency: string;
  max_tickets: number | null;
  draw_mode: 'auto' | 'manual';
  notify_winners: boolean;
  prizes: Array<{ rank: number; name: string; amount: number }>;
  image_url?: string | null;
  terms?: string | null;
  status: 'Active' | 'Pending' | 'Completed' | 'Cancelled';
  winning_ticket_id: string | null;
  tickets_count: number;
  created_at: string;
  updated_at: string;
}

export function listAdminRaffles(query: {
  status?: AdminRaffle['status'];
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: AdminRaffle[]; total?: number; page: number; limit: number }>(
    '/api/admin/raffles',
    { query }
  );
}

export function createAdminRaffle(input: Partial<AdminRaffle>) {
  return http.post<AdminRaffle>('/api/admin/raffles', input);
}

export function updateAdminRaffle(id: string, input: Partial<AdminRaffle>) {
  return http.put<AdminRaffle>(`/api/admin/raffles/${id}`, input);
}

export function setAdminRaffleStatus(id: string, status: AdminRaffle['status']) {
  return http.patch<AdminRaffle>(`/api/admin/raffles/${id}/status`, { status });
}

export function drawAdminRaffle(id: string) {
  return http.post<AdminRaffle>(`/api/admin/raffles/${id}/draw`);
}

export function listAdminRaffleTickets(id: string) {
  return http.get<{ items: Array<Record<string, unknown>> }>(
    `/api/admin/raffles/${id}/tickets`
  );
}

export function listAdminRaffleWinners(id: string) {
  return http.get<{ items: Array<Record<string, unknown>> }>(
    `/api/admin/raffles/${id}/winners`
  );
}

/* ─────────────────────── Cashout Boost Promotion ─────────────────────── */

export interface CashoutBoostAvailability {
  live_bets: boolean;
  prematch_bets: boolean;
  single_bets: boolean;
  multiple_bets: boolean;
  system_bets: boolean;
}

export interface CashoutBoostSports {
  football: boolean;
  basketball: boolean;
  tennis: boolean;
  volleyball: boolean;
  esports: boolean;
  virtual: boolean;
  others: boolean;
}

export interface CashoutBoostDisplay {
  show_badge: boolean;
  show_original_amount: boolean;
  show_promotion_amount: boolean;
  show_final_amount: boolean;
  badge_text: string;
}

export interface CashoutBoostConfig {
  is_enabled: boolean;
  promotion_type: 'percentage' | 'fixed';
  promotion_value: number;
  availability: CashoutBoostAvailability;
  sports: CashoutBoostSports;
  display: CashoutBoostDisplay;
}

const DEFAULT_CASHOUT_BOOST: CashoutBoostConfig = {
  is_enabled: false,
  promotion_type: 'percentage',
  promotion_value: 10,
  availability: {
    live_bets: true,
    prematch_bets: true,
    single_bets: true,
    multiple_bets: true,
    system_bets: false,
  },
  sports: {
    football: true,
    basketball: true,
    tennis: true,
    volleyball: true,
    esports: false,
    virtual: false,
    others: true,
  },
  display: {
    show_badge: true,
    show_original_amount: true,
    show_promotion_amount: true,
    show_final_amount: true,
    badge_text: '🔥 Cash Out Boost',
  },
};

export function getCashoutBoostConfig(): Promise<CashoutBoostConfig> {
  return http
    .get<CashoutBoostConfig>('/api/admin/promotions/cashout-boost')
    .then((r) => ({ ...DEFAULT_CASHOUT_BOOST, ...r }));
}

export function updateCashoutBoostConfig(config: CashoutBoostConfig): Promise<CashoutBoostConfig> {
  return http.put<CashoutBoostConfig>('/api/admin/promotions/cashout-boost', config);
}

/* ─────────────────────── Registration (Signup) Bonus ────────────────────── */

/** Products the signup bonus may be used on (checkboxes). */
export interface RegistrationBonusProducts {
  sportsbook: boolean;
  football: boolean;
  virtual: boolean;
  casino: boolean;
}

/** "International model" sportsbook usage rules for the bonus. */
export interface RegistrationBonusSportsbookRules {
  /** Minimum number of matches/selections in a qualifying bet. */
  min_selections: number;
  /** Minimum odds each selection must be priced at. */
  min_odds: number;
}

export interface RegistrationBonusConfig {
  /** Master on/off switch for the new-user signup bonus. */
  is_enabled: boolean;
  /** Non-withdrawable bonus amount credited to each new account (ETB). */
  amount: number;
  /** Which products the bonus can be wagered on. */
  products: RegistrationBonusProducts;
  /** Sportsbook-specific wagering conditions. */
  sportsbook_rules: RegistrationBonusSportsbookRules;
  /** Turnover requirement (amount × multiplier) before conversion to cash. */
  wagering_multiplier: number;
  /** Bonus validity window in days (0 = never expires). */
  expires_in_days: number;
}

const DEFAULT_REGISTRATION_BONUS: RegistrationBonusConfig = {
  is_enabled: false,
  amount: 0,
  products: {
    sportsbook: true,
    football: false,
    virtual: false,
    casino: false,
  },
  sportsbook_rules: {
    min_selections: 0,
    min_odds: 0,
  },
  wagering_multiplier: 0,
  expires_in_days: 0,
};

export function getRegistrationBonusConfig(): Promise<RegistrationBonusConfig> {
  return http
    .get<RegistrationBonusConfig>('/api/admin/promotions/registration-bonus')
    .then((r) => ({
      ...DEFAULT_REGISTRATION_BONUS,
      ...r,
      products: { ...DEFAULT_REGISTRATION_BONUS.products, ...(r?.products ?? {}) },
      sportsbook_rules: {
        ...DEFAULT_REGISTRATION_BONUS.sportsbook_rules,
        ...(r?.sportsbook_rules ?? {}),
      },
    }));
}

export function updateRegistrationBonusConfig(
  config: RegistrationBonusConfig
): Promise<RegistrationBonusConfig> {
  return http.put<RegistrationBonusConfig>('/api/admin/promotions/registration-bonus', config);
}

/* ───────────────────────── Rain Bonus (game drops) ───────────────────────── */

export type RainGameId = 'fast-keno' | 'aviator';

export interface RainConfig {
  /** Master on/off for this game's rain. */
  is_enabled: boolean;
  /** Total pool distributed per rain event (ETB). */
  pool_amount: number;
  /** Fixed amount each claimer gets (equal mode). 0 → pool_amount ÷ max_claims. */
  per_claim_amount: number;
  /** How the pool is split between claimers. */
  distribution: 'equal' | 'random';
  /** Max players that can claim a single rain. */
  max_claims: number;
  /** Rain events fired per day. */
  rains_per_day: number;
  /** Daily UTC window "HH:MM"; empty ⇒ all day. */
  window_start: string;
  window_end: string;
  /** Seconds a rain stays claimable. */
  claim_deadline_seconds: number;
  /** Where the reward lands. */
  credit_target: 'bonus' | 'main';
  /** Eligibility gates (0 disables). */
  min_balance: number;
  min_wager_today: number;
  min_account_age_days: number;
  currency: string;
}

export const DEFAULT_RAIN_CONFIG: RainConfig = {
  is_enabled: false,
  pool_amount: 500,
  per_claim_amount: 5,
  distribution: 'equal',
  max_claims: 10,
  rains_per_day: 20,
  window_start: '',
  window_end: '',
  claim_deadline_seconds: 600,
  credit_target: 'bonus',
  min_balance: 0,
  min_wager_today: 0,
  min_account_age_days: 0,
  currency: 'ETB',
};

export function getRainConfig(game: RainGameId): Promise<RainConfig> {
  return http
    .get<RainConfig>(`/api/admin/games/rain/${game}`)
    .then((r) => ({ ...DEFAULT_RAIN_CONFIG, ...r }));
}

export function updateRainConfig(game: RainGameId, config: RainConfig): Promise<RainConfig> {
  return http.put<RainConfig>(`/api/admin/games/rain/${game}`, config);
}

export interface KenoCountdownConfig {
  betting_seconds: number;
}

export function getKenoCountdown(): Promise<KenoCountdownConfig> {
  return http
    .get<KenoCountdownConfig>('/api/admin/games/countdown/fast-keno')
    .then((r) => ({ betting_seconds: 30, ...r }));
}

export function updateKenoCountdown(config: KenoCountdownConfig): Promise<KenoCountdownConfig> {
  return http.put<KenoCountdownConfig>('/api/admin/games/countdown/fast-keno', config);
}
