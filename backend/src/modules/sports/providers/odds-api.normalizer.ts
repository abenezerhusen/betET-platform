/**
 * Normalization layer — converts Odds-API.io payloads into the shapes our
 * EXISTING database + frontend already use. The frontend never sees raw API
 * data; the sync writes only these normalized values into sports_events /
 * sports_markets / sports_selections, exactly like the seed does.
 *
 * Market mapping (only markets the platform already understands are emitted):
 *   ML                  → market_type '1x2'            "Full Time Result"  (Home/Draw/Away)
 *   Over/Under          → market_type 'over_under_2_5' "Over/Under 2.5"    (Over/Under)  [line 2.5 only]
 *   Both Teams to Score → market_type 'btts'           "Both Teams to Score" (Yes/No)
 */

import type {
  NormalizedEvent,
  NormalizedMarket,
  NormalizedStatus,
  OddsApiEvent,
  OddsApiMarket,
  OddsApiOddsRow,
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

/** Extract the current match minute from the live clock, when present. */
function minuteOf(event: OddsApiEvent): number | null {
  const m = event.clock?.minute;
  return typeof m === 'number' && Number.isFinite(m) ? m : null;
}

/**
 * Prettify a provider league slug into a display name when the provider
 * omits `league.name`. e.g. "england-premier-league" → "England Premier
 * League". Prevents fixtures that DO have league data (under `slug`) from
 * being stored with a NULL league and surfacing as "Unknown League".
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
  const home = (event.home ?? '').trim();
  const away = (event.away ?? '').trim();
  const sport = (event.sport?.slug ?? event.sport?.name ?? '').trim().toLowerCase();
  const startsAt = event.date ?? null;
  if (!home || !away || !sport || !startsAt) return null;

  return {
    providerEventId: String(event.id),
    sport,
    // Prefer the provider's display name; fall back to a prettified slug so a
    // fixture that carries league data under `slug` is never stored as NULL
    // (which the frontend renders as "Unknown League").
    league:
      (event.league?.name ?? '').trim() ||
      prettifyLeagueSlug(event.league?.slug) ||
      null,
    homeTeam: home,
    awayTeam: away,
    startsAt: new Date(startsAt).toISOString(),
    status: mapStatus(event.status),
    homeScore: toNumber(event.scores?.home),
    awayScore: toNumber(event.scores?.away),
    minute: minuteOf(event),
  };
}

/** Valid decimal odds must be > 1 (matches sports_selections CHECK). */
function validOdds(v: unknown): number | null {
  const n = toNumber(v);
  return n !== null && n > 1 ? n : null;
}

function marketNameMatches(name: string | undefined, needles: string[]): boolean {
  const n = (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return needles.some((needle) => n === needle || n.includes(needle));
}

const cleanName = (name: string | undefined) =>
  (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Betting line carried under `hdp` (preferred) or legacy `max`. */
function lineOf(r: OddsApiOddsRow): number | null {
  const raw = r.hdp ?? r.max;
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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

/** First plausible decimal-odds value on a single-outcome labelled row. */
function pickSingleOdds(row: OddsApiOddsRow): number | null {
  for (const k of ['odds', 'under', 'over', 'home', 'away', 'yes', 'no'] as const) {
    const v = validOdds(row[k]);
    if (v !== null) return v;
  }
  return null;
}

const STOP_TOKENS = new Set(['fc', 'cf', 'cd', 'sc', 'ac', 'afc', 'ud', 'rc', 'cp']);
function teamTokens(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_TOKENS.has(w));
}
/** Which side a partial team label ("CD Alaves") refers to, by token overlap. */
function whichSide(part: string, home: string, away: string): 'home' | 'away' | null {
  const p = new Set(teamTokens(part));
  const h = teamTokens(home).filter((t) => p.has(t)).length;
  const a = teamTokens(away).filter((t) => p.has(t)).length;
  if (h > a) return 'home';
  if (a > h) return 'away';
  return null;
}
const norm = (s: string) => s.toLowerCase().trim();

/**
 * Normalize ONE bookmaker's odds into every market we can settle from the final
 * score. Each returned market_type is understood by `market-grading.ts`, so any
 * bet placed on it is guaranteed to auto-settle. In-play / half-time / quarter-
 * line markets are intentionally skipped (not score-deterministic for us).
 */
export function normalizeOdds(
  response: OddsApiOddsResponse,
  bookmaker: string
): NormalizedMarket[] {
  const books = response.bookmakers ?? {};
  const key =
    Object.keys(books).find((k) => k.toLowerCase() === bookmaker.toLowerCase()) ??
    bookmaker;
  const markets: OddsApiMarket[] = books[key] ?? [];
  const homeName = response.home ?? '';
  const awayName = response.away ?? '';
  const out: NormalizedMarket[] = [];
  const seen = new Set<string>();
  const add = (m: NormalizedMarket) => {
    if (m.selections.length === 0 || seen.has(m.marketType)) return;
    seen.add(m.marketType);
    out.push(m);
  };

  const find = (needles: string[]) =>
    markets.find((m) => marketNameMatches(m.name, needles));
  // Exact-name lookup (avoids "Totals" matching "Totals HT").
  const findExact = (name: string) =>
    markets.find((m) => cleanName(m.name) === name);

  /* ---- ML → 1x2 (Home / Draw / Away) ------------------------------------ */
  const mlRow =
    markets.find((m) => ['ml', 'moneyline', 'match result', '1x2'].includes(cleanName(m.name)))
      ?.odds?.[0] ?? find(['moneyline', 'match result', '1x2'])?.odds?.[0];
  if (mlRow) {
    const home = validOdds(mlRow.home);
    const away = validOdds(mlRow.away);
    const draw = validOdds(mlRow.draw);
    if (home !== null && away !== null) {
      const sel = [{ label: 'Home', oddsDecimal: home }];
      if (draw !== null) sel.push({ label: 'Draw', oddsDecimal: draw });
      sel.push({ label: 'Away', oddsDecimal: away });
      add({ marketType: '1x2', label: 'Full Time Result', selections: sel });
    }
  }

  /* ---- Draw No Bet ------------------------------------------------------- */
  const dnbRow = findExact('draw no bet')?.odds?.[0];
  if (dnbRow) {
    const home = validOdds(dnbRow.home);
    const away = validOdds(dnbRow.away);
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

  /* ---- Double Chance ----------------------------------------------------- */
  const dc = findExact('double chance');
  if (dc?.odds?.length) {
    const sel: NormalizedMarket['selections'] = [];
    let ok = true;
    for (const row of dc.odds) {
      const odds = pickSingleOdds(row);
      const raw = norm(String(row.label ?? ''));
      if (odds === null || !raw) {
        ok = false;
        break;
      }
      if (raw.includes('draw')) {
        const other = raw.replace(/draw/g, '').replace(/\bor\b/g, ' ');
        const side = whichSide(other, homeName, awayName);
        if (side === 'home') sel.push({ label: 'Home or Draw', oddsDecimal: odds });
        else if (side === 'away') sel.push({ label: 'Draw or Away', oddsDecimal: odds });
        else {
          ok = false;
          break;
        }
      } else {
        sel.push({ label: 'Home or Away', oddsDecimal: odds });
      }
    }
    // Only publish when all three outcomes mapped cleanly.
    if (ok && sel.length === 3) {
      add({ marketType: 'double_chance', label: 'Double Chance', selections: sel });
    }
  }

  /* ---- Both Teams to Score ---------------------------------------------- */
  const bttsRow = findExact('both teams to score')?.odds?.[0];
  if (bttsRow) {
    const yes = validOdds(bttsRow.yes);
    const no = validOdds(bttsRow.no);
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

  /* ---- Total goals Over/Under (every clean line, all sources) ----------- */
  const totalSources = markets.filter((m) =>
    ['goals over/under', 'alternative goal line', 'alternative total goals', 'totals'].includes(
      cleanName(m.name)
    )
  );
  for (const src of totalSources) {
    for (const row of src.odds ?? []) {
      const line = lineOf(row);
      if (line === null || line <= 0 || !isCleanLine(line)) continue;
      const over = validOdds(row.over);
      const under = validOdds(row.under);
      if (over === null || under === null) continue;
      // The 2.5 line keeps the legacy market_type + bare "Over"/"Under" labels
      // so it updates existing rows in place (no duplicate selections); other
      // lines carry the line in their label for clarity.
      const is25 = line === 2.5;
      add({
        marketType: is25 ? 'over_under_2_5' : `ou:${line}`,
        label: `Over/Under ${line}`,
        selections: [
          { label: is25 ? 'Over' : `Over ${line}`, oddsDecimal: over },
          { label: is25 ? 'Under' : `Under ${line}`, oddsDecimal: under },
        ],
      });
    }
  }

  /* ---- Team totals (home / away) ---------------------------------------- */
  for (const [name, fam, who] of [
    ['team total goals home', 'tt_home', 'Home'],
    ['team total goals away', 'tt_away', 'Away'],
  ] as const) {
    const src = findExact(name);
    for (const row of src?.odds ?? []) {
      const line = lineOf(row);
      if (line === null || line <= 0 || !isCleanLine(line)) continue;
      const over = validOdds(row.over);
      const under = validOdds(row.under);
      if (over === null || under === null) continue;
      add({
        marketType: `${fam}:${line}`,
        label: `${who} Team Total ${line}`,
        selections: [
          { label: `Over ${line}`, oddsDecimal: over },
          { label: `Under ${line}`, oddsDecimal: under },
        ],
      });
    }
  }

  /* ---- Asian handicap (Spread + Alternative) — clean lines only --------- */
  const ahSources = markets.filter((m) =>
    ['spread', 'alternative asian handicap', 'asian handicap'].includes(cleanName(m.name))
  );
  for (const src of ahSources) {
    for (const row of src.odds ?? []) {
      const line = lineOf(row);
      if (line === null || !isCleanLine(line)) continue;
      const home = validOdds(row.home);
      const away = validOdds(row.away);
      if (home === null || away === null) continue;
      add({
        marketType: `ah:${line}`,
        label: `Asian Handicap ${signed(line)}`,
        selections: [
          { label: `Home ${signed(line)}`, oddsDecimal: home },
          { label: `Away ${signed(-line)}`, oddsDecimal: away },
        ],
      });
    }
  }

  /* ---- European handicap (3-way, integer lines) ------------------------- */
  const eh = findExact('european handicap');
  for (const row of eh?.odds ?? []) {
    const line = lineOf(row);
    if (line === null || !Number.isInteger(line)) continue;
    const home = validOdds(row.home);
    const draw = validOdds(row.draw);
    const away = validOdds(row.away);
    if (home === null || draw === null || away === null) continue;
    add({
      marketType: `eh:${line}`,
      label: `European Handicap ${signed(line)}`,
      selections: [
        { label: `Home ${signed(line)}`, oddsDecimal: home },
        { label: `Draw ${signed(line)}`, oddsDecimal: draw },
        { label: `Away ${signed(line)}`, oddsDecimal: away },
      ],
    });
  }

  /* ---- Correct Score ----------------------------------------------------- */
  const cs = findExact('correct score');
  if (cs?.odds?.length) {
    const sel: NormalizedMarket['selections'] = [];
    for (const row of cs.odds) {
      const raw = norm(String(row.label ?? ''));
      const m = /^(\d+)\s*-\s*(\d+)$/.exec(raw);
      const odds = pickSingleOdds(row);
      if (!m || odds === null) continue; // skip "Other"/unparseable
      sel.push({ label: `${m[1]}-${m[2]}`, oddsDecimal: odds });
    }
    add({ marketType: 'correct_score', label: 'Correct Score', selections: sel });
  }

  /* ---- Exact Total Goals ------------------------------------------------- */
  const etg = findExact('exact total goals');
  if (etg?.odds?.length) {
    const sel: NormalizedMarket['selections'] = [];
    for (const row of etg.odds) {
      const raw = norm(String(row.label ?? ''));
      const odds = pickSingleOdds(row);
      if (odds === null) continue;
      const plus = /^(\d+)\s*\+/.exec(raw) || /over\s*(\d+)/.exec(raw);
      const exact = /^(\d+)\b/.exec(raw);
      if (plus) sel.push({ label: `${plus[1]}+`, oddsDecimal: odds });
      else if (exact) sel.push({ label: `${exact[1]}`, oddsDecimal: odds });
    }
    add({ marketType: 'exact_goals', label: 'Exact Total Goals', selections: sel });
  }

  return out;
}
