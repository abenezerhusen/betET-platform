/** /api/admin/p2p — the P2P agent wallet network admin surface */
import { http } from './client';

export interface P2pDashboardKpis {
  total_deposits_today: string;
  total_withdrawals_today: string;
  successful_deposits_today: number;
  successful_withdrawals_today: number;
  failed_today: number;
  manual_review_count: number;
  active_agents: number;
  total_agents: number;
}

/** Telebirr agent row returned by GET /wallets */
export interface WalletAgentRow {
  id: string;
  tenant_id: string;
  agent_name: string;
  telebirr_number: string;
  device_id: string;
  device_name: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  status: string;
  balance: string;
  /** Net pre-deposit (float) derived from confirmed swaps; reflects top-ups. */
  pre_deposit?: string;
  assigned_cashier_id?: string | null;
  last_assigned_at?: string | null;
  created_at: string;
}

export interface WalletPriorityRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  priority: number;
  enabled: boolean;
}

export interface DashboardWalletStatusRow {
  agent_id: string;
  agent_name: string;
  device_id: string | null;
  device_name: string | null;
  telebirr_number: string;
  status: string;
  last_seen_at: string | null;
  balance: string;
  daily_limit: string;
  used_today: string;
  pre_deposit: string;
  commission_rate: string;
  total_capacity: string;
  available_capacity: string;
  deposits_today: string;
  withdrawals_today: string;
  earned_today: string;
}

export interface DashboardCapacityRow {
  agent_id: string;
  agent_name: string;
  pre_deposit: string;
  commission_rate: string;
  total_capacity: string;
  available_capacity: string;
  used_today: string;
  earned_today: string;
}

export interface DashboardActivityRow {
  id: string;
  kind: 'deposit' | 'withdrawal' | 'command' | 'event';
  status: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  amount: string | null;
  agent_id: string | null;
  agent_name: string | null;
  reference: string | null;
  created_at: string;
}

export interface P2pDashboard {
  kpis: P2pDashboardKpis;
  agents: WalletAgentRow[];
  priority: WalletPriorityRow[];
  wallet_status: DashboardWalletStatusRow[];
  capacity: DashboardCapacityRow[];
  activity_feed: DashboardActivityRow[];
}

export function getDashboard() {
  return http.get<P2pDashboard>('/api/admin/p2p/dashboard');
}

export interface UnifiedTransactionRow {
  id: string;
  kind: 'deposit' | 'withdrawal';
  user_id: string | null;
  user_email: string | null;
  user_phone: string | null;
  amount: string;
  currency: string;
  status: string;
  status_label: string;
  reference: string | null;
  agent_id: string | null;
  agent_name: string | null;
  wallet_phone: string | null;
  created_at: string;
}

export function listTransactions(query: {
  tab?: 'all' | 'deposit' | 'withdrawal' | 'failed';
  status?: 'success' | 'pending' | 'processing' | 'failed';
  agent_id?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{
    items: UnifiedTransactionRow[];
    total: number;
    page: number;
    limit: number;
  }>('/api/admin/p2p/transactions', { query });
}

/** Alias — wallet list entries are Telebirr agents */
export type WalletDevice = WalletAgentRow;

export interface RegisterWalletDevicePayload {
  name: string;
  telebirr_number: string;
  pre_deposit: number;
  commission_rate?: number;
  daily_limit?: number;
  ussd_pin?: string;
  /** APK login password. Username for the agent app is `telebirr_number`. */
  login_password?: string;
  device_id?: string;
}

export type WalletDeviceDetail = WalletAgentRow & {
  sub_accounts?: Array<Record<string, unknown>>;
  swaps?: Array<Record<string, unknown>>;
};

export function listWalletDevices(query: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: WalletAgentRow[]; total?: number; page?: number; limit?: number }>(
    '/api/admin/p2p/wallets',
    {
      query,
    }
  );
}

export function registerWalletDevice(input: RegisterWalletDevicePayload) {
  return http.post<{ agent: WalletAgentRow; swap: Record<string, unknown> }>(
    '/api/admin/p2p/wallets',
    input
  );
}

export function getWalletDevice(id: string) {
  return http.get<WalletDeviceDetail>(`/api/admin/p2p/wallets/${id}`);
}

export function updateWalletDevice(
  id: string,
  input: Partial<{ name: string; status: 'active' | 'inactive' | 'suspended'; enabled: boolean }>
) {
  return http.put<WalletAgentRow>(`/api/admin/p2p/wallets/${id}`, input);
}

export function topUpWalletDevice(
  id: string,
  input: { amount: number; note?: string; re_enable_wallet?: boolean }
) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/wallets/${id}/topup`, input);
}

export function withdrawalSwap(
  id: string,
  input: {
    amount: number;
    ref_user_id?: string;
    ref_withdrawal_id?: string;
    note?: string;
  }
) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/wallets/${id}/withdrawal-swap`, input);
}

