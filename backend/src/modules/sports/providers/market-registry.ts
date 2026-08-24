/**
 * Provider market registry — the single, extensible source of truth for WHICH
 * the-odds-api (v4) market keys we request from the provider and how they map
 * onto our internal, score-gradable market_type families.
 *
 * the-odds-api splits its markets across two endpoints (verified against
 * https://the-odds-api.com/liveapi/guides/v4/ and the betting-markets list):
 *
 *   FEATURED   h2h, spreads, totals, outrights
 *              → available in BULK on GET /sports/{key}/odds
 *              → one request prices EVERY event in a league.
 *
 *   ADDITIONAL btts, double_chance, draw_no_bet, team_totals, alternates,
 *              correct_score, halftime_fulltime, corners, cards, player props…
 *              → available ONLY per event on
 *                GET /sports/{key}/events/{eventId}/odds
 *              → 1 request per event (1 quota credit per market per region).
 *
 * This is why "only 1x2" was ever stored: the sync only ever hit the featured
 * /odds endpoint with markets=h2h. Everything else needs the per-event endpoint
 * (or the featured spreads/totals keys).
 *
 * EXTENDING COVERAGE
 * ------------------
 * To ingest a new market: add its provider key below AND — if it introduces a
 * new internal family — a grading rule in `market-grading.ts` and a handler in
 * `odds-api.normalizer.ts`. The sync engine itself never changes.
 *
 * SAFETY
 * ------
 * A key only belongs in an INGEST list when the market can be settled
 * deterministically from the FINAL FULL-TIME SCORE with UNAMBIGUOUS outcome
 * orientation. Half/period markets, corners, cards, player props, HT/FT and
 * correct_score are deliberately EXCLUDED (they can't be graded from the
 * full-time score alone, or their provider outcome orientation isn't safe to
 * assume) — importing them would strand or, worse, mis-settle real money.
 * Unknown provider markets are never silently dropped: the normalizer logs each
 * one once (see `isSupportedProviderMarketKey`) so it can be added later.
 */

/**
 * Featured markets requested in bulk on the league `/odds` endpoint (one call
 * per league prices every event). All three are already handled by the
 * normalizer (h2h→1x2, totals→over/under, spreads→asian handicap) and gradable.
 */
export const FEATURED_MARKET_KEYS = ['h2h', 'spreads', 'totals'] as const;

/**
 * Additional (non-featured) soccer markets requested per event on the
 * event-odds endpoint. Every key here is score-gradable with an unambiguous
 * outcome orientation and has a normalizer handler.
 */
export const ADDITIONAL_MARKET_KEYS = [
  'h2h_3_way', // match winner incl. draw (soccer alias of h2h) → 1x2
  'btts', // both teams to score → btts
  'double_chance', // 1X / 12 / X2 → double_chance
  'draw_no_bet', // match winner, draw refunded → dnb
  'totals', // over/under (also featured; harmless to re-request)
  'alternate_totals', // all over/under lines → ou:<line>
  'team_totals', // team over/under → tt_home/tt_away:<line>
  'alternate_team_totals', // all team over/under lines
  'spreads', // asian handicap (featured) → ah:<line>
  'alternate_spreads', // all handicap lines → ah:<line>
] as const;

/**
 * Comprehensive per-event request set (featured + additional), used by the
 * on-demand single-event fetch so an opened match shows its full gradable
 * market board in ONE provider request.
 */
export const EVENT_ODDS_MARKET_KEYS: readonly string[] = [
  ...new Set<string>([...FEATURED_MARKET_KEYS, ...ADDITIONAL_MARKET_KEYS]),
];

/**
 * Provider market keys the normalizer knows how to publish. Used to detect —
 * and log ONCE — provider markets we receive but do not yet ingest, so new
 * upstream markets surface for future implementation instead of vanishing
 * silently. Keep in lockstep with the normalizer's handlers.
 */
export const SUPPORTED_PROVIDER_MARKET_KEYS: ReadonlySet<string> = new Set([
  'h2h',
  'h2h_3_way',
  'spreads',
  'alternate_spreads',
  'totals',
  'alternate_totals',
  'team_totals',
  'alternate_team_totals',
  'btts',
  'draw_no_bet',
  'double_chance',
]);

export function isSupportedProviderMarketKey(key: string): boolean {
  return SUPPORTED_PROVIDER_MARKET_KEYS.has(key.toLowerCase().trim());
}

/** Comma-joined helpers for the API `markets` query parameter. */
export const FEATURED_MARKETS_PARAM = FEATURED_MARKET_KEYS.join(',');
export const EVENT_ODDS_MARKETS_PARAM = EVENT_ODDS_MARKET_KEYS.join(',');
