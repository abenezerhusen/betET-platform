/**
 * Synchronization normalization tests (STEP 22).
 *
 * The normalizer is the boundary between raw the-odds-api.com (v4) payloads
 * and the internal sports_events / sports_markets / sports_selections writes.
 * These tests pin down:
 *   - provider status → internal status mapping (completed / cancelled /
 *     postponed detection used by result sync + settlement),
 *   - event normalization (provider event ID is the identity; junk payloads
 *     are rejected instead of creating broken rows; v4 scores arrays are
 *     matched to home/away by team name),
 *   - odds normalization (bookmakers[].markets[].outcomes → only
 *     score-settleable markets are published, quarter lines and invalid odds
 *     are skipped, no duplicate markets).
 */
import { describe, it, expect } from 'vitest';
import {
  extractScorePair,
  mapStatus,
  normalizeEvent,
  normalizeOdds,
} from './odds-api.normalizer';
import type { OddsApiEvent, OddsApiMarket, OddsApiOddsResponse } from './odds-api.types';

describe('mapStatus', () => {
  it('detects completed events under every provider alias', () => {
    for (const s of ['settled', 'finished', 'ended', 'closed', 'FINISHED']) {
      expect(mapStatus(s)).toBe('finished');
    }
  });

  it('detects live events', () => {
    for (const s of ['live', 'inplay', 'in_play']) {
      expect(mapStatus(s)).toBe('live');
    }
  });

  it('detects cancelled and abandoned events', () => {
    for (const s of ['cancelled', 'canceled', 'abandoned']) {
      expect(mapStatus(s)).toBe('cancelled');
    }
  });

  it('detects postponed events', () => {
    for (const s of ['postponed', 'delayed']) {
      expect(mapStatus(s)).toBe('postponed');
    }
  });

  it('falls back to scheduled for unknown or missing statuses (never guesses a result state)', () => {
    expect(mapStatus('pending')).toBe('scheduled');
    expect(mapStatus(undefined)).toBe('scheduled');
    expect(mapStatus('some_new_status')).toBe('scheduled');
  });
});

describe('normalizeEvent', () => {
  const base: OddsApiEvent = {
    id: 'e912304de2b2ce35b473ce2ecd3d1502',
    sport_key: 'soccer_epl',
    sport_title: 'EPL',
    commence_time: '2026-08-15T14:00:00Z',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    status: 'pending',
    sport: { slug: 'football', name: 'Soccer' },
    league: { name: 'EPL', slug: 'soccer_epl' },
  };

  it('maps the provider event ID as a stable string identity', () => {
    const n = normalizeEvent(base);
    expect(n).not.toBeNull();
    expect(n!.providerEventId).toBe('e912304de2b2ce35b473ce2ecd3d1502');
    expect(n!.homeTeam).toBe('Arsenal');
    expect(n!.awayTeam).toBe('Chelsea');
    expect(n!.sport).toBe('football');
    expect(n!.league).toBe('EPL');
    expect(n!.status).toBe('scheduled');
    expect(n!.startsAt).toBe('2026-08-15T14:00:00.000Z');
  });

  it('is deterministic — same payload normalizes identically (idempotent sync input)', () => {
    expect(normalizeEvent(base)).toEqual(normalizeEvent({ ...base }));
  });

  it('rejects payloads missing team, sport or start time instead of writing broken rows', () => {
    expect(normalizeEvent({ ...base, home_team: '' })).toBeNull();
    expect(normalizeEvent({ ...base, away_team: undefined })).toBeNull();
    expect(normalizeEvent({ ...base, sport: {} })).toBeNull();
    expect(normalizeEvent({ ...base, commence_time: undefined })).toBeNull();
  });

  it('maps completed:true to finished and the scores array to home/away by team name', () => {
    const finished: OddsApiEvent = {
      ...base,
      completed: true,
      // Order intentionally away-first to prove name matching (not position).
      scores: [
        { name: 'Chelsea', score: '1' },
        { name: 'Arsenal', score: '2' },
      ],
    };
    const n = normalizeEvent(finished)!;
    expect(n.status).toBe('finished');
    expect(n.homeScore).toBe(2);
    expect(n.awayScore).toBe(1);
  });

  it('falls back to positional order when score names do not match the teams', () => {
    const pair = extractScorePair({
      ...base,
      scores: [
        { name: 'Arsenal FC', score: 3 },
        { name: 'Chelsea FC', score: 0 },
      ],
    });
    expect(pair.home).toBe(3);
    expect(pair.away).toBe(0);
  });

  it('returns null scores when the provider sends no usable score', () => {
    const n = normalizeEvent({ ...base, scores: null })!;
    expect(n.homeScore).toBeNull();
    expect(n.awayScore).toBeNull();
  });

  it('prettifies the league key when the display name is missing', () => {
    const n = normalizeEvent({
      ...base,
      league: { slug: 'soccer_ethiopia_premier_league' },
    })!;
    expect(n.league).toBe('Soccer Ethiopia Premier League');
  });
});

