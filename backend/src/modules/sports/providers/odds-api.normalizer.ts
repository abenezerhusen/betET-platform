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
import { logger } from '../../../infrastructure/logger';
import { isSupportedProviderMarketKey } from './market-registry';

/**
 * Provider market keys we receive but do not (yet) ingest are logged ONCE each
 * so new upstream markets are discoverable for future implementation instead of
 * vanishing silently. Module-level dedupe keeps the logs quiet across the run.
 */
const loggedUnsupportedMarkets = new Set<string>();
function noteUnsupportedProviderMarket(key: string): void {
  const k = (key ?? '').toLowerCase().trim();
  if (!k || isSupportedProviderMarketKey(k) || loggedUnsupportedMarkets.has(k)) {
    return;
  }
  loggedUnsupportedMarkets.add(k);
  logger.info(
    { providerMarketKey: k },
    'odds-normalizer: provider market not yet ingested (logged for future support)'
  );
}

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
 * Resolve a provider double_chance outcome name to exactly one canonical label
 * ("Home or Draw" | "Home or Away" | "Draw or Away") the grader understands.
 * Robust to every observed provider wording: full team-name pairs
 * ("Arsenal/Chelsea"), worded ("Home or Draw"), and coded ("1X"/"12"/"X2").
 * Returns null when the outcome doesn't resolve to exactly two of {H,D,A} — so
 * an ambiguous outcome is skipped rather than mis-labelled.
 */
export function classifyDoubleChance(
  name: string,
  homeName: string,
  awayName: string
): 'Home or Draw' | 'Home or Away' | 'Draw or Away' | null {
  const n = norm(name);
  if (!n) return null;
  const has = { h: false, d: false, a: false };

  // Compact coded forms first (unambiguous).
  if (n === '1x' || n === 'x1') return 'Home or Draw';
  if (n === '12' || n === '21') return 'Home or Away';
  if (n === 'x2' || n === '2x') return 'Draw or Away';

  // Team-name substring match (most reliable for team-pair wording).
  if (homeName && n.includes(homeName)) has.h = true;
  if (awayName && n.includes(awayName)) has.a = true;

  // Token scan for worded / coded fragments.
  for (const t of n.split(/[\/,&+]|\bor\b|\band\b|\s+/).map((x) => x.trim())) {
    if (!t) continue;
    if (t === '1' || t === 'home' || t === 'h') has.h = true;
    else if (t === '2' || t === 'away' || t === 'a') has.a = true;
    else if (t === 'x' || t === 'draw' || t === 'tie') has.d = true;
  }

  const count = Number(has.h) + Number(has.d) + Number(has.a);
  if (count !== 2) return null;
  if (has.h && has.d) return 'Home or Draw';
  if (has.h && has.a) return 'Home or Away';
  return 'Draw or Away';
}

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
  // The configured `bookmaker` is a comma-separated PREFERENCE LIST
  // (e.g. "pinnacle,williamhill,marathonbet"), not a single key. Pick the
  // first preferred book present in this payload; if none are present, fall
  // back to whichever returned book offers the MOST markets so we still surface
  // the fullest gradable board (books differ wildly — some only carry h2h,
  // while a sharp book like pinnacle also carries totals/handicap/btts/DC/DNB).
  const books = response.bookmakers ?? [];
  const preferences = (bookmaker ?? '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let book = undefined as (typeof books)[number] | undefined;
  for (const pref of preferences) {
    book = books.find((b) => norm(b.key) === pref || norm(b.title) === pref);
    if (book) break;
  }
  if (!book && books.length > 0) {
    book = books.reduce(
      (best, b) => ((b.markets?.length ?? 0) > (best.markets?.length ?? 0) ? b : best),
      books[0]
    );
  }
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

  /* ---- h2h / h2h_3_way → 1x2 (Home / Draw / Away) ------------------------ */
  // h2h_3_way is the soccer alias of h2h (match winner incl. draw); both map to
  // the same 1x2 family. `add()` dedupes so a payload carrying both is fine.
  for (const m of [...byKey('h2h'), ...byKey('h2h_3_way')]) {
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

  /* ---- double_chance → 1X / 12 / X2 -------------------------------------- */
  // Provider outcome names vary widely ("Arsenal/Draw", "Home or Draw", "1X",
  // team-name pairs…). classifyDoubleChance resolves each to exactly one of the
  // three canonical pairs by matching team names AND coded/worded tokens, so we
  // store the grader's expected labels regardless of the provider's wording.
  for (const m of byKey('double_chance')) {
    const picks = new Map<string, number>();
    for (const o of m.outcomes ?? []) {
      const price = validOdds(o.price);
      if (price === null) continue;
      const label = classifyDoubleChance(o.name ?? '', homeName, awayName);
      if (label && !picks.has(label)) picks.set(label, price);
    }
    // Preserve the natural 1X / 12 / X2 order for display consistency.
    const order = ['Home or Draw', 'Home or Away', 'Draw or Away'];
    const selections = order
      .filter((lbl) => picks.has(lbl))
      .map((lbl) => ({ label: lbl, oddsDecimal: picks.get(lbl)! }));
    if (selections.length > 0) {
      add({ marketType: 'double_chance', label: 'Double Chance', selections });
    }
  }

  /* ---- team_totals / alternate_team_totals → per-team Over/Under ---------- */
  // Team totals grade against ONE team's score. The provider carries the team
  // in the outcome `description`; we split into tt_home:<line> / tt_away:<line>
  // (clean lines only — quarter/whole-line push handled by the grader).
  {
    const homeByLine = new Map<number, { over?: number; under?: number }>();
    const awayByLine = new Map<number, { over?: number; under?: number }>();
    for (const m of [...byKey('team_totals'), ...byKey('alternate_team_totals')]) {
      for (const o of m.outcomes ?? []) {
        const line = toNumber(o.point);
        const price = validOdds(o.price);
        if (line === null || price === null || line <= 0 || !isCleanLine(line)) {
          continue;
        }
        const team = norm(o.description);
        const isHome = !!team && (team === homeName || team.includes(homeName) || homeName.includes(team));
        const isAway = !!team && (team === awayName || team.includes(awayName) || awayName.includes(team));
        const map = isHome ? homeByLine : isAway ? awayByLine : null;
        if (!map) continue;
        const side = norm(o.name);
        const entry = map.get(line) ?? {};
        if (side.startsWith('over')) entry.over = price;
        else if (side.startsWith('under')) entry.under = price;
        map.set(line, entry);
      }
    }
    const emitTeamTotals = (
      map: Map<number, { over?: number; under?: number }>,
      family: 'tt_home' | 'tt_away',
      who: string
    ): void => {
      for (const [line, pair] of map) {
        if (pair.over === undefined || pair.under === undefined) continue;
        add({
          marketType: `${family}:${line}`,
          label: `${who} Total ${line}`,
          selections: [
            { label: `Over ${line}`, oddsDecimal: pair.over },
            { label: `Under ${line}`, oddsDecimal: pair.under },
          ],
        });
      }
    };
    emitTeamTotals(homeByLine, 'tt_home', 'Home');
    emitTeamTotals(awayByLine, 'tt_away', 'Away');
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

  // Surface any provider market we received but don't yet ingest (HT/FT,
  // corners, cards, player props, correct_score, period markets…) so coverage
  // gaps are discoverable — never silently dropped.
  for (const m of markets) {
    if (m.key) noteUnsupportedProviderMarket(m.key);
  }

  return out;
}
