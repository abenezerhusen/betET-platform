/**
 * Profile + history endpoints for the end-user.
 *
 * All routes here live under `/api/user` and require a valid bearer token
 * (handled by `client.ts`).
 */

import { apiRequest } from './client';
import type {
  PaginatedResponse,
  TransactionItem,
  BetSummaryItem,
  WalletRow,
} from './types';

export interface MeResponse {
  profile: Record<string, unknown>;
  wallets: WalletRow[];
}

export async function getProfile(): Promise<MeResponse> {
  return apiRequest<MeResponse>('/api/user/me');
}

export interface UpdateProfileInput {
  email?: string;
  phone?: string;
  metadata?: {
    first_name?: string;
    last_name?: string;
    date_of_birth?: string;
    gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
    country?: string;
    city?: string;
    address?: string;
    language?: string;
    timezone?: string;
    marketing_opt_in?: boolean;
  };
}

export async function updateProfile(
  input: UpdateProfileInput
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>('/api/user/me', {
    method: 'PUT',
    body: input,
  });
}

export interface TransactionsQuery {
  page?: number;
  limit?: number;
  type?: string;
  status?: 'pending' | 'completed' | 'failed' | 'reversed' | 'cancelled';
  from?: string;
  to?: string;
}

export async function listTransactions(
  query: TransactionsQuery = {}
): Promise<PaginatedResponse<TransactionItem>> {
  return apiRequest<PaginatedResponse<TransactionItem>>('/api/user/me/transactions', {
    method: 'GET',
    query: query as Record<string, string | number | undefined>,
  });
}

export interface BetsHistoryQuery {
  page?: number;
  limit?: number;
  status?:
    | 'pending'
    | 'accepted'
    | 'won'
    | 'lost'
    | 'void'
    | 'cancelled'
    | 'cashed_out'
    | 'partial_won';
  game_id?: string;
  from?: string;
  to?: string;
}

export async function listBets(
  query: BetsHistoryQuery = {}
): Promise<PaginatedResponse<BetSummaryItem>> {
  return apiRequest<PaginatedResponse<BetSummaryItem>>('/api/user/me/bets', {
    method: 'GET',
    query: query as Record<string, string | number | undefined>,
  });
}
