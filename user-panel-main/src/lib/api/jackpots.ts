/**
 * User-panel API client for jackpots.
 *
 *   listActiveJackpots()       — list running/scheduled jackpots (public)
 *   getJackpot(id)             — single jackpot detail (public)
 *   enterJackpot(id, quantity) — buy ticket(s) online (requires auth)
 */

import { apiRequest } from './client';

export interface PublicJackpot {
  id: string;
  name: string;
  description: string | null;
  status: 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled' | 'draft';
  starts_at: string | null;
  ends_at: string | null;
  entry_fee: string;
  prize_pool: string;
  currency: string;
  max_entries: number | null;
  tickets_sold: number;
  rules: {
    event_ids?: string[];
    prize_tiers?: Array<{
      matches: number;
      prize: number;
      shared: boolean;
      label?: string;
    }>;
    description?: string | null;
  };
}

export interface JackpotEntryResult {
  jackpot_id: string;
  jackpot_name: string;
  currency: string;
  quantity: number;
  total_stake: number;
  wallet_balance_after: number;
  tickets: Array<{
    id: string;
    ticket_code: string;
    coupon_code: string;
  }>;
}

export async function listActiveJackpots(): Promise<{ items: PublicJackpot[] }> {
  return apiRequest<{ items: PublicJackpot[] }>('/api/jackpots', { skipAuth: true });
}

export async function getJackpot(id: string): Promise<PublicJackpot> {
  return apiRequest<PublicJackpot>(`/api/jackpots/${encodeURIComponent(id)}`, {
    skipAuth: true,
  });
}

export async function enterJackpot(
  id: string,
  quantity = 1
): Promise<JackpotEntryResult> {
  return apiRequest<JackpotEntryResult>(`/api/jackpots/${encodeURIComponent(id)}/enter`, {
    method: 'POST',
    body: { quantity },
  });
}
