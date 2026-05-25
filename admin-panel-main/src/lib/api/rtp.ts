/**
 * Section 15 — RTP Management (internal game engine only).
 *
 * Backed by /api/admin/games/rtp* — sourced from the `internal_games` and
 * `game_rtp_overrides` tables. Only the 4 first-party games (Aviator, JetX,
 * Fast Keno, Multi Hot 5) appear here; external provider RTPs are set in
 * the provider dashboard and therefore are not editable from this page.
 */
import { http } from './client';

export type GameStatus = 'Active' | 'Disabled';

export interface RtpClientOverride {
  clientId: string;
  rtp: number;
  updatedAt: string;
}

export interface InternalGameRtp {
  id: string;
  name: string;
  provider: string;
  defaultRtp: number;
  minRtp: number;
  maxRtp: number;
  status: GameStatus;
  minBet: number;
  maxBet: number;
  slug: string | null;
  thumbnail_url: string | null;
  description: string | null;
  gameType: string | null;
  clientOverrides: RtpClientOverride[];
}

export function listInternalGamesRtp() {
  return http.get<InternalGameRtp[]>('/api/admin/games/rtp');
}

export function updateGameRtp(
  gameId: string,
  body: { rtp: number; apply_global: boolean; client_id?: string | null }
) {
  return http.patch<{ ok: boolean; game: InternalGameRtp }>(
    `/api/admin/games/${gameId}/rtp`,
    body
  );
}

export function updateGameStatus(gameId: string, status: GameStatus) {
  return http.patch<{ ok: boolean; id: string; status: GameStatus }>(
    `/api/admin/games/${gameId}/status`,
    { status }
  );
}
