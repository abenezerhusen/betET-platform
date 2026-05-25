/**
 * Section 10 — Monitoring (Logs sub-tree)
 *
 *   /api/admin/logs/activity   — User activity feed (player / cashier)
 *   /api/admin/logs/audit      — Audit Trail (admin / super-admin / system)
 *   /api/admin/logs/errors     — Backend errors & exceptions
 *
 * All endpoints return the same shape: { items, total, page, limit, pages }.
 */

import { http } from './client';

export interface LogRow {
  id: string;
  tenant_id: string | null;
  actor_id: string | null;
  actor_type: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  status: string;
  created_at: string;
  /** Convenience copy of created_at — added by the backend for parity
   *  with the error_logs.occurred_at field. */
  occurred_at: string;
}

export interface ListLogsQuery {
  page?: number;
  limit?: number;
  tenant_id?: string;
  user_id?: string;
  actor_id?: string;
  action?: string;
  action_prefix?: string;
  resource?: string;
  resource_id?: string;
  status?: 'success' | 'failure' | 'warning' | 'info';
  from?: string;
  to?: string;
  search?: string;
}

export interface LogsPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function listActivityLogs(query: ListLogsQuery = {}) {
  return http.get<LogsPage<LogRow>>('/api/admin/logs/activity', { query });
}

export function listAuditLogs(query: ListLogsQuery = {}) {
  return http.get<LogsPage<LogRow>>('/api/admin/logs/audit', { query });
}

/* -------------------------------------------------------------------------- */
/* Error tracking — separate row shape (error_logs table)                     */
/* -------------------------------------------------------------------------- */

export interface ErrorLogRow {
  id: string;
  tenant_id: string | null;
  request_id: string | null;
  level: 'debug' | 'info' | 'warning' | 'error' | 'fatal';
  source: string;
  code: string | null;
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
  user_id: string | null;
  occurred_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface ListErrorLogsQuery {
  level?: ErrorLogRow['level'];
  source?: string;
  search?: string;
  resolved?: boolean;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export function listErrorLogs(query: ListErrorLogsQuery = {}) {
  return http.get<{
    items: ErrorLogRow[];
    total: number;
    page: number;
    limit: number;
  }>('/api/admin/logs/errors', { query });
}
