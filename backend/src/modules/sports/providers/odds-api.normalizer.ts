/**
 * Normalization layer — converts the-odds-api.com (v4) payloads into the
 * shapes our EXISTING database + frontend already use. The frontend never sees
 * raw API data; the sync writes only these normalized values into
 * sports_events / sports_markets / sports_selections, exactly like the seed
 * does.
 *
 * Market mapping (only markets the platform already understands are emitted —
 * every market_type below is gradable by market-grading.ts):
 *   h2h                       → market_type '1x2'            "Full Time Result"  (Home/Draw/Away)
 *   totals / alternate_totals → 'over_under_2_5' (2.5 line) or 'ou:{line}'       (Over/Under)
 *   spreads / alt. spreads    → 'ah:{line}'                  "Asian Handicap"    (Home/Away)  [clean lines only]
 *   btts                      → 'btts'                       "Both Teams to Score" (Yes/No)
 *   draw_no_bet               → 'dnb'                        "Draw No Bet"       (Home/Away)
 */

import type {
  NormalizedEvent,
  NormalizedMarket,
  NormalizedStatus,
  OddsApiEvent,
  OddsApiMarket,
  OddsApiOutcome,
  OddsApiOddsResponse,
} from './odds-api.types';

export function mapStatus(raw: string | undefined): NormalizedStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'live':
    case 'inplay':
    case 'in_play':
      return 'live';
    case 'settled':
    case 'finished':
    case 'ended':
    case 'closed':
      return 'finished';
    case 'cancelled':
    case 'canceled':
    case 'abandoned':
      return 'cancelled';
    case 'postponed':
    case 'delayed':
      return 'postponed';
    case 'pending':
    case 'prematch':
    case 'scheduled':
    case 'upcoming':
    default:
      return 'scheduled';
  }
}

function toNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();

/**
 * v4 scores arrive as an array of {name, score} — map them to home/away by
 * matching the team names. When the names don't match exactly (accents,
 * provider-side renames) but exactly two rows are present, fall back to the
 * provider's positional order (home first).
 */
export function extractScorePair(event: OddsApiEvent): {
  home: number | null;
  away: number | null;
} {
  const list = Array.isArray(event.scores) ? event.scores : [];
  if (list.length === 0) return { home: null, away: null };

  const homeName = norm(event.home_team);
  const awayName = norm(event.away_team);
  let home = list.find((s) => norm(s.name) === homeName)?.score;
  let away = list.find((s) => norm(s.name) === awayName)?.score;

  if ((home === undefined || away === undefined) && list.length === 2) {
    if (home === undefined && norm(list[0].name) !== awayName) home = list[0].score;
    if (away === undefined && norm(list[1].name) !== homeName) away = list[1].score;
  }

  return { home: toNumber(home), away: toNumber(away) };
}

/**
 * Prettify a provider league key into a display name when the provider omits
 * `league.name` (= sport_title). e.g. "soccer_ethiopia_premier_league" →
 * "Soccer Ethiopia Premier League". Prevents fixtures from being stored with
 * a NULL league and surfacing as "Unknown League".
 */
function prettifyLeagueSlug(slug: string | undefined): string | null {
  const s = (slug ?? '').trim();
  if (!s) return null;
  return s
    .replace(/[_/]+/g, '-')
    .split('-')
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .trim() || null;
}

