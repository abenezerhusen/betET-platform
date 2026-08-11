/**
 * Thin, isolated HTTP client for Odds-API.io (v3).
 *
 * Responsibilities: connect, fetch sports / leagues / events / live events /
 * odds. It holds NO credentials of its own — the caller passes a resolved
 * `{ apiUrl, apiKey }` (env default or per-tenant sealed key). The API key is
 * sent as the `apiKey` query parameter per the provider spec.
 *
 * Every call optionally increments a request-budget counter so the sync layer
 * can stay under the plan's hourly request cap.
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
  status?: string; // e.g. "pending,live"
  from?: string;
  to?: string;
  limit?: number;
  skip?: number;
}

const REQUEST_TIMEOUT_MS = 15_000;

function baseUrl(apiUrl: string): string {
  return (apiUrl || 'https://api.odds-api.io/v3').replace(/\/+$/, '');
}

/**
 * Module-level circuit breaker for the provider's hourly cap.
 *
 * The in-memory RequestBudget resets whenever the process restarts, but the
 * provider's rolling-hour counter does NOT — so after a restart we can think we
 * have budget and get a storm of 429s. When the API tells us the quota is blown
 * (and when it resets), we park all further calls until then instead of burning
 * the reset window with doomed requests. Persists across sync runs in-process.
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

export class OddsApiClient {
  constructor(private readonly config: OddsApiClientConfig) {}

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
            'odds-api: hourly quota exhausted — pausing calls until reset'
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

  /** GET /sports — used by the connection test (no key required upstream). */
  async getSports(budget?: RequestBudget): Promise<OddsApiSportRef[]> {
    const data = await this.getJson<OddsApiSportRef[]>('/sports', {}, budget);
    return Array.isArray(data) ? data : [];
  }

  /** GET /leagues?sport= */
  async getLeagues(sport: string, budget?: RequestBudget): Promise<OddsApiLeagueRef[]> {
    const data = await this.getJson<OddsApiLeagueRef[]>('/leagues', { sport }, budget);
    return Array.isArray(data) ? data : [];
  }

  /** GET /events?sport=…&status=… */
  async getEvents(query: EventsQuery, budget?: RequestBudget): Promise<OddsApiEvent[]> {
    const data = await this.getJson<OddsApiEvent[]>(
      '/events',
      {
        sport: query.sport,
        league: query.league,
        status: query.status,
        from: query.from,
        to: query.to,
        limit: query.limit,
        skip: query.skip,
      },
      budget
    );
    return Array.isArray(data) ? data : [];
  }

  /** GET /events/live */
  async getLiveEvents(budget?: RequestBudget): Promise<OddsApiEvent[]> {
    const data = await this.getJson<OddsApiEvent[]>('/events/live', {}, budget);
    return Array.isArray(data) ? data : [];
  }

  /**
   * GET /events/{id} — single event with its current status + scores.
   * Used for TARGETED result resolution of fixtures that carry pending bets
   * but fell outside the windowed settled feed. Returns null on 404 (event
   * unknown/removed upstream) so the caller can flag the ticket for review.
   */
  async getEventById(
    eventId: string | number,
    budget?: RequestBudget
  ): Promise<OddsApiEvent | null> {
    try {
      const data = await this.getJson<OddsApiEvent>(`/events/${eventId}`, {}, budget);
      return data && typeof data === 'object' && data.id != null ? data : null;
    } catch (err) {
      if (err instanceof Error && err.message === 'odds_api_http_404') return null;
      throw err;
    }
  }

  /** GET /odds?eventId=&bookmakers= */
  async getOdds(
    eventId: string | number,
    bookmakers: string,
    budget?: RequestBudget
  ): Promise<OddsApiOddsResponse | null> {
    const data = await this.getJson<OddsApiOddsResponse>(
      '/odds',
      { eventId, bookmakers },
      budget
    );
    return data && typeof data === 'object' ? data : null;
  }

  /** GET /odds/multi?eventIds=&bookmakers= — up to 10 events, counts as 1 req. */
  async getOddsMulti(
    eventIds: Array<string | number>,
    bookmakers: string,
    budget?: RequestBudget
  ): Promise<OddsApiOddsResponse[]> {
    if (eventIds.length === 0) return [];
    const data = await this.getJson<OddsApiOddsResponse[]>(
      '/odds/multi',
      { eventIds: eventIds.join(','), bookmakers },
      budget
    );
    return Array.isArray(data) ? data : [];
  }
}
