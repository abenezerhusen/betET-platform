/**
 * Data access for the sports data provider integration.
 *
 *  - sports_data_provider  : per-tenant provider config + runtime sync state.
 *  - sports_events / sports_markets / sports_selections : the EXISTING tables
 *    the sync writes into. Upserts mirror the seed's write shape exactly
 *    (market_type '1x2', label 'Full Time Result', selections Home/Draw/Away)
 *    so /api/sports/* keeps working with zero changes.
 *
 * Idempotency: events are matched first by the provider event id stored in
 * metadata->>'provider_event_id', then by the natural key
 * (tenant, sport, league, home_team, away_team) — so a real fixture ADOPTS an
 * existing seed row instead of duplicating it.
 */

import type { PoolClient } from 'pg';
import type { NormalizedEvent, NormalizedMarket } from './odds-api.types';

export interface SportsProviderRow {
  id: string;
  tenant_id: string;
  provider: string;
  enabled: boolean;
  api_url: string;
  api_key_sealed: string | null;
  bookmaker: string;
  sports: string[];
  leagues: string[] | null;
  prematch_interval_seconds: number;
  live_interval_seconds: number;
  max_requests_per_hour: number;
  sync_window_hours: number;
  status: string;
  last_run_at: Date | null;
  last_success_at: Date | null;
  last_error: string | null;
  last_events_sync_at: Date | null;
  events_synced: number;
  odds_synced: number;
  created_at: Date;
  updated_at: Date;
}

