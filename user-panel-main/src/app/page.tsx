"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LeftSidebarSports } from "@/components/LeftSidebarSports";
import { Betslip } from "@/components/Betslip";
import { MatchCard } from "@/components/MatchCard";
import MobileMainNavTabs from "@/components/MobileMainNavTabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar as CalendarIcon, ChevronDown, ChevronUp } from "lucide-react";
import { getMatchesForSportLeague, type SampleMatch } from "@/data/leagueMatches";
import { OddsButton } from "@/components/OddsButton";
import {
  sports as sportsCatalog,
  getSportByKey,
  getDefaultSport,
  type Sport,
} from "@/data/sportsCatalog";
import * as sportsApi from "@/lib/api/sports";
import { publicConfigApi } from "@/lib/api";
import type { PromotionBanner, PublicGeneral } from "@/lib/api/publicConfig";

// ---------------------------------------------------------------------------
// Time filter helpers
// ---------------------------------------------------------------------------

type TimeFilter = "all" | "1h" | "2h" | "3h" | "6h" | "today" | "calendar";

/**
 * Parse a match's `date` (DD/MM) + `time` (HH:MM) into a real Date.
 * The sample dataset doesn't store the year, so we default to the current
 * year and bump forward when the resulting date would otherwise be far in
 * the past (keeping the feed feeling "upcoming").
 */
function toMatchDate(dateStr: string, timeStr: string): Date {
  const [dd = 1, mm = 1] = dateStr.split("/").map((v) => parseInt(v, 10));
  const [hh = 0, mi = 0] = timeStr.split(":").map((v) => parseInt(v, 10));
  const now = new Date();
  const candidate = new Date(now.getFullYear(), (mm || 1) - 1, dd || 1, hh, mi);
  const msPerDay = 24 * 60 * 60 * 1000;
  if (candidate.getTime() < now.getTime() - 180 * msPerDay) {
    return new Date(now.getFullYear() + 1, (mm || 1) - 1, dd || 1, hh, mi);
  }
  return candidate;
}

function isMatchBettable(startsAt?: string, date?: string, time?: string): boolean {
  if (startsAt) {
    const kickoff = new Date(startsAt).getTime();
    return Number.isFinite(kickoff) && kickoff > Date.now();
  }
  if (date && time) {
    return toMatchDate(date, time).getTime() > Date.now();
  }
  return true;
}

function filterMatchesByTime<T extends { date: string; time: string; startsAt?: string }>(
  list: T[],
  filter: TimeFilter,
  calendarDate: string,
): T[] {
  const now = new Date();
  // Never offer fixtures for betting once kickoff has passed.
  const bettable = list.filter((m) => isMatchBettable(m.startsAt, m.date, m.time));
  if (filter === "all") return bettable;
  const HOURS: Record<string, number> = { "1h": 1, "2h": 2, "3h": 3, "6h": 6 };

  if (HOURS[filter] !== undefined) {
    const end = now.getTime() + HOURS[filter] * 60 * 60 * 1000;
    return bettable.filter((m) => {
      const t = m.startsAt
        ? new Date(m.startsAt).getTime()
        : toMatchDate(m.date, m.time).getTime();
      return t >= now.getTime() && t <= end;
    });
  }
  if (filter === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return bettable.filter((m) => {
      const t = m.startsAt
        ? new Date(m.startsAt).getTime()
        : toMatchDate(m.date, m.time).getTime();
      return t >= now.getTime() && t <= end.getTime();
    });
  }
  if (filter === "calendar" && calendarDate) {
    const [y, mo, d] = calendarDate.split("-").map((v) => parseInt(v, 10));
    const start = new Date(y, (mo || 1) - 1, d || 1, 0, 0, 0, 0);
    const end = new Date(y, (mo || 1) - 1, d || 1, 23, 59, 59, 999);
    return bettable.filter((m) => {
      const t = m.startsAt
        ? new Date(m.startsAt).getTime()
        : toMatchDate(m.date, m.time).getTime();
      return t >= start.getTime() && t <= end.getTime();
    });
  }
  return bettable;
}

// ---------------------------------------------------------------------------
// Top leagues definition (used by the Top Leagues tab)
// ---------------------------------------------------------------------------

interface TopLeagueRef {
  country: string;
  league: string;
  flag: string;
}

const TOP_LEAGUES: TopLeagueRef[] = [
  { country: "England", league: "Premier League", flag: "https://flagcdn.com/w40/gb-eng.png" },
  { country: "Spain", league: "La Liga", flag: "https://flagcdn.com/w40/es.png" },
  { country: "Italy", league: "Serie A", flag: "https://flagcdn.com/w40/it.png" },
  { country: "Germany", league: "Bundesliga", flag: "https://flagcdn.com/w40/de.png" },
  { country: "France", league: "Ligue 1", flag: "https://flagcdn.com/w40/fr.png" },
  { country: "Portugal", league: "Primeira Liga", flag: "https://flagcdn.com/w40/pt.png" },
  { country: "Netherlands", league: "Eredivisie", flag: "https://flagcdn.com/w40/nl.png" },
];

