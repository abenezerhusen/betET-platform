/**
 * Section 18 — sportsbook bet placement / cashout / history.
 *
 * Backed by `/api/bets/*` on the platform backend. These endpoints
 * accept a multi-leg slip, calculate `total_odds`, `potential_payout`,
 * tax preview, and atomically debit the wallet.
 */

import { apiRequest } from './client';

export interface PlaceSelectionInput {
  selection_id: string;
  /**
   * Snapshot of the odds the user saw on the slip — if it has changed
   * server-side, the placement is rejected with reason='odds_changed'
   * unless `accept_odds_changed` is true.
   */
  odds_seen?: number;
}

export interface PlaceBetInput {
  stake: number;
  bet_type?: 'single' | 'combo' | 'system';
  currency?: string;
  selections: PlaceSelectionInput[];
  idempotency_key?: string;
  accept_odds_changed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PlacedBet {
  id: string;
  coupon_code: string;
  status: string;
  stake: string;
  total_odds: string;
  potential_payout: string;
  estimated_tax: string;
  estimated_net_pay: string;
  currency: string;
  placed_at: string;
  cashout_available: boolean;
}

export interface PlaceBetOutcome {
  bet: PlacedBet;
  wallet: { id: string; balance: string; currency: string };
  legs: Array<{
    selection_id: string;
    market_id: string;
    event_id: string;
    odds_at_placement: string;
  }>;
  idempotent: boolean;
}

export function placeBet(input: PlaceBetInput): Promise<PlaceBetOutcome> {
  return apiRequest<PlaceBetOutcome>('/api/bets/place', {
    method: 'POST',
    body: input,
  });
}

export interface CashoutOutcome {
  bet_id: string;
  cashout_amount: string;
  status: string;
  wallet: { id: string; balance: string; currency: string };
}

export function cashoutBet(betId: string): Promise<CashoutOutcome> {
  return apiRequest<CashoutOutcome>(`/api/bets/${betId}/cashout`, {
    method: 'POST',
    body: {},
  });
}

export interface BetHistoryRow {
  id: string;
  coupon_code: string;
  bet_type: string;
  stake: string;
  total_odds: string;
  potential_payout: string;
  tax_amount: string;
  actual_payout: string | null;
  cashout_amount: string | null;
  status: string;
  currency: string;
  placed_at: string;
  settled_at: string | null;
  legs_count: number;
}

export interface BetHistoryPage {
  items: BetHistoryRow[];
  total: number;
  page: number;
  limit: number;
}

export function listMyBets(query: {
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
} = {}): Promise<BetHistoryPage> {
  return apiRequest<BetHistoryPage>('/api/bets', { query });
}

export function getBet(betId: string) {
  return apiRequest<Record<string, unknown>>(`/api/bets/${betId}`);
}
