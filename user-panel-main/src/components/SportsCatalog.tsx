"use client";

/**
 * Shared sports catalog navigation.
 *
 * This is the exact navigation that already lives in the desktop left
 * sidebar (`LeftSidebarSports`). It has been extracted into a standalone
 * component so the mobile hamburger menu can reuse it verbatim — giving
 * phone and tablet users the same league / country filter UX as the
 * desktop sidebar without duplicating any data or behaviour.
 *
 * The component is purely presentational: it reads from `sportsCatalog`
 * and pushes to `/?sport=…&country=…&league=…`, which the home page
 * already understands. An optional `onNavigate` callback lets callers
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
import { sports } from "@/data/sportsCatalog";
import { sportsApi } from "@/lib/api";

// Same `topLeagues` list as the desktop sidebar. Kept here so both consumers
// render the identical set of featured leagues.
const topLeagues: {
  name: string;
  icon: string;
  sport: string;
  country: string;
  league: string;
}[] = [
  { name: "World - FIFA World Cup Qua...", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "World Cup", league: "Group Stage" },
  { name: "World - FIFA World Cup 202...", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "World Cup", league: "Final" },
  { name: "Europe - UEFA Champ...", icon: "https://ext.same-assets.com/1203561035/3559223569.png", sport: "football", country: "Champions League", league: "Group Stage" },
  { name: "Europe - UEFA Europa...", icon: "https://ext.same-assets.com/1203561035/3559223569.png", sport: "football", country: "Europa League", league: "Group Stage" },
  { name: "Europe - UEFA Confer...", icon: "https://ext.same-assets.com/1203561035/3559223569.png", sport: "football", country: "Europa Conference League", league: "Group Stage" },
  { name: "England - Premier Le...", icon: "https://ext.same-assets.com/1203561035/3447107198.png", sport: "football", country: "England", league: "Premier League" },
  { name: "Spain - La Liga", icon: "https://ext.same-assets.com/1203561035/1920343590.png", sport: "football", country: "Spain", league: "La Liga" },
  { name: "Germany - Bundesliga", icon: "https://ext.same-assets.com/1203561035/2987763661.png", sport: "football", country: "Germany", league: "Bundesliga" },
  { name: "France - Ligue 1", icon: "https://ext.same-assets.com/1203561035/3982235625.png", sport: "football", country: "France", league: "Ligue 1" },
  { name: "Italy - Serie A", icon: "https://ext.same-assets.com/1203561035/2221869759.png", sport: "football", country: "Italy", league: "Serie A" },
];

interface SportsCatalogProps {
  /** Invoked after any navigation action so callers can close an
   *  enclosing drawer/menu. Optional. */
  onNavigate?: () => void;
  /** Extra classes applied to the root container — useful for tightening
   *  spacing when the catalog is embedded inside another panel. */
  className?: string;
}

export function SportsCatalog({ onNavigate, className = "" }: SportsCatalogProps) {
  const router = useRouter();
  const [expandedSport, setExpandedSport] = useState<string | null>("football");
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);

  // Live + upcoming counts from `GET /api/sports/catalog`. We layer these
  // on top of the static tree (which carries the flags/icons) so the
  // sidebar reads like a real bookmaker — number of live matches per
  // sport / per league updates as the day evolves.
  const [counts, setCounts] = useState<{
    perSport: Map<string, { live: number; upcoming: number }>;
    perLeague: Map<string, { live: number; upcoming: number }>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    sportsApi
      .getSportsCatalog()
      .then((res) => {
        if (cancelled) return;
        const perSport = new Map<string, { live: number; upcoming: number }>();
        const perLeague = new Map<string, { live: number; upcoming: number }>();
        for (const s of res.sports ?? []) {
          perSport.set(s.sport.toLowerCase(), {
            live: s.live_count,
            upcoming: s.upcoming_count,
          });
          for (const l of s.leagues) {
            perLeague.set(l.name.toLowerCase(), {
              live: l.live_count,
              upcoming: l.upcoming_count,
            });
          }
        }
        setCounts({ perSport, perLeague });
      })
      .catch(() => {
        // Sidebar still renders without counts when the backend is offline.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve a count badge for a given sport / league name. Falls back to
  // the static `count` field on the catalog when the backend has no data
  // for that node yet.
  const sportLiveCount = useMemo(() => {
    return (sportKey: string, fallback: number | string): string => {
      const c = counts?.perSport.get(sportKey.toLowerCase());
      if (!c) return String(fallback);
      if (c.live > 0) return `${c.live} live`;
      return String(c.upcoming || fallback);
    };
  }, [counts]);

  const leagueLiveCount = useMemo(() => {
    return (countryLeague: string): number | null => {
      // Backend leagues come in "Country - League" form (matching the
      // `sports_events.league` column). We try the full join first, then
      // fall back to bare league name.
      const exact = counts?.perLeague.get(countryLeague.toLowerCase());
      if (exact) return exact.live + exact.upcoming;
      return null;
    };
  }, [counts]);

  const openLeague = (sportKey: string, countryName: string, leagueName: string) => {
    const params = new URLSearchParams({
      sport: sportKey,
      country: countryName,
      league: leagueName,
    });
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
          <svg
            className="w-4 h-4 text-white"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
          </svg>
          <span className="font-bold text-xs uppercase tracking-wide">
            Top Leagues
          </span>
        </div>
        <div className="space-y-1">
          {topLeagues.map((league, idx) => (
            <button
              key={idx}
              onClick={() => openLeague(league.sport, league.country, league.league)}
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

      {/* Sports with Countries/Leagues */}
      <div className="p-3 pt-0 space-y-1">
        {sports.map((sport) => (
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
                    {sportLiveCount(sport.key, sport.count)}
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
                {sport.countries.map((country, cIdx) => (
                  <Collapsible
                    key={`${sport.key}-${cIdx}`}
                    open={expandedCountry === `${sport.key}:${country.name}`}
                    onOpenChange={() =>
                      toggleCountry(`${sport.key}:${country.name}`)
                    }
                  >
                    <CollapsibleTrigger asChild>
                      <button className="sidebar-item w-full text-left text-xs text-gray-300 hover:text-white">
                        <img
                          src={country.flag}
                          alt=""
                          className="w-4 h-3 rounded-sm"
                        />
                        <span className="flex-1">{country.name}</span>
                        <span className="text-[10px] text-gray-500 mr-1">
                          {country.count}
                        </span>
                        {expandedCountry === `${sport.key}:${country.name}` ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="pl-6 mt-0.5 space-y-0.5">
                        {country.leagues.map((league, lIdx) => {
                          const total = leagueLiveCount(
                            `${country.name} - ${league}`,
                          );
                          return (
                            <button
                              key={lIdx}
                              onClick={() =>
                                openLeague(sport.key, country.name, league)
                              }
                              className="w-full text-left py-1 px-2 text-[11px] text-gray-400 hover:text-white hover:bg-[var(--mezzo-hover)] rounded transition-colors flex items-center"
                            >
                              <span className="flex-1 truncate">{league}</span>
                              {total !== null && total > 0 && (
                                <span className="ml-2 text-[10px] text-[var(--mezzo-accent-yellow)]">
                                  {total}
                                </span>
                              )}
                            </button>
                          );
                        })}
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

export default SportsCatalog;
