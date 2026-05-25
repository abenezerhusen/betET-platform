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
