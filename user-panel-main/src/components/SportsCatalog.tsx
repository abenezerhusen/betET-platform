"use client";

/**
 * Shared sports catalog navigation.
 *
 * This is the exact navigation that already lives in the desktop left
 * sidebar (`LeftSidebarSports`) and is reused verbatim by the mobile
 * hamburger menu.
 *
 * Data source: the REAL sport → country → league tree is built from
 * `GET /api/sports/catalog` (which reflects the live `sports_events`
 * table populated by the Odds-API.io sync). This makes every real league
 * — across every sport — reachable from the sidebar. The static
 * `sportsCatalog` is only used as an offline fallback (backend
 * unreachable) so the panel never renders empty, and to supply country
 * flags / sport icons on top of the real names.
 *
 * The component is purely presentational: it pushes to
 * `/?sport=…&country=…&league=…&l=<full league name>`, which the home
 * page already understands. An optional `onNavigate` callback lets callers
 * close an enclosing drawer/menu after a selection is made.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { sports, getSportForBackendKey } from "@/data/sportsCatalog";
import { sportsApi } from "@/lib/api";

const GLOBE_ICON = "https://ext.same-assets.com/1203561035/3182885345.svg";

// Featured leagues shortcut list. Kept identical to the previous design.
const topLeagues: {
  name: string;
  icon: string;
  sport: string;
  country: string;
  league: string;
}[] = [
  { name: "England - Premier Le...", icon: "https://ext.same-assets.com/1203561035/3447107198.png", sport: "football", country: "England", league: "Premier League" },
  { name: "Spain - La Liga", icon: "https://ext.same-assets.com/1203561035/1920343590.png", sport: "football", country: "Spain", league: "LaLiga" },
  { name: "Germany - Bundesliga", icon: "https://ext.same-assets.com/1203561035/2987763661.png", sport: "football", country: "Germany", league: "Bundesliga" },
  { name: "France - Ligue 1", icon: "https://ext.same-assets.com/1203561035/3982235625.png", sport: "football", country: "France", league: "Ligue 1" },
  { name: "Italy - Serie A", icon: "https://ext.same-assets.com/1203561035/2221869759.png", sport: "football", country: "Italy", league: "Serie A" },
];

interface RealLeague {
  full: string;
  label: string;
  live: number;
  upcoming: number;
}
interface RealCountry {
  name: string;
  flag: string;
  leagues: RealLeague[];
  total: number;
}
interface RealSport {
  key: string;
  name: string;
  icon: string;
  live: number;
  upcoming: number;
  countries: RealCountry[];
}

// Country → flag URL, harvested once from the static catalog so real league
// names ("Country - League") can still show the right flag when we have one.
const FLAG_BY_COUNTRY: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const s of sports) {
    for (const c of s.countries) {
      if (c.name && c.flag && !map[c.name.toLowerCase()]) {
        map[c.name.toLowerCase()] = c.flag;
      }
    }
  }
  return map;
})();

// Sport display order — footy first, then the rest of the popular ones.
const SPORT_ORDER = [
  "football",
  "basketball",
  "tennis",
  "baseball",
  "ice-hockey",
  "american-football",
  "volleyball",
  "handball",
  "rugby",
  "cricket",
  "mma",
  "mixed-martial-arts",
  "boxing",
  "esports",
];

interface SportsCatalogProps {
  onNavigate?: () => void;
  className?: string;
}

export function SportsCatalog({ onNavigate, className = "" }: SportsCatalogProps) {
  const router = useRouter();
  const [expandedSport, setExpandedSport] = useState<string | null>("football");
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);

  // Real tree from GET /api/sports/catalog (null until loaded / on failure).
  const [realTree, setRealTree] = useState<RealSport[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    sportsApi
      .getSportsCatalog()
      .then((res) => {
        if (cancelled) return;
        const built = buildRealTree(res.sports ?? []);
        setRealTree(built.length > 0 ? built : null);
      })
      .catch(() => {
        // Leave realTree null → falls back to the static catalog below.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openLeague = (
    sportKey: string,
    countryName: string,
    leagueName: string,
    fullName?: string,
  ) => {
    const params = new URLSearchParams({
      sport: sportKey,
      country: countryName,
      league: leagueName,
    });
    // `l` carries the exact backend league name so the home page filters
    // the real API by the precise value (handles commas / no-dash names).
    if (fullName) params.set("l", fullName);
    router.push(`/?${params.toString()}`);
    onNavigate?.();
  };

  const toggleSport = (sportKey: string) => {
    setExpandedSport(expandedSport === sportKey ? null : sportKey);
    setExpandedCountry(null);
  };

  const toggleCountry = (countryName: string) => {
    setExpandedCountry(expandedCountry === countryName ? null : countryName);
  };

  return (
    <div className={className}>
      {/* Top Leagues */}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-3 px-2">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
          </svg>
          <span className="font-bold text-xs uppercase tracking-wide">Top Leagues</span>
        </div>
        <div className="space-y-1">
          {topLeagues.map((league, idx) => (
            <button
              key={idx}
              onClick={() =>
                openLeague(
                  league.sport,
                  league.country,
                  league.league,
                  `${league.country} - ${league.league}`,
                )
              }
              className="sidebar-item w-full text-left text-xs text-gray-300 hover:text-white"
            >
              <img src={league.icon} alt="" className="w-4 h-4" />
              <span className="truncate flex-1">{league.name}</span>
              <ChevronRight className="w-3 h-3 text-gray-500" />
            </button>
          ))}
        </div>
      </div>

      {/* Filter by Time */}
      <div className="px-5 py-3">
        <button
          className="w-full py-2 rounded text-xs font-bold"
          style={{ background: "var(--mezzo-accent-yellow)", color: "#000" }}
        >
          Filter by Time
        </button>
      </div>

      {/* Sports with Countries/Leagues — REAL tree when available */}
      <div className="p-3 pt-0 space-y-1">
        {realTree
          ? realTree.map((sport) => (
              <Collapsible
                key={sport.key}
                open={expandedSport === sport.key}
                onOpenChange={() => toggleSport(sport.key)}
              >
                <CollapsibleTrigger asChild>
                  <button className="sidebar-item w-full justify-between text-white">
                    <div className="flex items-center gap-2">
                      <img src={sport.icon} alt="" className="w-5 h-5" />
                      <span className="text-xs font-medium">{sport.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs">
                        {sport.live > 0 ? `${sport.live} live` : sport.upcoming}
                      </span>
                      {expandedSport === sport.key ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="pl-4 mt-1 space-y-1">
                    {sport.countries.map((country, cIdx) => {
                      const ckey = `${sport.key}:${country.name}`;
                      return (
                        <Collapsible
                          key={`${sport.key}-${cIdx}`}
                          open={expandedCountry === ckey}
                          onOpenChange={() => toggleCountry(ckey)}
                        >
                          <CollapsibleTrigger asChild>
                            <button className="sidebar-item w-full text-left text-xs text-gray-300 hover:text-white">
                              <img src={country.flag} alt="" className="w-4 h-3 rounded-sm" />
                              <span className="flex-1 truncate">{country.name}</span>
                              <span className="text-[10px] text-gray-500 mr-1">
                                {country.total}
                              </span>
                              {expandedCountry === ckey ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="pl-6 mt-0.5 space-y-0.5">
                              {country.leagues.map((league, lIdx) => (
                                <button
                                  key={lIdx}
                                  onClick={() =>
                                    openLeague(
                                      sport.key,
                                      country.name,
                                      league.label,
                                      league.full,
                                    )
                                  }
                                  className="w-full text-left py-1 px-2 text-[11px] text-gray-400 hover:text-white hover:bg-[var(--mezzo-hover)] rounded transition-colors flex items-center"
                                >
                                  <span className="flex-1 truncate">{league.label}</span>
                                  {league.live > 0 ? (
                                    <span className="ml-2 text-[10px] text-[var(--mezzo-accent-green)]">
                                      {league.live} live
                                    </span>
                                  ) : (
                                    league.upcoming > 0 && (
                                      <span className="ml-2 text-[10px] text-[var(--mezzo-accent-yellow)]">
                                        {league.upcoming}
                                      </span>
                                    )
                                  )}
                                </button>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))
          : /* Offline fallback — static catalog (visuals unchanged) */
            sports.map((sport) => (
              <Collapsible
                key={sport.key}
                open={expandedSport === sport.key}
                onOpenChange={() => toggleSport(sport.key)}
              >
                <CollapsibleTrigger asChild>
                  <button className="sidebar-item w-full justify-between text-white">
                    <div className="flex items-center gap-2">
                      <img src={sport.icon} alt="" className="w-5 h-5" />
                      <span className="text-xs font-medium">{sport.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{sport.count}</span>
                      {expandedSport === sport.key ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="pl-4 mt-1 space-y-1">
                    {sport.countries.map((country, cIdx) => (
                      <Collapsible
                        key={`${sport.key}-${cIdx}`}
                        open={expandedCountry === `${sport.key}:${country.name}`}
                        onOpenChange={() => toggleCountry(`${sport.key}:${country.name}`)}
                      >
                        <CollapsibleTrigger asChild>
                          <button className="sidebar-item w-full text-left text-xs text-gray-300 hover:text-white">
                            <img src={country.flag} alt="" className="w-4 h-3 rounded-sm" />
                            <span className="flex-1">{country.name}</span>
                            <span className="text-[10px] text-gray-500 mr-1">{country.count}</span>
                            {expandedCountry === `${sport.key}:${country.name}` ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pl-6 mt-0.5 space-y-0.5">
                            {country.leagues.map((league, lIdx) => (
                              <button
                                key={lIdx}
                                onClick={() =>
                                  openLeague(
                                    sport.key,
                                    country.name,
                                    league,
                                    `${country.name} - ${league}`,
                                  )
                                }
                                className="w-full text-left py-1 px-2 text-[11px] text-gray-400 hover:text-white hover:bg-[var(--mezzo-hover)] rounded transition-colors flex items-center"
                              >
                                <span className="flex-1 truncate">{league}</span>
                              </button>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
      </div>
    </div>
  );
}

/**
 * Convert the flat `GET /api/sports/catalog` response into the
 * sport → country → league tree the sidebar renders. League names arrive
 * as "Country - League"; we split on the FIRST " - " to derive the country
 * group while keeping the exact full name for API filtering.
 */
function buildRealTree(
  apiSports: {
    sport: string;
    live_count: number;
    upcoming_count: number;
    leagues: { name: string; live_count: number; upcoming_count: number }[];
  }[],
): RealSport[] {
  const out: RealSport[] = [];
  for (const s of apiSports) {
    const meta = getSportForBackendKey(s.sport);
    const staticEntry = sports.find((c) => c.key === meta.key);
    const countries = new Map<string, RealCountry>();

    for (const l of s.leagues) {
      const name = l.name ?? "";
      const sep = name.indexOf(" - ");
      const countryName = sep > 0 ? name.slice(0, sep).trim() : "Other";
      const leagueLabel = sep > 0 ? name.slice(sep + 3).trim() : name;
      if (!countries.has(countryName)) {
        countries.set(countryName, {
          name: countryName,
          flag: FLAG_BY_COUNTRY[countryName.toLowerCase()] ?? GLOBE_ICON,
          leagues: [],
          total: 0,
        });
      }
      const c = countries.get(countryName)!;
      c.leagues.push({
        full: name,
        label: leagueLabel || name,
        live: l.live_count,
        upcoming: l.upcoming_count,
      });
      c.total += l.live_count + l.upcoming_count;
    }

    const countryList = Array.from(countries.values())
      .map((c) => ({
        ...c,
        leagues: c.leagues.sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    out.push({
      key: s.sport,
      name: (staticEntry?.name ?? meta.name).toString(),
      icon: staticEntry?.icon ?? meta.icon ?? GLOBE_ICON,
      live: s.live_count,
      upcoming: s.upcoming_count,
      countries: countryList,
    });
  }

  return out.sort((a, b) => {
    const ia = SPORT_ORDER.indexOf(a.key);
    const ib = SPORT_ORDER.indexOf(b.key);
    if (ia === -1 && ib === -1) return a.key.localeCompare(b.key);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export default SportsCatalog;
