/**
 * The-Odds-API.com (v4) wire types + the internal normalized shapes the sync
 * layer writes into the EXISTING sports_events / sports_markets /
 * sports_selections tables. Grounded in https://the-odds-api.com/liveapi/guides/v4/
 * (GET /v4/sports, /v4/sports/{key}/odds, /v4/sports/{key}/scores).
 *
 * Nothing here is imported by existing sportsbook code — it only feeds the
 * background sync. Kept deliberately permissive (optional fields) because the
 * upstream payload varies by sport / plan / bookmaker.
 */

/* -------------------------------------------------------------------------- */
/*  Upstream (the-odds-api.com v4) wire shapes                                */
/* -------------------------------------------------------------------------- */

/**
 * `GET /v4/sports` item. `key` is a full league key ("soccer_epl"), `group`
 * is the sport family ("Soccer"). `name`/`slug` are kept as OPTIONAL
 * compatibility aliases: the client fills them on the per-event `sport` ref
 * with our internal generic sport slug ("football") so the sync layer's
 * sport filtering keeps working unchanged.
 */
export interface OddsApiSportRef {
  key?: string;
  group?: string;
  title?: string;
  description?: string;
  active?: boolean;
  has_outrights?: boolean;
  name?: string;
  slug?: string;
}

export interface OddsApiLeagueRef {
  /** Display name — the provider's `sport_title` (e.g. "EPL"). */
  name?: string;
  /** Provider league key — the `sport_key` (e.g. "soccer_epl"). */
  slug?: string;
}

/** One entry of the `/scores` response `scores` array: {name, score}. */
export interface OddsApiScoreEntry {
  name?: string;
  score?: string | number;
}

/** One outcome inside a bookmaker market ({name, price, point?}). */
export interface OddsApiOutcome {
  name?: string;
  price?: number;
  /** Line for totals ("Over/Under {point}") and spreads (handicap). */
  point?: number;
  description?: string;
}

export interface OddsApiMarket {
  /** v4 market key: "h2h" | "totals" | "spreads" | "btts" | ... */
  key?: string;
  last_update?: string;
  outcomes?: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  /** v4 bookmaker key, e.g. "draftkings" — matched against the config value. */
  key?: string;
  title?: string;
  last_update?: string;
  markets?: OddsApiMarket[];
}

/**
 * Event shape shared by the odds + scores + events endpoints. The client maps
 * every v4 payload into this one shape and ADDS the `sport`/`league`/`status`
 * compatibility refs so the sync layer keeps working unchanged:
 *   - `sport.slug`  → our generic sport ("football"), derived from the group
 *   - `league.name` → `sport_title`, `league.slug` → `sport_key`
 *   - `status`      → "pending" | "live" | "settled" (derived; the-odds-api
 *                     has no status field — `completed` + `commence_time`)
 */
export interface OddsApiEvent {
  /** v4 event ids are hex strings (e.g. "e912304de2b2ce35b473ce2ecd3d1502"). */
  id: string;
  sport_key?: string;
  sport_title?: string;
  commence_time?: string;
  home_team?: string | null;
  away_team?: string | null;
  /** `/scores` only: true once the match has finished. */
  completed?: boolean;
  /** `/scores` only: final/current scores, matched to teams by `name`. */
  scores?: OddsApiScoreEntry[] | null;
  last_update?: string | null;
  /** `/odds` only: per-bookmaker markets. */
  bookmakers?: OddsApiBookmaker[];
  /** Compatibility refs filled by the client (see above). */
  sport?: OddsApiSportRef;
  league?: OddsApiLeagueRef;
  status?: string;
}

/**
 * Odds response for one event — in v4 this is the same event shape with the
 * `bookmakers` array populated (the odds endpoints return arrays of these).
 */
export type OddsApiOddsResponse = OddsApiEvent;

/* -------------------------------------------------------------------------- */
/*  Internal normalized shapes (map 1:1 onto existing DB columns)             */
/* -------------------------------------------------------------------------- */

export type NormalizedStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled';

export interface NormalizedSelection {
  /** Existing selection label convention: Home/Draw/Away, Over/Under, Yes/No. */
  label: string;
  oddsDecimal: number;
}

export interface NormalizedMarket {
  /** Existing sports_markets.market_type, e.g. '1x2', 'over_under_2_5', 'btts'. */
  marketType: string;
  /** Existing sports_markets.label, e.g. 'Full Time Result'. */
  label: string;
  selections: NormalizedSelection[];
}

export interface NormalizedEvent {
  providerEventId: string;
  sport: string;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  startsAt: string; // ISO
  status: NormalizedStatus;
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
}
