"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { LeftSidebarSports } from "@/components/LeftSidebarSports";
import { Betslip } from "@/components/Betslip";
import { MatchCard } from "@/components/MatchCard";
import MobileMainNavTabs from "@/components/MobileMainNavTabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar as CalendarIcon, ChevronDown, ChevronUp } from "lucide-react";
import { OddsButton } from "@/components/OddsButton";
import {
  sports as sportsCatalog,
  getSportForBackendKey,
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
  /** Exact provider league name (for the API query). */
  league: string;
  /** Optional friendly label for display (defaults to `league`). */
  label?: string;
  flag: string;
}

// `league` MUST match the provider's exact league name (used to query the API,
// e.g. "Spain - LaLiga" with no space, "Portugal - Liga Portugal"). `label`
// is the friendly display text.
const TOP_LEAGUES: TopLeagueRef[] = [
  { country: "England", league: "Premier League", flag: "https://flagcdn.com/w40/gb-eng.png" },
  { country: "Spain", league: "LaLiga", label: "La Liga", flag: "https://flagcdn.com/w40/es.png" },
  { country: "Italy", league: "Serie A", flag: "https://flagcdn.com/w40/it.png" },
  { country: "Germany", league: "Bundesliga", flag: "https://flagcdn.com/w40/de.png" },
  { country: "France", league: "Ligue 1", flag: "https://flagcdn.com/w40/fr.png" },
  { country: "Portugal", league: "Liga Portugal", label: "Primeira Liga", flag: "https://flagcdn.com/w40/pt.png" },
  { country: "Netherlands", league: "Eredivisie", flag: "https://flagcdn.com/w40/nl.png" },
];

/**
 * Shape returned by `MatchCard`. Every instance is sourced from the
 * provider via `/api/sports/matches`; there is no mock fallback.
 */