export function listWalletSwaps(id: string) {
  return http.get<{ items: Array<Record<string, unknown>> }>(
    `/api/admin/p2p/wallets/${id}/swaps`
  );
}

export function updateWalletUssdPin(id: string, input: { pin: string }) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/wallets/${id}/pin`, input);
}

/**
 * Set / reset the APK login password for a wallet device. The agent app
 * logs in with the wallet's telebirr_number as the username and this
 * password. Independent from the USSD PIN.
 */
export function updateWalletPassword(id: string, input: { password: string }) {
  return http.post<{ ok: boolean; agent_id: string }>(
    `/api/admin/p2p/wallets/${id}/password`,
    input
  );
}

export function listSubAccounts(walletId: string) {
  return http.get<{ items: Array<Record<string, unknown>> }>(
    `/api/admin/p2p/wallets/${walletId}/accounts`
  );
}

export function addSubAccount(walletId: string, input: { phone: string; label?: string }) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/wallets/${walletId}/accounts`, input);
}

export function toggleSubAccount(id: string, input: { enabled: boolean }) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/accounts/${id}/toggle`, input);
}

export function removeSubAccount(id: string) {
  return http.delete<{ id: string }>(`/api/admin/p2p/accounts/${id}`);
}

export function listSwaps(query: { status?: string; page?: number; limit?: number } = {}) {
  return http.get<{ items: Array<Record<string, unknown>>; total?: number }>(
    '/api/admin/p2p/swaps',
    { query }
  );
}

export function confirmSwap(id: string) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/swaps/${id}/confirm`);
}

export function failSwap(id: string, body: { reason?: string } = {}) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/swaps/${id}/fail`, body);
}

export interface DepositQueueRow {
  id: string;
  tenant_id: string;
  user_id?: string | null;
  amount: string;
  reference?: string | null;
  sender_phone?: string | null;
  sender_name?: string | null;
  wallet?: string | null;
  user_email?: string | null;
  user_phone?: string | null;
  status: string;
  created_at: string;
  [k: string]: unknown;
}

export interface ApproveDepositResponse {
  ok: boolean;
  deposit_id: string;
  wallet_transaction_id: string;
}

export function listDepositQueue(query: {
  status?: 'pending' | 'approved' | 'rejected';
  agent_id?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{
    items: DepositQueueRow[];
    total?: number;
    page?: number;
    limit?: number;
  }>('/api/admin/p2p/deposits', {
    query,
  });
}

export function approveDeposit(
  id: string,
  body: { note?: string; user_id?: string } = {}
) {
  return http.post<ApproveDepositResponse>(`/api/admin/p2p/deposits/${id}/approve`, body);
}

export function rejectDeposit(id: string, body: { reason: string }) {
  return http.post<DepositQueueRow>(`/api/admin/p2p/deposits/${id}/reject`, body);
}

export interface WithdrawalQueueRow {
  id: string;
  tenant_id?: string;
  user_id?: string;
  amount: string;
  currency?: string;
  status: string;
  telebirr_number?: string | null;
  account_name?: string | null;
  requested_at?: string | null;
  created_at?: string;
  user_email?: string | null;
  user_phone?: string | null;
  is_awaiting_approval?: boolean;
  [k: string]: unknown;
}

export function listWithdrawalQueue(query: {
  status?: 'pending' | 'processing' | 'awaiting_approval' | 'success' | 'failed';
  agent_id?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{
    items: WithdrawalQueueRow[];
    total?: number;
    page?: number;
    limit?: number;
    manual_approval_threshold?: number;
  }>('/api/admin/p2p/withdrawals', { query });
}

export function setApprovalThreshold(input: { manual_approval_threshold: number }) {
  return http.put<Record<string, unknown>>('/api/admin/p2p/withdrawals/threshold', input);
}

export function approveWithdrawal(
  id: string,
  body: { agent_id?: string; note?: string } = {}
) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/withdrawals/${id}/approve`, body);
}

export function rejectWithdrawal(id: string, body: { reason: string }) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/withdrawals/${id}/reject`, body);
}

export function switchWithdrawalWallet(id: string, body: { agent_id: string; reason?: string }) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/withdrawals/${id}/switch`, body);
}

export function listCommands(query: {
  status?: string;
  kind?: string;
  agent_id?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: Array<Record<string, unknown>>; total?: number }>(
    '/api/admin/p2p/commands',
    { query }
  );
}

export function issueCommand(input: {
  agent_id: string;
  kind: string;
  payload?: Record<string, unknown>;
  reference?: string;
}) {
  return http.post<Record<string, unknown>>('/api/admin/p2p/commands', input);
}

