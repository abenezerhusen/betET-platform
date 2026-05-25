// Extensible sports catalog.
//
// This file is the single source of truth for every sport the app renders in
// the left sidebar and the detailed-view betting panel. Data is expressed as
// plain arrays / objects so that additional sports, countries, leagues,
// betting markets, or selections can be added at any time without touching UI
// components or rendering logic.
//
// Shape overview
//   Sport
//     ├─ countries: SportCountry[]     // drives sidebar expansion
//     └─ bettingMarkets: BettingMarket[]
//                └─ options: BetOption[]   // individual odds buttons
//
// The UI iterates these arrays generically, so a new market type or a new
// provider-supplied selection is purely a data-level change.

import {
  footballCountries,
  type FootballCountry,
} from "./footballCountries";

export interface BetOption {
  /** User-visible label for the odd (e.g. "Over 2.5", "Yes", "Home"). */
  label: string;
  /** Decimal odd for this selection. */
  odd: number;
}

export interface BettingMarket {
  /** Display name (e.g. "Match Result"). */
  name: string;
  /** Stable key used by the expanded-sections UI state. */
  key: string;
  /** Optional info icon (renders a "i" bubble next to the name). */
  hasInfo?: boolean;
  /** When true this market is grouped inside the MAIN block on top. */
  inMain?: boolean;
  /**
   * When true the market is rendered using the match-level home/draw/away
   * odds (i.e. the fundamental 1/X/2 or 1/2 line). Options are ignored.
   */
  hasMainOdds?: boolean;
  /** Explicit option list (for any market that isn't main 1X2). */
  options?: BetOption[];
}

export interface SportCountry {
  name: string;
  flag: string;
  leagues: string[];
  /** Displayed count next to the country row. */
  count: number;
}

export interface SportSelection {
  /** Selection code shown inside the button ("1", "X", "2", "Home", ...). */
  code: string;
  /** Where to pick the odd from on the generated SampleMatch.odds object. */
  pick: "home" | "draw" | "away";
}

export interface Sport {
  /** Stable identifier used in URLs and look-ups. */
  key: string;
  /** Short label shown in the sidebar (matches current truncated labels). */
  name: string;
  /** Long, human-readable name. */
  fullName: string;
  /** Icon URL for the sidebar row. */
  icon: string;
  /** Count shown next to the sport name. */
  count: number;
  /** True when the main market supports a draw ("X" column). */
  hasDraw: boolean;
  /** Selections rendered in the middle-panel quick-pick buttons. */
  mainSelections: SportSelection[];
  /** Name of the main market (e.g. "Match Result", "Moneyline"). */
  mainMarketName: string;
  /** Hierarchical countries → leagues list for sidebar expansion. */
  countries: SportCountry[];
  /** Full list of betting markets shown in the detailed view. */
  bettingMarkets: BettingMarket[];
}

// Shared helpers ------------------------------------------------------------

const GLOBE = "https://ext.same-assets.com/1203561035/3182885345.svg";
const flag = (code: string) => `https://flagcdn.com/w40/${code}.png`;

const SEL_3WAY: SportSelection[] = [
  { code: "1", pick: "home" },
  { code: "X", pick: "draw" },
  { code: "2", pick: "away" },
];

const SEL_2WAY: SportSelection[] = [
  { code: "1", pick: "home" },
  { code: "2", pick: "away" },
];

// ---------------------------------------------------------------------------
// FOOTBALL
// ---------------------------------------------------------------------------

