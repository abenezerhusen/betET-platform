/**
 * /api/admin/bet-for-me — Section 4 page tabs.
 */
import { http } from './client';

export interface BetForMeCommission {
  bet_type: 'single' | 'combo' | 'system' | 'jackpot';
  rate: number;
  default: number;
  updated_at: string | null;
  updated_by: string | null;
}

export interface CommissionsResponse {
  items: BetForMeCommission[];
  default: number;
  updated_at: string | null;
  updated_by: string | null;
}

export function listCommissions() {
  return http.get<CommissionsResponse>('/api/admin/bet-for-me/commissions');
}

export interface UpdateCommissionsInput {
  default?: number;
  rates: Array<{ bet_type: BetForMeCommission['bet_type']; rate: number }>;
}

export function updateCommissions(input: UpdateCommissionsInput) {
  return http.put<{ default: number; by_bet_type: Record<string, number> }>(
    '/api/admin/bet-for-me/commissions',
    input
  );
}

export interface BetForMeTransaction {
  id: string;
  tenant_id: string;
  user_id: string | null;
  wallet_id: string | null;
  type: string;
  amount: string;
  before_balance: string;
  after_balance: string;
  currency: string;
  reference: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  user_email?: string | null;
  user_phone?: string | null;
  user_name?: string | null;
  cashier_email?: string | null;
  cashier_name?: string | null;
}

export interface BetForMeTxQuery {
  user_id?: string;
  cashier_id?: string;
  status?: 'pending' | 'completed' | 'failed' | 'reversed';
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export interface ListBetForMeTxResponse {
  items: BetForMeTransaction[];
  total: number;
  page: number;
  limit: number;
  summary?: { total_amount: string; count: string } | null;
}

export function listTransactions(query: BetForMeTxQuery = {}) {
  return http.get<ListBetForMeTxResponse>('/api/admin/bet-for-me/transactions', { query });
}

export function listTopups(query: BetForMeTxQuery = {}) {
  return http.get<ListBetForMeTxResponse>('/api/admin/bet-for-me/topups', { query });
}
