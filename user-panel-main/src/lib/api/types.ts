/**
 * Shared TypeScript shapes for the user-panel API surface.
 *
 * These mirror the JSON shapes returned by the backend (`backend/src/modules/*`).
 * Only fields actually consumed by the user panel are typed here; everything
 * else is left as `Record<string, unknown>` to stay forward compatible.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages?: number;
}

export interface AuthUserSummary {
  id: string;
  tenant_id: string;
  role: string;
  email: string | null;
  phone: string | null;
  display_name?: string | null;
  username?: string | null;
}

/** Flat token pair returned by `/api/auth/login`, `/api/auth/register`+login, `/api/auth/refresh`. */
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  user: AuthUserSummary;
}

/** GET `/api/user/wallet` */
export interface WalletRow {
  id: string;
  tenant_id: string;
  user_id: string;
  currency: string;
  balance: string;
  bonus_balance: string;
  locked_balance: string;
  status: string;
}

export interface WalletSummaryLine {
  currency: string;
  balance: string;
  bonus_balance: string;
  locked_balance: string;
  total: string;
}

export interface WalletApiResponse {
  items: WalletRow[];
  summary: WalletSummaryLine[];
}

export interface UserProfile {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  date_of_birth: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  preferred_language?: string | null;
  status: string;
  kyc_status?: string | null;
}

export interface BetSummaryItem {
  id: string;
  user_id: string;
  match_id: string | null;
  event_id: string | null;
  bet_type: string;
  stake: string | number;
  potential_payout: string | number;
  actual_payout: string | number | null;
  status: string;
  placed_at: string;
  settled_at?: string | null;
  odds?: string | number | null;
  selections?: Array<{
    market: string;
    selection: string;
    odds: string | number;
    status: string;
  }>;
}

export interface TransactionItem {
  id: string;
  user_id: string;
  wallet_id: string | null;
  type: string;
  amount: string | number;
  fee: string | number | null;
  status: string;
  reference: string | null;
  description: string | null;
  created_at: string;
  completed_at: string | null;
  payment_method?: string | null;
}

/** Row from `games` via `/api/user/games`. */
export interface GameSummary {
  id: string;
  tenant_id: string;
  provider: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  is_active: boolean;
  is_iframe: boolean;
  iframe_url: string | null;
  rtp: string | null;
  status: string;
}

export interface PromotionItem {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  banner_url: string | null;
  starts_at: string;
  ends_at: string | null;
  terms_url: string | null;
  is_active: boolean;
}
