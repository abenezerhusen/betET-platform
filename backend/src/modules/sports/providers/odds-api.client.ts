/**
 * Thin, isolated HTTP client for the-odds-api.com (v4).
 *
 * v4 URL structure (base URL already ends in /v4):
 *   GET /sports                          → list all sports (league keys)
 *   GET /sports/{sport_key}/odds         → prematch odds per league key
 *   GET /sports/{sport_key}/scores       → scores/results (daysFrom ≤ 3)
 *   GET /sports/{sport_key}/events       → upcoming events (no odds)
 *
 * Unlike the old odds-api.io, v4 has NO cross-sport /events, /events/live or
 * /odds/multi endpoints — every call is per LEAGUE KEY ("soccer_epl"). The
 * client therefore:
 *   - caches the /sports list and maps league keys ↔ our generic sport slugs
 *     ("football"), so callers keep passing generic sports unchanged;
 *   - remembers which sport_key each event id came from, so the per-event
 *     odds/result methods can hit the right league endpoint directly;
 *   - maps every payload into the existing OddsApiEvent shape (see types),
 *     so the sync layer keeps working unchanged.
 *
 * It holds NO credentials of its own — the caller passes a resolved
 * `{ apiUrl, apiKey }` (env default or per-tenant sealed key). The API key is
 * sent as the `apiKey` query parameter per the provider spec.
 *
 * Every call optionally increments a request-budget counter so the sync layer
 * can stay under the plan's request cap (the-odds-api free tier is ~500
 * requests/month — the budget is the only thing standing between the sync
 * loop and a blown quota, so EVERY network call goes through budget.take()).
 */

import { logger } from '../../../infrastructure/logger';
import type {
  OddsApiEvent,
  OddsApiLeagueRef,
  OddsApiOddsResponse,
  OddsApiSportRef,
} from './odds-api.types';

export interface OddsApiClientConfig {
  apiUrl: string;
  apiKey: string;
}

/** Simple rolling per-hour request budget shared across a sync run. */
export interface RequestBudget {
  /** Returns true and consumes 1 unit when a request is allowed. */
  take(): boolean;
  remaining(): number;
}

export function createHourlyBudget(maxPerHour: number): RequestBudget {
  let windowStart = Date.now();
  let used = 0;
  const WINDOW_MS = 60 * 60 * 1000;
  return {
    take() {
      const now = Date.now();
      if (now - windowStart >= WINDOW_MS) {
        windowStart = now;
        used = 0;
      }
      if (used >= maxPerHour) return false;
      used += 1;
      return true;
    },
    remaining() {
      const now = Date.now();
      if (now - windowStart >= WINDOW_MS) return maxPerHour;
      return Math.max(0, maxPerHour - used);
    },
  };
}

