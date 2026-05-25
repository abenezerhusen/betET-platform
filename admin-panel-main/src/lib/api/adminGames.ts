import { http } from './client';

export interface AdminGameListRow {
  id: string;
  name: string;
  type: string;
  provider: string;
}

export function listAdminGamesSimple() {
  return http.get<AdminGameListRow[]>('/api/admin/games/list');
}

