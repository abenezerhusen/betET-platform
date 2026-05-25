/**
 * /api/admin/jackpots — Super Jackpots page.
 *
 * Server-backed by `tournaments` rows where `kind = 'jackpot'`. Tickets
 * are sportsbook bets with the `jackpot_id` foreign key set.
 */
import { http } from './client';

export type JackpotStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled';

export interface AdminJackpot {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  kind: 'jackpot';
  status: JackpotStatus;
  starts_at: string | null;
  ends_at: string | null;
  entry_fee: string;
  prize_pool: string;
  currency: string;
  max_entries: number | null;
  rules: {
    event_ids?: string[];
    prize_tiers?: Array<{
      matches: number;
      prize: number;
      shared?: boolean;
      label?: string;
    }>;
    description?: string | null;
    [k: string]: unknown;
  };
  leaderboard?: unknown[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  tickets_count?: string;
}

export interface ListJackpotsQuery {
  status?: JackpotStatus;
  search?: string;
  page?: number;
  limit?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export function listJackpots(query: ListJackpotsQuery = {}) {
  return http.get<{ items: AdminJackpot[]; total: number; page: number; limit: number }>(
    '/api/admin/jackpots',
    { query }
  );
}

export interface CreateJackpotInput {
  name: string;
  description?: string;
  entry_fee: number;
  prize_pool: number;
  currency?: string;
  max_entries?: number;
  starts_at?: string;
  ends_at?: string;
  status?: JackpotStatus;
  event_ids: string[];
  prize_tiers?: Array<{
    matches: number;
    prize: number;
    shared?: boolean;
    label?: string;
  }>;
  metadata?: Record<string, unknown>;
}

export function createJackpot(input: CreateJackpotInput) {
  return http.post<AdminJackpot>('/api/admin/jackpots', input);
}

export interface JackpotDetail extends AdminJackpot {
  stats?: {
    tickets: string;
    online_tickets: string;
    offline_tickets: string;
  } | null;
}

export function getJackpot(id: string) {
  return http.get<JackpotDetail>(`/api/admin/jackpots/${id}`);
}

export function updateJackpot(id: string, input: Partial<CreateJackpotInput>) {
  return http.patch<AdminJackpot>(`/api/admin/jackpots/${id}`, input);
}

export function deleteJackpot(id: string) {
  return http.delete<{ ok: true }>(`/api/admin/jackpots/${id}`);
}

export interface JackpotTicket {
  id: string;
  tenant_id: string;
  user_id: string | null;
  cashier_id: string | null;
  channel: 'online' | 'offline' | 'bet_for_me';
  bet_type: string;
  bet_for_user_phone: string | null;
  stake: string;
  currency: string;
  potential_payout: string | null;
  actual_payout: string | null;
  status: string;
  jackpot_id: string;
  metadata: Record<string, unknown>;
  placed_at: string;
  settled_at: string | null;
  user_email: string | null;
  user_phone: string | null;
  user_name: string | null;
  jackpot_name: string | null;
  jackpot_currency: string | null;
  leg_count: number;
  won_legs: number;
}

export interface ListTicketsQuery {
  type?: 'online' | 'offline';
  status?: string;
  user_id?: string;
  page?: number;
  limit?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export function listJackpotTickets(jackpotId: string, query: ListTicketsQuery = {}) {
  return http.get<{ items: JackpotTicket[]; total: number; page: number; limit: number }>(
    `/api/admin/jackpots/${jackpotId}/tickets`,
    { query }
  );
}

export interface SettleJackpotInput {
  prize_pool?: number;
  dry_run?: boolean;
}

export interface SettleJackpotResponse {
  jackpot_id: string;
  dry_run: boolean;
  winners: Array<{
    bet_id: string;
    user_id: string;
    prize: string;
    currency: string;
    tier: number;
  }>;
  winners_count: number;
  losers_count: number;
  total_paid: number;
  prize_pool: number;
  settled_at: string | null;
}

export function settleJackpot(id: string, input: SettleJackpotInput = {}) {
  return http.patch<SettleJackpotResponse>(`/api/admin/jackpots/${id}/settle`, input);
}