export function broadcastCommand(input: {
  kind: 'check_balance' | 'restart' | 'heartbeat';
  payload?: Record<string, unknown>;
}) {
  return http.post<Record<string, unknown>>('/api/admin/p2p/commands/broadcast', input);
}

export function updateCommandStatus(
  id: string,
  input: {
    status: 'sent' | 'executing' | 'success' | 'failed' | 'cancelled';
    result?: Record<string, unknown>;
    error_message?: string;
  }
) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/commands/${id}/status`, input);
}

export function cancelCommand(id: string) {
  return http.post<Record<string, unknown>>(`/api/admin/p2p/commands/${id}/cancel`);
}

export interface OperatorRow {
  id: string;
  tenant_id: string;
  user_id?: string | null;
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'client';
  status: 'active' | 'suspended';
  permissions: string[];
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
  assigned_agent_ids?: string[];
}

export function listOperators(query: {
  role?: 'admin' | 'operator' | 'client';
  status?: 'active' | 'suspended';
  search?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{
    items: OperatorRow[];
    total?: number;
    page?: number;
    limit?: number;
  }>('/api/admin/p2p/operators', {
    query,
  });
}

export interface CreateOperatorPayload {
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'client';
  status?: 'active' | 'suspended';
  permissions?: string[];
  assigned_agent_ids?: string[];
  user_id?: string;
}

export function createOperator(input: CreateOperatorPayload) {
  return http.post<OperatorRow & { assigned_agent_ids?: string[] }>('/api/admin/p2p/operators', input);
}

export function getOperator(id: string) {
  return http.get<OperatorRow>(`/api/admin/p2p/operators/${id}`);
}

export function updateOperator(
  id: string,
  input: Partial<{
    name: string;
    email: string;
    role: 'admin' | 'operator' | 'client';
    status: 'active' | 'suspended';
    permissions: string[];
  }>
) {
  return http.put<OperatorRow>(`/api/admin/p2p/operators/${id}`, input);
}

export function setOperatorAssignments(id: string, input: { assigned_agent_ids: string[] }) {
  return http.put<{ assigned: string[] }>(`/api/admin/p2p/operators/${id}/assignments`, input);
}

export function setOperatorPermissions(id: string, input: { permissions: string[] }) {
  return http.put<OperatorRow>(`/api/admin/p2p/operators/${id}/permissions`, input);
}

export function issueAccessToken(
  operatorId: string,
  body: { ttl_hours?: number; delivered_to?: string } = {}
) {
  return http.post<{ token: string; expires_at: string }>(
    `/api/admin/p2p/operators/${operatorId}/access-tokens`,
    body
  );
}

export function rotateAccessToken(
  operatorId: string,
  body: { ttl_hours?: number; delivered_to?: string } = {}
) {
  return http.post<{ token: string; expires_at: string }>(
    `/api/admin/p2p/operators/${operatorId}/access-tokens/rotate`,
    body
  );
}

export function revokeAccessToken(id: string) {
  return http.delete<{ id: string }>(`/api/admin/p2p/access-tokens/${id}`);
}

export function getP2pSettings() {
  return http.get<Record<string, unknown>>('/api/admin/p2p/settings');
}

export function updateP2pSettings(input: Record<string, unknown>) {
  return http.put<Record<string, unknown>>('/api/admin/p2p/settings', input);
}

export function getWalletPriority() {
  return http.get<{ items: Array<{ agent_id: string; priority: number; enabled: boolean }> }>(
    '/api/admin/p2p/wallet-priority'
  );
}

export function setWalletPriority(input: {
  items: Array<{ agent_id: string; priority: number; enabled: boolean }>;
}) {
  return http.put<{ items: WalletPriorityRow[] }>('/api/admin/p2p/wallet-priority', input);
}

export function listCommissions() {
  return http.get<Record<string, unknown>>('/api/admin/p2p/commissions');
}

export function upsertWalletCommission(input: Record<string, unknown>) {
  return http.put<Record<string, unknown>>('/api/admin/p2p/commissions/wallet', input);
}

export function upsertClientCommission(input: Record<string, unknown>) {
  return http.put<Record<string, unknown>>('/api/admin/p2p/commissions/client', input);
}

/** `userId` — backend path param */
export function deleteClientCommission(userId: string) {
  return http.delete<{ ok: boolean }>(`/api/admin/p2p/commissions/client/${userId}`);
}

export function listEventLogs(query: {
  kind?: 'sms_in' | 'sms_out' | 'ussd' | 'error' | 'wallet_switch' | 'command';
  level?: 'info' | 'warning' | 'error';
  agent_id?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: Array<Record<string, unknown>>; total?: number }>(
    '/api/admin/p2p/logs',
    { query }
  );
}
