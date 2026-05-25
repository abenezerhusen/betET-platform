"use client";

import { LeftSidebar } from "@/components/LeftSidebar";
import { Betslip } from "@/components/Betslip";
import { Calendar } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { sportsApi } from "@/lib/api";

export default function ResultsPage() {
  const [rows, setRows] = useState<sportsApi.SportsMatchRow[]>([]);

  useEffect(() => {
    sportsApi
      .listSportsMatches({ status: "completed", page: 1, limit: 30 })
      .then((res) => setRows(res.items ?? []))
      .catch(() => setRows([]));
  }, []);

  const results = useMemo(() => {
    const byLeague = new Map<string, sportsApi.SportsMatchRow[]>();
    for (const r of rows) {
      const key = r.league || r.sport || "Unknown League";
      const list = byLeague.get(key) ?? [];
      list.push(r);
      byLeague.set(key, list);
    }
    return Array.from(byLeague.entries()).map(([league, matches]) => ({
      league,
      leagueFlag: "https://ext.same-assets.com/1203561035/3447107198.png",
      date: "Recent",
      matches: matches.map((m) => ({
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        homeScore: m.home_score,
        awayScore: m.away_score,
        time: "Full Time",
      })),
    }));
  }, [rows]);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <LeftSidebar />

      <div className="flex-1" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="p-6 border-b" style={{ borderColor: "var(--mezzo-border)" }}>
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="w-6 h-6 text-[var(--mezzo-accent-yellow)]" />
            <h1 className="text-2xl font-bold">Match Results</h1>
          </div>
          <p className="text-gray-400">Recently finished matches and their final scores</p>
        </div>

        <div className="p-4 space-y-4">
          {results.map((league, idx) => (
            <div key={idx} className="rounded-lg overflow-hidden" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <div className="flex items-center gap-2 px-4 py-2" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                <img src={league.leagueFlag} alt="" className="w-4 h-3 rounded-sm" />
                <span className="font-semibold">{league.league}</span>
                <span className="text-xs text-gray-400 ml-auto">{league.date}</span>
              </div>

              <div className="divide-y" style={{ borderColor: "var(--mezzo-border)" }}>
                {league.matches.map((match, matchIdx) => (
                  <div key={matchIdx} className="p-4 hover:bg-[var(--mezzo-bg-tertiary)] transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm">{match.homeTeam}</span>
                          <span className="text-xl font-bold mx-4">{match.homeScore}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">{match.awayTeam}</span>
                          <span className="text-xl font-bold mx-4">{match.awayScore}</span>
                        </div>
                      </div>
                      <div className="text-right ml-6">
                        <div className="text-xs text-gray-400">{match.time}</div>
                        <div className="mt-1 px-2 py-1 rounded text-xs" style={{ background: "var(--mezzo-accent-green)", color: "#000" }}>
                          Finished
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Betslip />
    </div>
  );
}
