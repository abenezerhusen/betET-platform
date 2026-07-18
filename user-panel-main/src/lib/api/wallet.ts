/**
 * Wallet, deposit and withdrawal endpoints exposed to the end-user.
 *
 * - `getWallet`: snapshot of the user's wallet (available/locked/bonus).
 * - `transfer`:  P2P transfer to another user (phone/email/id).
 * - `submitWithdrawal`: legacy generic withdrawal request.
 * - Telebirr-specific deposit & withdrawal flows under `telebirr*`.
 */

import { apiRequest } from './client';
import type { WalletApiResponse, PaginatedResponse } from './types';

export async function getWallet(currency?: string): Promise<WalletApiResponse> {
  return apiRequest<WalletApiResponse>('/api/user/wallet', {
    query: currency ? { currency } : undefined,
  });
}

export interface TransferInput {
  amount: string | number;
  currency?: string;
  receiver_phone?: string;
  receiver_email?: string;
  receiver_user_id?: string;
  note?: string;
  idempotency_key?: string;
}

export async function transfer(input: TransferInput): Promise<{
  idempotent: boolean;
  transfer_id: string;
  receiver_user_id: string;
  amount: string;
  new_balance: string;
}> {
  return apiRequest('/api/user/wallet/transfer', {
    method: 'POST',
    body: input,
  });
}

export interface WithdrawalRequestInput {
  amount: string | number;
  currency?: string;
  payment_method?:
    | 'cash'
    | 'card'
    | 'bank_transfer'
    | 'mobile_money'
    | 'voucher'
    | 'other';
  payment_details?: Record<string, unknown>;
  notes?: string;
  idempotency_key?: string;
}

export async function submitWithdrawal(input: WithdrawalRequestInput): Promise<{
  idempotent: boolean;
  withdrawal_id: string;
  status: string;
  amount: string;
}> {
  return apiRequest('/api/user/withdrawal/request', {
    method: 'POST',
    body: input,
  });
}

/* ---------- Telebirr deposits ---------- */

export interface TelebirrDepositInitiateInput {
  amount: string | number;
  /**
   * Real Telebirr transaction reference the user pasted from their own
   * Telebirr SMS. The backend confirms the deposit by matching it against
   * the agent SMS's parsed ref.
   */
  telebirr_reference?: string;
  /** Payment screenshot as a base64 data URL (evidence for verification). */
  screenshot_url?: string;
}

export interface TelebirrDepositInitiateResponse {
  request_id: string;
  reference_code: string;
  telebirr_number: string;
  agent_name: string;
  amount: string;
  currency: string;
  expires_at: string;
  instructions: string;
  /** True when the matching SMS had already arrived and the deposit was
   *  credited immediately. */
  confirmed: boolean;
}

export async function telebirrDepositInitiate(
  input: TelebirrDepositInitiateInput
): Promise<TelebirrDepositInitiateResponse> {
  return apiRequest('/api/user/deposits/telebirr/initiate', {
    method: 'POST',
    body: input,
  });
}

export interface TelebirrDepositRow {
  id: string;
  amount: string;
  status: string;
  reference: string | null;
  created_at: string;
  completed_at: string | null;
}

export async function telebirrDepositHistory(query: {
  page?: number;
  limit?: number;
} = {}): Promise<PaginatedResponse<TelebirrDepositRow>> {
  return apiRequest('/api/user/deposits/telebirr/history', {
    query: query as Record<string, number | undefined>,
  });
}

export async function telebirrDepositStatus(requestId: string): Promise<{
  request_id: string;
  status: 'waiting' | 'confirmed' | 'expired' | 'cancelled' | string;
  amount: string;
  reference_code: string;
  telebirr_number: string;
  expires_at: string;
  credited_amount: string | null;
  telebirr_ref: string | null;
  matched_transaction_id: string | null;
  seconds_until_expiry: number;
}> {
  return apiRequest(`/api/user/deposits/telebirr/${requestId}/status`);
}

export async function telebirrDepositCancel(requestId: string): Promise<{
  request_id: string;
  status: string;
}> {
  return apiRequest(`/api/user/deposits/telebirr/${requestId}/cancel`, {
    method: 'DELETE',
  });
}

