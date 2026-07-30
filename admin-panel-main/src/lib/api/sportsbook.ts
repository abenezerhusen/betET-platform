/** /api/admin/sportsbook — events / markets / selections / bets */
import { http } from './client';

export interface SportEvent {
  id: string;
  tenant_id: string;
  sport: string;
  league?: string;
  home_team?: string;
  away_team?: string;
  starts_at: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export function listEvents(query: {
  sport?: string;
  league?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: SportEvent[]; total?: number }>('/api/admin/sportsbook/events', {
    query,
  });
}

export function createEvent(input: Partial<SportEvent>) {
  return http.post<SportEvent>('/api/admin/sportsbook/events', input);
}

export function getEvent(id: string) {
  return http.get<SportEvent>(`/api/admin/sportsbook/events/${id}`);
}

export function updateEvent(id: string, input: Partial<SportEvent>) {
  return http.put<SportEvent>(`/api/admin/sportsbook/events/${id}`, input);
}

export function deleteEvent(id: string) {
  return http.delete<{ id: string }>(`/api/admin/sportsbook/events/${id}`);
}

export function listMarkets(eventId: string) {
  return http.get<{ items: Array<Record<string, unknown>> }>(
    `/api/admin/sportsbook/events/${eventId}/markets`
  );
}

export function createMarket(eventId: string, input: Record<string, unknown>) {
  return http.post<Record<string, unknown>>(
    `/api/admin/sportsbook/events/${eventId}/markets`,
    input
  );
}

export function updateMarket(id: string, input: Record<string, unknown>) {
  return http.put<Record<string, unknown>>(`/api/admin/sportsbook/markets/${id}`, input);
}

export function settleMarket(id: string, input: { winning_selection_id?: string; void?: boolean }) {
  return http.post<Record<string, unknown>>(`/api/admin/sportsbook/markets/${id}/settle`, input);
}

export function addSelection(marketId: string, input: Record<string, unknown>) {
  return http.post<Record<string, unknown>>(
    `/api/admin/sportsbook/markets/${marketId}/selections`,
    input
  );
}

export function updateSelection(id: string, input: Record<string, unknown>) {
  return http.put<Record<string, unknown>>(`/api/admin/sportsbook/selections/${id}`, input);
}

export interface SportsbookBet {
  id: string;
  tenant_id: string;
  user_id?: string | null;
  cashier_id?: string | null;
  bet_for_user_phone?: string | null;
  bet_type?: 'single' | 'combo' | 'system' | 'jackpot';
  status: string;
  stake: string;
  potential_payout?: string | null;
  actual_payout?: string | null;
  channel: 'online' | 'offline' | 'bet_for_me';
  jackpot_id?: string | null;
  placed_at: string;
  settled_at?: string | null;
  metadata?: Record<string, unknown>;
}

export function listBets(query: {
  status?: string;
  channel?: 'online' | 'offline' | 'bet_for_me';
  bet_type?: 'single' | 'combo' | 'system' | 'jackpot';
  cashier_id?: string;
  user_id?: string;
  jackpot_id?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  search?: string;
} = {}) {
  return http.get<{ items: SportsbookBet[]; total?: number }>('/api/admin/sportsbook/bets', {
    query,
  });
}

export function getBet(id: string) {
  return http.get<SportsbookBet>(`/api/admin/sportsbook/bets/${id}`);
}

export function settleBet(id: string, input: { status: 'won' | 'lost' | 'void'; payout?: number }) {
  return http.post<SportsbookBet>(`/api/admin/sportsbook/bets/${id}/settle`, input);
}

export function voidBet(id: string, input: { reason: string }) {
  return http.post<SportsbookBet>(`/api/admin/sportsbook/bets/${id}/void`, input);
}

/* -------------------------------------------------------------------------- */
/* Section 18 — match-lifecycle endpoints                                     */
/* -------------------------------------------------------------------------- */

export interface OddsUpdate {
  selection_id: string;
  new_odds: number;
}

export function updateMatchOdds(matchId: string, updates: OddsUpdate[]) {
  return http.patch<{ ok: true; match_id: string; updated: number }>(
    `/api/admin/matches/${matchId}/odds`,
    { updates }
  );
}

export function setMatchStatus(
  matchId: string,
  status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled'
) {
  return http.post<{ id: string; status: string }>(
    `/api/admin/matches/${matchId}/status`,
    { status }
  );
}

export interface MatchResultInput {
  home_score: number;
  away_score: number;
  status?: 'finished' | 'cancelled' | 'postponed';
  selection_results?: Array<{
    selection_id: string;
    result: 'won' | 'lost' | 'void';
  }>;
}

export interface MatchResultOutcome {
  match_id: string;
  status: string;
  home_score: number;
  away_score: number;
  settled_selections: number;
  settled_bets: number;
}

export function setMatchResult(matchId: string, input: MatchResultInput) {
  return http.post<MatchResultOutcome>(
    `/api/admin/matches/${matchId}/result`,
    input
  );
}

/* -------------------------------------------------------------------------- */
/* Sportsbook Tax & Compensation Bonus management                             */
/* -------------------------------------------------------------------------- */

export interface SportsbookTaxConfig {
  betting_tax_enabled: boolean;
  betting_tax_percent: number;
  compensation_bonus_enabled: boolean;
  compensation_bonus_percent: number;
  winning_tax_enabled: boolean;
  winning_tax_percent: number;
  winning_tax_threshold: number;
}

export const DEFAULT_SPORTSBOOK_TAX: SportsbookTaxConfig = {
  betting_tax_enabled: true,
  betting_tax_percent: 15,
  compensation_bonus_enabled: false,
  compensation_bonus_percent: 0,
  winning_tax_enabled: true,
  winning_tax_percent: 15,
  winning_tax_threshold: 1000,
};

export function getSportsbookTaxConfig() {
  return http.get<SportsbookTaxConfig>('/api/admin/sportsbook/tax-config');
}

export function updateSportsbookTaxConfig(input: SportsbookTaxConfig) {
  return http.put<SportsbookTaxConfig>('/api/admin/sportsbook/tax-config', input);
}

export interface SportsbookTaxReport {
  total_tickets: number;
  total_original_stakes: number;
  total_betting_tax_collected: number;
  total_effective_stakes: number;
  total_compensation_bonus_paid: number;
  total_winning_tax_collected: number;
  total_final_payout: number;
  net_sportsbook_revenue: number;
}

export function getSportsbookTaxReport(query: {
  from?: string;
  to?: string;
  sport?: string;
  league?: string;
  branch_id?: string;
  cashier_id?: string;
  user_id?: string;
} = {}) {
  return http.get<SportsbookTaxReport>('/api/admin/sportsbook/tax-report', {
    query,
  });
}