const footballMarkets: BettingMarket[] = [
  { name: "To Qualify", key: "toQualify", inMain: true,
    options: [{ label: "1", odd: 1.75 }, { label: "2", odd: 1.89 }] },
  { name: "Match Result", key: "matchResult", inMain: true, hasMainOdds: true },
  { name: "1UP", key: "1up", hasInfo: true, inMain: true,
    options: [{ label: "1", odd: 1.26 }, { label: "X", odd: 4.09 }, { label: "2", odd: 2.38 }] },
  { name: "2UP", key: "2up", hasInfo: true, inMain: true,
    options: [{ label: "1", odd: 1.53 }, { label: "X", odd: 4.09 }, { label: "2", odd: 5.20 }] },
  { name: "Double Chance", key: "doubleChance",
    options: [{ label: "1X", odd: 1.38 }, { label: "12", odd: 1.25 }, { label: "X2", odd: 1.44 }] },
  { name: "Both Teams to Score", key: "bothScore",
    options: [{ label: "Yes", odd: 1.60 }, { label: "No", odd: 2.07 }] },
  { name: "Correct Score", key: "correctScore", options: [
    { label: "1-0", odd: 8.50 }, { label: "2-0", odd: 12.0 }, { label: "2-1", odd: 11.0 },
    { label: "3-0", odd: 20.0 }, { label: "3-1", odd: 18.0 }, { label: "3-2", odd: 25.0 },
    { label: "0-0", odd: 9.00 }, { label: "1-1", odd: 6.50 }, { label: "2-2", odd: 15.0 },
    { label: "0-1", odd: 11.0 }, { label: "0-2", odd: 18.0 }, { label: "1-2", odd: 13.0 },
  ]},
  { name: "Draw No Bet", key: "drawNoBet",
    options: [{ label: "1", odd: 1.52 }, { label: "2", odd: 1.62 }] },
  { name: "Goals Odd/Even", key: "goalsOddEven",
    options: [{ label: "Odd", odd: 1.88 }, { label: "Even", odd: 1.88 }] },
  { name: "Home Team Goals Odd/Even", key: "homeGoalsOddEven",
    options: [{ label: "Odd", odd: 1.95 }, { label: "Even", odd: 1.80 }] },
  { name: "Away Team Goals Odd/Even", key: "awayGoalsOddEven",
    options: [{ label: "Odd", odd: 1.90 }, { label: "Even", odd: 1.85 }] },
  { name: "Half Time/Full Time", key: "htft", options: [
    { label: "Home/Home", odd: 4.20 }, { label: "Home/Draw", odd: 12.0 }, { label: "Home/Away", odd: 25.0 },
    { label: "Draw/Home", odd: 6.50 }, { label: "Draw/Draw", odd: 8.00 }, { label: "Draw/Away", odd: 9.50 },
    { label: "Away/Home", odd: 35.0 }, { label: "Away/Draw", odd: 18.0 }, { label: "Away/Away", odd: 7.00 },
  ]},
  { name: "Highest Scoring Half", key: "highestHalf",
    options: [{ label: "1st Half", odd: 2.80 }, { label: "2nd Half", odd: 2.10 }, { label: "Equal", odd: 3.50 }] },
  { name: "Next Goal", key: "nextGoal",
    options: [{ label: "Home", odd: 1.85 }, { label: "Away", odd: 1.95 }, { label: "No Goal", odd: 4.50 }] },
  { name: "Goals", key: "goals", options: [
    { label: "Over 0.5", odd: 1.08 }, { label: "Under 0.5", odd: 7.50 },
    { label: "Over 1.5", odd: 1.30 }, { label: "Under 1.5", odd: 3.25 },
    { label: "Over 2.5", odd: 1.95 }, { label: "Under 2.5", odd: 1.78 },
    { label: "Over 3.5", odd: 3.40 }, { label: "Under 3.5", odd: 1.28 },
    { label: "Over 4.5", odd: 6.50 }, { label: "Under 4.5", odd: 1.08 },
  ]},
  { name: "Handicap", key: "handicap", options: [
    { label: "Home -1", odd: 3.80 }, { label: "Home -2", odd: 7.50 },
    { label: "Away +1", odd: 1.45 }, { label: "Away +2", odd: 1.18 },
  ]},
  { name: "Specials", key: "specials", options: [
    { label: "Red Card - Yes", odd: 3.40 }, { label: "Red Card - No", odd: 1.28 },
    { label: "Own Goal - Yes", odd: 6.50 }, { label: "Own Goal - No", odd: 1.08 },
    { label: "Hat-Trick - Yes", odd: 9.00 }, { label: "Hat-Trick - No", odd: 1.05 },
    { label: "BTTS Both Halves - Yes", odd: 5.50 }, { label: "BTTS Both Halves - No", odd: 1.14 },
    { label: "Clean Sheet Home - Yes", odd: 2.75 }, { label: "Clean Sheet Home - No", odd: 1.42 },
    { label: "Clean Sheet Away - Yes", odd: 3.20 }, { label: "Clean Sheet Away - No", odd: 1.32 },
  ]},
  { name: "Minutes", key: "minutes", options: [
    { label: "1st Goal 1-15 min", odd: 3.80 }, { label: "1st Goal 16-30 min", odd: 4.20 },
    { label: "1st Goal 31-45 min", odd: 4.50 }, { label: "1st Goal 46-60 min", odd: 5.00 },
    { label: "1st Goal 61-75 min", odd: 6.25 }, { label: "1st Goal 76-90 min", odd: 7.50 },
    { label: "No Goal", odd: 9.00 },
  ]},
  { name: "1st Half", key: "firstHalf", options: [
    { label: "1st Half Result 1", odd: 3.20 }, { label: "1st Half Result X", odd: 2.10 }, { label: "1st Half Result 2", odd: 4.50 },
    { label: "1st Half Over 0.5", odd: 1.45 }, { label: "1st Half Under 0.5", odd: 2.65 },
    { label: "1st Half Over 1.5", odd: 2.80 }, { label: "1st Half Under 1.5", odd: 1.38 },
  ]},
  { name: "2nd Half", key: "secondHalf", options: [
    { label: "2nd Half Result 1", odd: 2.95 }, { label: "2nd Half Result X", odd: 2.30 }, { label: "2nd Half Result 2", odd: 4.20 },
    { label: "2nd Half Over 0.5", odd: 1.50 }, { label: "2nd Half Under 0.5", odd: 2.50 },
    { label: "2nd Half Over 1.5", odd: 2.60 }, { label: "2nd Half Under 1.5", odd: 1.42 },
  ]},
  { name: "Statistics", key: "statistics", options: [
    { label: "Total Corners Over 9.5", odd: 1.85 }, { label: "Total Corners Under 9.5", odd: 1.88 },
    { label: "Total Cards Over 3.5", odd: 1.65 }, { label: "Total Cards Under 3.5", odd: 2.10 },
    { label: "Total Fouls Over 22.5", odd: 1.78 }, { label: "Total Fouls Under 22.5", odd: 1.92 },
    { label: "Total Shots Over 25.5", odd: 1.80 }, { label: "Total Shots Under 25.5", odd: 1.90 },
    { label: "Shots on Target Over 9.5", odd: 1.75 }, { label: "Shots on Target Under 9.5", odd: 1.95 },
  ]},
  { name: "Penalty", key: "penalty",
    options: [{ label: "Penalty Yes", odd: 3.50 }, { label: "Penalty No", odd: 1.25 }] },
  { name: "Corners", key: "corners", options: [
    { label: "Over 8.5", odd: 1.65 }, { label: "Under 8.5", odd: 2.10 },
    { label: "Over 9.5", odd: 1.85 }, { label: "Under 9.5", odd: 1.88 },
    { label: "Over 10.5", odd: 2.15 }, { label: "Under 10.5", odd: 1.62 },
  ]},
  { name: "Yellow Cards", key: "yellowCards", options: [
    { label: "Over 2.5", odd: 1.45 }, { label: "Under 2.5", odd: 2.55 },
    { label: "Over 3.5", odd: 1.85 }, { label: "Under 3.5", odd: 1.88 },
    { label: "Over 4.5", odd: 2.45 }, { label: "Under 4.5", odd: 1.48 },
  ]},
  { name: "Fouls", key: "fouls", options: [
    { label: "Over 20.5", odd: 1.85 }, { label: "Under 20.5", odd: 1.88 },
    { label: "Over 22.5", odd: 2.00 }, { label: "Under 22.5", odd: 1.75 },
    { label: "Over 24.5", odd: 2.35 }, { label: "Under 24.5", odd: 1.55 },
    { label: "Home Fouls Over 10.5", odd: 1.90 }, { label: "Home Fouls Under 10.5", odd: 1.85 },
    { label: "Away Fouls Over 10.5", odd: 1.92 }, { label: "Away Fouls Under 10.5", odd: 1.82 },
  ]},
  { name: "Throw-ins", key: "throwIns", options: [
    { label: "Over 35.5", odd: 1.72 }, { label: "Under 35.5", odd: 2.00 },
    { label: "Over 40.5", odd: 1.95 }, { label: "Under 40.5", odd: 1.80 },
    { label: "Over 45.5", odd: 2.30 }, { label: "Under 45.5", odd: 1.58 },
  ]},
  { name: "Saves", key: "saves", options: [
    { label: "Over 6.5", odd: 1.68 }, { label: "Under 6.5", odd: 2.05 },
    { label: "Over 8.5", odd: 2.00 }, { label: "Under 8.5", odd: 1.75 },
    { label: "Over 10.5", odd: 2.55 }, { label: "Under 10.5", odd: 1.45 },
  ]},
  { name: "Offsides", key: "offsides", options: [
    { label: "Over 3.5", odd: 1.72 }, { label: "Under 3.5", odd: 2.00 },
    { label: "Over 4.5", odd: 2.10 }, { label: "Under 4.5", odd: 1.65 },
    { label: "Over 5.5", odd: 2.75 }, { label: "Under 5.5", odd: 1.42 },
  ]},
  { name: "Shots", key: "shots", options: [
    { label: "Over 22.5", odd: 1.75 }, { label: "Under 22.5", odd: 1.95 },
    { label: "Over 25.5", odd: 1.95 }, { label: "Under 25.5", odd: 1.80 },
    { label: "Over 28.5", odd: 2.30 }, { label: "Under 28.5", odd: 1.58 },
  ]},
  { name: "Shots on Target", key: "shotsOnTarget", options: [
    { label: "Over 7.5", odd: 1.62 }, { label: "Under 7.5", odd: 2.15 },
    { label: "Over 9.5", odd: 1.90 }, { label: "Under 9.5", odd: 1.85 },
    { label: "Over 11.5", odd: 2.40 }, { label: "Under 11.5", odd: 1.52 },
  ]},
  { name: "Goal Kicks", key: "goalKicks", options: [
    { label: "Over 14.5", odd: 1.75 }, { label: "Under 14.5", odd: 1.95 },
    { label: "Over 16.5", odd: 2.00 }, { label: "Under 16.5", odd: 1.75 },
    { label: "Over 18.5", odd: 2.45 }, { label: "Under 18.5", odd: 1.50 },
  ]},
  { name: "Substitutions", key: "substitutions", options: [
    { label: "Over 6.5", odd: 1.55 }, { label: "Under 6.5", odd: 2.35 },
    { label: "Over 7.5", odd: 1.85 }, { label: "Under 7.5", odd: 1.88 },
    { label: "Over 8.5", odd: 2.40 }, { label: "Under 8.5", odd: 1.52 },
  ]},
  { name: "Players", key: "players", options: [
    { label: "Anytime Goalscorer - Home Star", odd: 1.85 },
    { label: "Anytime Goalscorer - Away Star", odd: 2.10 },
    { label: "First Goalscorer - Home Star", odd: 4.50 },
    { label: "First Goalscorer - Away Star", odd: 5.00 },
    { label: "Last Goalscorer - Home Star", odd: 4.75 },
    { label: "Last Goalscorer - Away Star", odd: 5.25 },
    { label: "Hat-Trick - Home Star", odd: 15.0 },
    { label: "Hat-Trick - Away Star", odd: 18.0 },
    { label: "To Be Booked - Home Player", odd: 3.25 },
    { label: "To Be Booked - Away Player", odd: 3.40 },
    { label: "No Goalscorer", odd: 9.50 },
  ]},
  { name: "Extra Time", key: "extraTime",
    options: [{ label: "Extra Time Yes", odd: 4.50 }, { label: "Extra Time No", odd: 1.15 }] },
];

