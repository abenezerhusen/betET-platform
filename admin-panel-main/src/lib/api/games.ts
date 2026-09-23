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

/* -------------------------------------------------------------------------- */
/* Public lobby games — the exact same game universe the user panel home /     */
/* Games page shows (internal engine + external providers + catalog). Used by  */
/* the Settings → General → Popular Games picker so an admin selects real,     */
/* launchable games. These are public read endpoints (auth omitted).          */
/* -------------------------------------------------------------------------- */

export interface LobbyGameOption {
  id: string;
  name: string;
  provider: string;
  type: string;
  thumbnail_url: string;
  source: 'internal' | 'external' | 'catalog';
}

const THUMB_FALLBACK = '/play-core-logo.png';

export async function listPublicLobbyGames(): Promise<LobbyGameOption[]> {
  const [lobby, ext, catalog] = await Promise.all([
    http
      .get<{ all_games?: Array<Record<string, unknown>> }>('/api/games/lobby', { auth: false })
      .catch(() => ({ all_games: [] })),
    http
      .get<{ games?: Array<Record<string, unknown>> }>('/api/games/external/list', { auth: false })
      .catch(() => ({ games: [] })),
    http
      .get<{ items?: Array<Record<string, unknown>> }>('/api/public/games', {
        auth: false,
        query: { page: 1, limit: 200 },
      })
      .catch(() => ({ items: [] })),
  ]);

  const merged: LobbyGameOption[] = [];
  const seen = new Set<string>();
  const pushUnique = (g: LobbyGameOption) => {
    const key = g.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(g);
  };

  for (const g of lobby.all_games ?? []) {
    pushUnique({
      id: String((g.slug as string) || (g.id as string)),
      name: String(g.name ?? ''),
      provider: String(g.provider ?? ''),
      type: String((g.game_type as string) ?? 'casino'),
      thumbnail_url: String((g.thumbnail_url as string) || THUMB_FALLBACK),
      source: 'internal',
    });
  }
  for (const g of ext.games ?? []) {
    pushUnique({
      id: String(g.id ?? ''),
      name: String(g.name ?? ''),
      provider: String(g.provider ?? ''),
      type: 'casino',
      thumbnail_url: String((g.thumbnail_url as string) || THUMB_FALLBACK),
      source: 'external',
    });
  }
  for (const g of catalog.items ?? []) {
    const cfg = (g.config as { thumbnail_url?: string; banner_url?: string }) ?? {};
    pushUnique({
      id: String(g.id ?? ''),
      name: String(g.name ?? ''),
      provider: String(g.provider ?? ''),
      type: String(g.type ?? 'casino'),
      thumbnail_url: cfg.thumbnail_url || cfg.banner_url || THUMB_FALLBACK,
      source: 'catalog',
    });
  }
  return merged.filter((g) => g.id && g.name);
}
