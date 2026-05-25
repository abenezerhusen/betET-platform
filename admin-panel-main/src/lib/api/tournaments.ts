/** /api/admin/tournaments */
import { http } from './client';

export type TournamentKind = 'sportsbook' | 'casino' | 'streak' | 'jackpot';
export type TournamentStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled';
export type TournamentFormat = 'leaderboard' | 'knockout' | 'jackpot';

export interface Tournament {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  /** Product family: backend column `kind`. */
  kind?: TournamentKind;
  /** Legacy alias for `kind` (kept for backwards-compat in callers). */
  game_type?: string;
  buy_in?: number;
  entry_fee?: number;
  prize_pool?: number;
  currency?: string;
  max_entries?: number | null;
  status: TournamentStatus;
  starts_at?: string | null;
  ends_at?: string | null;
  rules?: Record<string, unknown> & { format?: TournamentFormat };
  leaderboard?: unknown[];
  created_at: string;
  updated_at: string;
}

export interface LeaderboardEntry {
  id: string;
  user_id: string;
  score: string;
  rank: number | null;
  status: string;
  joined_at: string;
  user_email: string | null;
  user_phone: string | null;
}

export function listTournaments(query: {
  status?: string;
  kind?: TournamentKind;
  page?: number;
  limit?: number;
  search?: string;
} = {}) {
  return http.get<{ items: Tournament[]; total?: number }>('/api/admin/tournaments', { query });
}

export function createTournament(input: Partial<Tournament>) {
  return http.post<Tournament>('/api/admin/tournaments', input);
}

export function getTournament(id: string) {
  return http.get<Tournament>(`/api/admin/tournaments/${id}`);
}

export function updateTournament(id: string, input: Partial<Tournament>) {
  return http.put<Tournament>(`/api/admin/tournaments/${id}`, input);
}

export function setTournamentStatus(id: string, status: TournamentStatus) {
  return http.patch<Tournament>(`/api/admin/tournaments/${id}/status`, { status });
}

export function deleteTournament(id: string) {
  return http.delete<{ id: string }>(`/api/admin/tournaments/${id}`);
}

export function getTournamentLeaderboard(id: string) {
  return http.get<{ tournament_id: string; items: LeaderboardEntry[] }>(
    `/api/admin/tournaments/${id}/leaderboard`
  );
}

export function completeTournament(id: string) {
  return http.post<{
    tournament: Tournament;
    payouts: Array<{
      rank: number;
      entry_id: string;
      user_id: string;
      amount: number;
      transaction_id: string | null;
    }>;
  }>(`/api/admin/tournaments/${id}/complete`);
}

export function listEntries(id: string) {
  return http.get<{ items: Array<Record<string, unknown>> }>(
    `/api/admin/tournaments/${id}/entries`
  );
}

export function addEntry(id: string, input: { user_id: string; score?: number }) {
  return http.post<Record<string, unknown>>(`/api/admin/tournaments/${id}/entries`, input);
}

export function updateEntryScore(entryId: string, input: { score: number }) {
  return http.put<Record<string, unknown>>(
    `/api/admin/tournaments/entries/${entryId}/score`,
    input
  );
}

export function removeEntry(entryId: string) {
  return http.delete<{ id: string }>(`/api/admin/tournaments/entries/${entryId}`);
}

/* ------------------------------------------------------------------ */
/* Streak Settings (spec § Tournaments → Streak Settings)              */
/* ------------------------------------------------------------------ */

export interface StreakTier {
  id?: string;
  enabled: boolean;
  streak_days: number;
  reward_type: 'free_bet' | 'cash' | 'multiplier';
  reward_amount: number | string;
  min_bet_daily: number | string;
}

export interface StreakConfig {
  enabled: boolean;
  min_bet_amount: number;
  required_wins: number;
  reset_on_loss: boolean;
  reset_on_cancel: boolean;
  auto_notify: boolean;
  tiers: StreakTier[];
}

export function getStreakConfig() {
  return http.get<StreakConfig>('/api/admin/streaks/config');
}

export function updateStreakConfig(input: Partial<StreakConfig>) {
  return http.put<StreakConfig>('/api/admin/streaks/config', input);
}

export function createStreakTier(input: Omit<StreakTier, 'id'>) {
  return http.post<StreakTier>('/api/admin/streaks/config', input);
}

export function updateStreakTier(id: string, input: Partial<StreakTier>) {
  return http.put<StreakTier>(`/api/admin/streaks/config/${id}`, input);
}

export function deleteStreakTier(id: string) {
  return http.delete<{ ok: boolean }>(`/api/admin/streaks/config/${id}`);
}

export interface StreakLeaderboardRow {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_bet_date: string | null;
  streak_bonus_earned: string;
  user_email: string | null;
  user_phone: string | null;
}

export function getStreakLeaderboard() {
  return http.get<{ items: StreakLeaderboardRow[] }>('/api/admin/streaks/leaderboard');
}
