"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown, Star } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { sports as catalogSports, type Sport } from "@/data/sportsCatalog";

/**
 * Flatten a sport's countries/leagues into a single list of sidebar entries
 * with a "Country - League" label. The full list is cached per sport so the
 * array is constant across re-renders (same reference).
 */
const LEAGUES_PER_SPORT = 12;

type SidebarLeague = {
  name: string;
  flag: string;
  count: number;
  sportKey: string;
  country: string;
  league: string;
};

function flattenSportLeagues(sport: Sport): SidebarLeague[] {
  const out: SidebarLeague[] = [];
  for (const country of sport.countries) {
    for (const league of country.leagues) {
      out.push({
        name: `${country.name} - ${league}`,
        flag: country.flag,
        count: country.count,
        sportKey: sport.key,
        country: country.name,
        league,
      });
      if (out.length >= LEAGUES_PER_SPORT) return out;
    }
  }
  return out;
}

const sports = catalogSports.map((s) => ({
  name: s.name === "TABLE TEN..." ? "TABLE TENNIS" : s.name,
  count: s.count,
  icon: s.icon,
  key: s.key,
  leagues: flattenSportLeagues(s),
}));

const topLeagues: { name: string; icon: string; sport: string; country: string; league: string }[] = [
  { name: "World - FIFA World Cup Qualifications", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "World Cup", league: "Group Stage" },
  { name: "World - FIFA World Cup 2026 Outright", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "World Cup", league: "Final" },
  { name: "Europe - UEFA Champions League", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "Champions League", league: "Group Stage" },
  { name: "Europe - UEFA Europa League", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "Europa League", league: "Group Stage" },
  { name: "Europe - UEFA Conference League", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "Europa Conference League", league: "Group Stage" },
  { name: "England - Premier League", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "England", league: "Premier League" },
  { name: "Spain - La Liga", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "Spain", league: "La Liga" },
  { name: "Germany - Bundesliga", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "Germany", league: "Bundesliga" },
  { name: "France - Ligue 1", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "France", league: "Ligue 1" },
  { name: "Italy - Serie A", icon: "https://ext.same-assets.com/1203561035/3182885345.svg", sport: "football", country: "Italy", league: "Serie A" },
];

export function LeftSidebar() {
  const router = useRouter();
  const [expandedSports, setExpandedSports] = useState<string[]>(["FOOTBALL"]);

  const toggleSport = (sportName: string) => {
    setExpandedSports((prev) =>
      prev.includes(sportName)
        ? prev.filter((s) => s !== sportName)
        : [...prev, sportName]
    );
  };

  const openLeague = (sportKey: string, countryName: string, leagueName: string) => {
    const params = new URLSearchParams({ sport: sportKey, country: countryName, league: leagueName });
    router.push(`/?${params.toString()}`);
  };

  return (
    <aside
      className="hidden md:block md:w-56 lg:w-64 flex-shrink-0 border-r"
      style={{
        background: "var(--mezzo-bg-secondary)",
        borderColor: "var(--mezzo-border)",
      }}
    >
      <ScrollArea className="h-[calc(100vh-120px)]">
        {/* Top Leagues */}
        <div className="p-3">
          <div className="flex items-center gap-2 mb-3 px-2">
            <Star className="w-4 h-4 text-[var(--mezzo-accent-yellow)]" />
            <span className="font-semibold text-sm uppercase tracking-wide">Top Leagues</span>
          </div>
          <div className="space-y-1">
            {topLeagues.map((league) => (
              <button
                key={league.name}
                onClick={() => openLeague(league.sport, league.country, league.league)}
                className="sidebar-item w-full text-left text-sm text-gray-300 hover:text-white"
              >
                <img src={league.icon} alt="" className="w-4 h-4" />
                <span className="truncate flex-1">{league.name}</span>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
            ))}
          </div>
        </div>

        {/* Filter by Time */}
        <div className="px-3 py-2">
          <button
            className="w-full text-left px-3 py-2 rounded text-sm font-medium"
            style={{ color: "var(--mezzo-accent-yellow)" }}
          >
            Filter by Time
          </button>
        </div>

        {/* Sports */}
        <div className="p-3 pt-0">
          {sports.map((sport) => (
            <Collapsible
              key={sport.name}
              open={expandedSports.includes(sport.name)}
              onOpenChange={() => toggleSport(sport.name)}
            >
              <CollapsibleTrigger asChild>
                <button className="sidebar-item w-full justify-between text-white">
                  <div className="flex items-center gap-2">
                    <img src={sport.icon} alt="" className="w-5 h-5" />
                    <span className="font-medium text-sm">{sport.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{sport.count}</span>
                    {expandedSports.includes(sport.name) ? (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pl-6 space-y-1 py-1">
                  {sport.leagues.map((league) => (
                    <button
                      key={`${sport.key}-${league.name}`}
                      onClick={() => openLeague(league.sportKey, league.country, league.league)}
                      className="sidebar-item w-full text-left text-sm text-gray-400 hover:text-white"
                    >
                      <img src={league.flag} alt="" className="w-4 h-3 rounded-sm" />
                      <span className="flex-1">{league.name}</span>
                      <span className="text-xs">{league.count}</span>
                    </button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
