import { apiRequest } from './client';

export interface UserGamePick {
  id: string;
  game: string;
  type: string;
  prediction: string;
  confidence: number;
  subscribers: number;
  status: 'Active' | 'Upcoming' | 'Completed';
  start_time: string | null;
  result?: 'Won' | 'Lost' | 'Void' | null;
}

export function listGamePicks(params?: { status?: 'Active' | 'Upcoming' | 'Completed'; limit?: number }) {
  return apiRequest<{ items: UserGamePick[] }>('/api/user/game-picks', {
    method: 'GET',
    query: params,
  });
}

export function subscribeGamePick(pick_id: string) {
  return apiRequest<{ ok: boolean }>('/api/user/game-picks/subscribe', {
    method: 'POST',
    body: { pick_id },
  });
}

export function unsubscribeGamePick(pick_id: string) {
  return apiRequest<{ ok: boolean }>('/api/user/game-picks/unsubscribe', {
    method: 'POST',
    body: { pick_id },
  });
}
