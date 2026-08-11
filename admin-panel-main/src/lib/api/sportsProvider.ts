/**
 * API client for the Sports Data Provider (Odds-API.io) integration.
 *
 * Talks only to /api/admin/sports-provider/*. All endpoints require the
 * `settings.sports_provider` permission (Super Admin by default). The API key
 * is sealed server-side and never returned in plaintext.
 */

import { http } from './client';

const BASE = '/api/admin/sports-provider';

export interface ProviderStatus {
  /** env master switch: 'mock' | 'odds_api' (read-only in the UI). */
  data_provider_mode: 'mock' | 'odds_api';
  configured: boolean;
  enabled: boolean;
  provider: string;
  api_url: string;
  api_key_masked: string | null;
  has_api_key: boolean;
  api_key_source: 'admin' | 'env' | 'none';
  bookmaker: string;
  sports: string[];
  leagues: string[] | null;
  prematch_interval_seconds: number;
  live_interval_seconds: number;
  max_requests_per_hour: number;
  sync_window_hours: number;
  status: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_events_sync_at: string | null;
  last_results_sync_at: string | null;
  last_error: string | null;
  events_synced: number;
  odds_synced: number;
  results_finalized: number;
  tickets_settled: number;
  updated_at: string | null;
  /** Live pipeline health counts (best-effort; may be absent on error). */
  stats?: PipelineStats;
}

export interface PipelineStats {
  events_total?: number;
  leagues_total?: number;
  events_upcoming?: number;
  events_live?: number;
  events_completed?: number;
  events_awaiting_results?: number;
  events_with_odds?: number;
  unsettled_tickets?: number;
  tickets_needing_review?: number;
  last_settlement_at?: string | null;
}

export interface ProviderConfigInput {
  enabled?: boolean;
  api_url?: string;
  /** Empty / omitted keeps the stored key. */
  api_key?: string;
  bookmaker?: string;
  sports?: string[];
  leagues?: string[] | null;
  prematch_interval_seconds?: number;
  live_interval_seconds?: number;
  max_requests_per_hour?: number;
  sync_window_hours?: number;
}

export interface TestResult {
  ok: boolean;
  sports: number;
  error: string | null;
}

export interface SyncPhaseResult {
  phase: 'prematch' | 'live' | 'results';
  eventsUpserted: number;
  oddsUpserted: number;
  requestsRemaining: number;
  resultsFinalized?: number;
  ticketsSettled?: number;
  eventsCancelled?: number;
  skipped?: string;
}

export interface SyncResult {
  results?: SyncPhaseResult;
  prematch: SyncPhaseResult;
  live: SyncPhaseResult;
  events_upserted: number;
  odds_upserted: number;
  results_finalized?: number;
  tickets_settled?: number;
  status: ProviderStatus;
}

export const getStatus = () => http.get<ProviderStatus>(`${BASE}`);

export const saveConfig = (input: ProviderConfigInput) =>
  http.put<ProviderStatus>(`${BASE}`, input);

export const testConnection = () => http.post<TestResult>(`${BASE}/test`);

export const syncNow = () => http.post<SyncResult>(`${BASE}/sync`);
