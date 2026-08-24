/**
 * Canonical league naming for the-odds-api soccer competitions.
 *
 * WHY THIS EXISTS
 * ---------------
 * The whole user panel (country flags, the country→league sidebar tree, and the
 * "Top Leagues" shortcuts) was built around the previous provider's naming
 * convention: "Country - League" (e.g. "Germany - Bundesliga"). The flag/country
 * for a fixture is derived by splitting the league on the FIRST " - " and taking
 * the left side as the country.
 *
 * the-odds-api returns league display titles that DON'T follow that convention —
 * they come back as "Bundesliga - Germany", "La Liga - Spain", "EPL",
 * "Allsvenskan - Sweden", etc. That breaks:
 *   1. Country/flag resolution (wrong or missing flag, league grouped under
 *      "Other").
 *   2. Top-League shortcuts (they send "England - Premier League" but the stored
 *      fixture is "EPL", so the board is empty → "No upcoming matches").
 *
 * The reliable, stable key for each competition is the provider `sport_key`
 * (soccer_epl, soccer_germany_bundesliga, …). This module maps every soccer
 * sport_key our account returns onto a canonical { country, league } pair so the
 * ingested fixture's `league` is stored as "Country - League" — the exact shape
 * the frontend already understands. The country strings match the names in the
 * user panel's flag catalog so the correct flag resolves.
 *
 * It also exposes `resolveLeagueName()` which maps common Top-League name
 * variants (old spellings / admin-configured strings / raw provider titles) back
 * onto the canonical name, so a Top-League click matches regardless of the exact
 * wording that was configured.
 */

export interface LeagueInfo {
  /** Country name — MUST match the user-panel flag catalog for the flag to show. */
  country: string;
  /** Clean league display name. */
  league: string;
  /** Extra name strings (admin/legacy/raw-provider) that resolve to this league. */
  aliases?: string[];
}

/**
 * provider sport_key → canonical { country, league }.
 * Extend this as new soccer_* keys appear in the /sports feed; unknown keys fall
 * back to the provider's own title (see canonicalLeague).
 */