export function normalizeEvent(event: OddsApiEvent): NormalizedEvent | null {
  const home = (event.home_team ?? '').trim();
  const away = (event.away_team ?? '').trim();
  const sport = (event.sport?.slug ?? event.sport?.name ?? '').trim().toLowerCase();
  const startsAt = event.commence_time ?? null;
  if (!home || !away || !sport || !startsAt) return null;

  // completed:true is authoritative (the scores feed has no status field);
  // otherwise fall back to the derived/provider status string.
  const status: NormalizedStatus =
    event.completed === true ? 'finished' : mapStatus(event.status);

  const scores = extractScorePair(event);

  return {
    providerEventId: String(event.id),
    // The provider league key ("soccer_epl") — from sport_key (or the league
    // slug the client mirrors it onto). Persisted so the odds phase can price
    // by league without relying on the fragile in-memory sport_key map.
    providerSportKey:
      (event.sport_key ?? '').trim() ||
      (event.league?.slug ?? '').trim() ||
      null,
    sport,
    // Prefer the provider's display name (sport_title); fall back to a
    // prettified sport_key so a fixture is never stored as NULL (which the
    // frontend renders as "Unknown League").
    league:
      (event.league?.name ?? '').trim() ||
      prettifyLeagueSlug(event.league?.slug) ||
      null,
    homeTeam: home,
    awayTeam: away,
    startsAt: new Date(startsAt).toISOString(),
    status,
    homeScore: scores.home,
    awayScore: scores.away,
    // v4 exposes no match clock.
    minute: null,
  };
}

/** Valid decimal odds must be > 1 (matches sports_selections CHECK). */
function validOdds(v: unknown): number | null {
  const n = toNumber(v);
  return n !== null && n > 1 ? n : null;
}

/**
 * We only publish handicap/total lines that resolve to a clean win / lose /
 * push outcome from the final score — i.e. whole or half lines (…-1, -0.5, 0,
 * 0.5, 1…). Quarter lines (.25/.75) split the stake and can't be expressed with
 * our won|lost|void selection result, so they're skipped.
 */
const isCleanLine = (line: number): boolean => Number.isInteger(line * 2);

/** Human line suffix: 0.5 → "+0.5", -1 → "-1". */
const signed = (line: number): string => (line > 0 ? `+${line}` : `${line}`);

/**
 * Normalize ONE event's odds into every market we can settle from the final
 * score. Odds come from the requested bookmaker's markets[].outcomes arrays
 * (bookmaker matched by v4 key or title, falling back to the first available
 * one so a key/title config mismatch never blanks the whole book). Each
 * returned market_type is understood by `market-grading.ts`, so any bet placed
 * on it is guaranteed to auto-settle.
 */