interface HomeMatch {
  id?: string;
  /** Backend sport key (e.g. "football", "ice-hockey") when API-sourced. */
  sport?: string;
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
    // Number(null) / Number('') coerce to 0, which would render as a fake
    // "0.00" odd — treat absent values as missing so the fallback applies.
    if (v == null || v === '') return fallback;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  // Headline 1x2 is always real (the list only returns priced fixtures).
  // Draw may be absent for two-way sports (tennis) → NaN renders as "—".
  const homeOdds = toNum(row.home_odds, NaN);
  const drawOdds = toNum(row.draw_odds, NaN);
  const awayOdds = toNum(row.away_odds, NaN);
  return {
    id: row.id,
    sport: row.sport,
    league: row.league ?? row.sport,
    leagueFlag: leagueFlagFor(row.league),
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    date,
    time,
    startsAt: row.starts_at,
    // "+N" badge = real number of pickable outcomes (selections) across every
    // market imported for this fixture — the real depth from the provider, no
    // catalog placeholder count.
    sideBets: (row.selection_count ?? 0) as number,
    odds: {
      home: homeOdds,
      draw: drawOdds,
      away: awayOdds,
      // Secondary markets come straight from the provider. When a fixture
      // hasn't been priced for a given market yet the value is NaN, which
      // the MatchCard renders as "—" — never a fabricated proxy.
      home1x: toNum(row.home1x_odds, NaN),
      draw12: toNum(row.draw12_odds, NaN),
      away2x: toNum(row.away2x_odds, NaN),
      yesScore: toNum(row.yes_score_odds, NaN),
      noScore: toNum(row.no_score_odds, NaN),
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
  const pathname = usePathname() ?? "/";
  // Drives the URL-based open/close of the drill-down so any "HOME" link
  // (which points at "/") reliably returns to the feed. `pendingPreselect`
  // carries the exact match tapped from the feed so the detail opens on it
  // after the URL round-trip; `loadedLeagueKey` de-dupes the load effect so
  // switching matches doesn't refetch the same league twice.
  const pendingPreselectRef = useRef<HomeMatch | null>(null);
  const loadedLeagueKeyRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState("upcoming");
  const [showDetailedView, setShowDetailedView] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [selectedLeague, setSelectedLeague] = useState("");
  const [selectedSport, setSelectedSport] = useState<Sport>(() => getDefaultSport());
  // Real matches for the currently opened league (drill-down middle panel).
  // Populated from `GET /api/sports/matches?league=…` so team names, kickoff
  // times and odds are the real ones — never mock placeholders.
  const [sidebarMatches, setSidebarMatches] = useState<HomeMatch[]>([]);
  const [leagueLoading, setLeagueLoading] = useState(false);
  // League BOARD view (sidebar menu click) — shows a league's upcoming matches
  // as the standard MatchCard feed (same card style as the home board),
  // distinct from the single-match detail opened by the "More Markets" (+N)
  // button. Null when we're not viewing a league board.
  const [leagueBoardMatches, setLeagueBoardMatches] = useState<HomeMatch[]>([]);
  const [leagueBoardName, setLeagueBoardName] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<string[]>(["main", "toQualify", "matchResult", "1up", "2up"]);
  // Real markets for the currently opened fixture (fetched from /matches/:id).
  // Drives the detail panel's market list so the odds/markets shown match the
  // synced provider data instead of the static catalog placeholders.
  const [detailMarkets, setDetailMarkets] = useState<sportsApi.SportsMarket[]>([]);

  // Pulled from `GET /api/sports/matches?status=upcoming`. Starts empty and
  // is populated exclusively from the provider — no mock snapshot. The list
  // endpoint only returns fixtures that carry real odds.
  const [matches, setMatches] = useState<HomeMatch[]>([]);

  // Time-based logic (scheduleFromNow / time filters) depends on `Date.now()`,
  // which differs between the SSR pass and client hydration and would trigger
  // React hydration mismatches. Keep the first client render identical to the
  // server (no wall-clock rewriting/filtering) and switch it on after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Independent time filters for each tab so switching tabs doesn't lose
  // the user's current selection. Both tabs open on "today" because the main
  // feed is meant to show matches happening today by default.
  const [upcomingFilter, setUpcomingFilter] = useState<TimeFilter>("today");
  const [upcomingCalendar, setUpcomingCalendar] = useState<string>("");
  const [topFilter, setTopFilter] = useState<TimeFilter>("today");
  const [topCalendar, setTopCalendar] = useState<string>("");

  // Fetch upcoming matches from the backend (`status=upcoming` is a
  // spec alias for `scheduled`). Whatever the provider returns is exactly
  // what renders — an empty result shows the empty state, never mock data.
  useEffect(() => {
    let cancelled = false;
    sportsApi
      .listSportsMatches({ status: "upcoming", limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setMatches((res.items ?? []).map(backendMatchToHome));
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
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
  const upcomingMatches = useMemo(() => matches, [matches]);

  // Real matches for the headline "TOP LEAGUES" tab. Fetched per configured
  // league so the tab shows the same fixtures the rest of the world sees.
  const [topLeagueMatches, setTopLeagueMatches] = useState<HomeMatch[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      TOP_LEAGUES.map((l) =>
        sportsApi
          .listSportsMatches({
            league: `${l.country} - ${l.league}`,
            status: "upcoming",
            limit: 25,
          })
          .then((res) => res.items ?? [])
          .catch(() => []),
      ),
    ).then((batches) => {
      if (cancelled) return;
      const rows = batches.flat();
      if (rows.length > 0) {
        const mapped = rows
          .map(backendMatchToHome)
          .sort(
            (a, b) =>
              new Date(a.startsAt ?? 0).getTime() -
              new Date(b.startsAt ?? 0).getTime(),
          );
        setTopLeagueMatches(mapped);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the REAL market book for the opened fixture (all synced markets +
  // odds), refreshing periodically so live prices track the provider. Cleared
  // when no real fixture is selected so the catalog fallback can render.
  useEffect(() => {
    const matchId = selectedMatch?.id;
    if (!showDetailedView || !matchId) {
      setDetailMarkets([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      sportsApi
        .getSportsMatch(String(matchId))
        .then((res) => {
          if (!cancelled) setDetailMarkets(res.markets ?? []);
        })
        .catch(() => {
          if (!cancelled) setDetailMarkets([]);
        });
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [showDetailedView, selectedMatch?.id]);

  // Fetch every real fixture for a league and open the detailed drill-down
  // view. Keeps the exact same UI — only the data source is the live API.
  const loadLeagueMatches = async (
    fullLeagueName: string,
    sport: Sport,
    preselect?: HomeMatch,
    preselectId?: string,
  ) => {
    setSelectedSport(sport);
    setSelectedLeague(fullLeagueName);
    setExpandedSections(["main", ...sport.bettingMarkets.map((m) => m.key)]);
    setSidebarMatches([]);
    // "MORE MARKETS" flow: a tap on a specific fixture's "+N" button carries
    // that exact match as `preselect`. Open ONLY that match's detail — its full
    // market book loads via GET /matches/:id — and DO NOT list the rest of the
    // league. This keeps More-Markets = one specific match (never a list of
    // other same-league matches). The sidebar "league click" flow has no
    // preselect and still loads the whole league below.
    if (preselect) {
      setSidebarMatches([preselect]);
      setSelectedMatch(preselect);
      setShowDetailedView(true);
      setLeagueLoading(false);
      return;
    }
    setLeagueLoading(true);
    try {
      // Pull both upcoming and any in-play fixtures for the league.
      const [up, live] = await Promise.all([
        sportsApi
          .listSportsMatches({ league: fullLeagueName, status: "upcoming", limit: 100 })
          .then((r) => r.items ?? [])
          .catch(() => []),
        sportsApi
          .listSportsMatches({ league: fullLeagueName, status: "live", limit: 50 })
          .then((r) => r.items ?? [])
          .catch(() => []),
      ]);
      const mapped = [...live, ...up].map(backendMatchToHome);
      setSidebarMatches(mapped);
      if (mapped.length > 0) {
        if (!preselect) {
          // Prefer the exact fixture from the URL (?m=), else the first row.
          const target = preselectId
            ? mapped.find((m) => String(m.id) === preselectId)
            : undefined;
          setSelectedMatch(target ?? mapped[0]);
        }
        setShowDetailedView(true);
      } else if (!preselect) {
        // Empty league via deep-link — still show the frame + empty state.
        setSelectedMatch({
          league: fullLeagueName,
          leagueFlag: leagueFlagFor(fullLeagueName),
          homeTeam: "",
          awayTeam: "",
          date: "",
          time: "",
          sideBets: 0,
          odds: {
            home: 0, draw: 0, away: 0, home1x: 0, draw12: 0,
            away2x: 0, yesScore: 0, noScore: 0,
          },
        });
        setShowDetailedView(true);
      }
    } finally {
      setLeagueLoading(false);
    }
  };

  // LEAGUE BOARD: a sidebar menu click (no specific match) opens the league's
  // upcoming + live fixtures as the standard MatchCard feed — the same card
  // style as the home board — organised by that single league. This is the
  // "click England → Premier League" flow; it does NOT open the single-match
  // drill-down (that stays reserved for the "More Markets" +N button).
  const openLeagueBoard = async (fullLeagueName: string, sport: Sport) => {
    setSelectedSport(sport);
    setSelectedLeague(fullLeagueName);
    // Leaving the single-match detail view; show the board instead.
    setShowDetailedView(false);
    setSelectedMatch(null);
    setSidebarMatches([]);
    setLeagueBoardName(fullLeagueName);
    setLeagueBoardMatches([]);
    setLeagueLoading(true);
    try {
      const [up, live] = await Promise.all([
        sportsApi
          .listSportsMatches({ league: fullLeagueName, status: "upcoming", limit: 100 })
          .then((r) => r.items ?? [])
          .catch(() => []),
        sportsApi
          .listSportsMatches({ league: fullLeagueName, status: "live", limit: 50 })
          .then((r) => r.items ?? [])
          .catch(() => []),
      ]);
      // Live first, then upcoming by soonest kickoff — matches the feed order.
      const mapped = [...live, ...up].map(backendMatchToHome);
      setLeagueBoardMatches(mapped);
    } finally {
      setLeagueLoading(false);
    }
  };

  // Pre-mount the time filters are skipped (they call `Date.now()`); the full
  // list renders identically on server + first client paint, then filtering
  // applies once mounted.
  const upcomingFiltered = useMemo(
    () =>
      mounted
        ? filterMatchesByTime(upcomingMatches, upcomingFilter, upcomingCalendar)
        : upcomingMatches,
    [mounted, upcomingFilter, upcomingCalendar, upcomingMatches],
  );
  const topFiltered = useMemo(
    () =>
      mounted
        ? filterMatchesByTime(topLeagueMatches, topFilter, topCalendar)
        : topLeagueMatches,
    [mounted, topFilter, topCalendar, topLeagueMatches],
  );

  // URL <-> drill-down sync. The detail view's open state lives in the URL
  // query (?sport=&country=&league=&l=&m=) so that any "HOME" link (href="/")
  // closes it: clearing the query makes this effect reset the view. Opening a
  // league (sidebar or a feed "+N" tap) sets the query, which this effect then
  // loads. A ref de-dupes so re-renders don't refetch the same league.
  useEffect(() => {
    const sportKey = searchParams.get("sport");
    const country = searchParams.get("country");
    const league = searchParams.get("league");
    const full = searchParams.get("l");
    const matchId = searchParams.get("m");
    const hasParams = Boolean(full || (country && league));

    if (!hasParams) {
      // Navigated back to a bare "/" (HOME / logo / back) — close the drill
      // down and return to the feed.
      loadedLeagueKeyRef.current = null;
      pendingPreselectRef.current = null;
      setShowDetailedView(false);
      setSelectedMatch(null);
      setSidebarMatches([]);
      setSelectedLeague("");
      setLeagueBoardName(null);
      setLeagueBoardMatches([]);
      return;
    }

    const fullLeagueName = full || `${country} - ${league}`;
    const key = `${sportKey ?? ""}|${fullLeagueName}|${matchId ?? ""}`;
    if (loadedLeagueKeyRef.current === key) return; // already showing this
    loadedLeagueKeyRef.current = key;

    // Resolve the sport for the detail markets. The sidebar sends backend
    // sport keys (e.g. "ice-hockey", "american-football"); map those to a
    // catalog/synthesized Sport. Fall back to the catalog-key lookup for any
    // legacy links, then to football.
    const sport = sportKey ? getSportForBackendKey(sportKey) : getDefaultSport();
    // A feed tap stashes the exact fixture so it opens instantly; sidebar
    // links have none and fall back to matching ?m= then the first row.
    const preselect =
      pendingPreselectRef.current &&
      String(pendingPreselectRef.current.id ?? "") === (matchId ?? "")
        ? pendingPreselectRef.current
        : undefined;
    pendingPreselectRef.current = null;
    if (matchId) {
      // A specific fixture (More Markets +N or a match deep-link) → open its
      // detail view with the full market book.
      void loadLeagueMatches(fullLeagueName, sport, preselect, matchId);
    } else {
      // A league menu click (England → Premier League) → show that league's
      // upcoming matches as the standard MatchCard board.
      void openLeagueBoard(fullLeagueName, sport);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSideBetsClick = (match: any) => {
    // Encode the open state in the URL so HOME/back returns to the feed.
    // Stash the tapped fixture so the load effect opens on it immediately.
    pendingPreselectRef.current = match as HomeMatch;
    const params = new URLSearchParams();
    if (match?.sport) params.set("sport", String(match.sport));
    if (match?.league) params.set("l", String(match.league));
    const mid = match?.id ?? match?.eventId;
    if (mid) params.set("m", String(mid));
    router.push(`${pathname}?${params.toString()}`);
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

  // LEAGUE BOARD view — a sidebar league click renders the league's upcoming
  // matches as the same MatchCard feed used on the home board (identical card
  // style: Match Result 1/X/2, Double chance, Both Score, +N). Rendered before
  // the single-match detail so tapping +N here still opens that match.
  if (leagueBoardName && !showDetailedView) {
    return (
      <div className="flex min-h-[calc(100vh-180px)]">
        <LeftSidebarSports />

        <div className="flex-1 min-w-0 overflow-hidden" style={{ background: "var(--mezzo-bg-primary)" }}>
          {/* League header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ background: "var(--mezzo-bg-secondary)", borderColor: "var(--mezzo-border)" }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <img src={leagueFlagFor(leagueBoardName)} alt="" className="w-5 h-3.5 rounded-sm" />
              <h2 className="text-sm font-bold text-[var(--mezzo-accent-green)] truncate">
                {leagueBoardName}
              </h2>
            </div>
            <button
              onClick={() => {
                loadedLeagueKeyRef.current = null;
                router.push("/");
              }}
              className="text-xs text-gray-400 hover:text-white shrink-0"
            >
              ← Home
            </button>
          </div>

          {/* Column headers — same as the home board (desktop only) */}
          <div
            className="hidden lg:flex items-center px-4 py-2 text-xs text-gray-500 font-medium"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <div className="flex-1">Match Result</div>
            <div className="w-[140px] text-center">Double chance</div>
            <div className="w-[100px] text-center">Both Score</div>
            <div className="w-24 text-right"></div>
          </div>

          <div className="overflow-auto max-h-[calc(100vh-240px)]">
            {leagueLoading && leagueBoardMatches.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">Loading matches…</div>
            ) : leagueBoardMatches.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                No upcoming matches for this league right now.
              </div>
            ) : (
              leagueBoardMatches.map((match, index) => (
                <MatchCard
                  key={`league-${match.homeTeam}-${match.awayTeam}-${index}`}
                  {...match}
                  onSideBetsClick={() => handleSideBetsClick(match)}
                />
              ))
            )}
          </div>
        </div>

        <Betslip />
      </div>
    );
  }

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
                // Clearing the query closes the drill-down via the URL sync
                // effect (keeps HOME / back / this button all consistent).
                loadedLeagueKeyRef.current = null;
                if (searchParams.toString()) router.replace(pathname);
                else {
                  setShowDetailedView(false);
                  setSidebarMatches([]);
                  setSelectedMatch(null);
                  setSelectedLeague("");
                }
              }}
              className="text-xs text-gray-400 hover:text-white shrink-0"
            >
              ← Back
            </button>
          </div>

          <div className="overflow-auto max-h-[320px] md:max-h-none md:h-[calc(100vh-180px)]">
            {leagueLoading && leagueMatches.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-gray-400">
                Loading matches…
              </div>
            )}
            {!leagueLoading && leagueMatches.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-gray-400">
                No upcoming matches for this league right now.
              </div>
            )}
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
                      // Thread real 1x2 selection ids through so slips added
                      // from the drill-down resolve in the cashier flow.
                      const selId =
                        sel.pick === "home" ? match.selectionIds?.home
                        : sel.pick === "draw" ? match.selectionIds?.draw
                        : match.selectionIds?.away;
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
                          selectionId={selId ?? undefined}
                          eventId={match.eventId ?? match.id}
                          marketId={match.marketId ?? undefined}
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
                    {/* MAIN shows only the headline match-result with REAL
                        odds. Catalog placeholder mains (To Qualify / 1UP / 2UP)
                        are never shown — the full real market book renders
                        below from the provider feed. */}
                    {selectedSport.bettingMarkets
                      .filter(m => m.inMain && m.hasMainOdds)
                      .map((market) => (
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
                                  const selId =
                                    sel.pick === "home" ? selectedMatch.selectionIds?.home
                                    : sel.pick === "draw" ? selectedMatch.selectionIds?.draw
                                    : selectedMatch.selectionIds?.away;
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
                                      selectionId={selId ?? undefined}
                                      eventId={selectedMatch.eventId ?? selectedMatch.id}
                                      marketId={selectedMatch.marketId ?? undefined}
                                      className="py-2 rounded text-center hover:opacity-80 transition-opacity"
                                      style={{ background: "var(--mezzo-bg-tertiary)" }}
                                    >
                                      <div className="text-[10px] text-gray-400">{sel.code}</div>
                                      <div className="font-bold text-[var(--mezzo-accent-green)]">{Number.isFinite(value) ? value.toFixed(2) : "—"}</div>
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

              {/* Other Markets — REAL synced market book when available, so the
                  odds/markets match the provider (same as every betting site).
                  Falls back to the catalog layout only before odds sync. */}
              {detailMarkets.length > 0
                ? detailMarkets
                    // Match Result already shown in MAIN above.
                    .filter((mk) => mk.name !== "Full Time Result" && mk.name !== "Match Result")
                    .map((mk) => {
                      const n = mk.selections.length;
                      const cols = n === 2 ? "grid-cols-2" : n > 10 ? "grid-cols-4" : "grid-cols-3";
                      return (
                        <div key={String(mk.id)} className="rounded overflow-hidden" style={{ background: "var(--mezzo-bg-secondary)" }}>
                          <button
                            onClick={() => toggleSection(String(mk.id))}
                            className="w-full flex items-center justify-between px-3 py-2.5 font-semibold text-sm"
                          >
                            <span>{mk.name}</span>
                            {expandedSections.includes(String(mk.id)) ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                          {expandedSections.includes(String(mk.id)) && n > 0 && (
                            <div className="px-3 pb-3">
                              <div className={`grid ${cols} gap-2`}>
                                {mk.selections.map((option) => (
                                  <OddsButton
                                    key={String(option.id)}
                                    homeTeam={selectedMatch.homeTeam}
                                    awayTeam={selectedMatch.awayTeam}
                                    league={selectedMatch.league}
                                    date={selectedMatch.date}
                                    time={selectedMatch.time}
                                    market={mk.name}
                                    selection={option.name}
                                    odds={Number(option.odds)}
                                    selectionId={String(option.id)}
                                    marketId={String(mk.id)}
                                    eventId={selectedMatch.id ? String(selectedMatch.id) : undefined}
                                    className="py-2 rounded text-center hover:opacity-80 transition-opacity"
                                    style={{ background: "var(--mezzo-bg-tertiary)" }}
                                  >
                                    <div className="text-[10px] text-gray-400">{option.name}</div>
                                    <div className="font-bold text-[var(--mezzo-accent-green)]">{Number(option.odds).toFixed(2)}</div>
                                  </OddsButton>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                : (
                  // No mock fallback: the real market book is being fetched
                  // live from the provider for this fixture.
                  <div
                    className="rounded px-3 py-6 text-center text-sm text-gray-400"
                    style={{ background: "var(--mezzo-bg-secondary)" }}
                  >
                    Loading live markets…
                  </div>
                )}
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
