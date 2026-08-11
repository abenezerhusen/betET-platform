/**
 * Synchronization normalization tests (STEP 22).
 *
 * The normalizer is the boundary between raw Odds-API.io payloads and the
 * internal sports_events / sports_markets / sports_selections writes. These
 * tests pin down:
 *   - provider status → internal status mapping (completed / cancelled /
 *     postponed detection used by result sync + settlement),
 *   - event normalization (provider event ID is the identity; junk payloads
 *     are rejected instead of creating broken rows),
 *   - odds normalization (only score-settleable markets are published,
 *     quarter lines and invalid odds are skipped, no duplicate markets).
 */
import { describe, it, expect } from 'vitest';
import { mapStatus, normalizeEvent, normalizeOdds } from './odds-api.normalizer';
import type { OddsApiEvent, OddsApiOddsResponse } from './odds-api.types';

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
    id: 123456,
    home: 'Arsenal',
    away: 'Chelsea',
    date: '2026-08-15T14:00:00Z',
    status: 'pending',
    sport: { slug: 'football', name: 'Football' },
    league: { name: 'England - Premier League', slug: 'england-premier-league' },
  };

  it('maps the provider event ID as a stable string identity', () => {
    const n = normalizeEvent(base);
    expect(n).not.toBeNull();
    expect(n!.providerEventId).toBe('123456');
    expect(n!.homeTeam).toBe('Arsenal');
    expect(n!.awayTeam).toBe('Chelsea');
    expect(n!.sport).toBe('football');
    expect(n!.league).toBe('England - Premier League');
    expect(n!.status).toBe('scheduled');
    expect(n!.startsAt).toBe('2026-08-15T14:00:00.000Z');
  });

  it('is deterministic — same payload normalizes identically (idempotent sync input)', () => {
    expect(normalizeEvent(base)).toEqual(normalizeEvent({ ...base }));
  });

  it('rejects payloads missing team, sport or start time instead of writing broken rows', () => {
    expect(normalizeEvent({ ...base, home: '' })).toBeNull();
    expect(normalizeEvent({ ...base, away: undefined })).toBeNull();
    expect(normalizeEvent({ ...base, sport: {} })).toBeNull();
    expect(normalizeEvent({ ...base, date: undefined })).toBeNull();
  });

  it('carries final scores through for settlement, tolerating string scores', () => {
    const finished = {
      ...base,
      status: 'settled',
      // Provider spec says numbers, but payloads vary — strings must not
      // silently block settlement.
      scores: { home: '2' as unknown as number, away: 1 },
    };
    const n = normalizeEvent(finished)!;
    expect(n.status).toBe('finished');
    expect(n.homeScore).toBe(2);
    expect(n.awayScore).toBe(1);
  });

  it('returns null scores when the provider sends no usable score', () => {
    const n = normalizeEvent({ ...base, scores: { home: undefined, away: undefined } })!;
    expect(n.homeScore).toBeNull();
    expect(n.awayScore).toBeNull();
  });

  it('prettifies the league slug when the display name is missing', () => {
    const n = normalizeEvent({
      ...base,
      league: { slug: 'england-premier-league' },
    })!;
    expect(n.league).toBe('England Premier League');
  });
});

describe('normalizeOdds', () => {
  const response = (markets: NonNullable<OddsApiOddsResponse['bookmakers']>[string]): OddsApiOddsResponse => ({
    id: 123456,
    home: 'Arsenal',
    away: 'Chelsea',
    bookmakers: { bet365: markets },
  });

  it('normalizes the 1x2 market', () => {
    const out = normalizeOdds(
      response([{ name: 'ML', odds: [{ home: '2.10', draw: '3.40', away: '3.60' }] }]),
      'bet365'
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
      {
        id: 1,
        bookmakers: { Bet365: [{ name: 'ML', odds: [{ home: '2.0', away: '3.0' }] }] },
      },
      'bet365'
    );
    expect(out).toHaveLength(1);
  });

  it('publishes clean over/under lines and skips quarter lines (not won/lost/void-gradable)', () => {
    const out = normalizeOdds(
      response([
        {
          name: 'Goals Over/Under',
          odds: [
            { hdp: 2.5, over: '1.90', under: '1.90' },
            { hdp: 2.25, over: '1.80', under: '2.00' }, // quarter line → skipped
            { hdp: 3, over: '2.40', under: '1.55' },
          ],
        },
      ]),
      'bet365'
    );
    const types = out.map((m) => m.marketType);
    expect(types).toContain('over_under_2_5');
    expect(types).toContain('ou:3');
    expect(types).not.toContain('ou:2.25');
  });

  it('skips rows with unavailable or invalid odds instead of publishing stale/broken prices', () => {
    const out = normalizeOdds(
      response([
        { name: 'ML', odds: [{ home: '1.00', away: '3.00' }] }, // odds must be > 1
        { name: 'Both Teams to Score', odds: [{ yes: 'N/A', no: '1.80' }] },
      ]),
      'bet365'
    );
    expect(out).toHaveLength(0);
  });

  it('never emits duplicate market types for the same event', () => {
    const out = normalizeOdds(
      response([
        { name: 'Goals Over/Under', odds: [{ hdp: 2.5, over: '1.90', under: '1.90' }] },
        { name: 'Totals', odds: [{ hdp: 2.5, over: '1.95', under: '1.85' }] },
      ]),
      'bet365'
    );
    expect(out.filter((m) => m.marketType === 'over_under_2_5')).toHaveLength(1);
  });

  it('returns an empty list when the requested bookmaker is absent (plan limitation, not an error)', () => {
    const out = normalizeOdds(
      { id: 1, bookmakers: { pinnacle: [{ name: 'ML', odds: [{ home: '2.0', away: '2.0' }] }] } },
      'bet365'
    );
    expect(out).toHaveLength(0);
  });

  it('grades everything it publishes: asian handicap integer + half lines only', () => {
    const out = normalizeOdds(
      response([
        {
          name: 'Spread',
          odds: [
            { hdp: -0.5, home: '1.85', away: '1.95' },
            { hdp: -0.75, home: '2.05', away: '1.75' }, // quarter line → skipped
            { hdp: -1, home: '2.30', away: '1.60' },
          ],
        },
      ]),
      'bet365'
    );
    const types = out.map((m) => m.marketType);
    expect(types).toContain('ah:-0.5');
    expect(types).toContain('ah:-1');
    expect(types).not.toContain('ah:-0.75');
  });
});
