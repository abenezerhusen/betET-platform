import { http } from './client';

export interface MatchStatsRow {
  match_id: string;
  match: string;
  league: string;
  total_bets: number;
  total_stake: number;
  avg_odds: number;
  win_rate: number;
  status: string;
  starts_at: string;
}

export function listMatchStats(query: {
  status?: 'live' | 'upcoming' | 'completed';
  page?: number;
  limit?: number;
  export?: 'csv';
} = {}) {
  return http.get<MatchStatsRow[] | { csv: string }>('/api/admin/matches/stats', { query });
}

export function getMatchStatsSummary() {
  return http.get<{
    total_active_matches: number;
    total_bets_today: number;
    total_stake_today: number;
    avg_win_rate_today: number;
  }>('/api/admin/matches/stats/summary');
}

export interface EndpointMetricRow {
  endpoint: string;
  method: string;
  version: string;
  rate_limit: string;
  avg_response_ms: number;
  status: 'Active' | 'Degraded' | 'Down';
  last_tested: string;
  calls_today: number;
  error_rate_pct: number;
}

export function listApiManagementEndpoints() {
  return http.get<EndpointMetricRow[]>('/api/admin/api-management/endpoints');
}

export function testApiManagementEndpoint(input: { endpoint: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' }) {
  return http.post('/api/admin/api-management/endpoints/test', input);
}

export function listApiManagementWebhooks() {
  return http.get<Array<{ id: string; endpoint: string; provider: string; last_delivery_status: string; last_delivery_at: string }>>(
    '/api/admin/api-management/webhooks'
  );
}

export function testApiManagementWebhook(id: string) {
  return http.post(`/api/admin/api-management/webhooks/${id}/test`);
}

export interface MaintenanceStatusResponse {
  services: Array<{ name: string; status: string; latency_ms?: number; uptime_pct?: number; connections?: number; memory_mb?: number }>;
  disk_usage_pct: number;
  cpu_pct: number;
  memory_pct: number;
}

export interface MaintenanceLogRow {
  id: string;
  type: 'System' | 'Performance' | 'Security';
  severity: 'Info' | 'Warning' | 'Critical';
  message: string;
  timestamp: string;
}

export interface BackupFileRow {
  name: string;
  size_bytes: number;
  created_at: string;
}

export function getMaintenanceStatus() {
  return http.get<MaintenanceStatusResponse>('/api/admin/maintenance/status');
}

export function listMaintenanceLogs(query?: {
  type?: 'System' | 'Performance' | 'Security';
  severity?: 'Info' | 'Warning' | 'Critical';
}) {
  return http.get<MaintenanceLogRow[]>('/api/admin/maintenance/logs', { query });
}

export function listMaintenanceBackups() {
  return http.get<BackupFileRow[]>('/api/admin/maintenance/backups');
}

export function triggerMaintenanceBackup() {
  return http.post<{ ok: boolean; message: string }>('/api/admin/maintenance/backups/trigger');
}

export function flushMaintenanceCache() {
  return http.post<{ ok: boolean; message: string }>('/api/admin/maintenance/cache/flush');
}

export function getMaintenanceCacheStats() {
  return http.get<{ hit_rate_pct: number; size_mb: number; key_count: number }>(
    '/api/admin/maintenance/cache/stats'
  );
}

export function getMaintenanceDbStats() {
  return http.get<{ table_counts: Record<string, number>; db_size_mb: number; slow_queries: unknown[]; index_health: string }>(
    '/api/admin/maintenance/db/stats'
  );
}

export function runMaintenanceDbVacuum() {
  return http.post<{ ok: boolean; message: string }>('/api/admin/maintenance/db/vacuum');
}