// ---------------------------------------------------------------------------
// BASKETBALL
// ---------------------------------------------------------------------------

const basketballCountries: SportCountry[] = [
  { name: "USA", flag: flag("us"), leagues: ["NBA", "NCAA", "WNBA", "NBA G League"], count: 42 },
  { name: "Europe", flag: GLOBE, leagues: ["EuroLeague", "EuroCup", "Champions League", "FIBA Europe Cup"], count: 36 },
  { name: "Spain", flag: flag("es"), leagues: ["Liga ACB", "LEB Oro", "Copa del Rey"], count: 16 },
  { name: "Germany", flag: flag("de"), leagues: ["BBL", "ProA", "BBL Pokal"], count: 14 },
  { name: "Italy", flag: flag("it"), leagues: ["Serie A", "Serie A2", "Coppa Italia"], count: 12 },
  { name: "Turkey", flag: flag("tr"), leagues: ["BSL", "TB2L"], count: 10 },
  { name: "Greece", flag: flag("gr"), leagues: ["Basket League", "A2"], count: 8 },
  { name: "China", flag: flag("cn"), leagues: ["CBA", "WCBA"], count: 10 },
  { name: "Australia", flag: flag("au"), leagues: ["NBL", "WNBL"], count: 8 },
  { name: "Argentina", flag: flag("ar"), leagues: ["Liga Nacional"], count: 6 },
  { name: "International", flag: GLOBE, leagues: ["FIBA World Cup", "Olympics", "FIBA AmeriCup"], count: 12 },
];