describe('normalizeOdds', () => {
  const response = (
    markets: OddsApiMarket[],
    bookmakerKey = 'draftkings'
  ): OddsApiOddsResponse => ({
    id: 'abc123',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    bookmakers: [{ key: bookmakerKey, markets }],
  });

  it('normalizes the h2h market into 1x2, matching outcomes by team name', () => {
    const out = normalizeOdds(
      response([
        {
          key: 'h2h',
          // Shuffled on purpose — mapping must go by name, not position.
          outcomes: [
            { name: 'Chelsea', price: 3.6 },
            { name: 'Draw', price: 3.4 },
            { name: 'Arsenal', price: 2.1 },
          ],
        },
      ]),
      'draftkings'
    );
    expect(out).toHaveLength(1);
    expect(out[0].marketType).toBe('1x2');
    expect(out[0].selections).toEqual([
      { label: 'Home', oddsDecimal: 2.1 },
      { label: 'Draw', oddsDecimal: 3.4 },
      { label: 'Away', oddsDecimal: 3.6 },
    ]);
  });

  it('matches the bookmaker key case-insensitively', () => {
    const out = normalizeOdds(
      response(
        [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 2 }, { name: 'Chelsea', price: 3 }] }],
        'draftkings'
      ),
      'DraftKings'
    );
    expect(out).toHaveLength(1);
  });

  it('falls back to the first available bookmaker when the configured one is absent', () => {
    const out = normalizeOdds(
      response(
        [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 2 }, { name: 'Chelsea', price: 3 }] }],
        'pinnacle'
      ),
      'bet365'
    );
    expect(out).toHaveLength(1);
    expect(out[0].marketType).toBe('1x2');
  });

  it('publishes clean over/under lines and skips quarter lines (not won/lost/void-gradable)', () => {
    const out = normalizeOdds(
      response([
        {
          key: 'totals',
          outcomes: [
            { name: 'Over', price: 1.9, point: 2.5 },
            { name: 'Under', price: 1.9, point: 2.5 },
            { name: 'Over', price: 1.8, point: 2.25 }, // quarter line → skipped
            { name: 'Under', price: 2.0, point: 2.25 },
            { name: 'Over', price: 2.4, point: 3 },
            { name: 'Under', price: 1.55, point: 3 },
          ],
        },
      ]),
      'draftkings'
    );
    const types = out.map((m) => m.marketType);
    expect(types).toContain('over_under_2_5');
    expect(types).toContain('ou:3');
    expect(types).not.toContain('ou:2.25');
  });

  it('skips markets with unavailable or invalid odds instead of publishing broken prices', () => {
    const out = normalizeOdds(
      response([
        {
          key: 'h2h',
          outcomes: [
            { name: 'Arsenal', price: 1.0 }, // odds must be > 1
            { name: 'Chelsea', price: 3.0 },
          ],
        },
        {
          key: 'btts',
          outcomes: [{ name: 'Yes' }, { name: 'No', price: 1.8 }],
        },
      ]),
      'draftkings'
    );
    expect(out).toHaveLength(0);
  });

  it('never emits duplicate market types for the same event', () => {
    const out = normalizeOdds(
      response([
        {
          key: 'totals',
          outcomes: [
            { name: 'Over', price: 1.9, point: 2.5 },
            { name: 'Under', price: 1.9, point: 2.5 },
          ],
        },
        {
          key: 'alternate_totals',
          outcomes: [
            { name: 'Over', price: 1.95, point: 2.5 },
            { name: 'Under', price: 1.85, point: 2.5 },
          ],
        },
      ]),
      'draftkings'
    );
    expect(out.filter((m) => m.marketType === 'over_under_2_5')).toHaveLength(1);
  });

  it('returns an empty list when no bookmaker carries markets', () => {
    const out = normalizeOdds(
      { id: 'x', home_team: 'A', away_team: 'B', bookmakers: [] },
      'draftkings'
    );
    expect(out).toHaveLength(0);
  });

  it('grades everything it publishes: asian handicap integer + half lines only', () => {
    const out = normalizeOdds(
      response([
        {
          key: 'spreads',
          outcomes: [
            { name: 'Arsenal', price: 1.85, point: -0.5 },
            { name: 'Chelsea', price: 1.95, point: 0.5 },
            { name: 'Arsenal', price: 2.05, point: -0.75 }, // quarter line → skipped
            { name: 'Chelsea', price: 1.75, point: 0.75 },
            { name: 'Arsenal', price: 2.3, point: -1 },
            { name: 'Chelsea', price: 1.6, point: 1 },
          ],
        },
      ]),
      'draftkings'
    );
    const types = out.map((m) => m.marketType);
    expect(types).toContain('ah:-0.5');
    expect(types).toContain('ah:-1');
    expect(types).not.toContain('ah:-0.75');
  });
});
