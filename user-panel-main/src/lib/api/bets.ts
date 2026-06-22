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

/**
 * Section 16 Flow B — reserve a walk-in (branch-pay) sportsbook slip.
 *
 * Used by the offline "Place Bet" button when the slip is built on
 * behalf of a player who pays cash at the till. The backend creates a
 * `sportsbook_bets` row in status='pending', channel='offline',
 * without debiting any wallet. The returned `coupon_code` (SBK-XXXXXXXX)
 * is what the cashier types into "Sell Ticket" in the cashier panel.
 */
/** Hint the backend can use to find a selection when the slip leg
 * doesn't carry a real `selection_id` (e.g. picks were added before the
 * page was reloaded with the new sportsbook IDs). */
export interface OfflineSelectionHint {
  home_team: string;
  away_team: string;
  /** Optional: "Match Result", "1x2", … (omit and the backend defaults
   *  to the 1x2/Match Result market). */
  market_label?: string;
  /** "Home" | "Draw" | "Away" or "1" | "X" | "2" — case insensitive. */
  selection_label: string;
  /** ISO date to disambiguate when the same teams meet twice. */
  starts_at?: string;
}

export interface OfflineSelectionInput {
  /** Preferred — direct sportsbook selection UUID. */
  selection_id?: string;
  /** Fallback — backend resolves to a selection_id. */
  selection_hint?: OfflineSelectionHint;
  odds_seen?: number;
}

export interface OfflineReservationInput {
  stake: number;
  bet_type?: 'single' | 'combo' | 'system';
  currency?: string;
  selections: OfflineSelectionInput[];
  metadata?: Record<string, unknown>;
}

export interface OfflineReservation {
  bet_id: string;
  coupon_code: string;
  ticket_code: string;
  stake: number;
  total_odds: number;
  potential_payout: number;
  currency: string;
  bet_type: 'single' | 'combo' | 'system';
  picks_count: number;
  placed_at: string;
  status: 'pending';
  channel: 'offline';
}

export function reserveOfflineBet(
  input: OfflineReservationInput,
): Promise<OfflineReservation> {
  return apiRequest<OfflineReservation>('/api/public/bets/reserve-offline', {
    method: 'POST',
    body: input,
    skipAuth: true,
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

export interface CancelBetOutcome {
  success: boolean;
  bet_id: string;
  refunded: string;
  currency: string;
  new_balance: string | null;
}

export function cancelBet(betId: string): Promise<CancelBetOutcome> {
  return apiRequest<CancelBetOutcome>(`/api/bets/${betId}/cancel`, {
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
  /** Extended settlement status (may be null for older tickets). */
  settlement_status: string | null;
  /** Human-readable explanation for the current status. */
  void_reason: string | null;
  settlement_reason: string | null;
  postponed_at: string | null;
  postpone_wait_hours: number | null;
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

/* -------------------------------------------------------------------------- */
/* Internal game bets  (Aviator / JetX / Keno / etc.)                        */
/* -------------------------------------------------------------------------- */

export interface GameBetRow {
  id: string;
  game_id: string | null;
  game_name: string;
  stake: string;
  potential_win: string;
  payout: string | null;
  currency: string;
  status: string;
  placed_at: string;
  settled_at: string | null;
}

export interface GameBetPage {
  items: GameBetRow[];
  total: number;
  page: number;
  limit: number;
}

export function listMyGameBets(query: {
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
} = {}): Promise<GameBetPage> {
  return apiRequest<GameBetPage>('/api/user/bets', { query });
}

/* -------------------------------------------------------------------------- */
/* Ticket reload — load an existing ticket's selections back into the slip    */
/* -------------------------------------------------------------------------- */

export interface ReloadedSelection {
  selection_id: string;
  market_id: string;
  event_id: string;
  home_team: string;
  away_team: string;
  league: string;
  sport: string;
  market_label: string;
  selection_label: string;
  odds_at_placement: string;
  current_odds: string;
  starts_at: string;
  event_status: string;
  market_status: string;
  /**
   * Per-leg settlement result. `null` while pending; settled legs carry
   * `'won' | 'lost' | 'void'` so the UI can render per-pick status.
   */
  selection_result: 'won' | 'lost' | 'void' | null;
  /** True when the leg can still be placed as a fresh bet. */
  replayable: boolean;
}

export interface ReloadedTicket {
  bet: {
    id: string;
    coupon_code: string;
    status: string;
    bet_type: string;
    stake: string;
    total_odds: string;
    potential_payout: string;
    currency: string;
    placed_at: string;
  };
  selections: ReloadedSelection[];
}

/**
 * Look a ticket up by coupon code (SBK-XXXXXXXX) or bet UUID so the user
 * can view it or replay the same selections as a new bet.
 */
export function reloadTicket(code: string): Promise<ReloadedTicket> {
  return apiRequest<ReloadedTicket>(
    `/api/bets/reload/${encodeURIComponent(code.trim())}`
  );
}