const basketballMarkets: BettingMarket[] = [
  { name: "Moneyline", key: "moneyline", inMain: true, hasMainOdds: true },
  { name: "Point Spread", key: "spread", inMain: true, options: [
    { label: "Home -4.5", odd: 1.85 }, { label: "Away +4.5", odd: 1.95 },
    { label: "Home -6.5", odd: 2.10 }, { label: "Away +6.5", odd: 1.72 },
    { label: "Home -8.5", odd: 2.45 }, { label: "Away +8.5", odd: 1.52 },
  ]},
  { name: "Total Points", key: "totalPoints", inMain: true, options: [
    { label: "Over 210.5", odd: 1.90 }, { label: "Under 210.5", odd: 1.90 },
    { label: "Over 215.5", odd: 1.95 }, { label: "Under 215.5", odd: 1.85 },
    { label: "Over 220.5", odd: 2.05 }, { label: "Under 220.5", odd: 1.75 },
  ]},
  { name: "Double Result (HT/FT)", key: "htft", options: [
    { label: "Home/Home", odd: 2.10 }, { label: "Home/Away", odd: 11.0 },
    { label: "Away/Home", odd: 10.5 }, { label: "Away/Away", odd: 2.30 },
  ]},
  { name: "Highest Scoring Quarter", key: "highestQtr", options: [
    { label: "1st", odd: 3.75 }, { label: "2nd", odd: 3.40 },
    { label: "3rd", odd: 3.50 }, { label: "4th", odd: 3.25 },
  ]},
  { name: "1st Quarter Winner", key: "q1",
    options: [{ label: "Home", odd: 1.90 }, { label: "Away", odd: 1.90 }] },
  { name: "1st Half Winner", key: "halfWinner",
    options: [{ label: "Home", odd: 1.85 }, { label: "Away", odd: 1.95 }] },
  { name: "Home Team Total Points", key: "homeTotal", options: [
    { label: "Over 105.5", odd: 1.90 }, { label: "Under 105.5", odd: 1.90 },
    { label: "Over 110.5", odd: 2.00 }, { label: "Under 110.5", odd: 1.80 },
  ]},
  { name: "Away Team Total Points", key: "awayTotal", options: [
    { label: "Over 105.5", odd: 1.95 }, { label: "Under 105.5", odd: 1.85 },
    { label: "Over 110.5", odd: 2.05 }, { label: "Under 110.5", odd: 1.75 },
  ]},
  { name: "Race to 20 Points", key: "raceTo20",
    options: [{ label: "Home", odd: 1.75 }, { label: "Away", odd: 2.05 }] },
  { name: "Odd/Even Total Points", key: "oddEven",
    options: [{ label: "Odd", odd: 1.90 }, { label: "Even", odd: 1.90 }] },
  { name: "Winning Margin", key: "margin", options: [
    { label: "Home by 1-5", odd: 5.50 }, { label: "Home by 6-10", odd: 5.25 },
    { label: "Home by 11+", odd: 2.60 }, { label: "Away by 1-5", odd: 5.75 },
    { label: "Away by 6-10", odd: 5.50 }, { label: "Away by 11+", odd: 2.85 },
  ]},
  { name: "Overtime", key: "overtime",
    options: [{ label: "Yes", odd: 8.00 }, { label: "No", odd: 1.06 }] },
];

// ---------------------------------------------------------------------------
// TENNIS
// ---------------------------------------------------------------------------

const tennisCountries: SportCountry[] = [
  { name: "ATP", flag: GLOBE, leagues: ["ATP 250", "ATP 500", "ATP Masters 1000", "ATP Finals"], count: 48 },
  { name: "WTA", flag: GLOBE, leagues: ["WTA 250", "WTA 500", "WTA 1000", "WTA Finals"], count: 42 },
  { name: "Grand Slam", flag: GLOBE, leagues: ["Australian Open", "French Open", "Wimbledon", "US Open"], count: 32 },
  { name: "ITF", flag: GLOBE, leagues: ["ITF Men", "ITF Women"], count: 28 },
  { name: "Challenger", flag: GLOBE, leagues: ["ATP Challenger", "WTA 125"], count: 24 },
  { name: "Team Events", flag: GLOBE, leagues: ["Davis Cup", "Billie Jean King Cup", "United Cup"], count: 12 },
  { name: "Exhibition", flag: GLOBE, leagues: ["Laver Cup", "Exhibition Matches"], count: 4 },
];

