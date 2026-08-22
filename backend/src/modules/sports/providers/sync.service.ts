/**
 * Sync orchestrator — the bridge between Odds-API.io and the EXISTING
 * sports_events / sports_markets / sports_selections tables.
 *
 * Design goals:
 *  - HTTP calls happen OUTSIDE database transactions; DB writes use short
 *    per-batch transactions (same discipline as the other workers).
 *  - Stays within the plan's hourly request budget (see RequestBudget).
 *  - Fully idempotent — re-running adopts existing rows instead of duplicating.
 *  - Completely inert unless a caller invokes it (the worker only does so when
 *    DATA_PROVIDER=odds_api + provider enabled + key present).
 *
 * Three phases:
 *  - results:  fetch finished/cancelled fixtures → record final scores → grade
 *    → auto-settle tickets (wallet-crediting). Scheduled INDEPENDENTLY of the
 *    other phases so settlement never waits on (or gets starved by) the
 *    fixture/odds import cadence.
 *  - prematch: GET /events per sport (upcoming within the window) → upsert
 *    events, then refresh odds for events whose prices are stale.
 *  - live:     GET /events/live (one request, all sports) → upsert live events
 *    (score + minute + status), then refresh their odds more frequently.
 */

import { logger } from '../../../infrastructure/logger';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  OddsApiClient,
  createHourlyBudget,
  type RequestBudget,
} from './odds-api.client';
import { normalizeEvent, normalizeOdds } from './odds-api.normalizer';
import { resolveConfig, type ResolvedProviderConfig } from './provider.config';
import { settleFinishedResults } from './results.service';
import * as repo from './provider.repository';
import type { OddsApiEvent } from './odds-api.types';

export type SyncPhase = 'prematch' | 'live' | 'results';

export interface SyncResult {
  phase: SyncPhase;
  eventsUpserted: number;
  oddsUpserted: number;
  requestsRemaining: number;
  /** Finished events whose final score was recorded this cycle. */
  resultsFinalized?: number;
  /** Tickets auto-settled (won/lost) from real results this cycle. */
  ticketsSettled?: number;
  /** Events cancelled/abandoned this cycle (tickets voided + refunded). */
  eventsCancelled?: number;
  skipped?: string;
}

const EVENTS_PER_SPORT = 5000; // provider page ceiling
const MAX_PAGES_PER_SPORT = 4; // paginate dense sports (football) weeks ahead
const ODDS_MULTI_CHUNK = 10; // /odds/multi ceiling (counts as 1 request)

// Re-importing 27k fixtures every 15 min starves the tight request budget and
// leaves nothing for ODDS. Fixtures barely change, so refresh the catalogue at
// most this often; the freed budget goes to pricing (odds) instead.
const EVENTS_IMPORT_INTERVAL_MS = 45 * 60 * 1000; // 45 min
const lastEventsImport = new Map<string, number>();

/**
 * Leagues users actually browse (the "Top Leagues" rail). Their odds are
 * fetched FIRST regardless of kickoff date, so marquee fixtures (e.g. the EPL
 * opener weeks out) show real prices instead of placeholder defaults.
 */
// Exact provider league names (verified against the feed — note "LaLiga" has
// no space and Portugal's top flight is "Liga Portugal").
const PRIORITY_LEAGUES = [
  'England - Premier League',
  'Spain - LaLiga',
  'Italy - Serie A',
  'Germany - Bundesliga',
  'France - Ligue 1',
  'Portugal - Liga Portugal',
  'Netherlands - Eredivisie',
  'England - Championship',
  'Spain - LaLiga 2',
  'Germany - 2. Bundesliga',
  'Italy - Serie B',
  'France - Ligue 2',
  'International Clubs - UEFA Champions League, Qualification',
  'International Clubs - UEFA Europa League, Qualification',
];

/**
 * Per-tenant request budget that PERSISTS across sync runs within this process
 * so the plan's hourly cap is enforced across every prematch + live cycle — not
 * just within one run. Recreated only when the configured cap changes.
 */
const tenantBudgets = new Map<string, { budget: RequestBudget; max: number }>();

function getTenantBudget(tenantId: string, maxPerHour: number): RequestBudget {
  const existing = tenantBudgets.get(tenantId);
  if (existing && existing.max === maxPerHour) return existing.budget;
  const budget = createHourlyBudget(maxPerHour);
  tenantBudgets.set(tenantId, { budget, max: maxPerHour });
  return budget;
}

