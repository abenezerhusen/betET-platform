"use client";

/**
 * `/sport-history` — Section 15 spec.
 *
 * What it is:  Completed match results, displayed as a chronological list.
 * Data:        GET /api/sports/matches?status=completed
 *
 * The previous version was a hard-coded "my tickets" view, but the spec
 * explicitly defines this page as the completed-matches archive (the
 * personal-bets view lives at `/bets-history`). The rich filter UI from
 * the original implementation is preserved (date range + result filter
 * + summary counter) so the page still feels familiar.
 */

import { useEffect, useMemo, useState } from "react";
import { Betslip } from "@/components/Betslip";
import {
  CheckCircle,
  Ticket,
  ChevronDown,
  ChevronUp,
  Calendar,
  Filter,
  RotateCcw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { sportsApi } from "@/lib/api";

type WinnerKey = "all" | "home" | "draw" | "away";

interface FinishedMatch {
  id: string;
  sport: string;
  league: string | null;
  home_team: string;
  away_team: string;
  starts_at: string;
  home_score: number;
  away_score: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function winnerOf(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

export default function SportHistoryPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [winnerFilter, setWinnerFilter] = useState<WinnerKey>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [rows, setRows] = useState<FinishedMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    sportsApi
      .listSportsMatches({ status: "completed", page: 1, limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setRows(
          (res.items ?? []).map((r) => ({
            id: r.id,
            sport: r.sport,
            league: r.league ?? null,
            home_team: r.home_team,
            away_team: r.away_team,
            starts_at: r.starts_at,
            home_score: r.home_score ?? 0,
            away_score: r.away_score ?? 0,
          })),
        );
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load completed matches");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const resetFilters = () => {
    setFromDate("");
    setToDate("");
    setWinnerFilter("all");
  };

  const filtered = useMemo(() => {
    const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`) : null;
    return rows.filter((m) => {
      if (winnerFilter !== "all") {
        if (winnerOf(m.home_score, m.away_score) !== winnerFilter) return false;
      }
      const d = new Date(m.starts_at);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [rows, fromDate, toDate, winnerFilter]);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div className="flex-1" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-6">
            <Ticket className="w-7 h-7 text-[var(--mezzo-accent-yellow)]" />
            <h1 className="text-2xl sm:text-3xl font-bold">
              Sport History - Completed Matches
            </h1>
          </div>

          <div
            className="rounded-lg p-4 mb-5"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <div className="flex items-center gap-2 mb-3 text-sm text-gray-300">
              <Filter className="w-4 h-4 text-[var(--mezzo-accent-yellow)]" />
              <span className="font-semibold">Filter matches</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  From
                </label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  To
                </label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Result</label>
                <select
                  value={winnerFilter}
                  onChange={(e) => setWinnerFilter(e.target.value as WinnerKey)}
                  className="w-full h-10 px-3 rounded border bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--mezzo-accent-green)]"
                >
                  <option value="all">All</option>
                  <option value="home">Home Win</option>
                  <option value="draw">Draw</option>
                  <option value="away">Away Win</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetFilters}
                  className="w-full border-[var(--mezzo-border)] text-white hover:bg-[var(--mezzo-bg-tertiary)] flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </Button>
              </div>
            </div>
            <div className="mt-3 text-xs text-gray-400">
              Showing{" "}
              <span className="text-white font-semibold">{filtered.length}</span>{" "}
              of {rows.length} matches
            </div>
          </div>

          {loading ? (
            <div className="rounded-lg p-6 text-center text-gray-400" style={{ background: "var(--mezzo-bg-secondary)" }}>
              Loading completed matches…
            </div>
          ) : error ? (
            <div className="rounded-lg p-6 text-center text-red-400" style={{ background: "var(--mezzo-bg-secondary)" }}>
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg p-6 text-center text-gray-400" style={{ background: "var(--mezzo-bg-secondary)" }}>
              No matches yet.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((match) => {
                const isOpen = !!expanded[match.id];
                const winner = winnerOf(match.home_score, match.away_score);
                return (
                  <div
                    key={match.id}
                    className="rounded-lg overflow-hidden"
                    style={{ background: "var(--mezzo-bg-secondary)" }}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(match.id)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--mezzo-bg-tertiary)]/60 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                        <span className="font-semibold text-sm sm:text-base truncate">
                          {match.home_team} {match.home_score} - {match.away_score} {match.away_team}
                        </span>
                        <span className="hidden sm:inline text-xs text-gray-400">
                          {match.league ?? match.sport}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded ${
                            winner === "home"
                              ? "bg-green-500/20 text-green-500"
                              : winner === "away"
                                ? "bg-red-500/20 text-red-500"
                                : "bg-yellow-500/20 text-yellow-500"
                          }`}
                        >
                          {winner === "home" ? "Home Win" : winner === "away" ? "Away Win" : "Draw"}
                        </span>
                        {isOpen ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 border-t" style={{ borderColor: "var(--mezzo-border)" }}>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs text-gray-400">
                          <div>
                            <div className="mb-1">Date</div>
                            <div className="text-white font-semibold">{formatDate(match.starts_at)}</div>
                          </div>
                          <div>
                            <div className="mb-1">League</div>
                            <div className="text-white font-semibold">{match.league ?? "—"}</div>
                          </div>
                          <div>
                            <div className="mb-1">Sport</div>
                            <div className="text-white font-semibold capitalize">{match.sport}</div>
                          </div>
                          <div>
                            <div className="mb-1">Match ID</div>
                            <div className="text-white font-semibold truncate">{match.id.slice(0, 12)}…</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Betslip />
    </div>
  );
}