const tennisMarkets: BettingMarket[] = [
  { name: "Match Winner", key: "winner", inMain: true, hasMainOdds: true },
  { name: "Set Betting", key: "setBetting", inMain: true, options: [
    { label: "2-0", odd: 2.10 }, { label: "2-1", odd: 3.50 },
    { label: "0-2", odd: 3.25 }, { label: "1-2", odd: 4.00 },
    { label: "3-0", odd: 3.75 }, { label: "3-1", odd: 4.50 }, { label: "3-2", odd: 6.00 },
    { label: "0-3", odd: 5.00 }, { label: "1-3", odd: 5.50 }, { label: "2-3", odd: 7.50 },
  ]},
  { name: "Total Games", key: "totalGames", inMain: true, options: [
    { label: "Over 21.5", odd: 1.90 }, { label: "Under 21.5", odd: 1.90 },
    { label: "Over 22.5", odd: 2.00 }, { label: "Under 22.5", odd: 1.80 },
    { label: "Over 23.5", odd: 2.10 }, { label: "Under 23.5", odd: 1.72 },
  ]},
  { name: "First Set Winner", key: "firstSet",
    options: [{ label: "Player 1", odd: 1.85 }, { label: "Player 2", odd: 1.95 }] },
  { name: "Total Sets", key: "totalSets",
    options: [{ label: "Over 2.5", odd: 1.85 }, { label: "Under 2.5", odd: 1.95 }] },
  { name: "Player 1 Total Games", key: "p1Games", options: [
    { label: "Over 10.5", odd: 1.90 }, { label: "Under 10.5", odd: 1.90 },
    { label: "Over 11.5", odd: 2.05 }, { label: "Under 11.5", odd: 1.75 },
  ]},
  { name: "Player 2 Total Games", key: "p2Games", options: [
    { label: "Over 10.5", odd: 1.90 }, { label: "Under 10.5", odd: 1.90 },
    { label: "Over 11.5", odd: 2.05 }, { label: "Under 11.5", odd: 1.75 },
  ]},
  { name: "Handicap Games", key: "handicapGames", options: [
    { label: "Home -3.5", odd: 1.85 }, { label: "Away +3.5", odd: 1.95 },
    { label: "Home -5.5", odd: 2.35 }, { label: "Away +5.5", odd: 1.55 },
  ]},
  { name: "Handicap Sets", key: "handicapSets",
    options: [{ label: "Home -1.5", odd: 2.55 }, { label: "Away +1.5", odd: 1.45 }] },
  { name: "Tie Break in Match", key: "tieBreak",
    options: [{ label: "Yes", odd: 1.75 }, { label: "No", odd: 2.05 }] },
  { name: "Tie Break in 1st Set", key: "tieBreakFirst",
    options: [{ label: "Yes", odd: 3.25 }, { label: "No", odd: 1.32 }] },
  { name: "Odd/Even Games", key: "oddEven",
    options: [{ label: "Odd", odd: 1.90 }, { label: "Even", odd: 1.90 }] },
];

// ---------------------------------------------------------------------------
// TABLE TENNIS
// ---------------------------------------------------------------------------

const tableTennisCountries: SportCountry[] = [
  { name: "ITTF", flag: GLOBE, leagues: ["World Championships", "World Cup", "World Tour"], count: 24 },
  { name: "WTT", flag: GLOBE, leagues: ["Champions", "Contender", "Star Contender", "Finals"], count: 32 },
  { name: "TT Cup", flag: GLOBE, leagues: ["TT Cup Men", "TT Cup Women"], count: 42 },
  { name: "Setka Cup", flag: GLOBE, leagues: ["Setka Cup"], count: 48 },
  { name: "Liga Pro", flag: GLOBE, leagues: ["Liga Pro"], count: 30 },
  { name: "Olympics", flag: GLOBE, leagues: ["Singles", "Doubles", "Team"], count: 12 },
  { name: "China", flag: flag("cn"), leagues: ["Super League"], count: 8 },
  { name: "Germany", flag: flag("de"), leagues: ["TTBL"], count: 6 },
];

const tableTennisMarkets: BettingMarket[] = [
  { name: "Match Winner", key: "winner", inMain: true, hasMainOdds: true },
  { name: "Correct Score", key: "correctScore", inMain: true, options: [
    { label: "3-0", odd: 2.75 }, { label: "3-1", odd: 3.20 }, { label: "3-2", odd: 4.50 },
    { label: "0-3", odd: 3.50 }, { label: "1-3", odd: 3.80 }, { label: "2-3", odd: 5.00 },
  ]},
  { name: "Total Sets", key: "totalSets", inMain: true, options: [
    { label: "Over 4.5", odd: 2.10 }, { label: "Under 4.5", odd: 1.70 },
    { label: "Over 5.5", odd: 3.00 }, { label: "Under 5.5", odd: 1.35 },
  ]},
  { name: "Total Points", key: "totalPoints", options: [
    { label: "Over 65.5", odd: 1.90 }, { label: "Under 65.5", odd: 1.90 },
    { label: "Over 70.5", odd: 2.00 }, { label: "Under 70.5", odd: 1.80 },
    { label: "Over 75.5", odd: 2.20 }, { label: "Under 75.5", odd: 1.65 },
  ]},
  { name: "First Set Winner", key: "firstSet",
    options: [{ label: "Home", odd: 1.85 }, { label: "Away", odd: 1.95 }] },
  { name: "Handicap Sets", key: "handicapSets", options: [
    { label: "Home -1.5", odd: 2.15 }, { label: "Away +1.5", odd: 1.70 },
    { label: "Home -2.5", odd: 3.40 }, { label: "Away +2.5", odd: 1.30 },
  ]},
  { name: "Handicap Points", key: "handicapPoints",
    options: [{ label: "Home -3.5", odd: 1.90 }, { label: "Away +3.5", odd: 1.90 }] },
  { name: "Odd/Even Points", key: "oddEven",
    options: [{ label: "Odd", odd: 1.92 }, { label: "Even", odd: 1.88 }] },
  { name: "Home Total Points", key: "homePoints",
    options: [{ label: "Over 35.5", odd: 1.90 }, { label: "Under 35.5", odd: 1.90 }] },
  { name: "Away Total Points", key: "awayPoints",
    options: [{ label: "Over 35.5", odd: 1.90 }, { label: "Under 35.5", odd: 1.90 }] },
];