export const LEAGUE_BY_KEY: Record<string, LeagueInfo> = {
  soccer_argentina_primera_division: { country: 'Argentina', league: 'Primera División' },
  soccer_austria_bundesliga: { country: 'Austria', league: 'Bundesliga', aliases: ['Austrian Football Bundesliga'] },
  soccer_belgium_first_div: { country: 'Belgium', league: 'Pro League', aliases: ['Belgium - First Division A', 'Belgium - Jupiler Pro League', 'Belgium First Div'] },
  soccer_brazil_campeonato: { country: 'Brazil', league: 'Série A', aliases: ['Brazil Série A', 'Brazil - Serie A'] },
  soccer_brazil_serie_b: { country: 'Brazil', league: 'Série B', aliases: ['Brazil Série B', 'Brazil - Serie B'] },
  soccer_chile_campeonato: { country: 'Chile', league: 'Primera División' },
  soccer_china_superleague: { country: 'China', league: 'Super League' },
  soccer_concacaf_leagues_cup: { country: 'North America', league: 'Leagues Cup' },
  soccer_conmebol_copa_libertadores: { country: 'South America', league: 'Copa Libertadores' },
  soccer_conmebol_copa_sudamericana: { country: 'South America', league: 'Copa Sudamericana' },
  soccer_denmark_superliga: { country: 'Denmark', league: 'Superliga', aliases: ['Denmark - Superligaen', 'Denmark Superliga'] },
  soccer_efl_champ: { country: 'England', league: 'Championship' },
  soccer_england_efl_cup: { country: 'England', league: 'EFL Cup', aliases: ['England - Carabao Cup'] },
  soccer_england_league1: { country: 'England', league: 'League One', aliases: ['England - League 1'] },
  soccer_england_league2: { country: 'England', league: 'League Two', aliases: ['England - League 2'] },
  soccer_epl: { country: 'England', league: 'Premier League', aliases: ['EPL', 'England - EPL'] },
  soccer_france_ligue_one: { country: 'France', league: 'Ligue 1', aliases: ['Ligue 1 - France'] },
  soccer_france_ligue_two: { country: 'France', league: 'Ligue 2', aliases: ['Ligue 2 - France'] },
  soccer_germany_bundesliga: { country: 'Germany', league: 'Bundesliga', aliases: ['Bundesliga - Germany'] },
  soccer_germany_bundesliga2: { country: 'Germany', league: '2. Bundesliga', aliases: ['Bundesliga 2 - Germany', 'Germany - Bundesliga 2'] },
  soccer_germany_bundesliga_women: { country: 'Germany', league: 'Frauen-Bundesliga' },
  soccer_germany_dfb_pokal: { country: 'Germany', league: 'DFB-Pokal' },
  soccer_germany_liga3: { country: 'Germany', league: '3. Liga', aliases: ['3. Liga - Germany'] },
  soccer_greece_super_league: { country: 'Greece', league: 'Super League' },
  soccer_italy_serie_a: { country: 'Italy', league: 'Serie A', aliases: ['Serie A - Italy'] },
  soccer_italy_serie_b: { country: 'Italy', league: 'Serie B', aliases: ['Serie B - Italy'] },
  soccer_japan_j_league: { country: 'Japan', league: 'J1 League', aliases: ['J League', 'Japan - J League'] },
  soccer_korea_kleague1: { country: 'South Korea', league: 'K League 1', aliases: ['K League 1'] },
  soccer_league_of_ireland: { country: 'Ireland', league: 'Premier Division', aliases: ['League of Ireland'] },
  soccer_mexico_ligamx: { country: 'Mexico', league: 'Liga MX' },
  soccer_netherlands_eredivisie: { country: 'Netherlands', league: 'Eredivisie', aliases: ['Dutch Eredivisie'] },
  soccer_norway_eliteserien: { country: 'Norway', league: 'Eliteserien', aliases: ['Eliteserien - Norway'] },
  soccer_poland_ekstraklasa: { country: 'Poland', league: 'Ekstraklasa', aliases: ['Ekstraklasa - Poland'] },
  soccer_portugal_primeira_liga: { country: 'Portugal', league: 'Liga Portugal', aliases: ['Primeira Liga - Portugal', 'Portugal - Primeira Liga'] },
  soccer_russia_premier_league: { country: 'Russia', league: 'Premier League', aliases: ['Premier League - Russia'] },
  soccer_saudi_arabia_pro_league: { country: 'Saudi Arabia', league: 'Pro League', aliases: ['Saudi Pro League'] },
  soccer_spain_la_liga: { country: 'Spain', league: 'La Liga', aliases: ['La Liga - Spain', 'Spain - LaLiga', 'LaLiga'] },
  soccer_spain_segunda_division: { country: 'Spain', league: 'La Liga 2', aliases: ['La Liga 2 - Spain', 'Spain - Segunda Division'] },
  soccer_spl: { country: 'Scotland', league: 'Premiership', aliases: ['Premiership - Scotland', 'Scotland - Premiership'] },
  soccer_sweden_allsvenskan: { country: 'Sweden', league: 'Allsvenskan', aliases: ['Allsvenskan - Sweden'] },
  soccer_sweden_superettan: { country: 'Sweden', league: 'Superettan', aliases: ['Superettan - Sweden'] },
  soccer_switzerland_superleague: { country: 'Switzerland', league: 'Super League', aliases: ['Swiss Superleague'] },
  soccer_turkey_super_league: { country: 'Turkiye', league: 'Süper Lig', aliases: ['Turkey Super League', 'Turkey - Super Lig', 'Turkiye - Super Lig'] },
  soccer_uefa_champs_league_qualification: { country: 'Europe', league: 'Champions League Qualification', aliases: ['UEFA Champions League Qualification'] },
  soccer_uefa_nations_league: { country: 'Europe', league: 'UEFA Nations League' },
  soccer_usa_mls: { country: 'USA', league: 'MLS' },
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Canonical "Country - League" for a fixture. Uses the provider sport_key when
 * known; otherwise falls back to the provider's own title so an unmapped league
 * is never dropped (it just keeps the raw name until we add it to the map).
 */
export function canonicalLeague(
  sportKey?: string | null,
  fallbackTitle?: string | null
): string | null {
  const key = (sportKey ?? '').trim().toLowerCase();
  const info = key ? LEAGUE_BY_KEY[key] : undefined;
  if (info) return `${info.country} - ${info.league}`;
  return (fallbackTitle ?? '').trim() || null;
}

// Reverse index: every known spelling (canonical, "League - Country", bare
// league, raw provider title alias) → canonical name.
const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const info of Object.values(LEAGUE_BY_KEY)) {
  const canonical = `${info.country} - ${info.league}`;
  const add = (s?: string) => {
    if (s && s.trim()) ALIAS_TO_CANONICAL.set(norm(s), canonical);
  };
  add(canonical);
  add(`${info.league} - ${info.country}`);
  add(info.league);
  for (const a of info.aliases ?? []) add(a);
}

/**
 * Resolve a league filter string (from a Top-League shortcut, admin config, or
 * the catalog) to the canonical stored name. Returns the input unchanged when we
 * have no mapping, so non-soccer / unmapped leagues keep working exactly as
 * before.
 */
export function resolveLeagueName(input: string): string {
  if (!input) return input;
  return ALIAS_TO_CANONICAL.get(norm(input)) ?? input;
}