export interface EventsQuery {
  sport: string;
  league?: string;
  status?: string; // kept for interface compatibility; v4 odds are prematch-only
  from?: string;
  to?: string;
  limit?: number;
  skip?: number;
  /** the-odds-api bookmaker key(s), comma separated (e.g. "draftkings"). */
  bookmakers?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
/** Markets requested with the bulk per-league odds import. */
const EVENTS_ODDS_MARKETS = 'h2h,spreads,totals';
/** Markets requested by the targeted per-event odds refresh. */
const ODDS_MARKETS = 'h2h';
const REGIONS = 'eu';
/** the-odds-api caps /scores lookback at 3 days. */
const MAX_SCORES_DAYS_FROM = 3;

function baseUrl(apiUrl: string): string {
  return (apiUrl || 'https://api.the-odds-api.com/v4').replace(/\/+$/, '');
}

/** v4 rejects millisecond timestamps — "2026-08-15T14:00:00Z" only. */
function toApiDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * v4 bookmaker keys are lowercase snake_case ("draftkings", "betfair_ex_eu").
 * Legacy config values like "Bet365" are lowercased; anything that cannot be
 * a valid key is dropped so we fall back to the regions filter instead of
 * sending a filter that matches nothing.
 */
function sanitizeBookmakers(value: string | undefined): string | undefined {
  const cleaned = (value ?? '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim().replace(/[^a-z0-9_]/g, ''))
    .filter(Boolean)
    .join(',');
  return cleaned || undefined;
}

/**
 * Module-level circuit breaker for the provider's request cap.
 *
 * The in-memory RequestBudget resets whenever the process restarts, but the
 * provider's counter does NOT — so after a restart we can think we have budget
 * and get a storm of 429s. When the API tells us the quota is blown (and when
 * it resets), we park all further calls until then instead of burning the
 * reset window with doomed requests. Persists across sync runs in-process.
 */
let rateLimitedUntil = 0;

/** Parse "It resets in 40 minutes and 50 seconds" → ms from now (fallback 15m). */
function parseResetMs(body: string): number {
  const min = /(\d+)\s*minute/.exec(body);
  const sec = /(\d+)\s*second/.exec(body);
  let ms = 0;
  if (min) ms += Number(min[1]) * 60_000;
  if (sec) ms += Number(sec[1]) * 1_000;
  return ms > 0 ? ms : 15 * 60_000;
}

/* -------------------------------------------------------------------------- */
/*  sport_key ↔ generic sport mapping                                         */
/* -------------------------------------------------------------------------- */

/**
 * v4 sport groups → the generic sport slugs our DB / provider config already
 * use (see provider.config DEFAULTS.sports). Anything unmapped falls back to
 * the slugified group name, so new upstream sports still import coherently.
 */
const SPORT_BY_GROUP: Record<string, string> = {
  soccer: 'football',
  'ice hockey': 'ice-hockey',
  'american football': 'american-football',
  'mixed martial arts': 'mixed-martial-arts',
  'rugby league': 'rugby',
  'rugby union': 'rugby',
  'aussie rules': 'aussie-rules',
};

/** Fallback when the /sports cache is cold: derive the group from the key prefix. */
const SPORT_BY_KEY_PREFIX: Record<string, string> = {
  soccer: 'football',
  icehockey: 'ice-hockey',
  americanfootball: 'american-football',
  mma: 'mixed-martial-arts',
  rugbyleague: 'rugby',
  rugbyunion: 'rugby',
  aussierules: 'aussie-rules',
};

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Generic sport slug for a league key, using its /sports group when known. */
function genericSportOf(sportKey: string, group?: string): string {
  const g = (group ?? '').toLowerCase().trim();
  if (g) return SPORT_BY_GROUP[g] ?? slugify(g);
  const prefix = (sportKey.split('_')[0] ?? '').toLowerCase();
  return SPORT_BY_KEY_PREFIX[prefix] ?? prefix;
}

/**
 * Remembers which sport_key each event id belongs to (learned from every
 * payload we see). v4 has no "look up event by id" endpoint, so this is what
 * lets getOdds / getOddsMulti / getEventById hit the right league endpoint
 * without scanning every sport. Module-level so it survives across sync runs.
 */
const sportKeyByEventId = new Map<string, string>();
const SPORT_KEY_MAP_CAP = 50_000;

function learnEventSportKey(eventId: string, sportKey: string | undefined): void {
  if (!eventId || !sportKey) return;
  if (sportKeyByEventId.size >= SPORT_KEY_MAP_CAP) sportKeyByEventId.clear();
  sportKeyByEventId.set(eventId, sportKey);
}

/* -------------------------------------------------------------------------- */
/*  Cross-instance caches (clients are recreated every run)                   */
/* -------------------------------------------------------------------------- */

/** /sports list cache — the catalogue barely changes. */
const SPORTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const sportsCache = new Map<string, { at: number; sports: OddsApiSportRef[] }>();

/**
 * Short /scores cache so overlapping passes (live feed + targeted result
 * resolution of many events in the same league) don't refetch the same
 * scoreboard within a minute — each avoided call is real quota saved.
 */
const SCORES_CACHE_TTL_MS = 60 * 1000;
const scoresCache = new Map<string, { at: number; events: OddsApiEvent[] }>();

export class OddsApiClient {
  constructor(private readonly config: OddsApiClientConfig) {}

  /** Cache partition key — distinct upstream accounts get distinct caches. */
  private cacheKey(): string {
    return `${baseUrl(this.config.apiUrl)}|${this.config.apiKey.slice(-8)}`;
  }

  private async getJson<T>(
    path: string,
    params: Record<string, string | number | undefined>,
    budget?: RequestBudget
  ): Promise<T> {
    if (Date.now() < rateLimitedUntil) {
      throw new Error('odds_api_rate_limited');
    }
    if (budget && !budget.take()) {
      throw new Error('odds_api_request_budget_exhausted');
    }
    const url = new URL(`${baseUrl(this.config.apiUrl)}${path}`);
    if (this.config.apiKey) url.searchParams.set('apiKey', this.config.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && String(v).length > 0) {
        url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 429) {
          const cooldownMs = parseResetMs(text);
          rateLimitedUntil = Date.now() + cooldownMs;
          logger.warn(
            { path, cooldownMinutes: Math.ceil(cooldownMs / 60_000) },
            'odds-api: request quota exhausted — pausing calls until reset'
          );
        } else {
          logger.warn(
            { path, status: res.status, body: text.slice(0, 500) },
            'odds-api: non-2xx response'
          );
        }
        throw new Error(`odds_api_http_${res.status}`);
      }
      return text ? (JSON.parse(text) as T) : ({} as T);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  Payload mapping                                                         */
  /* ------------------------------------------------------------------------ */

  /**
   * Map one raw v4 event (odds / scores / events payload) into the shared
   * OddsApiEvent shape, filling the compatibility refs the sync layer filters
   * on. Also learns the event's sport_key for later per-event calls.
   */
  private toEvent(
    raw: Record<string, unknown>,
    group: string | undefined
  ): OddsApiEvent {
    const id = String(raw.id ?? '');
    const sportKey = typeof raw.sport_key === 'string' ? raw.sport_key : '';
    learnEventSportKey(id, sportKey);

    const commence =
      typeof raw.commence_time === 'string' ? raw.commence_time : undefined;
    const completed = raw.completed === true;
    const started =
      commence !== undefined &&
      !Number.isNaN(new Date(commence).getTime()) &&
      new Date(commence).getTime() <= Date.now();

    // v4 has no status field — derive one so mapStatus() keeps working:
    // completed → settled; past kickoff but not completed → live; else pending.
    const status = completed ? 'settled' : started ? 'live' : 'pending';

    const generic = genericSportOf(sportKey, group);
    const league: OddsApiLeagueRef = {
      name: typeof raw.sport_title === 'string' ? raw.sport_title : undefined,
      slug: sportKey || undefined,
    };

    return {
      id,
      sport_key: sportKey || undefined,
      sport_title: league.name,
      commence_time: commence,
      home_team: typeof raw.home_team === 'string' ? raw.home_team : null,
      away_team: typeof raw.away_team === 'string' ? raw.away_team : null,
      completed: raw.completed === undefined ? undefined : completed,
      scores: Array.isArray(raw.scores)
        ? (raw.scores as OddsApiEvent['scores'])
        : raw.scores === null
          ? null
          : undefined,
      last_update:
        typeof raw.last_update === 'string' ? raw.last_update : undefined,
      bookmakers: Array.isArray(raw.bookmakers)
        ? (raw.bookmakers as OddsApiEvent['bookmakers'])
        : undefined,
      sport: { slug: generic, name: group ?? generic },
      league,
      status,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  Sports catalogue                                                        */
  /* ------------------------------------------------------------------------ */

  /** GET /sports — the full league-key catalogue (cached; barely changes). */
  async getSports(budget?: RequestBudget): Promise<OddsApiSportRef[]> {
    const cached = sportsCache.get(this.cacheKey());
    if (cached && Date.now() - cached.at < SPORTS_CACHE_TTL_MS) {
      return cached.sports;
    }
    const data = await this.getJson<OddsApiSportRef[]>('/sports', {}, budget);
    const sports = Array.isArray(data) ? data : [];
    if (sports.length > 0) {
      sportsCache.set(this.cacheKey(), { at: Date.now(), sports });
    }
    return sports;
  }

  /**
   * Active league keys (with their group) for one generic sport — or for ALL
   * sports when `sport` is omitted. Accepts a full league key ("soccer_epl")
   * as well, so callers may target a single league directly. Outright-only
   * competitions are skipped (no home/away teams — nothing we can publish).
   */
  private async sportKeysFor(
    sport: string | undefined,
    budget?: RequestBudget
  ): Promise<Array<{ key: string; group?: string }>> {
    const sports = await this.getSports(budget);
    const active = sports.filter(
      (s) => s.key && s.active !== false && s.has_outrights !== true
    );
    if (!sport) return active.map((s) => ({ key: s.key as string, group: s.group }));

    const wanted = sport.toLowerCase().trim();
    // Exact league key ("soccer_epl") — use it directly.
    const exact = active.find((s) => (s.key ?? '').toLowerCase() === wanted);
    if (exact) return [{ key: exact.key as string, group: exact.group }];

    return active
      .filter((s) => genericSportOf(s.key as string, s.group) === wanted)
      .map((s) => ({ key: s.key as string, group: s.group }));
  }

  /** Kept for interface compatibility — v4 folds leagues into /sports keys. */
  async getLeagues(sport: string, budget?: RequestBudget): Promise<OddsApiLeagueRef[]> {
    const keys = await this.sportKeysFor(sport, budget);
    const sports = await this.getSports(budget);
    return keys.map((k) => ({
      name: sports.find((s) => s.key === k.key)?.title ?? k.key,
      slug: k.key,
    }));
  }

  /* ------------------------------------------------------------------------ */
  /*  Scores (shared fetch — feeds live, results and per-event lookups)       */
  /* ------------------------------------------------------------------------ */

  private async fetchScores(
    sportKey: string,
    group: string | undefined,
    daysFrom: number,
    budget?: RequestBudget
  ): Promise<OddsApiEvent[]> {
    const days = Math.min(Math.max(Math.round(daysFrom) || 1, 1), MAX_SCORES_DAYS_FROM);
    const cacheId = `${this.cacheKey()}|${sportKey}|${days}`;
    const cached = scoresCache.get(cacheId);
    if (cached && Date.now() - cached.at < SCORES_CACHE_TTL_MS) {
      return cached.events;
    }
    const data = await this.getJson<Array<Record<string, unknown>>>(
      `/sports/${encodeURIComponent(sportKey)}/scores`,
      { daysFrom: days },
      budget
    );
    const events = (Array.isArray(data) ? data : []).map((raw) =>
      this.toEvent(raw, group)
    );
    scoresCache.set(cacheId, { at: Date.now(), events });
    return events;
  }

  /**
   * GET /sports/{sport_key}/scores?daysFrom= — completed matches with final
   * scores plus in-progress matches (completed=false). THE feed for
   * auto-settlement. `sport` may be a generic sport ("football") — fanned out
   * across its active league keys — or one exact league key.
   */
  async getScores(
    sport: string,
    daysFrom: number,
    budget?: RequestBudget
  ): Promise<OddsApiEvent[]> {
    const keys = await this.sportKeysFor(sport, budget);
    const out: OddsApiEvent[] = [];
    for (const k of keys) {
      try {
        out.push(...(await this.fetchScores(k.key, k.group, daysFrom, budget)));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Quota gone — return what we already collected; retried next cycle.
        if (msg.includes('rate_limited') || msg.includes('budget') || msg.includes('429')) {
          break;
        }
        logger.warn({ err, sportKey: k.key }, 'odds-api: scores fetch failed');
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------------ */
  /*  Events                                                                  */
  /* ------------------------------------------------------------------------ */

  /**
   * Upcoming events WITH current odds for one generic sport — one
   * GET /sports/{sport_key}/odds per active league key of that sport
   * (markets h2h,spreads,totals; regions eu; decimal odds). Mapped into the
   * existing OddsApiEvent shape; `from`/`to` map onto commenceTimeFrom/To.
   */
  async getEvents(query: EventsQuery, budget?: RequestBudget): Promise<OddsApiEvent[]> {
    const keys = await this.sportKeysFor(query.league || query.sport, budget);
    const out: OddsApiEvent[] = [];
    for (const k of keys) {
      let data;
      try {
        data = await this.getJson<Array<Record<string, unknown>>>(
          `/sports/${encodeURIComponent(k.key)}/odds`,
          {
            regions: REGIONS,
            markets: EVENTS_ODDS_MARKETS,
            oddsFormat: 'decimal',
            bookmakers: sanitizeBookmakers(query.bookmakers),
            commenceTimeFrom: query.from ? toApiDate(query.from) : undefined,
            commenceTimeTo: query.to ? toApiDate(query.to) : undefined,
          },
          budget
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('rate_limited') || msg.includes('budget') || msg.includes('429')) {
          break; // quota gone — return what we have; the rest imports next cycle
        }
        logger.warn({ err, sportKey: k.key }, 'odds-api: league odds fetch failed');
        continue;
      }
      if (Array.isArray(data)) {
        out.push(...data.map((raw) => this.toEvent(raw, k.group)));
      }
    }
    // limit/skip kept for interface compatibility (v4 has no pagination).
    const skip = query.skip ?? 0;
    const limited = query.limit ? out.slice(skip, skip + query.limit) : out.slice(skip);
    return limited;
  }

  /**
   * In-play events. v4 has no dedicated live endpoint — a match is live when
   * its scoreboard row (GET /sports/{key}/scores?daysFrom=1) has
   * completed=false and commence_time in the past.
   */
  async getLiveEvents(budget?: RequestBudget): Promise<OddsApiEvent[]> {
    const keys = await this.sportKeysFor(undefined, budget);
    const now = Date.now();
    const out: OddsApiEvent[] = [];
    for (const k of keys) {
      let events: OddsApiEvent[];
      try {
        events = await this.fetchScores(k.key, k.group, 1, budget);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('rate_limited') || msg.includes('budget') || msg.includes('429')) {
          break;
        }
        continue;
      }
      for (const e of events) {
        const started =
          e.commence_time !== undefined &&
          new Date(e.commence_time).getTime() <= now;
        if (started && e.completed === false) out.push(e);
      }
    }
    return out;
  }

  /**
   * Single event with its current status + scores — used for TARGETED result
   * resolution of fixtures that carry pending bets. v4 has no per-event
   * endpoint, so the event is located on its league scoreboard (direct hit
   * when the sport_key is known from a previous payload; otherwise a scan of
   * the active league scoreboards, budget permitting). Returns null when the
   * event cannot be found upstream so the caller can flag the ticket.
   */
  async getEventById(
    eventId: string | number,
    budget?: RequestBudget
  ): Promise<OddsApiEvent | null> {
    const id = String(eventId);
    const sports = await this.getSports(budget);
    const groupOf = (key: string) => sports.find((s) => s.key === key)?.group;

    const knownKey = sportKeyByEventId.get(id);
    const keys = knownKey
      ? [{ key: knownKey, group: groupOf(knownKey) }]
      : await this.sportKeysFor(undefined, budget);

    for (const k of keys) {
      let events: OddsApiEvent[];
      try {
        events = await this.fetchScores(k.key, k.group, MAX_SCORES_DAYS_FROM, budget);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('rate_limited') || msg.includes('budget') || msg.includes('429')) {
          throw err; // let the caller stop its loop — retried next cycle
        }
        continue;
      }
      const hit = events.find((e) => e.id === id);
      if (hit) return hit;
    }
    return null;
  }

  /* ------------------------------------------------------------------------ */
  /*  Odds                                                                    */
  /* ------------------------------------------------------------------------ */

  /**
   * Odds for ONE event: GET /sports/{sport_key}/odds?eventIds={id}. Requires
   * the event's sport_key (learned from any previous payload); without it
   * there is nothing to call in v4, so the method no-ops with null and the
   * event is picked up by the next bulk import instead.
   */
  async getOdds(
    eventId: string | number,
    bookmakers: string,
    budget?: RequestBudget
  ): Promise<OddsApiOddsResponse | null> {
    const rows = await this.getOddsMulti([eventId], bookmakers, budget);
    return rows[0] ?? null;
  }

  /**
   * Odds for a batch of events, grouped by their (learned) sport_key —
   * GET /sports/{sport_key}/odds?eventIds=…&bookmakers=…&markets=h2h per
   * distinct league. Ids whose league key is not known yet are skipped (they
   * get learned by the next events import and priced on the following pass).
   */
  /**
   * Prime the in-memory event→sport_key map from a persisted value (learned
   * previously and stored on the event). Lets the per-event/on-demand odds
   * paths (getOdds / getOddsMulti) work immediately after a process restart —
   * before any fresh events import has repopulated the map.
   */
  primeSportKey(eventId: string | number, sportKey: string | null | undefined): void {
    learnEventSportKey(String(eventId), sportKey ?? undefined);
  }

  /**
   * Odds for a WHOLE league in ONE request: GET /sports/{sport_key}/odds.
   * Returns every upcoming fixture (within the optional commence window) with
   * its h2h prices — the coverage-complete primitive the odds phase iterates
   * over per league key. Also learns each event's sport_key for later
   * per-event lookups. Never paginates (v4 has none).
   */
  async getLeagueOdds(
    sportKey: string,
    bookmakers: string,
    opts: { from?: string; to?: string },
    budget?: RequestBudget
  ): Promise<OddsApiOddsResponse[]> {
    const sports = await this.getSports(budget);
    const group = sports.find((s) => s.key === sportKey)?.group;
    const data = await this.getJson<Array<Record<string, unknown>>>(
      `/sports/${encodeURIComponent(sportKey)}/odds`,
      {
        regions: REGIONS,
        markets: ODDS_MARKETS,
        oddsFormat: 'decimal',
        bookmakers: sanitizeBookmakers(bookmakers),
        commenceTimeFrom: opts.from ? toApiDate(opts.from) : undefined,
        commenceTimeTo: opts.to ? toApiDate(opts.to) : undefined,
      },
      budget
    );
    return (Array.isArray(data) ? data : []).map((raw) => this.toEvent(raw, group));
  }

  async getOddsMulti(
    eventIds: Array<string | number>,
    bookmakers: string,
    budget?: RequestBudget
  ): Promise<OddsApiOddsResponse[]> {
    if (eventIds.length === 0) return [];

    const byKey = new Map<string, string[]>();
    let unknown = 0;
    for (const raw of eventIds) {
      const id = String(raw);
      const key = sportKeyByEventId.get(id);
      if (!key) {
        unknown += 1;
        continue;
      }
      const list = byKey.get(key) ?? [];
      list.push(id);
      byKey.set(key, list);
    }
    if (unknown > 0) {
      logger.debug(
        { unknown },
        'odds-api: event ids without a learned sport_key skipped this pass'
      );
    }
    if (byKey.size === 0) return [];

    const sports = await this.getSports(budget);
    const out: OddsApiOddsResponse[] = [];
    for (const [sportKey, ids] of byKey) {
      const group = sports.find((s) => s.key === sportKey)?.group;
      let data;
      try {
        data = await this.getJson<Array<Record<string, unknown>>>(
          `/sports/${encodeURIComponent(sportKey)}/odds`,
          {
            eventIds: ids.join(','),
            bookmakers: sanitizeBookmakers(bookmakers),
            regions: REGIONS,
            markets: ODDS_MARKETS,
            oddsFormat: 'decimal',
          },
          budget
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('rate_limited') || msg.includes('budget') || msg.includes('429')) {
          break; // quota gone — return what we have
        }
        logger.warn({ err, sportKey }, 'odds-api: odds fetch failed');
        continue;
      }
      if (Array.isArray(data)) {
        out.push(...data.map((raw) => this.toEvent(raw, group)));
      }
    }
    return out;
  }
}