// ---------------------------------------------------------------------------
// VOLLEYBALL
// ---------------------------------------------------------------------------

const volleyballCountries: SportCountry[] = [
  { name: "Italy", flag: flag("it"), leagues: ["SuperLega", "A2"], count: 12 },
  { name: "Poland", flag: flag("pl"), leagues: ["PlusLiga", "Tauron Liga"], count: 10 },
  { name: "Russia", flag: flag("ru"), leagues: ["Super League"], count: 8 },
  { name: "Turkey", flag: flag("tr"), leagues: ["Efeler Ligi", "Sultanlar Ligi"], count: 10 },
  { name: "Brazil", flag: flag("br"), leagues: ["Superliga A", "Superliga B"], count: 8 },
  { name: "Germany", flag: flag("de"), leagues: ["Bundesliga"], count: 6 },
  { name: "France", flag: flag("fr"), leagues: ["Ligue A"], count: 6 },
  { name: "USA", flag: flag("us"), leagues: ["NCAA", "LOVB"], count: 6 },
  { name: "CEV", flag: GLOBE, leagues: ["Champions League", "Cup", "Challenge Cup"], count: 10 },
  { name: "FIVB", flag: GLOBE, leagues: ["World Championship", "Nations League", "World Cup"], count: 12 },
];

const volleyballMarkets: BettingMarket[] = [
  { name: "Match Winner", key: "winner", inMain: true, hasMainOdds: true },
  { name: "Set Betting", key: "setBetting", inMain: true, options: [
    { label: "3-0", odd: 2.55 }, { label: "3-1", odd: 3.00 }, { label: "3-2", odd: 4.20 },
    { label: "0-3", odd: 3.50 }, { label: "1-3", odd: 3.80 }, { label: "2-3", odd: 5.00 },
  ]},
  { name: "Total Sets", key: "totalSets", inMain: true, options: [
    { label: "Over 3.5", odd: 1.85 }, { label: "Under 3.5", odd: 1.95 },
    { label: "Over 4.5", odd: 2.40 }, { label: "Under 4.5", odd: 1.55 },
  ]},
  { name: "Total Points", key: "totalPoints", options: [
    { label: "Over 180.5", odd: 1.90 }, { label: "Under 180.5", odd: 1.90 },
    { label: "Over 190.5", odd: 2.05 }, { label: "Under 190.5", odd: 1.75 },
    { label: "Over 200.5", odd: 2.30 }, { label: "Under 200.5", odd: 1.60 },
  ]},
  { name: "Home Team Sets", key: "homeSets",
    options: [{ label: "Over 1.5", odd: 1.75 }, { label: "Under 1.5", odd: 2.00 }] },
  { name: "Away Team Sets", key: "awaySets",
    options: [{ label: "Over 1.5", odd: 1.80 }, { label: "Under 1.5", odd: 1.95 }] },
  { name: "First Set Winner", key: "firstSet",
    options: [{ label: "Home", odd: 1.85 }, { label: "Away", odd: 1.95 }] },
  { name: "Handicap Sets", key: "handicapSets",
    options: [{ label: "Home -1.5", odd: 2.05 }, { label: "Away +1.5", odd: 1.75 }] },
  { name: "Handicap Points", key: "handicapPoints", options: [
    { label: "Home -5.5", odd: 1.90 }, { label: "Away +5.5", odd: 1.90 },
    { label: "Home -9.5", odd: 2.35 }, { label: "Away +9.5", odd: 1.55 },
  ]},
  { name: "5th Set Required", key: "fifthSet",
    options: [{ label: "Yes", odd: 3.25 }, { label: "No", odd: 1.32 }] },
  { name: "Odd/Even Points", key: "oddEven",
    options: [{ label: "Odd", odd: 1.90 }, { label: "Even", odd: 1.90 }] },
];

// ---------------------------------------------------------------------------
// ICE HOCKEY
// ---------------------------------------------------------------------------

const iceHockeyCountries: SportCountry[] = [
  { name: "USA", flag: flag("us"), leagues: ["NHL", "AHL"], count: 32 },
  { name: "Canada", flag: flag("ca"), leagues: ["NHL", "AHL", "WHL", "OHL", "QMJHL"], count: 18 },
  { name: "Russia", flag: flag("ru"), leagues: ["KHL", "VHL"], count: 16 },
  { name: "Sweden", flag: flag("se"), leagues: ["SHL", "HockeyAllsvenskan"], count: 14 },
  { name: "Finland", flag: flag("fi"), leagues: ["Liiga", "Mestis"], count: 12 },
  { name: "Switzerland", flag: flag("ch"), leagues: ["NL", "Swiss League"], count: 10 },
  { name: "Germany", flag: flag("de"), leagues: ["DEL", "DEL2"], count: 10 },
  { name: "Czech Republic", flag: flag("cz"), leagues: ["Extraliga", "Chance Liga"], count: 10 },
  { name: "Slovakia", flag: flag("sk"), leagues: ["Extraliga"], count: 6 },
  { name: "International", flag: GLOBE, leagues: ["World Championship", "Champions Hockey League", "Olympics"], count: 14 },
];