/* ---------- Telebirr withdrawals ---------- */

export interface TelebirrWithdrawalInitiateInput {
  amount: string;
  telebirr_number: string;
  account_name?: string;
}

export interface TelebirrWithdrawalRow {
  id: string;
  amount: string;
  telebirr_number: string;
  account_name: string;
  status: string;
  reference: string | null;
  created_at: string;
  completed_at: string | null;
}

export async function telebirrWithdrawalInitiate(
  input: TelebirrWithdrawalInitiateInput
): Promise<{
  request_id: string;
  status: string;
  amount: string;
}> {
  return apiRequest('/api/user/withdrawals/telebirr/initiate', {
    method: 'POST',
    body: input,
  });
}

export async function telebirrWithdrawalHistory(query: {
  page?: number;
  limit?: number;
  status?: string;
} = {}): Promise<PaginatedResponse<TelebirrWithdrawalRow>> {
  return apiRequest('/api/user/withdrawals/telebirr/history', {
    query: query as Record<string, string | number | undefined>,
  });
}

export async function telebirrWithdrawalStatus(requestId: string): Promise<{
  request_id: string;
  status: string;
  amount: string;
}> {
  return apiRequest(`/api/user/withdrawals/telebirr/${requestId}`);
}

export async function telebirrWithdrawalCancel(requestId: string): Promise<{
  request_id: string;
  status: string;
}> {
  return apiRequest(`/api/user/withdrawals/telebirr/${requestId}/cancel`, {
    method: 'DELETE',
  });
}

/* ---------- Section 15 spec aliases ---------- */
/* These keep the wording from the user-panel spec (`/api/p2p/accounts`,
 * `/api/payments/deposit/pending`, `/api/payments/withdraw`) wired to the
 * canonical Telebirr endpoints on the backend. */

export interface P2pAccountRow {
  device_id: string;
  account_id: string | null;
  phone: string;
  label: string;
  status: 'online' | 'offline' | 'maintenance';
  daily_limit_remaining: number | null;
}

export async function listP2pAccounts(): Promise<{
  accounts: P2pAccountRow[];
  has_online: boolean;
}> {
  return apiRequest('/api/p2p/accounts');
}

export interface PendingDepositRow {
  id: string;
  amount: string;
  reference_code: string;
  telebirr_number: string;
  status: string;
  expires_at: string;
  matched_transaction_id: string | null;
  created_at: string;
}

export async function listPendingDeposits(): Promise<{
  items: PendingDepositRow[];
}> {
  return apiRequest('/api/payments/deposit/pending');
}

export async function paymentsWithdraw(input: {
  amount: string | number;
  phone: string;
  account_name?: string;
}): Promise<{ request_id: string; status: string; amount: string }> {
  return apiRequest('/api/payments/withdraw', {
    method: 'POST',
    body: input,
  });
}

/* ---------- Section 16 — Branch (cash) withdrawals ---------- */
/* The user requests a single-use code online, then brings it to any
 * branch where the cashier looks it up and hands over cash. The locked
 * balance moves out of the wallet at the moment of request so the
 * player can't double-spend the funds elsewhere. */

export interface BranchWithdrawalRow {
  id: string;
  code: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processed' | 'expired' | 'cancelled';
  expires_at: string;
  processed_at: string | null;
  created_at: string;
}

export async function createBranchWithdrawal(input: {
  amount: number | string;
  currency?: string;
}): Promise<BranchWithdrawalRow> {
  return apiRequest('/api/user/me/branch-withdrawal', {
    method: 'POST',
    body: input,
  });
}

export async function listBranchWithdrawals(query: {
  status?: 'pending' | 'processed' | 'expired' | 'cancelled';
  limit?: number;
} = {}): Promise<{ items: BranchWithdrawalRow[] }> {
  return apiRequest('/api/user/me/branch-withdrawal', { query });
}

export async function cancelBranchWithdrawal(id: string): Promise<{
  id: string;
  status: string;
}> {
  return apiRequest(`/api/user/me/branch-withdrawal/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
