// Sample matches for a given league. Used by the home page when a user clicks
// a league in the left sidebar (or when the home page is opened directly with
// ?country=...&league=...&sport=...).
//
// Real team rosters are provided for the major football leagues. Any other
// league (and every non-football sport) falls back to a generic
// "<League> Team N / <League> Player N" placeholder so every league from the
// sports catalog produces a usable match list.

import { type Sport } from "./sportsCatalog";

export interface SampleMatchOdds {
  home: number;
  /** 0 for 2-way sports (tennis, basketball, ...). */
  draw: number;
  away: number;
  home1x: number;
  draw12: number;
  away2x: number;
  yesScore: number;
  noScore: number;
}

export interface SampleMatch {
  league: string;
  leagueFlag: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  time: string;
  sideBets: number;
  odds: SampleMatchOdds;
}

// Known real team rosters, keyed by full "<Country> - <League>" name.
const teamsByLeague: Record<string, string[]> = {
  "Germany - Bundesliga": [
    "Bayer 04 Leverkusen", "FC Augsburg",
    "SV Werder Bremen", "Hamburger SV",
    "Union Berlin", "VfL Wolfsburg",
    "TSG 1899 Hoffenheim", "Borussia Dortmund",
    "Eintracht Frankfurt", "RB Leipzig",
    "Sport-Club Freiburg", "1. FC Heidenheim 1846",
    "FC Bayern Munich", "VfB Stuttgart",
    "Borussia Monchengladbach", "FSV Mainz",
  ],
  "Germany - 2. Bundesliga": [
    "Hertha BSC", "Hannover 96",
    "Fortuna Düsseldorf", "Schalke 04",
    "Hamburger SV II", "Karlsruher SC",
    "FC Nürnberg", "SV Elversberg",
    "Greuther Fürth", "Eintracht Braunschweig",
  ],
  "England - Premier League": [
    "Manchester City", "Manchester United",
    "Arsenal", "Liverpool",
    "Chelsea", "Tottenham Hotspur",
    "Newcastle United", "Brighton & Hove Albion",
    "Aston Villa", "West Ham United",
    "Everton", "Crystal Palace",
    "Fulham", "Brentford",
    "Wolverhampton", "Nottingham Forest",
    "Bournemouth", "Leicester City",
  ],
  "England - Championship": [
    "Leeds United", "Sheffield United",
    "Burnley", "Norwich City",
    "Middlesbrough", "Preston North End",
    "Cardiff City", "Bristol City",
    "Swansea City", "Queens Park Rangers",
  ],
  "Spain - La Liga": [
    "Real Madrid", "FC Barcelona",
    "Atletico Madrid", "Sevilla",
    "Real Sociedad", "Villarreal",
    "Valencia", "Athletic Bilbao",
    "Real Betis", "Girona",
    "Osasuna", "Celta Vigo",
    "Mallorca", "Rayo Vallecano",
    "Las Palmas", "Getafe",
  ],
  "Italy - Serie A": [
    "Juventus", "Inter Milan",
    "AC Milan", "Napoli",
    "AS Roma", "Lazio",
    "Atalanta", "Fiorentina",
    "Bologna", "Torino",
    "Udinese", "Genoa",
    "Como", "Empoli",
    "Cagliari", "Hellas Verona",
  ],
  "Italy - Serie B": [
    "Palermo", "Parma",
    "Sampdoria", "Cremonese",
    "Pisa", "Brescia",
    "Bari", "Spezia",
  ],
  "France - Ligue 1": [
    "Paris Saint-Germain", "AS Monaco",
    "Marseille", "Lyon",
    "Lille", "Nice",
    "Rennes", "Lens",
    "Strasbourg", "Nantes",
    "Montpellier", "Toulouse",
    "Reims", "Brest",
    "Auxerre", "Angers",
  ],
  "Portugal - Primeira Liga": [
    "SL Benfica", "FC Porto",
    "Sporting CP", "SC Braga",
    "Vitória SC", "Boavista",
    "Rio Ave", "Famalicão",
  ],
  "Netherlands - Eredivisie": [
    "Ajax", "PSV Eindhoven",
    "Feyenoord", "AZ Alkmaar",
    "FC Twente", "FC Utrecht",
    "Vitesse", "Heerenveen",
  ],
  "Brazil - Série A": [
    "Flamengo", "Palmeiras",
    "São Paulo", "Corinthians",
    "Santos", "Atlético Mineiro",
    "Grêmio", "Internacional",
    "Fluminense", "Botafogo",
  ],
  "Argentina - Primera División": [
    "Boca Juniors", "River Plate",
    "Racing Club", "Independiente",
    "San Lorenzo", "Estudiantes",
    "Velez Sarsfield", "Newell's Old Boys",
  ],
  "USA - MLS": [
    "LA Galaxy", "Inter Miami",
    "Seattle Sounders", "LAFC",
    "New York City FC", "Atlanta United",
    "Portland Timbers", "Toronto FC",
  ],
  "Turkiye - Süper Lig": [
    "Galatasaray", "Fenerbahçe",
    "Beşiktaş", "Trabzonspor",
    "Başakşehir", "Adana Demirspor",
  ],
  "Saudi Arabia - Pro League": [
    "Al-Hilal", "Al-Nassr",
    "Al-Ittihad", "Al-Ahli",
    "Al-Fateh", "Al-Taawoun",
  ],
  "Scotland - Premiership": [
    "Celtic", "Rangers",
    "Hearts", "Hibernian",
    "Aberdeen", "Motherwell",
  ],
  "Belgium - Jupiler Pro League": [
    "Club Brugge", "Anderlecht",
    "Genk", "Standard Liege",
    "Antwerp", "Gent",
  ],
};