/** Filter raw events to the configured league allow-list (by slug or name). */
function inLeagueAllowlist(
  event: OddsApiEvent,
  leagues: string[] | null
): boolean {
  if (!leagues || leagues.length === 0) return true;
  const slug = (event.league?.slug ?? '').toLowerCase();
  const name = (event.league?.name ?? '').toLowerCase();
  return leagues.some((l) => {
    const t = l.toLowerCase();
    return t === slug || t === name;
  });
}

/** Upsert a batch of provider events inside one short transaction. */
async function upsertEventBatch(
  tenantId: string,
  events: OddsApiEvent[],
  leagues: string[] | null
): Promise<number> {
  const normalized = events
    .filter((e) => inLeagueAllowlist(e, leagues))
    .map(normalizeEvent)
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (normalized.length === 0) return 0;

  // Single bulk INSERT ... ON CONFLICT — handles thousands of fixtures fast.
  return withTenantClient({ tenantId }, (client) =>
    repo.upsertEvents(client, tenantId, normalized)
  );
}

/**
 * Effective priority leagues for odds fetching: the admin-configured Top
 * Leagues (Game Picks → Top Leagues) when present, merged with the hardcoded
 * defaults as a fallback so unconfigured tenants keep the previous behaviour.
 */
async function getPriorityLeagues(tenantId: string): Promise<string[]> {
  try {
    const rows = await withTenantClient({ tenantId }, (c) =>
      c.query<{ league: string }>(
        `SELECT league FROM top_leagues
          WHERE tenant_id = $1 AND enabled = true
          ORDER BY priority ASC`,
        [tenantId]
      )
    );
    const configured = rows.rows.map((r) => r.league);
    return configured.length > 0
      ? [...new Set([...configured, ...PRIORITY_LEAGUES])]
      : PRIORITY_LEAGUES;
  } catch {
    return PRIORITY_LEAGUES;
  }
}

/**
 * Refresh odds for provider events whose prices are stale — LEAGUE-KEY driven.
 *
 * the-odds-api (v4) has no cross-league odds endpoint: odds are fetched per
 * league key ("soccer_epl") via GET /sports/{key}/odds, and ONE such call
 * returns every upcoming fixture in that league. So instead of a per-event
 * fan-out (which skipped any event whose sport_key wasn't in the in-memory
 * map — the bug that left ~99% of fixtures unpriced), we enumerate every
 * DISTINCT league key that has matches needing odds and price it in one call.
 *
 * Budget-aware: leagues are ordered live/priority/soonest first, and we stop
 * the moment the request budget is exhausted — the remainder is picked up on
 * the next sync cycle.
 */
async function syncOdds(
  tenantId: string,
  cfg: ResolvedProviderConfig,
  client: OddsApiClient,
  budget: RequestBudget
): Promise<number> {
  const priorityLeagues = await getPriorityLeagues(tenantId);

  // Every league key with upcoming/live matches that need pricing this cycle.
  const leagueKeys = await withTenantClient({ tenantId }, (c) =>
    repo.listLeagueKeysNeedingOdds(c, tenantId, {
      liveIntervalSeconds: cfg.liveIntervalSeconds,
      prematchIntervalSeconds: cfg.prematchIntervalSeconds,
      windowHours: cfg.syncWindowHours,
      priorityLeagues,
    })
  );
  if (leagueKeys.length === 0) return 0;

  // Commence window: include matches that started up to 3h ago (live) through
  // the end of the sync window (mirrors listEventsNeedingOdds' bounds).
  const fromIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(
    Date.now() + cfg.syncWindowHours * 60 * 60 * 1000
  ).toISOString();

  let oddsUpserted = 0;
  for (const { provider_sport_key: sportKey } of leagueKeys) {
    if (budget.remaining() <= 0) break; // budget spent — resume next cycle
    if (!sportKey) continue;

    let responses;
    try {
      responses = await client.getLeagueOdds(
        sportKey,
        cfg.bookmaker,
        { from: fromIso, to: toIso },
        budget
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('rate_limited') ||
        msg.includes('budget') ||
        msg.includes('429')
      ) {
        break; // quota gone — the rest is priced next cycle
      }
      logger.warn({ err, tenantId, sportKey }, 'odds-sync: league odds fetch failed');
      continue;
    }
    if (responses.length === 0) continue;

    // Attach each returned fixture's odds to our matching event row.
    const idByProvider = await withTenantClient({ tenantId }, (c) =>
      repo.getEventIdsByProviderIds(
        c,
        tenantId,
        responses.map((r) => String(r.id))
      )
    );
    if (idByProvider.size === 0) continue;

    const stamped: string[] = [];
    await withTenantClient({ tenantId }, async (c) => {
      for (const resp of responses) {
        const ourId = idByProvider.get(String(resp.id));
        if (!ourId) continue;
        const markets = normalizeOdds(resp, cfg.bookmaker);
        if (markets.length > 0) {
          oddsUpserted += await repo.upsertMarkets(c, tenantId, ourId, markets);
        }
        stamped.push(ourId);
      }
      // Stamp every matched fixture (even ones with no usable markets) so we
      // don't re-hammer the same league every tick within the freshness window.
      await repo.touchOddsSynced(c, tenantId, stamped);
    });
  }
  return oddsUpserted;
}

