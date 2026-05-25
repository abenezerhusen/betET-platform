import { apiRequest } from './client';

export interface LiveCasinoGame {
  id: string;
  name: string;
  dealer: string;
  players_online: number;
  thumbnail_url: string | null;
  launch_url: string;
  provider: string;
}

export function listLiveCasinoGames() {
  return apiRequest<{ games: LiveCasinoGame[]; message?: string; provider?: string | null }>(
    '/api/games/live-casino',
    { method: 'GET' }
  );
}
