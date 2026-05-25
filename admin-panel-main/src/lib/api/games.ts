/** /api/admin/games */
import { http } from './client';
import type { GameRow, Paged } from './types';

export interface ListGamesQuery {
  page?: number;
  limit?: number;
  provider?: string;
  type?: string;
  is_active?: boolean;
  status?: string;
  search?: string;
}

export function listGames(query: ListGamesQuery = {}) {
  return http.get<Paged<GameRow>>('/api/admin/games', { query });
}

export function getGame(id: string) {
  return http.get<GameRow>(`/api/admin/games/${id}`);
}

export interface UpsertGameInput {
  provider: string;
  name: string;
  slug?: string;
  type: string;
  is_iframe?: boolean;
  iframe_url?: string;
  is_active?: boolean;
  status?: string;
  rtp?: number;
  metadata?: Record<string, unknown>;
}

export function createGame(input: UpsertGameInput) {
  return http.post<GameRow>('/api/admin/games', input);
}

export function updateGame(id: string, input: Partial<UpsertGameInput>) {
  return http.put<GameRow>(`/api/admin/games/${id}`, input);
}

export function deleteGame(id: string) {
  return http.delete<{ id: string }>(`/api/admin/games/${id}`);
}

export function toggleGame(id: string, is_active?: boolean) {
  return http.post<GameRow>(`/api/admin/games/${id}/toggle`, { is_active });
}

export function listGameSessions(
  id: string,
  query: { page?: number; limit?: number; status?: string } = {}
) {
  return http.get<Paged<Record<string, unknown>>>(`/api/admin/games/${id}/sessions`, { query });
}
