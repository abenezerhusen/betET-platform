import { http } from './client';

export interface AdminGamePick {
  id: string;
  game: string;
  type: string;
  prediction: string;
  confidence: number;
  subscribers: number;
  status: 'Active' | 'Upcoming' | 'Completed' | 'Cancelled';
  start_time: string | null;
  result?: 'Won' | 'Lost' | 'Void' | null;
  created_at?: string;
}

export function listAdminGamePicks(params?: {
  status?: 'active' | 'upcoming' | 'completed' | 'analysis';
}) {
  return http.get<AdminGamePick[]>('/api/admin/game-picks', { query: params });
}

export function createAdminGamePick(input: {
  game: string;
  type: string;
  prediction: string;
  confidence: number;
  status?: 'Active' | 'Upcoming' | 'Completed' | 'Cancelled';
  start_time: string;
}) {
  return http.post<AdminGamePick>('/api/admin/game-picks', input);
}

export function updateAdminGamePick(id: string, input: Partial<{
  game: string;
  type: string;
  prediction: string;
  confidence: number;
  status: 'Active' | 'Upcoming' | 'Completed' | 'Cancelled';
  start_time: string;
}>) {
  return http.put<AdminGamePick>(`/api/admin/game-picks/${id}`, input);
}

export function setAdminGamePickResult(id: string, input: { result: 'Won' | 'Lost' | 'Void' }) {
  return http.patch<AdminGamePick>(`/api/admin/game-picks/${id}/result`, input);
}

export function deleteAdminGamePick(id: string) {
  return http.delete<{ id: string }>(`/api/admin/game-picks/${id}`);
}

/* ------------------------------------------------------------------ */
/* Top Leagues configuration                                           */
/* ------------------------------------------------------------------ */

export interface TopLeague {
  id: string;
  league: string;
  enabled: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface AvailableLeague {
  league: string;
  events: number;
}

export function listTopLeagues() {
  return http.get<TopLeague[]>('/api/admin/game-picks/top-leagues');
}

export function listAvailableLeagues(search?: string) {
  return http.get<AvailableLeague[]>('/api/admin/game-picks/top-leagues/available', {
    query: search ? { search } : undefined,
  });
}

export function addTopLeague(league: string) {
  return http.post<TopLeague>('/api/admin/game-picks/top-leagues', { league });
}

export function updateTopLeague(
  id: string,
  input: { enabled?: boolean; priority?: number }
) {
  return http.put<TopLeague>(`/api/admin/game-picks/top-leagues/${id}`, input);
}

export function reorderTopLeagues(ids: string[]) {
  return http.post<TopLeague[]>('/api/admin/game-picks/top-leagues/reorder', { ids });
}

export function deleteTopLeague(id: string) {
  return http.delete<{ id: string }>(`/api/admin/game-picks/top-leagues/${id}`);
}
