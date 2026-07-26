/**
 * Odds-API.io (v3) wire types + the internal normalized shapes the sync layer
 * writes into the EXISTING sports_events / sports_markets / sports_selections
 * tables. Grounded in https://docs.odds-api.io (SimpleEventDto + /odds).
 *
 * Nothing here is imported by existing sportsbook code — it only feeds the
 * background sync. Kept deliberately permissive (optional fields) because the
 * upstream payload varies by sport / plan / bookmaker.
 */

/* -------------------------------------------------------------------------- */
/*  Upstream (Odds-API.io) wire shapes                                        */
/* -------------------------------------------------------------------------- */

export interface OddsApiSportRef {
  name?: string;
  slug?: string;
}

export interface OddsApiLeagueRef {
  /** e.g. "England - Premier League" — matches our league string convention. */
  name?: string;
  slug?: string;
}

export interface OddsApiPeriodScore {
  home?: number;
  away?: number;
}

export interface OddsApiScore {
  home?: number;
  away?: number;
  periods?: Record<string, OddsApiPeriodScore>;
}

export interface OddsApiClock {
  minute?: number;
  playedSeconds?: number;
  period?: number;
  running?: boolean;
  statusDetail?: string;
  injuryTime?: number;
}

/** `GET /events` item (dto.SimpleEventDto). */
export interface OddsApiEvent {
  id: number;
  home?: string;
  away?: string;
  homeId?: number;
  awayId?: number;
  bookmakerCount?: number;
  date?: string;
  status?: string; // pending | live | settled | cancelled
  league?: OddsApiLeagueRef;
  sport?: OddsApiSportRef;
  scores?: OddsApiScore;
  clock?: OddsApiClock;
}

/** A single row inside a market's `odds` array (shape varies by market). */
export interface OddsApiOddsRow {
  home?: string;
  draw?: string;
  away?: string;
  over?: string;
  under?: string;
  yes?: string;
  no?: string;
  max?: number; // total line for Over/Under
  hdp?: number; // handicap line
  [key: string]: string | number | undefined;
}

export interface OddsApiMarket {
  name?: string; // "ML" | "Over/Under" | "Both Teams to Score" | ...
  odds?: OddsApiOddsRow[];
  updatedAt?: string;
}

/** `GET /odds?eventId=` response. `bookmakers` maps bookmaker name → markets. */
export interface OddsApiOddsResponse {
  id: number;
  home?: string;
  away?: string;
  date?: string;
  status?: string;
  bookmakers?: Record<string, OddsApiMarket[]>;
}

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
