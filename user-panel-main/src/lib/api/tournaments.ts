/**
 * /api/user/tournaments — user-facing tournament listing + join.
 *
 * Spec § Tournaments → "User Panel: users can see and join active
 * tournaments". The list endpoint also includes per-user state
 * (joined / rank / score) so the UI can render the right CTA.
 */

import { apiRequest } from './client';

export interface UserTournamentRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  format: 'leaderboard' | 'knockout' | 'jackpot' | string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  entry_fee: string;
  prize_pool: string;
  currency: string;
  max_entries: number | null;
  participants: number;
  joined: boolean;
  my_rank: number | null;
  my_score: string | null;
}

export interface UserTournamentEntry {
  id: string;
  tournament_id: string;
  user_id: string;
  score: string;
  rank: number | null;
  status: string;
  joined_at: string;
  updated_at: string;
}

export interface UserLeaderboardEntry {
  id: string;
  user_id: string;
  score: string;
  rank: number | null;
  status: string;
  joined_at: string;
  display_name: string;
}

export function listTournaments() {
  return apiRequest<{ items: UserTournamentRow[] }>('/api/user/tournaments', {
    method: 'GET',
  });
}

export function joinTournament(id: string) {
  return apiRequest<UserTournamentEntry>(`/api/user/tournaments/${id}/join`, {
    method: 'POST',
  });
}

export function getTournamentLeaderboard(id: string) {
  return apiRequest<{ tournament_id: string; items: UserLeaderboardEntry[] }>(
    `/api/user/tournaments/${id}/leaderboard`,
    { method: 'GET' }
  );
}
