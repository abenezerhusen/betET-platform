/**
 * /api/admin/bets — Section 4 frontend API client.
 *
 * Backed by `backend/src/modules/admin/bets`. Returns rows that originate
 * from either `sportsbook_bets` or the legacy `bets` table; the server
 * harmonises both shapes so the panel can treat them uniformly.
 */
import { http } from './client';

export type BetType = 'online' | 'offline' | 'bet_for_me';
export type BetStatus =
  | 'pending'
  | 'won'
  | 'lost'
  | 'void'
  | 'cashout'
  | 'partial'
  | 'cancelled';

export interface AdminBet {
  id: string;
  tenant_id: string;
  user_id?: string | null;
  cashier_id?: string | null;
  channel: BetType;
  bet_type: 'single' | 'combo' | 'system' | 'jackpot';
  bet_for_user_phone?: string | null;
  stake: string;
  currency: string;
  potential_payout?: string | null;
  actual_payout?: string | null;
  status: BetStatus;
  jackpot_id?: string | null;
  metadata?: Record<string, unknown>;
  branch_id?: string | null;
  branch_name?: string | null;
  cashier_name?: string | null;
  cashier_email?: string | null;
  user_email?: string | null;
  user_phone?: string | null;
  user_name?: string | null;
  source?: 'sportsbook' | 'bets';
  placed_at: string;
  settled_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface BetSummary {
  total_stake: string;
  total_payout: string;
  won_count: string;
  lost_count: string;
  pending_count: string;
  cancelled_count: string;
}

export interface ListBetsResponse {
  items: AdminBet[];
  total: number;
  page: number;
  limit: number;
  summary?: BetSummary | null;
}

export interface ListBetsQuery {
  type?: BetType;
  status?: BetStatus;
  bet_type?: 'single' | 'combo' | 'system' | 'jackpot';
  user_id?: string;
  cashier_id?: string;
  branch_id?: string;
  jackpot_id?: string;
  phone?: string;
  payment_type?: string;
  paid?: boolean;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export function listBets(query: ListBetsQuery = {}) {
  return http.get<ListBetsResponse>('/api/admin/bets', { query });
}

export interface AdminBetLeg {
  id: string;
  bet_id: string;
  selection_id: string | null;
  odds_at_placement: string;
  status: string;
  settled_at: string | null;
  created_at: string;
  selection_label: string | null;
  current_odds: string | null;
  result: string | null;
  market_type: string | null;
  market_label: string | null;
  event_id: string | null;
  home_team: string | null;
  away_team: string | null;
  sport: string | null;
  league: string | null;
  starts_at: string | null;
}

export interface AdminBetDetail extends AdminBet {
  legs: AdminBetLeg[];
}

export function getBet(id: string) {
  return http.get<AdminBetDetail>(`/api/admin/bets/${id}`);
}

export interface CancelBetResponse {
  id: string;
  status: 'void' | 'cancelled';
  refund: {
    amount: string;
    currency: string;
    wallet_id: string;
    transaction_id: string;
  };
}

export function cancelBet(id: string, reason?: string) {
  return http.post<CancelBetResponse>(`/api/admin/bets/${id}/cancel`, {
    reason: reason ?? 'Admin panel cancellation',
  });
}