/**
 * Return a (date, time) pair `offsetMinutes` from now, formatted the same way
 * the sample data already uses (DD/MM + HH:MM). Kept local to `page.tsx` so
 * that only the main-feed schedule adapts — existing match fields and the
 * detailed view are otherwise untouched.
 */
function scheduleFromNow(offsetMinutes: number): { date: string; time: string } {
  const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const date = `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
  return { date, time };
}

/**
 * Shape returned by `MatchCard`. We keep the old hardcoded snapshot below
 * as a graceful fallback when the backend isn't reachable (e.g. during
 * local development with the API offline) so the UI never renders empty.
 */
interface HomeMatch {
  id?: string;
  league: string;
  leagueFlag: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  time: string;
  /** ISO kickoff from the backend — used to hide/disable started fixtures. */
  startsAt?: string;
  sideBets: number;
  odds: {
    home: number;
    draw: number;
    away: number;
    home1x: number;
    draw12: number;
    away2x: number;
    yesScore: number;
    noScore: number;
  };
  // Stable backend selection IDs for the 1x2 market — populated only
  // when the row came from the API. Threaded into MatchCard so each
  // pick from the home page carries a real selection_id and our
  // offline-reserve flow (Section 16 Flow B) can persist the bet.
  selectionIds?: {
    home?: string | null;
    draw?: string | null;
    away?: string | null;
  };
  eventId?: string;
  marketId?: string | null;
}

const FALLBACK_MATCHES: HomeMatch[] = [
  {
    league: "England - FA Cup",
    leagueFlag: "https://ext.same-assets.com/1203561035/3447107198.png",
    homeTeam: "Burton Albion",
    awayTeam: "West Ham United",
    date: "14/02",
    time: "12:15",
    sideBets: 567,
    odds: { home: 6.92, draw: 4.7, away: 1.36, home1x: 2.74, draw12: 1.14, away2x: 1.06, yesScore: 1.76, noScore: 1.9 },
  },
  {
    league: "Spain - La Liga",
    leagueFlag: "https://ext.same-assets.com/1203561035/1920343590.png",
    homeTeam: "Espanyol",
    awayTeam: "Celta De Vigo",
    date: "14/02",
    time: "13:00",
    sideBets: 764,
    odds: { home: 2.38, draw: 3.02, away: 3, home1x: 1.33, draw12: 1.33, away2x: 1.5, yesScore: 1.91, noScore: 1.78 },
  },
  {
    league: "Italy - Serie A",
    leagueFlag: "https://ext.same-assets.com/1203561035/2221869759.png",
    homeTeam: "Como",
    awayTeam: "Fiorentina",
    date: "14/02",
    time: "14:00",
    sideBets: 734,
    odds: { home: 1.59, draw: 3.94, away: 5, home1x: 1.13, draw12: 1.21, away2x: 2.18, yesScore: 1.73, noScore: 1.97 },
  },
  {
    league: "Germany - Bundesliga",
    leagueFlag: "https://ext.same-assets.com/1203561035/2987763661.png",
    homeTeam: "SV Werder Bremen",
    awayTeam: "FC Bayern Munich",
    date: "14/02",
    time: "14:30",
    sideBets: 718,
    odds: { home: 8.11, draw: 5.71, away: 1.27, home1x: 3.27, draw12: 1.1, away2x: 1.05, yesScore: 1.56, noScore: 2.25 },
  },
  {
    league: "Germany - Bundesliga",
    leagueFlag: "https://ext.same-assets.com/1203561035/2987763661.png",
    homeTeam: "Bayer 04 Leverkusen",
    awayTeam: "FC Augsburg",
    date: "14/02",
    time: "14:30",
    sideBets: 706,
    odds: { home: 1.22, draw: 7.2, away: 11.5, home1x: 1.05, draw12: 1.16, away2x: 4.1, yesScore: 1.72, noScore: 1.98 },
  },
  {
    league: "France - Ligue 1",
    leagueFlag: "https://ext.same-assets.com/1203561035/3982235625.png",
    homeTeam: "Paris Saint-Germain",
    awayTeam: "AS Monaco",
    date: "14/02",
    time: "20:45",
    sideBets: 892,
    odds: { home: 1.45, draw: 4.8, away: 5.5, home1x: 1.12, draw12: 1.22, away2x: 2.5, yesScore: 1.65, noScore: 2.1 },
  },
];

/**
 * Build a flag URL for a backend match row.
 *
 * The backend stores `league` as e.g. "England - Premier League". We
 * extract the country prefix and look it up in the static sports catalog
 * so we can re-use the existing flag CDN URLs without making a second
 * round-trip.
 */
function leagueFlagFor(league: string | null | undefined): string {
  if (!league) return "/play-core-logo.png";
  const country = league.split(" - ")[0]?.trim();
  if (!country) return "/play-core-logo.png";
  for (const sport of sportsCatalog) {
    const node = sport.countries.find(
      (c) => c.name.toLowerCase() === country.toLowerCase(),
    );
    if (node?.flag) return node.flag;
  }
  return "/play-core-logo.png";
}

/**
 * Map a backend `sports_events` row into the shape `MatchCard` expects.
 * We don't have the detail markets here so the secondary odds (home1x,
 * draw12, …) fall back to neutral values derived from the headline 1x2.
 * Clicking the side-bets button still routes through to the detail view
 * which loads the full markets via `GET /api/sports/matches/:id`.
 */
function backendMatchToHome(row: sportsApi.SportsMatchRow): HomeMatch {
  const starts = new Date(row.starts_at);
  const date = `${String(starts.getDate()).padStart(2, "0")}/${String(
    starts.getMonth() + 1,
  ).padStart(2, "0")}`;
  const time = `${String(starts.getHours()).padStart(2, "0")}:${String(
    starts.getMinutes(),
  ).padStart(2, "0")}`;
  // Postgres NUMERIC columns are serialized as strings by node-postgres,
  // so the typed `number` field arrives as e.g. "1.50". Coerce eagerly
  // so the MatchCard's `.toFixed(2)` calls don't crash on a string.
  const toNum = (v: unknown, fallback = 0): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const homeOdds = toNum(row.home_odds, 1.01);
  const drawOdds = toNum(row.draw_odds, 1.01);
  const awayOdds = toNum(row.away_odds, 1.01);
  return {
    id: row.id,
    league: row.league ?? row.sport,
    leagueFlag: leagueFlagFor(row.league),
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    date,
    time,
    startsAt: row.starts_at,
    sideBets: row.total_bets ?? 0,
    odds: {
      home: homeOdds,
      draw: drawOdds,
      away: awayOdds,
      // No double-chance / both-score odds in the list payload — derive a
      // reasonable proxy from the headline 1x2 so the secondary slots
      // render. The detail page always shows real values.
      home1x: Math.max(1.05, +(homeOdds * 0.55).toFixed(2)),
      draw12: Math.max(1.05, +((homeOdds + awayOdds) * 0.3).toFixed(2)),
      away2x: Math.max(1.05, +(awayOdds * 0.55).toFixed(2)),
      yesScore: 1.85,
      noScore: 1.85,
    },
    selectionIds: {
      home: row.home_selection_id ?? null,
      draw: row.draw_selection_id ?? null,
      away: row.away_selection_id ?? null,
    },
    eventId: row.id,
    marketId: row.match_result_market_id ?? null,
  };
}

// The per-sport betting markets are defined in `src/data/sportsCatalog.ts`.
// They're looked up at runtime inside `HomePageInner` via
// `selectedSport.bettingMarkets`, so adding new sports, markets, or odds is
// purely a data-level change (no JSX or control-flow edits needed here).

function TeamCrest() {
  return (
    <svg
      viewBox="0 0 64 72"
      className="w-14 h-16 drop-shadow-lg"
      aria-hidden="true"
    >
      {/* Shield */}
      <path
        d="M32 2 L60 10 C60 34 52 58 32 70 C12 58 4 34 4 10 Z"
        fill="#ffffff"
        stroke="#e5e7eb"
        strokeWidth="1.5"
      />
      {/* Soccer ball */}
      <g transform="translate(32 34)">
        <circle r="14" fill="#ffffff" stroke="#111827" strokeWidth="1.5" />
        {/* Center pentagon */}
        <polygon
          points="0,-6 5.7,-1.85 3.53,5 -3.53,5 -5.7,-1.85"
          fill="#111827"
        />
        {/* Outer pentagons (simple black accents) */}
        <polygon points="0,-13.5 3.5,-9 -3.5,-9" fill="#111827" />
        <polygon points="12.8,-4.2 9,1 6.2,-3.5" fill="#111827" />
        <polygon points="-12.8,-4.2 -9,1 -6.2,-3.5" fill="#111827" />
        <polygon points="7.9,10.8 4.2,7.2 8.7,5" fill="#111827" />
        <polygon points="-7.9,10.8 -4.2,7.2 -8.7,5" fill="#111827" />
      </g>
    </svg>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageInner />
    </Suspense>
  );
}

function HomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("upcoming");
  const [showDetailedView, setShowDetailedView] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [selectedLeague, setSelectedLeague] = useState("");
  const [selectedSport, setSelectedSport] = useState<Sport>(() => getDefaultSport());
  const [sidebarMatches, setSidebarMatches] = useState<SampleMatch[]>([]);
  const [expandedSections, setExpandedSections] = useState<string[]>(["main", "toQualify", "matchResult", "1up", "2up"]);

  // Pulled from `GET /api/sports/matches?status=upcoming`. Defaults to the
  // hardcoded snapshot so the page never renders empty when the backend
  // is unreachable.
  const [matches, setMatches] = useState<HomeMatch[]>(FALLBACK_MATCHES);

  // Independent time filters for each tab so switching tabs doesn't lose
  // the user's current selection. Both tabs open on "today" because the main
  // feed is meant to show matches happening today by default.
  const [upcomingFilter, setUpcomingFilter] = useState<TimeFilter>("today");
  const [upcomingCalendar, setUpcomingCalendar] = useState<string>("");
  const [topFilter, setTopFilter] = useState<TimeFilter>("today");
  const [topCalendar, setTopCalendar] = useState<string>("");

  // Fetch upcoming matches from the backend (`status=upcoming` is a
  // spec alias for `scheduled`). When the API is reachable we replace
  // the fallback snapshot; otherwise the fallback keeps the screen
  // populated so the user-panel never feels broken offline.
  useEffect(() => {
    let cancelled = false;
    sportsApi
      .listSportsMatches({ status: "upcoming", limit: 50 })
      .then((res) => {
        if (cancelled) return;
        const mapped = (res.items ?? []).map(backendMatchToHome);
        if (mapped.length > 0) setMatches(mapped);
      })
      .catch(() => {
        // Keep the fallback in place — the UI still renders something.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Dynamic banner slider -----------------------------------------------
  const [banners, setBanners] = useState<PromotionBanner[]>([]);
  const [brandingCfg, setBrandingCfg] = useState<PublicGeneral | null>(null);
  const [bannerIdx, setBannerIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchBanners = () => {
      Promise.all([
        publicConfigApi.listPromotionBanners().catch(() => ({ items: [] as PromotionBanner[] })),
        publicConfigApi.getPublicGeneral().catch(() => null),
      ]).then(([res, cfg]) => {
        if (cancelled) return;
        const active = (res.items ?? []).filter((b) => b.is_active !== false);
        setBanners(active.length > 0 ? active : []);
        if (cfg) setBrandingCfg(cfg);
      }).catch(() => { /* keep static fallback */ });
    };
    fetchBanners();
    const onVisible = () => { if (document.visibilityState === 'visible') fetchBanners(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Auto-advance banner every 5 seconds when multiple banners are configured
  useEffect(() => {
    if (banners.length <= 1) return;
    const id = setInterval(() => setBannerIdx((i) => (i + 1) % banners.length), 5000);
    return () => clearInterval(id);
  }, [banners.length]);

  // The hardcoded fallback uses an old DD/MM snapshot; rewrite those
  // entries so the time filters (1hr/2hr/3hr/6hr/Today/Calendar) keep
  // working even when the API is offline. Real backend rows already
  // come with the live `starts_at` so we leave them alone.
  const upcomingMatches = useMemo(() => {
    const offsets = [30, 90, 150, 300, 480, 600];
    return matches.map((m, i) =>
      m.id ? m : { ...m, ...scheduleFromNow(offsets[i % offsets.length]) },
    );
  }, [matches]);

  // All matches from top football leagues, generated via the sport-aware
  // helper (same logic the sidebar uses, so the dataset stays consistent).
  const topLeagueMatches = useMemo<SampleMatch[]>(() => {
    const football = sportsCatalog[0];
    return TOP_LEAGUES.flatMap((l) =>
      getMatchesForSportLeague(football, `${l.country} - ${l.league}`, l.flag),
    );
  }, []);

  const upcomingFiltered = useMemo(
    () => filterMatchesByTime(upcomingMatches, upcomingFilter, upcomingCalendar),
    [upcomingFilter, upcomingCalendar, upcomingMatches],
  );
  const topFiltered = useMemo(
    () => filterMatchesByTime(topLeagueMatches, topFilter, topCalendar),
    [topFilter, topCalendar, topLeagueMatches],
  );

  // Deep-link: open detailed view when sidebar navigates to ?sport=..&country=..&league=..
  useEffect(() => {
    const sportKey = searchParams.get("sport");
    const country = searchParams.get("country");
    const league = searchParams.get("league");
    if (!country || !league) return;

    // Resolve the sport from the URL, falling back to football so existing
    // deep-links without a sport param keep working unchanged.
    const sport = getSportByKey(sportKey) ?? getDefaultSport();
    const countryMeta = sport.countries.find((c) => c.name === country);
    const leagueFlag = countryMeta?.flag ?? "";
    const fullLeagueName = `${country} - ${league}`;
    const generated = getMatchesForSportLeague(sport, fullLeagueName, leagueFlag);
    if (generated.length === 0) return;

    setSelectedSport(sport);
    setSidebarMatches(generated);
    setSelectedLeague(fullLeagueName);
    setSelectedMatch(generated[0]);
    setShowDetailedView(true);
    setExpandedSections(["main", ...sport.bettingMarkets.map((m) => m.key)]);
  }, [searchParams]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSideBetsClick = (match: any) => {
    // Clicks originating from the hardcoded home page `matches` list are
    // always football. Inside the detailed view we keep whatever sport the
    // deep-link effect set.
    const sportForClick = showDetailedView ? selectedSport : sportsCatalog[0];
    if (!showDetailedView) setSelectedSport(sportForClick);

    // Preserve the currently loaded league list when clicking a side-bets button
    // on a match that belongs to the same league (e.g. inside the detailed
    // view). Only clear it when switching leagues so the home-list filter can
    // populate for the new league.
    if (match.league !== selectedLeague) setSidebarMatches([]);

    setSelectedMatch(match);
    setSelectedLeague(match.league);
    setShowDetailedView(true);
    setExpandedSections(["main", ...sportForClick.bettingMarkets.map((m) => m.key)]);
  };

  const handleMatchClick = (match: any) => {
    setSelectedMatch(match);
  };

  // Matches shown in the middle panel: prefer the sidebar-loaded batch (all
  // real/placeholder matches for that league), otherwise fall back to filtering
  // the small hard-coded `matches` list by the selected league.
  const leagueMatches = sidebarMatches.length > 0
    ? sidebarMatches
    : selectedLeague
      ? matches.filter(m => m.league === selectedLeague)
      : [];

  if (showDetailedView && selectedMatch) {
    return (
      <div className="flex flex-col md:flex-row min-h-[calc(100vh-180px)]">
        <LeftSidebarSports />

        {/* Middle Panel - League Matches
            <md: full-width, limited height with internal scroll so the
                 right panel (betting markets) shows underneath it.
            md–xl: progressively wider as the viewport allows, leaving
                   enough room for the right panel on iPad/Nest Hub.
            xl+: fixed 420px to match the pre-existing desktop design. */}
        <aside
          className="w-full md:w-[300px] lg:w-[360px] xl:w-[420px] flex-shrink-0 border-b md:border-b-0 md:border-r"
          style={{ background: "var(--mezzo-bg-primary)", borderColor: "var(--mezzo-border)" }}
        >
          <div className="p-3 flex items-center justify-between" style={{ background: "var(--mezzo-bg-tertiary)" }}>
            <h2 className="text-sm font-bold text-[var(--mezzo-accent-green)] truncate pr-2">{selectedLeague}</h2>
            <button
              onClick={() => {
                setShowDetailedView(false);
                setSidebarMatches([]);
                if (searchParams.get("league")) router.replace("/");
              }}
              className="text-xs text-gray-400 hover:text-white shrink-0"
            >
              ← Back
            </button>
          </div>

          <div className="overflow-auto max-h-[320px] md:max-h-none md:h-[calc(100vh-180px)]">
            {leagueMatches.map((match, index) => (
              <div
                key={index}
                className={`border-b transition-colors ${
                  selectedMatch.homeTeam === match.homeTeam ? "bg-[var(--mezzo-bg-tertiary)]" : "hover:bg-[var(--mezzo-hover)]"
                }`}
                style={{ borderColor: "var(--mezzo-border)" }}
              >
                <div className="px-3 py-2.5">
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z"/>
                      </svg>
                      <span className="text-[var(--mezzo-accent-green)]">{match.league}</span>
                    </div>
                    <span>{match.date} {match.time}</span>
                  </div>

                  <div
                    className="font-semibold text-sm mb-2 cursor-pointer hover:text-[var(--mezzo-accent-green)] transition-colors"
                    onClick={() => handleMatchClick(match)}
                  >
                    {match.homeTeam} V {match.awayTeam}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedSport.mainSelections.map((sel) => {
                      const value =
                        sel.pick === "home" ? match.odds.home
                        : sel.pick === "draw" ? match.odds.draw
                        : match.odds.away;
                      return (
                        <OddsButton
                          key={sel.code}
                          homeTeam={match.homeTeam}
                          awayTeam={match.awayTeam}
                          league={match.league}
                          date={match.date}
                          time={match.time}
                          market={selectedSport.mainMarketName}
                          selection={sel.code}
                          odds={value}
                          className="px-2.5 py-1 rounded text-xs hover:opacity-80 transition-opacity"
                          style={{ background: "var(--mezzo-bg-card)" }}
                          onClick={() => handleMatchClick(match)}
                        >
                          <span className="text-[9px] text-gray-500 mr-1">{sel.code}</span>
                          <span className="font-bold text-[var(--mezzo-accent-green)]">{value.toFixed(2)}</span>
                        </OddsButton>
                      );
                    })}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSideBetsClick(match); }}
                      className="px-2.5 py-1 rounded text-xs font-bold hover:opacity-80 transition-opacity ml-auto"
                      style={{ background: "var(--mezzo-accent-green)", color: "#000" }}
                    >
                      +{match.sideBets}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Right Panel - Detailed Betting Markets */}
        <div className="flex-1 min-w-0" style={{ background: "var(--mezzo-bg-primary)" }}>
          <div className="overflow-auto max-h-[calc(100vh-120px)] md:h-[calc(100vh-120px)]">
            {/* Football Field Visual */}
            <div
              className="relative h-32 sm:h-40 md:h-44 overflow-hidden"
              style={{
                backgroundImage: "url('/soccer-field.png')",
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
              }}
            >
              {/* Subtle dark gradient for text readability */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0) 70%)",
                }}
              ></div>

              {/* Team Crest Shields (home / away placeholders) */}
              <div className="absolute inset-0 flex items-center justify-between px-4 sm:px-8 md:px-12 pointer-events-none">
                <TeamCrest />
                <TeamCrest />
              </div>

              <div className="absolute top-2 sm:top-3 left-2 sm:left-3 right-2 sm:right-auto z-10">
                <div className="flex items-center gap-2 text-xs mb-1">
                  <img src={selectedMatch.leagueFlag} alt="" className="w-4 h-3 rounded-sm" />
                  <span className="text-[var(--mezzo-accent-green)] font-semibold drop-shadow truncate">{selectedMatch.league}</span>
                </div>
                <div className="text-white font-bold text-xs sm:text-sm drop-shadow truncate">{selectedMatch.homeTeam} V {selectedMatch.awayTeam}</div>
              </div>
            </div>

            {/* Betting Markets */}
            <div className="p-3 space-y-2">
              {/* MAIN Section */}
              <div className="rounded overflow-hidden" style={{ background: "var(--mezzo-bg-secondary)" }}>
                <button
                  onClick={() => toggleSection("main")}
                  className="w-full flex items-center justify-between px-3 py-2.5 font-bold text-sm"
                >
                  <span>MAIN</span>
                  {expandedSections.includes("main") ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>

                {expandedSections.includes("main") && (
                  <div className="px-3 pb-3 space-y-2">
                    {selectedSport.bettingMarkets.filter(m => m.inMain).map((market) => (
                      <div key={market.key}>
                        <button
                          onClick={() => toggleSection(market.key)}
                          className="w-full flex items-center justify-between py-1.5 text-sm"
                        >
                          <div className="flex items-center gap-1">
                            <span className="font-semibold">{market.name}</span>
                            {market.hasInfo && (
                              <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 11H9v-2h2v2zm0-4H9V5h2v4z"/>
                              </svg>
                            )}
                          </div>
                          {expandedSections.includes(market.key) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>

                        {expandedSections.includes(market.key) && (
                          <div className={`grid ${
                            (market.options && market.options.length === 2) ||
                            (market.hasMainOdds && !selectedSport.hasDraw)
                              ? 'grid-cols-2' : 'grid-cols-3'
                          } gap-2 mt-1`}>
                            {market.hasMainOdds ? (
                              <>
                                {selectedSport.mainSelections.map((sel) => {
                                  const value =
                                    sel.pick === "home" ? selectedMatch.odds.home
                                    : sel.pick === "draw" ? selectedMatch.odds.draw
                                    : selectedMatch.odds.away;
                                  return (
                                    <OddsButton
                                      key={sel.code}
                                      homeTeam={selectedMatch.homeTeam}
                                      awayTeam={selectedMatch.awayTeam}
                                      league={selectedMatch.league}
                                      date={selectedMatch.date}
                                      time={selectedMatch.time}
                                      market={market.name}
                                      selection={sel.code}
                                      odds={value}
                                      className="py-2 rounded text-center hover:opacity-80 transition-opacity"
                                      style={{ background: "var(--mezzo-bg-tertiary)" }}
                                    >
                                      <div className="text-[10px] text-gray-400">{sel.code}</div>
                                      <div className="font-bold text-[var(--mezzo-accent-green)]">{value.toFixed(2)}</div>
                                    </OddsButton>
                                  );
                                })}
                              </>
                            ) : market.options?.map((option, idx) => (
                              <OddsButton
                                key={idx}
                                homeTeam={selectedMatch.homeTeam}
                                awayTeam={selectedMatch.awayTeam}
                                league={selectedMatch.league}
                                date={selectedMatch.date}
                                time={selectedMatch.time}
                                market={market.name}
                                selection={option.label}
                                odds={option.odd}
                                className="py-2 rounded text-center hover:opacity-80 transition-opacity"
                                style={{ background: "var(--mezzo-bg-tertiary)" }}
                              >
                                <div className="text-[10px] text-gray-400">{option.label}</div>
                                <div className="font-bold text-[var(--mezzo-accent-green)]">{option.odd.toFixed(2)}</div>
                              </OddsButton>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Other Markets */}
              {selectedSport.bettingMarkets.filter(m => !m.inMain).map((market) => (
                <div key={market.key} className="rounded overflow-hidden" style={{ background: "var(--mezzo-bg-secondary)" }}>
                  <button
                    onClick={() => toggleSection(market.key)}
                    className="w-full flex items-center justify-between px-3 py-2.5 font-semibold text-sm"
                  >
                    <span>{market.name}</span>
                    {expandedSections.includes(market.key) ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>

                  {expandedSections.includes(market.key) && market.options && market.options.length > 0 && (
                    <div className="px-3 pb-3">
                      <div className={`grid ${
                        market.options.length === 2 ? 'grid-cols-2' :
                        market.options.length > 10 ? 'grid-cols-4' :
                        market.options.length > 6 ? 'grid-cols-3' :
                        'grid-cols-3'
                      } gap-2`}>
                        {market.options.map((option, idx) => (
                          <OddsButton
                            key={idx}
                            homeTeam={selectedMatch.homeTeam}
                            awayTeam={selectedMatch.awayTeam}
                            league={selectedMatch.league}
                            date={selectedMatch.date}
                            time={selectedMatch.time}
                            market={market.name}
                            selection={option.label}
                            odds={option.odd}
                            className="py-2 rounded text-center hover:opacity-80 transition-opacity"
                            style={{ background: "var(--mezzo-bg-tertiary)" }}
                          >
                            <div className="text-[10px] text-gray-400">{option.label}</div>
                            <div className="font-bold text-[var(--mezzo-accent-green)]">{option.odd.toFixed(2)}</div>
                          </OddsButton>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <Betslip />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <LeftSidebarSports />

      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-hidden" style={{ background: "var(--mezzo-bg-primary)" }}>
        {/* Banner Slider — dynamic when configured in admin, static fallback otherwise */}
        <div className="p-2 sm:p-4">
          {banners.length > 0 ? (
            <div className="relative h-24 sm:h-32 md:h-40 rounded-lg overflow-hidden">
              {banners.map((banner, idx) => (
                <div
                  key={banner.id ?? idx}
                  className="absolute inset-0 transition-opacity duration-700"
                  style={{ opacity: idx === bannerIdx ? 1 : 0 }}
                >
                  {banner.image_url ? (
                    <img
                      src={banner.image_url}
                      alt={banner.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full"
                      style={{ background: "linear-gradient(135deg, var(--mezzo-accent-green) 0%, var(--mezzo-accent-yellow) 100%)" }}
                    />
                  )}
                  <div className="absolute inset-0 flex items-center px-3 sm:px-6 md:px-8 gap-3 bg-black/20">
                    <div className="min-w-0">
                      <h2 className="text-base sm:text-xl md:text-3xl font-bold text-white mb-1 sm:mb-2 leading-tight drop-shadow">
                        {banner.title}
                      </h2>
                      {banner.description && (
                        <p className="text-[11px] sm:text-sm md:text-lg text-white/90 leading-tight drop-shadow">
                          {banner.description}
                        </p>
                      )}
                      {banner.cta_url && (
                        <a
                          href={banner.cta_url}
                          className="mt-1 sm:mt-2 inline-block text-xs sm:text-sm font-semibold px-3 py-1 rounded text-black"
                          style={{ background: "var(--mezzo-accent-yellow)" }}
                        >
                          Bet Now
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {/* Dot indicators */}
              {banners.length > 1 && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                  {banners.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setBannerIdx(idx)}
                      className="w-1.5 h-1.5 rounded-full transition-all"
                      style={{ background: idx === bannerIdx ? "#fff" : "rgba(255,255,255,0.45)" }}
                      aria-label={`Banner ${idx + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div
              className="relative h-24 sm:h-32 md:h-40 rounded-lg overflow-hidden"
              style={{ background: "linear-gradient(135deg, var(--mezzo-accent-green) 0%, var(--mezzo-accent-yellow) 100%)" }}
            >
              <div className="absolute inset-0 flex items-center justify-between px-3 sm:px-6 md:px-8 gap-3">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-xl md:text-3xl font-bold text-white mb-1 sm:mb-2 leading-tight">
                    {brandingCfg?.static_banner_title || "WIN UP TO 360,000"}
                  </h2>
                  <p className="text-[11px] sm:text-sm md:text-lg text-white/80 leading-tight">
                    {brandingCfg?.static_banner_subtitle || "EVERY SECOND ON FASTKENO"}
                  </p>
                </div>
                {(brandingCfg?.static_banner_image_url || "https://ext.same-assets.com/1203561035/2427311734.jpeg") && (
                  <img
                    src={brandingCfg?.static_banner_image_url || "https://ext.same-assets.com/1203561035/2427311734.jpeg"}
                    alt="Promo"
                    className="h-16 sm:h-24 md:h-32 w-auto object-contain shrink-0"
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mobile main nav tabs — appears directly under the banner on
            phones/tablets and mirrors the desktop header's primary nav.
            Hidden on `lg+` so the existing desktop nav row (rendered in
            `Header`) remains the single source of truth on desktop. */}
        <MobileMainNavTabs />

        {/* Tabs */}
        <Tabs defaultValue="upcoming" className="w-full" onValueChange={setActiveTab}>
          <div className="flex" style={{ background: "var(--mezzo-bg-secondary)" }}>
            <TabsList className="flex w-full h-auto p-0 bg-transparent">
              <TabsTrigger
                value="upcoming"
                className="flex-1 px-2 sm:px-4 md:px-8 py-3 sm:py-4 text-[11px] sm:text-sm font-bold tracking-wide transition-all rounded-none"
                style={{
                  background: activeTab === "upcoming" ? "#3a3a4a" : "#2a2a3a",
                  color: activeTab === "upcoming" ? "#fff" : "#9ca3af"
                }}
              >
                UPCOMING MATCHES
              </TabsTrigger>
              <TabsTrigger
                value="top"
                className="flex-1 px-2 sm:px-4 md:px-8 py-3 sm:py-4 text-[11px] sm:text-sm font-bold tracking-wide transition-all rounded-none"
                style={{
                  background: activeTab === "top" ? "var(--mezzo-accent-yellow)" : "#2a2a3a",
                  color: activeTab === "top" ? "#000" : "#9ca3af"
                }}
              >
                TOP LEAGUES
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Column Headers — only shown when MatchCard renders its desktop
              single-row layout (lg+). Below lg the stacked grid is used. */}
          <div
            className="hidden lg:flex items-center px-4 py-2 text-xs text-gray-500 font-medium"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <div className="flex-1">Match Result</div>
            <div className="w-[140px] text-center">Double chance</div>
            <div className="w-[100px] text-center">Both Score</div>
            <div className="w-24 text-right"></div>
          </div>

          <TabsContent value="upcoming" className="mt-0">
            <TimeFilterBar
              value={upcomingFilter}
              calendarDate={upcomingCalendar}
              onChange={setUpcomingFilter}
              onCalendarChange={setUpcomingCalendar}
              total={upcomingMatches.length}
              visible={upcomingFiltered.length}
            />
            <div className="overflow-auto max-h-[calc(100vh-360px)] md:max-h-[calc(100vh-440px)]">
              {upcomingFiltered.length === 0 ? (
                <EmptyRow />
              ) : (
                upcomingFiltered.map((match, index) => (
                  <MatchCard
                    key={`${match.homeTeam}-${match.awayTeam}-${index}`}
                    {...match}
                    onSideBetsClick={() => handleSideBetsClick(match)}
                  />
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="top" className="mt-0">
            <TimeFilterBar
              value={topFilter}
              calendarDate={topCalendar}
              onChange={setTopFilter}
              onCalendarChange={setTopCalendar}
              total={topLeagueMatches.length}
              visible={topFiltered.length}
            />
            <div className="overflow-auto max-h-[calc(100vh-360px)] md:max-h-[calc(100vh-440px)]">
              {topFiltered.length === 0 ? (
                <EmptyRow />
              ) : (
                topFiltered.map((match, index) => (
                  <MatchCard
                    key={`top-${match.homeTeam}-${match.awayTeam}-${index}`}
                    {...match}
                    onSideBetsClick={() => handleSideBetsClick(match)}
                  />
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Betslip />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared subcomponents
// ---------------------------------------------------------------------------

interface TimeFilterBarProps {
  value: TimeFilter;
  calendarDate: string;
  onChange: (v: TimeFilter) => void;
  onCalendarChange: (d: string) => void;
  total: number;
  visible: number;
}

function TimeFilterBar({
  value,
  calendarDate,
  onChange,
  onCalendarChange,
  total,
  visible,
}: TimeFilterBarProps) {
  const hourOptions: { key: TimeFilter; label: string }[] = [
    { key: "1h", label: "1hr" },
    { key: "2h", label: "2hr" },
    { key: "3h", label: "3hr" },
    { key: "6h", label: "6hr" },
    { key: "today", label: "Today" },
  ];

  const dateInputRef = useRef<HTMLInputElement | null>(null);

  // Programmatically open the native date picker. `showPicker()` is the
  // modern API (Chrome 99+, Firefox 101+, Safari 16.4+); we fall back to
  // `focus + click` on older browsers. This is the reliable way to open
  // the picker from a button click — overlay <input> tricks are blocked
  // by several browsers when the input is hidden.
  const openDatePicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    try {
      if (typeof (el as HTMLInputElement & { showPicker?: () => void }).showPicker === "function") {
        (el as HTMLInputElement & { showPicker: () => void }).showPicker();
        return;
      }
    } catch {
      /* some browsers throw if the input isn't user-focused; fall through */
    }
    el.focus();
    el.click();
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b overflow-x-auto"
      style={{
        background: "var(--mezzo-bg-secondary)",
        borderColor: "var(--mezzo-border)",
      }}
    >
      {hourOptions.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(active ? "all" : opt.key)}
            className="shrink-0 px-3 py-1.5 rounded text-xs font-semibold transition-colors"
            style={{
              background: active
                ? "var(--mezzo-accent-yellow)"
                : "var(--mezzo-bg-tertiary)",
              color: active ? "#000" : "#d1d5db",
            }}
          >
            {opt.label}
          </button>
        );
      })}

      <button
        type="button"
        onClick={openDatePicker}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer"
        style={{
          background:
            value === "calendar"
              ? "var(--mezzo-accent-yellow)"
              : "var(--mezzo-bg-tertiary)",
          color: value === "calendar" ? "#000" : "#d1d5db",
        }}
      >
        <CalendarIcon className="w-3.5 h-3.5" />
        <span>
          {value === "calendar" && calendarDate
            ? new Date(calendarDate).toLocaleDateString(undefined, {
                day: "2-digit",
                month: "short",
              })
            : "Calendar"}
        </span>
      </button>

      {/*
        Hidden date input used only as the target for `showPicker()`. It is
        kept focusable (not `display: none`) so browsers can anchor the
        native picker next to the Calendar button.
      */}
      <input
        ref={dateInputRef}
        type="date"
        value={calendarDate}
        onChange={(e) => {
          onCalendarChange(e.target.value);
          onChange(e.target.value ? "calendar" : "all");
        }}
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
          opacity: 0,
          pointerEvents: "none",
        }}
      />

      {value !== "all" && (
        <button
          type="button"
          onClick={() => {
            onChange("all");
            onCalendarChange("");
          }}
          className="shrink-0 px-3 py-1.5 rounded text-xs font-semibold text-gray-400 hover:text-white"
          style={{ background: "transparent" }}
        >
          Clear
        </button>
      )}

      <div className="ml-auto shrink-0 text-[11px] text-gray-400 pl-2">
        {visible} of {total}
      </div>
    </div>
  );
}

function EmptyRow() {
  return (
    <div
      className="px-4 py-6 text-sm text-center text-gray-400"
      style={{ background: "var(--mezzo-bg-primary)" }}
    >
      No matches match the selected time filter.
    </div>
  );
}
