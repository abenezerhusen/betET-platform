/**
 * /api/admin/telebirr — agents, transactions, disputes, reports,
 * reconciliation, withdrawals.
 */
import { http } from './client';

export interface TelebirrAgent {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  device_id?: string | null;
  status: string;
  daily_limit?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function listAgents(query: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: TelebirrAgent[]; total?: number }>('/api/admin/telebirr/agents', {
    query,
  });
}

export function createAgent(input: Partial<TelebirrAgent>) {
  return http.post<TelebirrAgent>('/api/admin/telebirr/agents', input);
}

export function updateAgent(id: string, input: Partial<TelebirrAgent>) {
  return http.put<TelebirrAgent>(`/api/admin/telebirr/agents/${id}`, input);
}

export function toggleAgent(id: string) {
  return http.post<TelebirrAgent>(`/api/admin/telebirr/agents/${id}/toggle`);
}

export function resetAgentToken(id: string) {
  return http.post<{ id: string; reset_at: string }>(
    `/api/admin/telebirr/agents/${id}/reset-token`
  );
}

export function listTransactions(query: {
  from?: string;
  to?: string;
  status?: string;
  type?: string;
  agent_id?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{
    items: Array<Record<string, unknown>>;
    total?: number;
  }>('/api/admin/telebirr/transactions', { query });
}

export function listRawSms(query: {
  agent_id?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: Array<Record<string, unknown>>; total?: number }>(
    '/api/admin/telebirr/raw-sms',
    { query }
  );
}

export function openDispute(transactionId: string, body: { reason: string; notes?: string }) {
  return http.post(`/api/admin/telebirr/transactions/${transactionId}/dispute`, body);
}

export function getReports(query: { from?: string; to?: string } = {}) {
  return http.get<Record<string, unknown>>('/api/admin/telebirr/reports', { query });
}

export function getSettings() {
  return http.get<Record<string, unknown>>('/api/admin/telebirr/settings');
}

export function updateSettings(input: Record<string, unknown>) {
  return http.put<Record<string, unknown>>('/api/admin/telebirr/settings', input);
}

export function listDisputes(query: { status?: string; page?: number; limit?: number } = {}) {
  return http.get<{ items: Array<Record<string, unknown>>; total?: number }>(
    '/api/admin/telebirr/disputes',
    { query }
  );
}

export function getDispute(id: string) {
  return http.get<Record<string, unknown>>(`/api/admin/telebirr/disputes/${id}`);
}

export function investigateDispute(id: string, body: { notes?: string } = {}) {
  return http.post<Record<string, unknown>>(
    `/api/admin/telebirr/disputes/${id}/investigate`,
    body
  );
}

export function resolveDisputeCredit(id: string, body: { notes?: string; amount?: number } = {}) {
  return http.post<Record<string, unknown>>(
    `/api/admin/telebirr/disputes/${id}/resolve-credit`,
    body
  );
}

export function resolveDisputeReject(id: string, body: { notes?: string } = {}) {
  return http.post<Record<string, unknown>>(
    `/api/admin/telebirr/disputes/${id}/resolve-reject`,
    body
  );
}

export function getReconciliation(query: { from?: string; to?: string } = {}) {
  return http.get<Record<string, unknown>>('/api/admin/telebirr/reconciliation', { query });
}

export function runReconciliation(body: { from?: string; to?: string } = {}) {
  return http.post<Record<string, unknown>>('/api/admin/telebirr/reconciliation/run', body);
}

export function uploadReconciliationStatement(body: Record<string, unknown>) {
  return http.post<Record<string, unknown>>(
    '/api/admin/telebirr/reconciliation/statement',
    body
  );
}

export function resolveReconciliation(id: string, body: { notes?: string } = {}) {
  return http.post<Record<string, unknown>>(
    `/api/admin/telebirr/reconciliation/${id}/resolve`,
    body
  );
}

export function listWithdrawals(query: {
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: Array<Record<string, unknown>>; total?: number }>(
    '/api/admin/telebirr/withdrawals',
    { query }
  );
}

export function getWithdrawal(id: string) {
  return http.get<Record<string, unknown>>(`/api/admin/telebirr/withdrawals/${id}`);
}

export function cancelWithdrawal(id: string, body: { reason?: string } = {}) {
  return http.post<Record<string, unknown>>(
    `/api/admin/telebirr/withdrawals/${id}/cancel`,
    body
  );
}
