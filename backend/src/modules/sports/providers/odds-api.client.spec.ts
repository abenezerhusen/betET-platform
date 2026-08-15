/**
 * the-odds-api.com v4 client tests — verify the new URL structure, query
 * params, payload → OddsApiEvent mapping and budget enforcement against
 * recorded v4 response shapes (fetch is stubbed; no network).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OddsApiClient, createHourlyBudget } from './odds-api.client';

/** Recorded /v4/sports catalogue (subset). */
const SPORTS = [
  { key: 'soccer_epl', group: 'Soccer', title: 'EPL', active: true, has_outrights: false },
  {
    key: 'soccer_uefa_champs_league',
    group: 'Soccer',
    title: 'UEFA Champions League',
    active: true,
    has_outrights: false,
  },
  { key: 'basketball_nba', group: 'Basketball', title: 'NBA', active: true, has_outrights: false },
  {
    key: 'soccer_fifa_world_cup_winner',
    group: 'Soccer',
    title: 'FIFA World Cup Winner',
    active: true,
    has_outrights: true, // outright-only → must be skipped
  },
  { key: 'tennis_atp_wimbledon', group: 'Tennis', title: 'Wimbledon', active: false },
];

/** Recorded /v4/sports/soccer_epl/odds item (the documented shape). */
const EPL_ODDS_EVENT = {
  id: 'abc123',
  sport_key: 'soccer_epl',
  sport_title: 'EPL',
  commence_time: '2099-01-01T14:00:00Z',
  home_team: 'Arsenal',
  away_team: 'Chelsea',
  bookmakers: [
    {
      key: 'draftkings',
      title: 'DraftKings',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Arsenal', price: 2.1 },
            { name: 'Chelsea', price: 3.4 },
            { name: 'Draw', price: 3.2 },
          ],
        },
      ],
    },
  ],
};

/** Recorded /v4/sports/soccer_epl/scores items. */
const EPL_SCORES = [
  {
    id: 'abc123',
    sport_key: 'soccer_epl',
    sport_title: 'EPL',
    commence_time: '2026-08-07T18:00:00Z',
    completed: true,
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    scores: [
      { name: 'Arsenal', score: '2' },
      { name: 'Chelsea', score: '1' },
    ],
    last_update: '2026-08-07T19:55:00Z',
  },
  {
    id: 'inplay1',
    sport_key: 'soccer_epl',
    sport_title: 'EPL',
    commence_time: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    completed: false,
    home_team: 'Fulham',
    away_team: 'Everton',
    scores: [
      { name: 'Fulham', score: '1' },
      { name: 'Everton', score: '0' },
    ],
    last_update: new Date().toISOString(),
  },
  {
    id: 'upcoming1',
    sport_key: 'soccer_epl',
    sport_title: 'EPL',
    commence_time: '2099-01-02T14:00:00Z',
    completed: false,
    home_team: 'Spurs',
    away_team: 'Brentford',
    scores: null,
    last_update: null,
  },
];

let requestedUrls: string[] = [];

function stubFetch(handler?: (url: URL) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(String(input));
      requestedUrls.push(url.pathname + url.search);
      let body: unknown = [];
      if (handler) {
        body = handler(url);
      } else if (url.pathname.endsWith('/sports')) {
        body = SPORTS;
      } else if (url.pathname.includes('/scores')) {
        body = url.pathname.includes('soccer_epl') ? EPL_SCORES : [];
      } else if (url.pathname.includes('/odds')) {
        body = url.pathname.includes('soccer_epl') ? [EPL_ODDS_EVENT] : [];
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    })
  );
}

/** Fresh client per test with a UNIQUE key so module-level caches never leak. */
let keySeq = 0;
function makeClient(): OddsApiClient {
  keySeq += 1;
  return new OddsApiClient({
    apiUrl: 'https://api.the-odds-api.com/v4',
    apiKey: `test-key-${Date.now()}-${keySeq}`,
  });
}

