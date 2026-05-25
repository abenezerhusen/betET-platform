"use client";

import { LeftSidebar } from "@/components/LeftSidebar";
import { Betslip } from "@/components/Betslip";
import { MatchCard } from "@/components/MatchCard";
import { TrendingUp } from "lucide-react";
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

export default function ExpressPage() {
  const [expressMatches, setExpressMatches] = useState<ReturnType<typeof mapMatch>[]>([]);

  useEffect(() => {
    // Spec wording is `is_featured=true`; the backend also accepts the
    // older `type=express` alias which maps to the same SQL filter. We
    // send the spec field so the URL matches the documented contract.
    sportsApi
      .listSportsMatches({ is_featured: true, limit: 10 })
      .then((res) => setExpressMatches((res.items ?? []).map(mapMatch)))
      .catch(() => setExpressMatches([]));
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <LeftSidebar />

      <div className="flex-1" style={{ background: "var(--mezzo-bg-primary)" }}>
        {/* Info Banner */}
        <div className="p-6 border-b" style={{ background: "var(--mezzo-bg-secondary)", borderColor: "var(--mezzo-border)" }}>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-full" style={{ background: "var(--mezzo-accent-green)" }}>
              <TrendingUp className="w-6 h-6 text-black" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold mb-2">Express Betting (Accumulators)</h1>
              <p className="text-gray-400 mb-3">
                Combine multiple selections into one bet for higher odds! Minimum 3 selections required.
              </p>
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="text-center p-3 rounded" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                  <div className="text-2xl font-bold text-[var(--mezzo-accent-yellow)]">3+</div>
                  <div className="text-xs text-gray-400 mt-1">Min Selections</div>
                </div>
                <div className="text-center p-3 rounded" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                  <div className="text-2xl font-bold text-[var(--mezzo-accent-yellow)]">10%</div>
                  <div className="text-xs text-gray-400 mt-1">Bonus on 5+ picks</div>
                </div>
                <div className="text-center p-3 rounded" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                  <div className="text-2xl font-bold text-[var(--mezzo-accent-yellow)]">20%</div>
                  <div className="text-xs text-gray-400 mt-1">Bonus on 10+ picks</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          <h2 className="text-xl font-bold mb-4">Recommended for Express Bets</h2>
          <p className="text-gray-400 mb-6">High confidence matches perfect for accumulators</p>
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
          {expressMatches.map((match, index) => (
            <MatchCard key={index} {...match} />
          ))}
        </div>
      </div>

      <Betslip />
    </div>
  );
}
