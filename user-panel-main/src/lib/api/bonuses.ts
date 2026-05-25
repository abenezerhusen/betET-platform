/**
 * Bonuses, promotions, payment methods and disputes APIs for the end-user.
 */

import { apiRequest } from './client';
import type { PaginatedResponse } from './types';

export interface BonusItem {
  id: string;
  title: string;
  description: string | null;
  type: string;
  amount?: string | number;
  percentage?: string | number;
  status: string;
  starts_at: string;
  ends_at: string | null;
  claimed_at?: string | null;
  wagering_progress?: number;
  wagering_required?: number;
}

export async function listBonuses(query: {
  status?: 'available' | 'active' | 'all';
} = {}): Promise<{ items: BonusItem[] }> {
  return apiRequest('/api/user/bonuses', {
    query: { status: query.status ?? 'all' },
  });
}

export async function claimBonus(
  id: string,
  metadata?: Record<string, unknown>
): Promise<{ bonus_id: string; status: string }> {
  return apiRequest(`/api/user/bonuses/${id}/claim`, {
    method: 'POST',
    body: { metadata },
  });
}

export interface PaymentMethodItem {
  id: string;
  code: string;
  name: string;
  channel: 'deposit' | 'withdrawal' | 'both';
  currency: string;
  country: string | null;
  min_amount: string | number | null;
  max_amount: string | number | null;
  fee_flat: string | number | null;
  fee_percent: string | number | null;
  is_active: boolean;
  logo_url: string | null;
}

export async function listPaymentMethods(query: {
  channel?: 'deposit' | 'withdrawal';
  currency?: string;
  country?: string;
} = {}): Promise<{ items: PaymentMethodItem[] }> {
  return apiRequest('/api/user/payment-methods', {
    query: query as Record<string, string | undefined>,
  });
}

export interface DisputeItem {
  id: string;
  type: string;
  reference_id: string | null;
  description: string;
  status: string;
  amount: string | number | null;
  created_at: string;
  resolved_at: string | null;
}

export async function listDisputes(query: {
  page?: number;
  limit?: number;
  status?: string;
} = {}): Promise<PaginatedResponse<DisputeItem>> {
  return apiRequest('/api/user/disputes/telebirr', {
    query: query as Record<string, string | number | undefined>,
  });
}

export async function submitDispute(input: {
  deposit_id?: string;
  withdrawal_id?: string;
  description: string;
  amount?: string;
  evidence?: Record<string, unknown>;
}): Promise<DisputeItem> {
  return apiRequest('/api/user/disputes/telebirr', {
    method: 'POST',
    body: input,
  });
}

export async function getDispute(id: string): Promise<DisputeItem> {
  return apiRequest(`/api/user/disputes/telebirr/${id}`);
}

export async function cancelDispute(id: string): Promise<{ id: string; status: string }> {
  return apiRequest(`/api/user/disputes/telebirr/${id}`, {
    method: 'DELETE',
  });
}
