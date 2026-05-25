/** /api/admin/wallets */
import { http } from './client';
import type { Paged, Wallet } from './types';

export interface ListWalletsQuery {
  page?: number;
  limit?: number;
  user_id?: string;
  currency?: string;
  status?: string;
  min_balance?: number;
  max_balance?: number;
}

export function listWallets(query: ListWalletsQuery = {}) {
  return http.get<Paged<Wallet>>('/api/admin/wallets', { query });
}

export function getWallet(id: string) {
  return http.get<Wallet>(`/api/admin/wallets/${id}`);
}

export interface AdjustWalletInput {
  amount: string | number;
  reason: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

export function creditWallet(id: string, input: AdjustWalletInput) {
  return http.post<Wallet>(`/api/admin/wallets/${id}/credit`, input);
}

export function debitWallet(id: string, input: AdjustWalletInput) {
  return http.post<Wallet>(`/api/admin/wallets/${id}/debit`, input);
}
