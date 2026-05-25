/** /api/admin/audit-logs */
import { http } from './client';
import type { AuditLogRow, Paged } from './types';

export interface ListAuditLogsQuery {
  page?: number;
  limit?: number;
  actor_id?: string;
  actor_type?: string;
  action?: string;
  resource?: string;
  resource_id?: string;
  status?: string;
  from?: string;
  to?: string;
}

export function listAuditLogs(query: ListAuditLogsQuery = {}) {
  return http.get<Paged<AuditLogRow>>('/api/admin/audit-logs', { query });
}
