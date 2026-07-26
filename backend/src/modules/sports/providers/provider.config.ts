/**
 * Resolves the EFFECTIVE provider configuration by combining the per-tenant
 * DB row with environment defaults, and produces the masked shape returned to
 * the admin UI (the sealed API key is never echoed).
 *
 * Credential precedence: a per-tenant key entered in the admin panel (sealed)
 * wins; otherwise the env `ODDS_API_KEY` is used. Base URL falls back to
 * `ODDS_API_URL`.
 */

import { env } from '../../../config/env';
import { maskSecretSummary, openSecret } from '../../../infrastructure/crypto/secret-cipher';
import type { SportsProviderRow } from './provider.repository';

export interface ResolvedProviderConfig {
  provider: 'mock' | 'odds_api';
  /** True only when the sync should actually run for this tenant. */
  active: boolean;
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  bookmaker: string;
  sports: string[];
  leagues: string[] | null;
  prematchIntervalSeconds: number;
  liveIntervalSeconds: number;
  maxRequestsPerHour: number;
  syncWindowHours: number;
}

const DEFAULTS = {
  bookmaker: 'Bet365',
  sports: [
    'football',
    'basketball',
    'tennis',
    'baseball',
    'ice-hockey',
    'american-football',
    'rugby',
    'cricket',
    'volleyball',
    'handball',
    'mixed-martial-arts',
    'boxing',
    'esports',
  ],
  prematchIntervalSeconds: 900,
  liveIntervalSeconds: 120,
  maxRequestsPerHour: 100,
  // 45 days — captures season openers (e.g. EPL) that are weeks away, so ALL
  // leagues (not just what's playing this week) get imported.
  syncWindowHours: 1080,
};

export function resolveConfig(row: SportsProviderRow | null): ResolvedProviderConfig {
  const envMode = env.DATA_PROVIDER; // 'mock' | 'odds_api'
  const apiKey =
    (row?.api_key_sealed ? safeOpen(row.api_key_sealed) : '') ||
    (env.ODDS_API_KEY ?? '');
  const enabled = Boolean(row?.enabled);
  const apiUrl = row?.api_url || env.ODDS_API_URL;

  const active = envMode === 'odds_api' && enabled && apiKey.length > 0;

  return {
    provider: envMode,
    active,
    enabled,
    apiUrl,
    apiKey,
    bookmaker: row?.bookmaker || DEFAULTS.bookmaker,
    sports: row?.sports?.length ? row.sports : DEFAULTS.sports,
    leagues: row?.leagues && row.leagues.length > 0 ? row.leagues : null,
    prematchIntervalSeconds:
      row?.prematch_interval_seconds || DEFAULTS.prematchIntervalSeconds,
    liveIntervalSeconds: row?.live_interval_seconds || DEFAULTS.liveIntervalSeconds,
    maxRequestsPerHour: row?.max_requests_per_hour || DEFAULTS.maxRequestsPerHour,
    syncWindowHours: row?.sync_window_hours || DEFAULTS.syncWindowHours,
  };
}

function safeOpen(sealed: string): string {
  try {
    return openSecret(sealed);
  } catch {
    return '';
  }
}

/** Masked, UI-safe representation of the provider config + sync state. */
export function presentConfig(row: SportsProviderRow | null) {
  const envMode = env.DATA_PROVIDER;
  const hasEnvKey = Boolean(env.ODDS_API_KEY && env.ODDS_API_KEY.length > 0);
  const hasDbKey = Boolean(row?.api_key_sealed);
  return {
    // env-level mode (read-only in the UI; changed via deployment config).
    data_provider_mode: envMode,
    configured: Boolean(row),
    enabled: row?.enabled ?? false,
    provider: row?.provider ?? 'odds_api',
    api_url: row?.api_url ?? env.ODDS_API_URL,
    api_key_masked: hasDbKey
      ? maskSecretSummary(row?.api_key_sealed ?? null)
      : hasEnvKey
        ? '•••••••••••• (env)'
        : null,
    has_api_key: hasDbKey || hasEnvKey,
    api_key_source: hasDbKey ? 'admin' : hasEnvKey ? 'env' : 'none',
    bookmaker: row?.bookmaker ?? DEFAULTS.bookmaker,
    sports: row?.sports ?? DEFAULTS.sports,
    leagues: row?.leagues ?? null,
    prematch_interval_seconds:
      row?.prematch_interval_seconds ?? DEFAULTS.prematchIntervalSeconds,
    live_interval_seconds: row?.live_interval_seconds ?? DEFAULTS.liveIntervalSeconds,
    max_requests_per_hour: row?.max_requests_per_hour ?? DEFAULTS.maxRequestsPerHour,
    sync_window_hours: row?.sync_window_hours ?? DEFAULTS.syncWindowHours,
    // runtime state
    status: row?.status ?? 'idle',
    last_run_at: row?.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    last_success_at: row?.last_success_at
      ? new Date(row.last_success_at).toISOString()
      : null,
    last_events_sync_at: row?.last_events_sync_at
      ? new Date(row.last_events_sync_at).toISOString()
      : null,
    last_error: row?.last_error ?? null,
    events_synced: row?.events_synced ?? 0,
    odds_synced: row?.odds_synced ?? 0,
    updated_at: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}
