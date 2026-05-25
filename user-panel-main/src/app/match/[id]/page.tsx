"use client";

import { useEffect, useMemo, useState } from "react";
import { Betslip } from "@/components/Betslip";
import { OddsButton } from "@/components/OddsButton";
import { useParams } from "next/navigation";
import { ChevronLeft, BarChart3 } from "lucide-react";
import Link from "next/link";
import { sportsApi } from "@/lib/api";

export default function MatchDetailsPage() {
  const params = useParams();
  const matchId = params.id as string;
  const [match, setMatch] = useState<sportsApi.SportsMatchDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    sportsApi
      .getSportsMatch(matchId)
      .then((res) => {
        if (!cancelled) setMatch(res);
      })
      .catch(() => {
        if (!cancelled) setMatch(null);
      });
    const id = setInterval(() => {
      void sportsApi.getSportsMatch(matchId).then((res) => {
        if (!cancelled) setMatch(res);
      });
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [matchId]);

  const homeTeam = match?.home_team ?? "Home Team";
  const awayTeam = match?.away_team ?? "Away Team";
  const kickoff = useMemo(
    () => (match?.starts_at ? new Date(match.starts_at).toLocaleString() : "—"),
    [match?.starts_at]
  );
  const bettingMarkets = match?.markets ?? [];

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div className="flex-1 min-w-0" style={{ background: "var(--mezzo-bg-primary)" }}>
        {/* Back Button */}
        <div className="p-4 border-b" style={{ borderColor: "var(--mezzo-border)" }}>
          <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
            <span>Back to Matches</span>
          </Link>
        </div>

        {/* Match Header */}
        <div className="p-4 sm:p-6" style={{ background: "var(--mezzo-bg-secondary)" }}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <BarChart3 className="w-6 h-6 text-[var(--mezzo-accent-yellow)] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs sm:text-sm text-gray-400">Football - Premier League</div>
                <h1 className="text-lg sm:text-2xl font-bold mt-1 break-words">{homeTeam} vs {awayTeam}</h1>
              </div>
            </div>
            <div className="text-left sm:text-right shrink-0">
              <div className="text-xs sm:text-sm text-gray-400">Kickoff</div>
              <div className="text-base sm:text-lg font-semibold">{kickoff}</div>
            </div>
          </div>
        </div>

        {/* Betting Markets */}
        <div className="p-4">
          <h2 className="text-xl font-bold mb-4">All Betting Markets</h2>
          <div className="space-y-4">
            {bettingMarkets.map((market) => (
              <div
                key={String(market.id)}
                className="rounded-lg p-4"
                style={{ background: "var(--mezzo-bg-secondary)" }}
              >
                <h3 className="text-sm font-semibold text-gray-400 mb-3">{market.name}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {market.selections.map((option) => (
                    <OddsButton
                      key={String(option.id)}
                      homeTeam={homeTeam}
                      awayTeam={awayTeam}
                      league={match?.league ?? match?.sport ?? "Sports"}
                      date=""
                      time=""
                      market={market.name}
                      selection={option.name}
                      odds={Number(option.odds)}
                      selectionId={String(option.id)}
                      marketId={String(market.id)}
                      eventId={match?.id ? String(match.id) : undefined}
                      className="odds-btn p-3 flex flex-col items-center justify-center hover:scale-105 transition-transform"
                    >
                      <div className="text-xs text-gray-400 mb-1">{option.name}</div>
                      <div className="text-lg font-bold">{Number(option.odds).toFixed(2)}</div>
                    </OddsButton>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Match Statistics */}
          <div className="mt-6 rounded-lg p-4" style={{ background: "var(--mezzo-bg-secondary)" }}>
            <h3 className="text-sm font-semibold text-gray-400 mb-3">Head to Head Statistics</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm">Last 5 Matches</span>
                <div className="flex gap-1">
                  <span className="w-6 h-6 rounded bg-green-600 flex items-center justify-center text-xs">W</span>
                  <span className="w-6 h-6 rounded bg-gray-600 flex items-center justify-center text-xs">D</span>
                  <span className="w-6 h-6 rounded bg-green-600 flex items-center justify-center text-xs">W</span>
                  <span className="w-6 h-6 rounded bg-red-600 flex items-center justify-center text-xs">L</span>
                  <span className="w-6 h-6 rounded bg-green-600 flex items-center justify-center text-xs">W</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Average Goals</span>
                <span className="font-semibold">2.5 per match</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Last Meeting</span>
                <span className="font-semibold">{homeTeam} 2-1 {awayTeam}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Betslip />
    </div>
  );
}
