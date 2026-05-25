"use client";

import { LeftSidebar } from "@/components/LeftSidebar";
import { Betslip } from "@/components/Betslip";
import { MatchCard } from "@/components/MatchCard";
import { useEffect, useState } from "react";
import { sportsApi } from "@/lib/api";

function mapMatch(m: sportsApi.SportsMatchRow) {
  const dt = new Date(m.starts_at);
  return {
    league: m.league || m.sport,
    leagueFlag: "https://ext.same-assets.com/1203561035/3447107198.png",
    homeTeam: m.home_team,
    awayTeam: m.away_team,
    date: dt.toLocaleDateString(),
    time: dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    sideBets: m.total_bets || 0,
    odds: {
      home: Number(m.home_odds || 1.5),
      draw: Number(m.draw_odds || 3),
      away: Number(m.away_odds || 2.5),
      home1x: 1.2,
      draw12: 1.35,
      away2x: 1.6,
      yesScore: 1.7,
      noScore: 1.9,
    },
  };
}

export default function TopSportsPage() {
  const [topMatches, setTopMatches] = useState<ReturnType<typeof mapMatch>[]>([]);

  useEffect(() => {
    sportsApi
      .listSportsMatches({ sort: "popularity", limit: 20 })
      .then((res) => setTopMatches((res.items ?? []).map(mapMatch)))
      .catch(() => setTopMatches([]));
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <LeftSidebar />

      <div className="flex-1" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">Top Matches of the Week</h1>
          <p className="text-gray-400 mb-6">Featured matches with the highest betting activity</p>
        </div>

        <div
          className="flex items-center px-4 py-2 text-xs text-gray-500 font-medium"
          style={{ background: "var(--mezzo-bg-secondary)" }}
        >
          <div className="flex-1">Match Result</div>
          <div className="w-[140px] text-center">Double Chance</div>
          <div className="w-[100px] text-center">Both Score</div>
          <div className="w-24 text-right"></div>
        </div>

        <div>
          {topMatches.map((match, index) => (
            <MatchCard key={index} {...match} />
          ))}
        </div>
      </div>

      <Betslip />
    </div>
  );
}