const iceHockeyMarkets: BettingMarket[] = [
  { name: "Regulation Winner", key: "reg3way", inMain: true, hasMainOdds: true },
  { name: "Moneyline (incl. OT/SO)", key: "moneyline", inMain: true,
    options: [{ label: "Home", odd: 1.85 }, { label: "Away", odd: 1.95 }] },
  { name: "Total Goals", key: "totalGoals", inMain: true, options: [
    { label: "Over 4.5", odd: 1.60 }, { label: "Under 4.5", odd: 2.30 },
    { label: "Over 5.5", odd: 1.85 }, { label: "Under 5.5", odd: 1.95 },
    { label: "Over 6.5", odd: 2.25 }, { label: "Under 6.5", odd: 1.65 },
  ]},
  { name: "Puck Line", key: "puckLine", inMain: true, options: [
    { label: "Home -1.5", odd: 2.35 }, { label: "Away +1.5", odd: 1.55 },
    { label: "Home +1.5", odd: 1.28 }, { label: "Away -1.5", odd: 3.40 },
  ]},
  { name: "Both Teams to Score", key: "btts",
    options: [{ label: "Yes", odd: 1.42 }, { label: "No", odd: 2.75 }] },
  { name: "1st Period Winner", key: "p1",
    options: [{ label: "1", odd: 2.45 }, { label: "X", odd: 2.15 }, { label: "2", odd: 2.80 }] },
  { name: "2nd Period Winner", key: "p2",
    options: [{ label: "1", odd: 2.40 }, { label: "X", odd: 2.20 }, { label: "2", odd: 2.75 }] },
  { name: "3rd Period Winner", key: "p3",
    options: [{ label: "1", odd: 2.50 }, { label: "X", odd: 2.10 }, { label: "2", odd: 2.85 }] },
  { name: "Highest Scoring Period", key: "highestPeriod",
    options: [{ label: "1st", odd: 3.40 }, { label: "2nd", odd: 2.75 }, { label: "3rd", odd: 2.50 }] },
  { name: "Overtime", key: "overtime",
    options: [{ label: "Yes", odd: 3.75 }, { label: "No", odd: 1.22 }] },
  { name: "Odd/Even Goals", key: "oddEven",
    options: [{ label: "Odd", odd: 1.90 }, { label: "Even", odd: 1.90 }] },
  { name: "First Goal", key: "firstGoal",
    options: [{ label: "Home", odd: 1.75 }, { label: "Away", odd: 1.95 }, { label: "No Goal", odd: 25.0 }] },
  { name: "Home Team Total", key: "homeTotal", options: [
    { label: "Over 2.5", odd: 1.75 }, { label: "Under 2.5", odd: 2.05 },
    { label: "Over 3.5", odd: 2.50 }, { label: "Under 3.5", odd: 1.50 },
  ]},
  { name: "Away Team Total", key: "awayTotal", options: [
    { label: "Over 2.5", odd: 1.80 }, { label: "Under 2.5", odd: 2.00 },
    { label: "Over 3.5", odd: 2.60 }, { label: "Under 3.5", odd: 1.48 },
  ]},
];

// ---------------------------------------------------------------------------
// CRICKET
// ---------------------------------------------------------------------------

const cricketCountries: SportCountry[] = [
  { name: "India", flag: flag("in"), leagues: ["IPL", "Ranji Trophy", "Syed Mushtaq Ali Trophy"], count: 24 },
  { name: "Australia", flag: flag("au"), leagues: ["BBL", "Sheffield Shield", "Marsh Cup"], count: 16 },
  { name: "England", flag: flag("gb-eng"), leagues: ["County Championship", "The Hundred", "T20 Blast"], count: 18 },
  { name: "Pakistan", flag: flag("pk"), leagues: ["PSL", "Quaid-e-Azam Trophy"], count: 12 },
  { name: "West Indies", flag: GLOBE, leagues: ["CPL", "Super50 Cup"], count: 10 },
  { name: "South Africa", flag: flag("za"), leagues: ["SA20", "CSA T20 Challenge"], count: 10 },
  { name: "New Zealand", flag: flag("nz"), leagues: ["Super Smash", "Plunket Shield"], count: 8 },
  { name: "Sri Lanka", flag: flag("lk"), leagues: ["LPL", "Inter-Provincial"], count: 6 },
  { name: "Bangladesh", flag: flag("bd"), leagues: ["BPL", "Dhaka Premier League"], count: 6 },
  { name: "ICC", flag: GLOBE, leagues: ["T20 World Cup", "ODI World Cup", "Champions Trophy", "World Test Championship"], count: 14 },
];