/* -------------------------------------------------------------------------- */
/*  Config                                                                    */
/* -------------------------------------------------------------------------- */
export async function getConfig(
  client: PoolClient,
  tenantId: string
): Promise<SportsProviderRow | null> {
  const r = await client.query<SportsProviderRow>(
    `SELECT * FROM sports_data_provider WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  return r.rows[0] ?? null;
}

export interface UpsertConfigInput {
  tenantId: string;
  enabled: boolean;
  apiUrl: string;
  /** null = keep the existing sealed key untouched. */
  apiKeySealed: string | null;
  bookmaker: string;
  sports: string[];
  leagues: string[] | null;
  prematchIntervalSeconds: number;
  liveIntervalSeconds: number;
  maxRequestsPerHour: number;
  syncWindowHours: number;
  updatedBy: string | null;
}

export async function upsertConfig(
  client: PoolClient,
  input: UpsertConfigInput
): Promise<SportsProviderRow> {
  const r = await client.query<SportsProviderRow>(
    `INSERT INTO sports_data_provider (
        tenant_id, provider, enabled, api_url, api_key_sealed, bookmaker,
        sports, leagues, prematch_interval_seconds, live_interval_seconds,
        max_requests_per_hour, sync_window_hours, updated_by
     ) VALUES (
        $1, 'odds_api', $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12
     )
     ON CONFLICT (tenant_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        api_url = EXCLUDED.api_url,
        api_key_sealed = COALESCE($4, sports_data_provider.api_key_sealed),
        bookmaker = EXCLUDED.bookmaker,
        sports = EXCLUDED.sports,
        leagues = EXCLUDED.leagues,
        prematch_interval_seconds = EXCLUDED.prematch_interval_seconds,
        live_interval_seconds = EXCLUDED.live_interval_seconds,
        max_requests_per_hour = EXCLUDED.max_requests_per_hour,
        sync_window_hours = EXCLUDED.sync_window_hours,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
     RETURNING *`,
    [
      input.tenantId,
      input.enabled,
      input.apiUrl,
      input.apiKeySealed,
      input.bookmaker,
      input.sports,
      input.leagues,
      input.prematchIntervalSeconds,
      input.liveIntervalSeconds,
      input.maxRequestsPerHour,
      input.syncWindowHours,
      input.updatedBy,
    ]
  );
  return r.rows[0];
}

export interface SyncStatePatch {
  status?: string;
  lastRunAt?: boolean;
  lastSuccessAt?: boolean;
  lastError?: string | null;
  lastEventsSyncAt?: boolean;
  eventsSyncedDelta?: number;
  oddsSyncedDelta?: number;
}

export async function setSyncState(
  client: PoolClient,
  tenantId: string,
  patch: SyncStatePatch
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [tenantId];
  let i = 2;
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(patch.status);
  }
  if (patch.lastRunAt) sets.push(`last_run_at = now()`);
  if (patch.lastSuccessAt) sets.push(`last_success_at = now()`);
  if (patch.lastEventsSyncAt) sets.push(`last_events_sync_at = now()`);
  if (patch.lastError !== undefined) {
    sets.push(`last_error = $${i++}`);
    values.push(patch.lastError);
  }
  if (patch.eventsSyncedDelta) {
    sets.push(`events_synced = events_synced + $${i++}`);
    values.push(patch.eventsSyncedDelta);
  }
  if (patch.oddsSyncedDelta) {
    sets.push(`odds_synced = odds_synced + $${i++}`);
    values.push(patch.oddsSyncedDelta);
  }
  if (sets.length === 0) return;
  await client.query(
    `UPDATE sports_data_provider SET ${sets.join(', ')} WHERE tenant_id = $1`,
    values
  );
}

/* -------------------------------------------------------------------------- */
/*  Event / market / selection upserts (write into EXISTING tables)           */
/* -------------------------------------------------------------------------- */

/**
 * Bulk idempotent upsert of provider events in ONE statement (all-leagues
 * volume). Keyed on the unique partial index (tenant_id, provider_event_id).
 * Existing metadata (e.g. odds_synced_at) and stats are preserved via `||`
 * merge, so an event refresh never wipes odds-freshness bookkeeping.
 *
 * Returns the number of rows written (inserted or updated).
 */
export async function upsertEvents(
  client: PoolClient,
  tenantId: string,
  events: NormalizedEvent[]
): Promise<number> {
  if (events.length === 0) return 0;
  const payload = events.map((ev) => ({
    provider_event_id: ev.providerEventId,
    sport: ev.sport,
    league: ev.league,
    home_team: ev.homeTeam,
    away_team: ev.awayTeam,
    starts_at: ev.startsAt,
    status: ev.status,
    home_score: ev.homeScore,
    away_score: ev.awayScore,
    minute: ev.minute,
  }));

  const res = await client.query(
    `INSERT INTO sports_events
        (tenant_id, sport, league, home_team, away_team, starts_at, status,
         home_score, away_score, stats, metadata)
     SELECT $1,
            x.sport, x.league, x.home_team, x.away_team, x.starts_at, x.status,
            x.home_score, x.away_score,
            CASE WHEN x.minute IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object('minute', x.minute) END,
            jsonb_build_object('provider', 'odds_api',
                               'provider_event_id', x.provider_event_id)
       FROM jsonb_to_recordset($2::jsonb) AS x(
              provider_event_id text, sport text, league text,
              home_team text, away_team text, starts_at timestamptz,
              status text, home_score int, away_score int, minute int
            )
     ON CONFLICT (tenant_id, (metadata->>'provider_event_id'))
        WHERE metadata ? 'provider_event_id'
     DO UPDATE SET
        starts_at  = EXCLUDED.starts_at,
        status     = EXCLUDED.status,
        home_score = COALESCE(EXCLUDED.home_score, sports_events.home_score),
        away_score = COALESCE(EXCLUDED.away_score, sports_events.away_score),
        league     = COALESCE(EXCLUDED.league, sports_events.league),
        -- Merge so we keep odds_synced_at and any existing stats/metadata.
        stats      = COALESCE(sports_events.stats, '{}'::jsonb) || EXCLUDED.stats,
        metadata   = COALESCE(sports_events.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_at = now()`,
    [tenantId, JSON.stringify(payload)]
  );
  return res.rowCount ?? 0;
}

export async function upsertEvent(
  client: PoolClient,
  tenantId: string,
  ev: NormalizedEvent
): Promise<{ id: string; created: boolean }> {
  // 1) Match by provider event id (previous sync), else adopt a natural-key row.
  const found = await client.query<{ id: string }>(
    `SELECT id FROM sports_events
      WHERE tenant_id = $1
        AND ( metadata->>'provider_event_id' = $2
              OR ( sport = $3
                   AND league IS NOT DISTINCT FROM $4
                   AND home_team = $5
                   AND away_team = $6 ) )
      ORDER BY (metadata->>'provider_event_id' = $2) DESC
      LIMIT 1`,
    [tenantId, ev.providerEventId, ev.sport, ev.league, ev.homeTeam, ev.awayTeam]
  );

  const providerMeta = JSON.stringify({
    provider: 'odds_api',
    provider_event_id: ev.providerEventId,
  });

  if (found.rows[0]) {
    const id = found.rows[0].id;
    await client.query(
      `UPDATE sports_events
          SET starts_at = $2,
              status = $3,
              home_score = COALESCE($4, home_score),
              away_score = COALESCE($5, away_score),
              league = COALESCE($6, league),
              stats = CASE WHEN $7::int IS NULL THEN stats
                           ELSE COALESCE(stats, '{}'::jsonb) || jsonb_build_object('minute', $7::int) END,
              metadata = COALESCE(metadata, '{}'::jsonb) || $8::jsonb,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $9`,
      [
        tenantId,
        ev.startsAt,
        ev.status,
        ev.homeScore,
        ev.awayScore,
        ev.league,
        ev.minute,
        providerMeta,
        id,
      ]
    );
    return { id, created: false };
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO sports_events
        (tenant_id, sport, league, home_team, away_team, starts_at, status,
         home_score, away_score, stats, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $10::int IS NULL THEN '{}'::jsonb
                  ELSE jsonb_build_object('minute', $10::int) END,
             $11::jsonb)
     RETURNING id`,
    [
      tenantId,
      ev.sport,
      ev.league,
      ev.homeTeam,
      ev.awayTeam,
      ev.startsAt,
      ev.status,
      ev.homeScore,
      ev.awayScore,
      ev.minute,
      providerMeta,
    ]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function ensureMarket(
  client: PoolClient,
  tenantId: string,
  eventId: string,
  marketType: string,
  label: string
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `WITH updated AS (
        UPDATE sports_markets
           SET label = $4, status = CASE WHEN status = 'settled' THEN status ELSE 'open' END,
               updated_at = now()
         WHERE tenant_id = $1 AND event_id = $2 AND market_type = $3
         RETURNING id
     ), inserted AS (
        INSERT INTO sports_markets (tenant_id, event_id, market_type, label, status)
        SELECT $1, $2, $3, $4, 'open'
         WHERE NOT EXISTS (SELECT 1 FROM updated)
         RETURNING id
     )
     SELECT id FROM updated UNION ALL SELECT id FROM inserted
     LIMIT 1`,
    [tenantId, eventId, marketType, label]
  );
  return r.rows[0].id;
}

async function upsertSelection(
  client: PoolClient,
  tenantId: string,
  marketId: string,
  label: string,
  odds: number
): Promise<void> {
  await client.query(
    `WITH updated AS (
        UPDATE sports_selections
           SET odds_decimal = $4
         WHERE tenant_id = $1 AND market_id = $2 AND label = $3
         RETURNING id
     )
     INSERT INTO sports_selections (tenant_id, market_id, label, odds_decimal)
     SELECT $1, $2, $3, $4
      WHERE NOT EXISTS (SELECT 1 FROM updated)`,
    [tenantId, marketId, label, odds]
  );
}

/** Upsert every normalized market + its selections for one event. */
export async function upsertMarkets(
  client: PoolClient,
  tenantId: string,
  eventId: string,
  markets: NormalizedMarket[]
): Promise<number> {
  let count = 0;
  for (const m of markets) {
    const marketId = await ensureMarket(client, tenantId, eventId, m.marketType, m.label);
    for (const s of m.selections) {
      await upsertSelection(client, tenantId, marketId, s.label, s.oddsDecimal);
      count += 1;
    }
  }
  return count;
}

export interface EventNeedingOdds {
  id: string;
  provider_event_id: string;
  status: string;
}

/**
 * Provider-sourced events whose odds are stale and should be refreshed this
 * run. Live events use `live_interval_seconds`; upcoming events within the
 * sync window use `prematch_interval_seconds`.
 */
export async function listEventsNeedingOdds(
  client: PoolClient,
  tenantId: string,
  opts: {
    liveIntervalSeconds: number;
    prematchIntervalSeconds: number;
    windowHours: number;
    limit: number;
    /** League names whose odds are fetched first, regardless of kickoff date. */
    priorityLeagues?: string[];
  }
): Promise<EventNeedingOdds[]> {
  const priority = opts.priorityLeagues ?? [];
  const r = await client.query<EventNeedingOdds>(
    `SELECT id,
            metadata->>'provider_event_id' AS provider_event_id,
            status
       FROM sports_events
      WHERE tenant_id = $1
        AND metadata ? 'provider_event_id'
        AND status IN ('scheduled', 'live')
        AND (
          (status = 'live' AND (
             metadata->>'odds_synced_at' IS NULL
             OR (metadata->>'odds_synced_at')::timestamptz < now() - make_interval(secs => $2)
          ))
          OR
          (status = 'scheduled'
             AND starts_at < now() + make_interval(hours => $4)
             AND starts_at > now() - interval '3 hours'
             AND (
               metadata->>'odds_synced_at' IS NULL
               OR (metadata->>'odds_synced_at')::timestamptz < now() - make_interval(secs => $3)
             ))
        )
      ORDER BY (status = 'live') DESC,
               (league = ANY($6)) DESC,   -- marquee leagues get priced first
               starts_at ASC
      LIMIT $5`,
    [
      tenantId,
      opts.liveIntervalSeconds,
      opts.prematchIntervalSeconds,
      opts.windowHours,
      opts.limit,
      priority,
    ]
  );
  return r.rows;
}

/** Stamp metadata.odds_synced_at = now() for the given events. */
export async function touchOddsSynced(
  client: PoolClient,
  tenantId: string,
  eventIds: string[]
): Promise<void> {
  if (eventIds.length === 0) return;
  await client.query(
    `UPDATE sports_events
        SET metadata = COALESCE(metadata, '{}'::jsonb)
              || jsonb_build_object('odds_synced_at', now()),
            updated_at = now()
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, eventIds]
  );
}
