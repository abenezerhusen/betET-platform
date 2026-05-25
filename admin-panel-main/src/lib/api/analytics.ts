/**
 * Section 10 — Monitoring (Performance Analytics)
 *
 *   GET /api/admin/analytics/performance
 *
 * Returns aggregate metrics plus the raw `items` list so the existing
 * row-by-row table on the Performance Analytics page keeps working.
 */

import { http } from './client';
import type { PerformanceMetricRow } from './monitoring';

export interface PerformanceSummary {
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_ms: number | null;
  request_count: string;
  error_count: string;
}

export interface PeakHourRow {
  hour: number;
  request_count: string;
}

export interface SlowEndpointRow {
  name: string;
  method: string | null;
  kind: string;
  p95_ms: number | null;
  request_count: string;
}

export interface PerformanceOverview {
  summary: PerformanceSummary | null;
  peak_hours: PeakHourRow[];
  slowest_endpoints: SlowEndpointRow[];
  database_query_time: { p50_ms: number | null; p95_ms: number | null } | null;
  items: PerformanceMetricRow[];
}

export function getPerformanceOverview(query: {
  kind?: 'route' | 'job' | 'webhook' | 'provider';
  name?: string;
  from?: string;
  to?: string;
  top?: number;
} = {}) {
  return http.get<PerformanceOverview>('/api/admin/analytics/performance', { query });
}