// Deterministic pseudo-random so a given (league, index) always produces the
// same odds/side-bet count (prevents flicker between renders).
function rng(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function round(n: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function makeOdds(seed: number, hasDraw: boolean = true): SampleMatchOdds {
  return {
    home: round(1.2 + rng(seed + 1) * 5.5),
    draw: hasDraw ? round(2.8 + rng(seed + 2) * 2.2) : 0,
    away: round(1.3 + rng(seed + 3) * 5.0),
    home1x: round(1.05 + rng(seed + 4) * 1.3),
    draw12: round(1.08 + rng(seed + 5) * 1.1),
    away2x: round(1.05 + rng(seed + 6) * 2.2),
    yesScore: round(1.55 + rng(seed + 7) * 0.6),
    noScore: round(1.55 + rng(seed + 8) * 0.6),
  };
}

// Match schedule is generated relative to "today" so the time filters on the
// home page (1hr / 2hr / 3hr / 6hr / Today / Calendar) always have real hits
// against the sample data, regardless of when the dev server was started.
const _today = new Date();
const _fmtDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
const _plusDays = (days: number) => {
  const d = new Date(_today);
  d.setDate(d.getDate() + days);
  return _fmtDate(d);
};
const DATES = [
  _plusDays(0), _plusDays(0), _plusDays(0), _plusDays(0),
  _plusDays(1), _plusDays(1),
  _plusDays(2), _plusDays(2),
];
const TIMES = ["10:30", "12:30", "15:00", "17:30", "19:30", "21:00", "13:00", "19:00"];

/**
 * Football-only variant kept for backward compatibility with any caller that
 * didn't pass a sport. Internally delegates to the sport-aware helper with
 * a football-shaped fallback (3-way odds, "Club" roster labels).
 */
export function getMatchesForLeague(
  fullLeagueName: string,
  leagueFlag: string,
): SampleMatch[] {
  return buildMatches(fullLeagueName, leagueFlag, {
    hasDraw: true,
    rosterLabel: "Club",
  });
}

/**
 * Sport-aware generator. Produces matches suitable for any sport defined in
 * the catalog, handling 2-way vs 3-way odds and nicer roster labels
 * (e.g. "Player" for tennis).
 */
export function getMatchesForSportLeague(
  sport: Sport,
  fullLeagueName: string,
  leagueFlag: string,
): SampleMatch[] {
  const rosterLabel =
    sport.key === "tennis" || sport.key === "tableTennis"
      ? "Player"
      : sport.key === "cricket"
        ? "XI"
        : "Team";

  return buildMatches(fullLeagueName, leagueFlag, {
    hasDraw: sport.hasDraw,
    rosterLabel,
  });
}

function buildMatches(
  fullLeagueName: string,
  leagueFlag: string,
  opts: { hasDraw: boolean; rosterLabel: string },
): SampleMatch[] {
  const teams = teamsByLeague[fullLeagueName];

  // Build a working roster (real teams if we have them, otherwise 12 generic).
  const roster: string[] = teams && teams.length >= 2
    ? teams
    : Array.from({ length: 12 }, (_, i) =>
        `${fullLeagueName.split(" - ")[1] ?? opts.rosterLabel} ${opts.rosterLabel} ${i + 1}`,
      );

  // Pair teams up into matches.
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < roster.length; i += 2) {
    pairs.push([roster[i], roster[i + 1]]);
  }

  // Seed derived from league name so odds are stable across renders.
  const baseSeed = Array.from(fullLeagueName).reduce(
    (acc, ch) => acc + ch.charCodeAt(0),
    0,
  );

  return pairs.map(([home, away], idx) => ({
    league: fullLeagueName,
    leagueFlag,
    homeTeam: home,
    awayTeam: away,
    date: DATES[idx % DATES.length],
    time: TIMES[idx % TIMES.length],
    sideBets: 1100 + Math.floor(rng(baseSeed + idx) * 800),
    odds: makeOdds(baseSeed + idx * 11, opts.hasDraw),
  }));
}
