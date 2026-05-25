/**
 * /api/admin/transactions — Section 5 (Transactions).
 *
 * Modern callers should use the unified `listTransactions({ type, ... })`
 * function which targets `GET /api/admin/transactions?type=online|branch|wallet`.
 *
 * The legacy helpers (`listOnlineTransactions`, `listBranchTransactions`,
 * `listWalletTransactions`) are preserved as thin wrappers for backwards
 * compatibility with any code that still calls them directly.
 */
import { http } from './client';

interface DateRange {
  from?: string;
  to?: string;
}

export type TransactionsType = 'online' | 'branch' | 'wallet';

export interface BranchTxQuery extends DateRange {
  branch_id?: string;
  cashier_id?: string;
  user_id?: string;
  type?:
    | 'deposit'
    | 'withdrawal'
    | 'ticket_sell'
    | 'ticket_payout'
    | 'ticket_cancel'
    | 'jackpot_payout'
    | 'jackpot_sell'
    | 'adjustment';
  status?:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'completed'
    | 'cancelled'
    | 'failed';
  phone?: string;
  reason?: string;
  search?: string;
  min_amount?: number;
  max_amount?: number;
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export interface OnlineTxQuery extends DateRange {
  type?: 'deposit' | 'withdrawal';
  status?: 'pending' | 'completed' | 'failed' | 'reversed' | 'cancelled';
  phone?: string;
  bank?: string;
  reason?: string;
  search?: string;
  min_amount?: number;
  max_amount?: number;
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export interface WalletTxQuery extends DateRange {
  user_id?: string;
  phone?: string;
  reason?: string;
  direction?: 'credit' | 'debit';
  /** Backwards-compat — kept for older callers that filtered transfer pairs. */
  sender_phone?: string;
  receiver_phone?: string;
  search?: string;
  min_amount?: number;
  max_amount?: number;
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export interface TxRowGeneric {
  id: string;
  tenant_id: string;
  created_at: string;
  type?: string;
  amount?: string | number;
  abs_amount?: string | number;
  fee?: string | number;
  currency?: string;
  status?: string;
  reference?: string | null;
  metadata?: Record<string, unknown>;
  user_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  user_phone?: string | null;
  phone?: string | null;
  full_name?: string | null;
  reason?: string | null;
  bank?: string | null;
  provider?: string | null;
  nonce?: string | null;
  session_id?: string | null;
  comment?: string | null;
  notes?: string | null;
  /** Branch-only fields */
  branch_name?: string | null;
  branch_email?: string | null;
  cashier_id?: string | null;
  cashier_name?: string | null;
  cashier_email?: string | null;
  /** Wallet-only fields */
  direction?: string | null;
  before_balance?: string | number;
  after_balance?: string | number;
  transfer_id?: string | null;
  counterparty_phone?: string | null;
  counterparty_name?: string | null;
  /** Online-only convenience field */
  direction_label?: string | null;
  /** Pre-existing wallet "transfer pair" fields kept for old wallet-page builds. */
  sender_name?: string | null;
  sender_phone?: string | null;
  receiver_name?: string | null;
  receiver_phone?: string | null;
  from_balance?: string | number;
  to_balance?: string | number;
  sales_name?: string | null;
  agent_name?: string | null;
  [k: string]: unknown;
}

export interface TxListResponse {
  items: TxRowGeneric[];
  total?: number;
  limit?: number;
  offset?: number;
  summary?: Record<string, unknown> | null;
}

/**
 * Unified Section-5 entry point. The query schema accepted by the server
 * depends on `type`; we narrow it here to keep callers honest.
 */
export function listTransactions(
  type: 'online',
  query?: OnlineTxQuery
): Promise<TxListResponse>;
export function listTransactions(
  type: 'branch',
  query?: BranchTxQuery
): Promise<TxListResponse>;
export function listTransactions(
  type: 'wallet',
  query?: WalletTxQuery
): Promise<TxListResponse>;
export function listTransactions(
  type: TransactionsType,
  query: OnlineTxQuery | BranchTxQuery | WalletTxQuery = {}
): Promise<TxListResponse> {
  return http.get<TxListResponse>('/api/admin/transactions', {
    query: { ...query, type },
  });
}

/* Legacy wrappers — keep older imports compiling. */

export function listBranchTransactions(query: BranchTxQuery = {}) {
  return listTransactions('branch', query);
}

export function listOnlineTransactions(query: OnlineTxQuery = {}) {
  return listTransactions('online', query);
}

export function listWalletTransactions(query: WalletTxQuery = {}) {
  return listTransactions('wallet', query);
}
