"use client";

/**
 * `/live` — Live betting page (Section 15).
 *
 * Data:    GET /api/sports/matches?status=live
 * Refresh: polled every 10 seconds (per spec). When WebSocket support
 *          lands on the backend (room `match:${id}`) we can swap this
 *          poll loop for a socket subscription without touching the JSX.
 *
 * UI re-uses the existing `MatchCard` and sidebar layout so the design
 * stays identical to the home page; only the data source and the lack
 * of the "Upcoming / Top Leagues" tabs differ.
 */

import { useEffect, useMemo, useState } from "react";
import { LeftSidebarSports } from "@/components/LeftSidebarSports";
import { Betslip } from "@/components/Betslip";
import { MatchCard } from "@/components/MatchCard";
import { Activity } from "lucide-react";
import { sportsApi } from "@/lib/api";
import { sports as sportsCatalog } from "@/data/sportsCatalog";

interface LiveCard {
  id: string;
  league: string;
  leagueFlag: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  time: string;
  sideBets: number;
  score: { home: number; away: number };
  minute: string;
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
}

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

function toLiveCard(row: sportsApi.SportsMatchRow): LiveCard {
  const starts = new Date(row.starts_at);
  const date = `${String(starts.getDate()).padStart(2, "0")}/${String(
    starts.getMonth() + 1,
  ).padStart(2, "0")}`;
  const time = `${String(starts.getHours()).padStart(2, "0")}:${String(
    starts.getMinutes(),
  ).padStart(2, "0")}`;
  return {
    id: row.id,
    league: row.league ?? row.sport,
    leagueFlag: leagueFlagFor(row.league),
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    date,
    time,
    sideBets: row.total_bets ?? 0,
    score: { home: row.home_score ?? 0, away: row.away_score ?? 0 },
    minute: row.minute ? `${row.minute}'` : "Live",
    odds: {
      home: row.home_odds,
      draw: row.draw_odds,
      away: row.away_odds,
      home1x: Math.max(1.05, +(row.home_odds * 0.55).toFixed(2)),
      draw12: Math.max(1.05, +((row.home_odds + row.away_odds) * 0.3).toFixed(2)),
      away2x: Math.max(1.05, +(row.away_odds * 0.55).toFixed(2)),
      yesScore: 1.85,
      noScore: 1.85,
    },
  };
}

export default function LivePage() {
  const [rows, setRows] = useState<sportsApi.SportsMatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const res = await sportsApi.listSportsMatches({
          status: "live",
          limit: 100,
        });
        if (cancelled) return;
        setRows(res.items ?? []);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message ?? "Failed to load live matches");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    // Spec: poll every 10s. We'll switch to a WebSocket subscription
    // once the backend emits `match:${id}` events.
    timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  const cards = useMemo(() => rows.map(toLiveCard), [rows]);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <LeftSidebarSports />

      <div
        className="flex-1 min-w-0 overflow-hidden"
        style={{ background: "var(--mezzo-bg-primary)" }}
      >
        <div
          className="px-4 py-3 border-b flex items-center gap-3"
          style={{
            background: "var(--mezzo-bg-secondary)",
            borderColor: "var(--mezzo-border)",
          }}
        >
          <span className="inline-flex w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <Activity className="w-5 h-5 text-[var(--mezzo-accent-yellow)]" />
          <h1 className="text-base sm:text-lg font-bold">Live Betting</h1>
          <span className="ml-auto text-xs text-gray-400">
            {cards.length} {cards.length === 1 ? "match" : "matches"} live
          </span>
        </div>

        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          {loading && cards.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              Loading live matches…
            </div>
          ) : error ? (
            <div className="p-10 text-center text-red-400 text-sm">
              {error}
            </div>
          ) : cards.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              No live matches right now. Check back soon.
            </div>
          ) : (
            cards.map((card) => (
              <MatchCard
                key={card.id}
                {...card}
                isLive
                onSideBetsClick={() => {
                  // Navigate to the match detail page where the live
                  // markets are loaded from `/api/sports/matches/:id`.
                  window.location.href = `/match/${encodeURIComponent(
                    card.id,
                  )}`;
                }}
              />
            ))
          )}
        </div>
      </div>

      <Betslip />
    </div>
  );
}