export function normalizeOdds(
  response: OddsApiOddsResponse,
  bookmaker: string
): NormalizedMarket[] {
  const books = response.bookmakers ?? [];
  const wanted = norm(bookmaker);
  const book =
    books.find((b) => norm(b.key) === wanted) ??
    books.find((b) => norm(b.title) === wanted) ??
    books[0];
  const markets: OddsApiMarket[] = book?.markets ?? [];
  const homeName = norm(response.home_team);
  const awayName = norm(response.away_team);

  const out: NormalizedMarket[] = [];
  const seen = new Set<string>();
  const add = (m: NormalizedMarket) => {
    if (m.selections.length === 0 || seen.has(m.marketType)) return;
    seen.add(m.marketType);
    out.push(m);
  };

  const byKey = (key: string): OddsApiMarket[] =>
    markets.filter((m) => norm(m.key) === key);

  /** Outcome for the home/away team (matched by name) or the Draw. */
  const outcomeFor = (
    outcomes: OddsApiOutcome[],
    side: 'home' | 'away' | 'draw'
  ): OddsApiOutcome | undefined => {
    if (side === 'draw') return outcomes.find((o) => norm(o.name) === 'draw');
    const name = side === 'home' ? homeName : awayName;
    return outcomes.find((o) => norm(o.name) === name);
  };

  /* ---- h2h → 1x2 (Home / Draw / Away) ------------------------------------ */
  for (const m of byKey('h2h')) {
    const outcomes = m.outcomes ?? [];
    const home = validOdds(outcomeFor(outcomes, 'home')?.price);
    const away = validOdds(outcomeFor(outcomes, 'away')?.price);
    const draw = validOdds(outcomeFor(outcomes, 'draw')?.price);
    if (home !== null && away !== null) {
      const sel = [{ label: 'Home', oddsDecimal: home }];
      if (draw !== null) sel.push({ label: 'Draw', oddsDecimal: draw });
      sel.push({ label: 'Away', oddsDecimal: away });
      add({ marketType: '1x2', label: 'Full Time Result', selections: sel });
    }
  }

  /* ---- draw_no_bet -------------------------------------------------------- */
  for (const m of byKey('draw_no_bet')) {
    const outcomes = m.outcomes ?? [];
    const home = validOdds(outcomeFor(outcomes, 'home')?.price);
    const away = validOdds(outcomeFor(outcomes, 'away')?.price);
    if (home !== null && away !== null) {
      add({
        marketType: 'dnb',
        label: 'Draw No Bet',
        selections: [
          { label: 'Home', oddsDecimal: home },
          { label: 'Away', oddsDecimal: away },
        ],
      });
    }
  }

  /* ---- btts ---------------------------------------------------------------- */
  for (const m of byKey('btts')) {
    const outcomes = m.outcomes ?? [];
    const yes = validOdds(outcomes.find((o) => norm(o.name) === 'yes')?.price);
    const no = validOdds(outcomes.find((o) => norm(o.name) === 'no')?.price);
    if (yes !== null && no !== null) {
      add({
        marketType: 'btts',
        label: 'Both Teams to Score',
        selections: [
          { label: 'Yes', oddsDecimal: yes },
          { label: 'No', oddsDecimal: no },
        ],
      });
    }
  }

  /* ---- totals / alternate_totals → Over/Under per clean line -------------- */
  for (const m of [...byKey('totals'), ...byKey('alternate_totals')]) {
    // Group Over/Under outcome pairs by their line (`point`).
    const byLine = new Map<number, { over?: number; under?: number }>();
    for (const o of m.outcomes ?? []) {
      const line = toNumber(o.point);
      const price = validOdds(o.price);
      if (line === null || price === null) continue;
      const entry = byLine.get(line) ?? {};
      const n = norm(o.name);
      if (n === 'over') entry.over = price;
      else if (n === 'under') entry.under = price;
      byLine.set(line, entry);
    }
    for (const [line, pair] of byLine) {
      if (line <= 0 || !isCleanLine(line)) continue;
      if (pair.over === undefined || pair.under === undefined) continue;
      // The 2.5 line keeps the legacy market_type + bare "Over"/"Under" labels
      // so it updates existing rows in place (no duplicate selections); other
      // lines carry the line in their label for clarity.
      const is25 = line === 2.5;
      add({
        marketType: is25 ? 'over_under_2_5' : `ou:${line}`,
        label: `Over/Under ${line}`,
        selections: [
          { label: is25 ? 'Over' : `Over ${line}`, oddsDecimal: pair.over },
          { label: is25 ? 'Under' : `Under ${line}`, oddsDecimal: pair.under },
        ],
      });
    }
  }

  /* ---- spreads / alternate_spreads → Asian handicap (clean lines only) ---- */
  for (const m of [...byKey('spreads'), ...byKey('alternate_spreads')]) {
    // Outcomes are per-team with the team's own point; pair them by the HOME
    // line (away must carry the mirrored point).
    const byLine = new Map<number, { home?: number; away?: number }>();
    for (const o of m.outcomes ?? []) {
      const point = toNumber(o.point);
      const price = validOdds(o.price);
      if (point === null || price === null) continue;
      const n = norm(o.name);
      if (n === homeName) {
        const entry = byLine.get(point) ?? {};
        entry.home = price;
        byLine.set(point, entry);
      } else if (n === awayName) {
        // Away point -1.5 pairs with home point +1.5 → store under home line.
        const entry = byLine.get(-point) ?? {};
        entry.away = price;
        byLine.set(-point, entry);
      }
    }
    for (const [line, pair] of byLine) {
      if (!isCleanLine(line)) continue;
      if (pair.home === undefined || pair.away === undefined) continue;
      add({
        marketType: `ah:${line}`,
        label: `Asian Handicap ${signed(line)}`,
        selections: [
          { label: `Home ${signed(line)}`, oddsDecimal: pair.home },
          { label: `Away ${signed(-line)}`, oddsDecimal: pair.away },
        ],
      });
    }
  }

  return out;
}