/**
 * ON-DEMAND pricing for a SINGLE event, used when a user opens a match detail.
 *
 * Guarantees the clicked fixture shows REAL live markets/odds straight from the
 * API even if the background worker hasn't reached it yet — the fix for "many
 * matches show identical placeholder odds". Cheap and self-limiting:
 *   - no-op unless the provider is active and the event is provider-sourced,
 *   - skips when the event's odds were refreshed within the freshness window,
 *   - one /odds request (guarded by the client's global rate-limit breaker),
 *   - never throws (best-effort; the caller still returns whatever is stored).
 *
 * Returns true when fresh odds were written this call.
 */
export async function ensureEventOdds(
  tenantId: string,
  eventId: string
): Promise<boolean> {
  try {
    const row = await withTenantClient({ tenantId }, (c) =>
      repo.getConfig(c, tenantId)
    );
    const cfg = resolveConfig(row);
    if (!cfg.active) return false;

    const ev = await withTenantClient({ tenantId }, (c) =>
      c.query<{
        pid: string | null;
        sport_key: string | null;
        status: string;
        starts_at: Date;
        synced_at: string | null;
      }>(
        `SELECT metadata->>'provider_event_id' AS pid,
                metadata->>'provider_sport_key' AS sport_key,
                status,
                starts_at,
                metadata->>'odds_synced_at' AS synced_at
           FROM sports_events
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [eventId, tenantId]
      )
    );
    const e = ev.rows[0];
    if (!e || !e.pid) return false;
    // Only price events that can still be bet on.
    if (e.status !== 'scheduled' && e.status !== 'live') return false;

    // Freshness: live prices move fast, prematch far less so.
    const freshnessMs =
      (e.status === 'live'
        ? cfg.liveIntervalSeconds
        : cfg.prematchIntervalSeconds) * 1000;
    if (e.synced_at) {
      const age = Date.now() - new Date(e.synced_at).getTime();
      if (age < freshnessMs) return false; // still fresh — use what we have
    }

    const client = new OddsApiClient({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey });
    // Prime the league key from the persisted value so the per-event odds call
    // works even right after a restart (before any fresh events import).
    client.primeSportKey(e.pid, e.sport_key);
    const budget = getTenantBudget(tenantId, cfg.maxRequestsPerHour);
    const resp = await client.getOdds(e.pid, cfg.bookmaker, budget);
    if (!resp) return false;
    const markets = normalizeOdds(resp, cfg.bookmaker);

    await withTenantClient({ tenantId }, async (c) => {
      if (markets.length > 0) {
        await repo.upsertMarkets(c, tenantId, eventId, markets);
      }
      await repo.touchOddsSynced(c, tenantId, [eventId]);
    });
    return markets.length > 0;
  } catch (err) {
    // Rate-limited / upstream hiccup — never break the detail response.
    logger.warn({ err, tenantId, eventId }, 'ensureEventOdds: on-demand price failed');
    return false;
  }
}

/**
 * ON-DEMAND pricing for a whole LEAGUE, used when a user opens a league board.
 *
 * Prices up to one /odds/multi chunk (10 fixtures = ONE provider request) of
 * that league's soonest UNPRICED fixtures so the board shows real odds right
 * away instead of appearing empty while the background worker catches up (the
 * fix for under-covered leagues like Australia having events but no odds).
 *
 * Cheap and self-limiting:
 *   - no-op unless the provider is active,
 *   - only touches fixtures whose odds are missing/stale (fresh ones cost 0),
 *   - a single request (guarded by the shared per-tenant hourly budget),
 *   - never throws — the caller still returns whatever is stored.
 *
 * Returns the number of selections written this call.
 */
export async function ensureLeagueOdds(
  tenantId: string,
  league: string
): Promise<number> {
  try {
    const row = await withTenantClient({ tenantId }, (c) =>
      repo.getConfig(c, tenantId)
    );
    const cfg = resolveConfig(row);
    if (!cfg.active) return 0;

    const due = await withTenantClient({ tenantId }, (c) =>
      repo.listLeagueEventsNeedingOdds(c, tenantId, league, {
        liveIntervalSeconds: cfg.liveIntervalSeconds,
        prematchIntervalSeconds: cfg.prematchIntervalSeconds,
        windowHours: cfg.syncWindowHours,
        limit: ODDS_MULTI_CHUNK, // one request prices up to 10 fixtures
      })
    );
    if (due.length === 0) return 0;

    const budget = getTenantBudget(tenantId, cfg.maxRequestsPerHour);
    if (budget.remaining() <= 0) return 0;

    const client = new OddsApiClient({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey });
    const idByProvider = new Map<string, string>();
    for (const d of due) {
      idByProvider.set(String(d.provider_event_id), d.id);
      // Prime league keys so getOddsMulti can group these ids right after a
      // restart (before an events import has repopulated the in-memory map).
      client.primeSportKey(d.provider_event_id, d.provider_sport_key);
    }

    let oddsUpserted = 0;
    const responses = await client.getOddsMulti(
      due.map((d) => d.provider_event_id),
      cfg.bookmaker,
      budget
    );
    await withTenantClient({ tenantId }, async (c) => {
      for (const resp of responses) {
        const ourId = idByProvider.get(String(resp.id));
        if (!ourId) continue;
        const markets = normalizeOdds(resp, cfg.bookmaker);
        if (markets.length > 0) {
          oddsUpserted += await repo.upsertMarkets(c, tenantId, ourId, markets);
        }
      }
      // Stamp every requested fixture (even empty ones) so we don't re-hammer
      // them on the next league open within the freshness window.
      await repo.touchOddsSynced(
        c,
        tenantId,
        due.map((d) => d.id)
      );
    });
    return oddsUpserted;
  } catch (err) {
    logger.warn({ err, tenantId, league }, 'ensureLeagueOdds: on-demand league price failed');
    return 0;
  }
}

/**
 * Run one sync cycle for a tenant. Loads the config, and — when active (or when
 * `force` is set for a manual admin test) — pulls events + odds and records the
 * runtime state. Never throws to the caller; failures are recorded on the row.
 */
export async function runSync(
  tenantId: string,
  opts: { phase: SyncPhase; force?: boolean }
): Promise<SyncResult> {
  const row = await withTenantClient({ tenantId }, (c) =>
    repo.getConfig(c, tenantId)
  );
  const cfg = resolveConfig(row);

  // The worker only calls us when active; `force` lets the admin "Sync now"
  // button pull data even while the env master switch is still `mock`, as long
  // as the provider is enabled and a key is present.
  const canRun = opts.force
    ? cfg.enabled && cfg.apiKey.length > 0
    : cfg.active;
  if (!canRun) {
    return {
      phase: opts.phase,
      eventsUpserted: 0,
      oddsUpserted: 0,
      requestsRemaining: 0,
      skipped: cfg.apiKey.length === 0 ? 'no_api_key' : 'inactive',
    };
  }

  const client = new OddsApiClient({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey });
  const budget = getTenantBudget(tenantId, cfg.maxRequestsPerHour);

  await withTenantClient({ tenantId }, (c) =>
    repo.setSyncState(c, tenantId, { status: 'syncing', lastRunAt: true, lastError: null })
  );

  let eventsUpserted = 0;
  let oddsUpserted = 0;
  let resultsFinalized = 0;
  let ticketsSettled = 0;
  let eventsCancelled = 0;
  try {
    // ---- Phase: results + auto-settlement ----------------------------------
    // Scheduled on its OWN interval by the worker (and run first by the admin
    // Sync Now), so recording final scores + settling real tickets never
    // competes with — or waits for — the fixture/odds import cadence. Cheap
    // no-op when no sport has past-kickoff open fixtures to finalize.
    if (opts.phase === 'results') {
      const r = await settleFinishedResults(tenantId, client, budget, cfg);
      resultsFinalized = r.finalized;
      ticketsSettled = r.settled;
      eventsCancelled = r.cancelled;

      await withTenantClient({ tenantId }, (c) =>
        repo.setSyncState(c, tenantId, {
          status: 'ok',
          lastSuccessAt: true,
          lastError: null,
          lastResultsSyncAt: true,
          resultsFinalizedDelta: resultsFinalized,
          ticketsSettledDelta: ticketsSettled,
        })
      );

      return {
        phase: opts.phase,
        eventsUpserted: 0,
        oddsUpserted: 0,
        requestsRemaining: budget.remaining(),
        resultsFinalized,
        ticketsSettled,
        eventsCancelled,
      };
    }

    // ---- Phase: events -----------------------------------------------------
    if (opts.phase === 'live') {
      // One request returns all live events across sports.
      const live = await client.getLiveEvents(budget);
      const filtered = live.filter((e) =>
        cfg.sports.includes((e.sport?.slug ?? e.sport?.name ?? '').toLowerCase())
      );
      eventsUpserted += await upsertEventBatch(tenantId, filtered, cfg.leagues);
    } else if (
      Date.now() - (lastEventsImport.get(tenantId) ?? 0) >=
      EVENTS_IMPORT_INTERVAL_MS
    ) {
      lastEventsImport.set(tenantId, Date.now());
      const fromIso = new Date().toISOString();
      const toIso = new Date(
        Date.now() + cfg.syncWindowHours * 60 * 60 * 1000
      ).toISOString();
      for (const sport of cfg.sports) {
        // Paginate: dense sports (football, baseball) return a full page and
        // truncate the window at ~2 weeks. Walk pages with `skip` until a
        // short page (no more data), the page cap, or the budget is hit — so
        // weeks-ahead majors (e.g. the Premier League opener) get imported.
        for (let page = 0; page < MAX_PAGES_PER_SPORT; page += 1) {
          if (budget.remaining() <= 0) break;
          let events;
          try {
            events = await client.getEvents(
              {
                sport,
                status: 'pending,live',
                from: fromIso,
                to: toIso,
                limit: EVENTS_PER_SPORT,
                skip: page * EVENTS_PER_SPORT,
              },
              budget
            );
          } catch (err) {
            logger.warn({ err, tenantId, sport, page }, 'odds-sync: getEvents failed');
            break;
          }
          if (events.length === 0) break;
          eventsUpserted += await upsertEventBatch(tenantId, events, cfg.leagues);
          if (events.length < EVENTS_PER_SPORT) break; // last page reached
        }
      }
    }

    // ---- Phase: odds -------------------------------------------------------
    oddsUpserted = await syncOdds(tenantId, cfg, client, budget);

    await withTenantClient({ tenantId }, (c) =>
      repo.setSyncState(c, tenantId, {
        status: 'ok',
        lastSuccessAt: true,
        lastEventsSyncAt: true,
        lastError: null,
        eventsSyncedDelta: eventsUpserted,
        oddsSyncedDelta: oddsUpserted,
      })
    );

    return {
      phase: opts.phase,
      eventsUpserted,
      oddsUpserted,
      requestsRemaining: budget.remaining(),
      resultsFinalized,
      ticketsSettled,
      eventsCancelled,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync_failed';
    logger.error({ err, tenantId, phase: opts.phase }, 'odds-sync: run failed');
    await withTenantClient({ tenantId }, (c) =>
      repo.setSyncState(c, tenantId, { status: 'error', lastError: message })
    ).catch(() => {});
    return {
      phase: opts.phase,
      eventsUpserted,
      oddsUpserted,
      requestsRemaining: budget.remaining(),
      skipped: message,
    };
  }
}

/** Lightweight connection test used by the admin "Test Connection" button. */
export async function testConnection(
  apiUrl: string,
  apiKey: string
): Promise<{ ok: boolean; sports: number; error: string | null }> {
  try {
    const client = new OddsApiClient({ apiUrl, apiKey });
    const sports = await client.getSports();
    return { ok: true, sports: sports.length, error: null };
  } catch (err) {
    return {
      ok: false,
      sports: 0,
      error: err instanceof Error ? err.message : 'connection_failed',
    };
  }
}
