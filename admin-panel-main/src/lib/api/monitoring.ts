/** /api/admin/monitoring — errors, metrics, system notifications */
import { http } from './client';

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
  level?: 'debug' | 'info' | 'warning' | 'error' | 'fatal';
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
  }>('/api/admin/monitoring/errors', { query });
}

export function recordError(input: {
  level?: ErrorLogRow['level'];
  source?: string;
  code?: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  user_id?: string;
  request_id?: string;
}) {
  return http.post<Partial<ErrorLogRow>>('/api/admin/monitoring/errors', input);
}

export function resolveError(id: string) {
  return http.post<{ id: string; resolved_at: string; resolved_by: string | null }>(
    `/api/admin/monitoring/errors/${id}/resolve`
  );
}

export interface PerformanceMetricRow {
  id: string;
  tenant_id: string | null;
  kind: 'route' | 'job' | 'webhook' | 'provider';
  name: string;
  method: string | null;
  request_count: number;
  error_count: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_ms: number | null;
  period_start: string;
  period_end: string;
  created_at: string;
}

export function listMetrics(query: {
  kind?: PerformanceMetricRow['kind'];
  name?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{ items: PerformanceMetricRow[] }>('/api/admin/monitoring/metrics', {
    query,
  });
}

export interface SystemNotificationRow {
  id: string;
  tenant_id: string;
  title: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error' | 'critical';
  target_role: string;
  target_user_id: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  read_count: number;
  link_url: string | null;
  metadata: Record<string, unknown>;
  status: 'queued' | 'sent' | 'cancelled' | 'failed';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Section 10 — per-admin "read" receipt. True when the row has
   *  been dismissed by the currently authenticated admin user. */
  read_by_me?: boolean;
  /** Timestamp of this admin's first read. */
  read_at?: string | null;
}

// Section 10 — spec calls this out at /api/admin/notifications. The
// /monitoring/notifications mountpoint remains live for legacy clients.
export function listNotifications(query: {
  status?: SystemNotificationRow['status'];
  level?: SystemNotificationRow['level'];
  target_role?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{
    items: SystemNotificationRow[];
    total: number;
    page: number;
    limit: number;
  }>('/api/admin/notifications', { query });
}

export function createNotification(input: {
  title: string;
  message: string;
  level?: SystemNotificationRow['level'];
  target_role?: string;
  target_user_id?: string;
  scheduled_at?: string;
  link_url?: string;
  metadata?: Record<string, unknown>;
  send_now?: boolean;
}) {
  return http.post<SystemNotificationRow>('/api/admin/notifications', input);
}

export function cancelNotification(id: string) {
  return http.post<{ id: string; status: string }>(
    `/api/admin/notifications/${id}/cancel`
  );
}

/** Section 10 — "Mark as read". Per-admin idempotent receipt. */
export function markNotificationRead(id: string) {
  return http.patch<{
    id: string;
    tenant_id: string;
    title: string;
    level: SystemNotificationRow['level'];
    status: SystemNotificationRow['status'];
    read_count: number;
    read_at: string;
    read_by_me: true;
    first_read: boolean;
  }>(`/api/admin/notifications/${id}/read`);
}