beforeEach(() => {
  requestedUrls = [];
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OddsApiClient (the-odds-api v4)', () => {
  it('getSports calls /sports and caches the catalogue', async () => {
    const client = makeClient();
    const sports = await client.getSports();
    expect(requestedUrls[0]).toMatch(/^\/v4\/sports\?apiKey=/);
    expect(sports).toHaveLength(SPORTS.length);
    await client.getSports();
    expect(requestedUrls).toHaveLength(1); // cached — no second request
  });

  it('getEvents fans out per active league key of the sport with the v4 odds params', async () => {
    const client = makeClient();
    const events = await client.getEvents({
      sport: 'football',
      from: '2026-08-15T00:00:00.000Z',
      to: '2026-08-20T00:00:00.000Z',
    });

    const oddsCalls = requestedUrls.filter((u) => u.includes('/odds?'));
    // Only the two active non-outright soccer keys — NBA, inactive tennis and
    // the outright competition are skipped.
    expect(oddsCalls).toHaveLength(2);
    expect(oddsCalls[0]).toContain('/v4/sports/soccer_epl/odds?');
    expect(oddsCalls[1]).toContain('/v4/sports/soccer_uefa_champs_league/odds?');
    expect(oddsCalls[0]).toContain('regions=eu');
    expect(oddsCalls[0]).toContain('markets=h2h%2Cspreads%2Ctotals');
    expect(oddsCalls[0]).toContain('oddsFormat=decimal');
    // v4 rejects millisecond timestamps.
    expect(oddsCalls[0]).toContain('commenceTimeFrom=2026-08-15T00%3A00%3A00Z');
    expect(oddsCalls[0]).toContain('commenceTimeTo=2026-08-20T00%3A00%3A00Z');

    // Mapped into the existing OddsApiEvent shape.
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.id).toBe('abc123');
    expect(e.home_team).toBe('Arsenal');
    expect(e.away_team).toBe('Chelsea');
    expect(e.sport?.slug).toBe('football'); // generic slug for the sync filter
    expect(e.league?.name).toBe('EPL');
    expect(e.league?.slug).toBe('soccer_epl');
    expect(e.status).toBe('pending'); // future kickoff, not completed
    expect(e.bookmakers?.[0]?.markets?.[0]?.key).toBe('h2h');
  });

  it('getScores calls /scores?daysFrom and maps completed results', async () => {
    const client = makeClient();
    const scores = await client.getScores('football', 2);
    const scoreCalls = requestedUrls.filter((u) => u.includes('/scores?'));
    expect(scoreCalls[0]).toContain('/v4/sports/soccer_epl/scores?');
    expect(scoreCalls[0]).toContain('daysFrom=2');

    const finished = scores.find((s) => s.id === 'abc123')!;
    expect(finished.completed).toBe(true);
    expect(finished.status).toBe('settled'); // → mapStatus() = finished
    expect(finished.scores).toEqual(EPL_SCORES[0].scores);
  });

  it('getScores clamps daysFrom to the provider maximum of 3', async () => {
    const client = makeClient();
    await client.getScores('football', 45);
    const scoreCall = requestedUrls.find((u) => u.includes('/scores?'))!;
    expect(scoreCall).toContain('daysFrom=3');
  });

  it('getLiveEvents returns only past-kickoff, not-completed scoreboard rows', async () => {
    const client = makeClient();
    const live = await client.getLiveEvents();
    expect(live.map((e) => e.id)).toEqual(['inplay1']);
    expect(live[0].status).toBe('live');
  });

  it('getEventById finds an event on its (learned) league scoreboard', async () => {
    const client = makeClient();
    await client.getScores('football', 1); // learns abc123 → soccer_epl
    requestedUrls = [];
    const event = await client.getEventById('abc123');
    expect(event).not.toBeNull();
    expect(event!.id).toBe('abc123');
    expect(event!.completed).toBe(true);
    // Direct hit on soccer_epl only — no scan across every sport.
    const scoreCalls = requestedUrls.filter((u) => u.includes('/scores?'));
    expect(scoreCalls.every((u) => u.includes('soccer_epl'))).toBe(true);
  });

  it('getEventById returns null when the event exists on no scoreboard', async () => {
    const client = makeClient();
    const event = await client.getEventById('does-not-exist');
    expect(event).toBeNull();
  });

  it('getOddsMulti groups ids by learned sport_key and requests eventIds with markets=h2h', async () => {
    const client = makeClient();
    await client.getEvents({ sport: 'football' }); // learns abc123 → soccer_epl
    requestedUrls = [];

    const rows = await client.getOddsMulti(['abc123'], 'draftkings');
    const call = requestedUrls.find((u) => u.includes('eventIds='))!;
    expect(call).toContain('/v4/sports/soccer_epl/odds?');
    expect(call).toContain('eventIds=abc123');
    expect(call).toContain('bookmakers=draftkings');
    expect(call).toContain('markets=h2h');
    expect(call).toContain('oddsFormat=decimal');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].id)).toBe('abc123');
  });

  it('getOddsMulti sanitizes legacy bookmaker config values into v4 keys', async () => {
    const client = makeClient();
    await client.getEvents({ sport: 'football' });
    requestedUrls = [];
    await client.getOddsMulti(['abc123'], 'Bet365');
    const call = requestedUrls.find((u) => u.includes('eventIds='))!;
    expect(call).toContain('bookmakers=bet365');
  });

  it('getOddsMulti skips ids whose league key is not learned yet (no blind scan)', async () => {
    const client = makeClient();
    const rows = await client.getOddsMulti(['never-seen-id'], 'draftkings');
    expect(rows).toHaveLength(0);
    expect(requestedUrls.filter((u) => u.includes('eventIds='))).toHaveLength(0);
  });

  it('every network call consumes the request budget and stops when exhausted', async () => {
    const client = makeClient();
    await client.getSports(); // warm the catalogue cache (cheap; not the point)
    requestedUrls = [];

    const budget = createHourlyBudget(1);
    const events = await client.getEvents({ sport: 'football' }, budget);
    // 2 league keys but only 1 unit of budget — exactly one odds request went
    // out; the rest of the fan-out stopped instead of hammering the API.
    expect(requestedUrls.filter((u) => u.includes('/odds?'))).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(budget.remaining()).toBe(0);
  });

  // LAST: trips the module-level 429 circuit breaker (parks all clients).
  it('parks all calls after a 429 quota response (circuit breaker)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('quota exceeded. It resets in 0 minutes and 1 seconds', {
          status: 429,
        })
      )
    );
    const client = makeClient();
    await expect(client.getSports()).rejects.toThrow('odds_api_http_429');
    // Next call short-circuits without touching the network.
    await expect(client.getSports()).rejects.toThrow('odds_api_rate_limited');
    // Let the 1s cooldown lapse so later suites aren't affected.
    await new Promise((r) => setTimeout(r, 1100));
  });
});