const cricketMarkets: BettingMarket[] = [
  { name: "Match Winner", key: "winner", inMain: true, hasMainOdds: true },
  { name: "Toss Winner", key: "toss", inMain: true,
    options: [{ label: "Home", odd: 1.90 }, { label: "Away", odd: 1.90 }] },
  { name: "Total Runs", key: "totalRuns", inMain: true, options: [
    { label: "Over 320.5", odd: 1.90 }, { label: "Under 320.5", odd: 1.90 },
    { label: "Over 330.5", odd: 2.05 }, { label: "Under 330.5", odd: 1.75 },
    { label: "Over 340.5", odd: 2.25 }, { label: "Under 340.5", odd: 1.65 },
  ]},
  { name: "First Innings Total", key: "firstInningsTotal", options: [
    { label: "Over 160.5", odd: 1.85 }, { label: "Under 160.5", odd: 1.95 },
    { label: "Over 170.5", odd: 2.00 }, { label: "Under 170.5", odd: 1.80 },
    { label: "Over 180.5", odd: 2.25 }, { label: "Under 180.5", odd: 1.65 },
  ]},
  { name: "Top Batsman (Home)", key: "topBatHome", options: [
    { label: "Opener 1", odd: 3.50 }, { label: "Opener 2", odd: 4.00 },
    { label: "No. 3", odd: 4.50 }, { label: "No. 4", odd: 5.00 },
    { label: "Captain", odd: 3.75 }, { label: "Others", odd: 2.50 },
  ]},
  { name: "Top Batsman (Away)", key: "topBatAway", options: [
    { label: "Opener 1", odd: 3.60 }, { label: "Opener 2", odd: 4.25 },
    { label: "No. 3", odd: 4.50 }, { label: "No. 4", odd: 5.20 },
    { label: "Captain", odd: 3.90 }, { label: "Others", odd: 2.55 },
  ]},
  { name: "Top Bowler (Home)", key: "topBowlHome", options: [
    { label: "Pacer 1", odd: 3.75 }, { label: "Pacer 2", odd: 4.25 },
    { label: "Spinner 1", odd: 4.00 }, { label: "Spinner 2", odd: 4.50 },
    { label: "Others", odd: 3.00 },
  ]},
  { name: "Highest Opening Partnership", key: "openingPartnership",
    options: [{ label: "Home", odd: 1.85 }, { label: "Away", odd: 1.95 }, { label: "Tie", odd: 26.0 }] },
  { name: "Method of First Dismissal", key: "firstDismissal", options: [
    { label: "Caught", odd: 1.75 }, { label: "Bowled", odd: 5.50 },
    { label: "LBW", odd: 6.50 }, { label: "Run Out", odd: 11.0 },
    { label: "Stumped", odd: 21.0 }, { label: "Other", odd: 15.0 },
  ]},
  { name: "A Six in 1st Over", key: "sixFirstOver",
    options: [{ label: "Yes", odd: 3.75 }, { label: "No", odd: 1.22 }] },
  { name: "Super Over", key: "superOver",
    options: [{ label: "Yes", odd: 21.0 }, { label: "No", odd: 1.04 }] },
  { name: "Total Fours", key: "totalFours",
    options: [{ label: "Over 20.5", odd: 1.90 }, { label: "Under 20.5", odd: 1.90 }] },
  { name: "Total Sixes", key: "totalSixes",
    options: [{ label: "Over 12.5", odd: 1.85 }, { label: "Under 12.5", odd: 1.95 }] },
  { name: "Total Wickets", key: "totalWickets",
    options: [{ label: "Over 11.5", odd: 1.85 }, { label: "Under 11.5", odd: 1.95 }] },
];

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const sports: Sport[] = [
  {
    key: "football",
    name: "FOOTBALL",
    fullName: "Football",
    icon: "https://ext.same-assets.com/1203561035/3182885345.svg",
    count: 1862,
    hasDraw: true,
    mainSelections: SEL_3WAY,
    mainMarketName: "Match Result",
    countries: footballCountries as FootballCountry[],
    bettingMarkets: footballMarkets,
  },
  {
    key: "basketball",
    name: "BASKETBALL",
    fullName: "Basketball",
    icon: "https://ext.same-assets.com/1203561035/2589845160.svg",
    count: 128,
    hasDraw: false,
    mainSelections: SEL_2WAY,
    mainMarketName: "Moneyline",
    countries: basketballCountries,
    bettingMarkets: basketballMarkets,
  },
  {
    key: "tennis",
    name: "TENNIS",
    fullName: "Tennis",
    icon: "https://ext.same-assets.com/1203561035/1261745809.svg",
    count: 5,
    hasDraw: false,
    mainSelections: SEL_2WAY,
    mainMarketName: "Match Winner",
    countries: tennisCountries,
    bettingMarkets: tennisMarkets,
  },
  {
    key: "tableTennis",
    name: "TABLE TEN...",
    fullName: "Table Tennis",
    icon: "https://ext.same-assets.com/1203561035/1261745809.svg",
    count: 187,
    hasDraw: false,
    mainSelections: SEL_2WAY,
    mainMarketName: "Match Winner",
    countries: tableTennisCountries,
    bettingMarkets: tableTennisMarkets,
  },
  {
    key: "volleyball",
    name: "VOLLEYBALL",
    fullName: "Volleyball",
    icon: "https://ext.same-assets.com/1203561035/1261745809.svg",
    count: 40,
    hasDraw: false,
    mainSelections: SEL_2WAY,
    mainMarketName: "Match Winner",
    countries: volleyballCountries,
    bettingMarkets: volleyballMarkets,
  },
  {
    key: "iceHockey",
    name: "ICE HOCKEY",
    fullName: "Ice Hockey",
    icon: "https://ext.same-assets.com/1203561035/240504676.svg",
    count: 235,
    hasDraw: true,
    mainSelections: SEL_3WAY,
    mainMarketName: "Regulation Winner",
    countries: iceHockeyCountries,
    bettingMarkets: iceHockeyMarkets,
  },
  {
    key: "cricket",
    name: "CRICKET",
    fullName: "Cricket",
    icon: "https://ext.same-assets.com/1203561035/3182885345.svg",
    count: 6,
    hasDraw: false,
    mainSelections: SEL_2WAY,
    mainMarketName: "Match Winner",
    countries: cricketCountries,
    bettingMarkets: cricketMarkets,
  },
];

export function getSportByKey(key: string | null | undefined): Sport | undefined {
  if (!key) return undefined;
  return sports.find((s) => s.key === key);
}

export function getDefaultSport(): Sport {
  return sports[0];
}

/** Locate the sport that owns the given country name (first match wins). */
export function findSportForCountry(countryName: string): Sport | undefined {
  return sports.find((s) => s.countries.some((c) => c.name === countryName));
}
