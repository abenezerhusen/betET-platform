"use client";

/**
 * `/virtual-sports` — Simulated, always-available sports (Section 15).
 *
 * Data:    GET /api/sports/virtual/schedule
 * Bet:     POST /api/sports/virtual/bet
 *
 * The schedule is generated server-side (a real provider plugs in later)
 * so the screen always shows the next 8 rounds across virtual football /
 * horse / dog. Each round is 180s; we refresh the schedule every 30s and
 * locally tick down a per-card countdown.
 *
 * UI uses the same shared sidebar + betslip as the home page so the look
 * & feel stays identical to the live and pre-match views.
 */

import { useEffect, useMemo, useState } from "react";
import { LeftSidebarSports } from "@/components/LeftSidebarSports";
import { Betslip } from "@/components/Betslip";
import { Trophy, Clock } from "lucide-react";
import { sportsApi } from "@/lib/api";

const SPORT_LABELS: Record<string, string> = {
  virtual_football: "Virtual Football",
  virtual_horse_racing: "Virtual Horse Racing",
  virtual_dog_racing: "Virtual Dog Racing",
};

interface SelectedPick {
  round_id: string;
  selection: "home" | "draw" | "away";
  odds: number;
  label: string;
  home: string;
  away: string;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Live";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export default function VirtualSportsPage() {
  const [schedule, setSchedule] = useState<sportsApi.VirtualSportRound[]>([]);
  const [now, setNow] = useState(Date.now());
  const [pick, setPick] = useState<SelectedPick | null>(null);
  const [stake, setStake] = useState("");
  const [placing, setPlacing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await sportsApi.getVirtualSportsSchedule();
        if (!cancelled) setSchedule(res.items ?? []);
      } catch {
        if (!cancelled) setSchedule([]);
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Local 1s tick to drive the round countdowns.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Group by sport for rendering.
  const groups = useMemo(() => {
    const map = new Map<string, sportsApi.VirtualSportRound[]>();
    for (const r of schedule) {
      const list = map.get(r.sport) ?? [];
      list.push(r);
      map.set(r.sport, list);
    }
    return Array.from(map.entries()).map(([sport, rounds]) => ({
      sport,
      label: SPORT_LABELS[sport] ?? sport,
      rounds: rounds
        .slice()
        .sort(
          (a, b) =>
            new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
        ),
    }));
  }, [schedule]);

  const placeBet = async () => {
    if (!pick) return;
    const stakeNumber = Number(stake);
    if (!Number.isFinite(stakeNumber) || stakeNumber <= 0) {
      setFeedback("Enter a valid stake");
      return;
    }
    setPlacing(true);
    setFeedback(null);
    try {
      const out = await sportsApi.placeVirtualSportsBet({
        round_id: pick.round_id,
        selection: pick.selection,
        stake: stakeNumber,
        odds: pick.odds,
      });
      setFeedback(
        `Bet placed (${out.bet_id.slice(0, 8)}…). New balance: ${out.balance}`,
      );
      setPick(null);
      setStake("");
    } catch (err) {
      setFeedback((err as Error).message ?? "Failed to place bet");
    } finally {
      setPlacing(false);
    }
  };

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
          <Trophy className="w-5 h-5 text-[var(--mezzo-accent-yellow)]" />
          <h1 className="text-base sm:text-lg font-bold">Virtual Sports</h1>
          <span className="ml-auto text-xs text-gray-400">
            Always-available simulated rounds
          </span>
        </div>

        {pick && (
          <div
            className="m-3 p-4 rounded-lg border flex flex-col sm:flex-row gap-3 items-stretch"
            style={{
              background: "var(--mezzo-bg-secondary)",
              borderColor: "var(--mezzo-border)",
            }}
          >
            <div className="flex-1 text-sm">
              <div className="font-semibold mb-1">
                {pick.home} vs {pick.away}
              </div>
              <div className="text-gray-400">
                Pick: {pick.label} @ {pick.odds.toFixed(2)}
              </div>
            </div>
            <input
              type="number"
              min="1"
              step="1"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="Stake (ETB)"
              className="px-3 py-2 rounded border bg-transparent text-sm w-full sm:w-40"
              style={{ borderColor: "var(--mezzo-border)" }}
            />
            <button
              type="button"
              onClick={placeBet}
              disabled={placing}
              className="px-4 py-2 rounded font-bold text-sm disabled:opacity-50"
              style={{
                background: "var(--mezzo-accent-green)",
                color: "#000",
              }}
            >
              {placing ? "Placing…" : "Place Bet"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPick(null);
                setStake("");
              }}
              className="px-3 py-2 rounded text-xs text-gray-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}
        {feedback && (
          <div className="mx-3 mb-2 text-xs text-[var(--mezzo-accent-yellow)]">
            {feedback}
          </div>
        )}

        <div className="overflow-auto max-h-[calc(100vh-300px)] p-3 space-y-4">
          {groups.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              Loading virtual schedule…
            </div>
          ) : (
            groups.map((g) => (
              <section
                key={g.sport}
                className="rounded-lg overflow-hidden"
                style={{ background: "var(--mezzo-bg-secondary)" }}
              >
                <header
                  className="px-3 py-2 text-sm font-semibold border-b"
                  style={{
                    background: "var(--mezzo-bg-tertiary)",
                    borderColor: "var(--mezzo-border)",
                  }}
                >
                  {g.label}
                </header>
                <div
                  className="divide-y"
                  style={{ borderColor: "var(--mezzo-border)" }}
                >
                  {g.rounds.map((r) => {
                    const startMs = new Date(r.starts_at).getTime();
                    const remaining = startMs - now;
                    const live = r.status === "live" || remaining <= 0;
                    return (
                      <div
                        key={r.id}
                        className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {r.home_team} vs {r.away_team}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {live ? (
                              <span className="text-red-400 font-semibold">
                                LIVE
                              </span>
                            ) : (
                              <span>
                                Starts in {formatCountdown(remaining)}
                              </span>
                            )}
                            <span className="ml-2 text-gray-500">
                              Round #{r.round_no}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={live}
                            onClick={() =>
                              setPick({
                                round_id: r.id,
                                selection: "home",
                                odds: r.odds.home,
                                label: r.home_team,
                                home: r.home_team,
                                away: r.away_team,
                              })
                            }
                            className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
                            style={{
                              background: "var(--mezzo-bg-tertiary)",
                              color: "var(--mezzo-accent-yellow)",
                              minWidth: 72,
                            }}
                          >
                            1 · {r.odds.home.toFixed(2)}
                          </button>
                          {r.odds.draw !== undefined && (
                            <button
                              type="button"
                              disabled={live}
                              onClick={() =>
                                setPick({
                                  round_id: r.id,
                                  selection: "draw",
                                  odds: r.odds.draw!,
                                  label: "Draw",
                                  home: r.home_team,
                                  away: r.away_team,
                                })
                              }
                              className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
                              style={{
                                background: "var(--mezzo-bg-tertiary)",
                                color: "var(--mezzo-accent-yellow)",
                                minWidth: 72,
                              }}
                            >
                              X · {r.odds.draw.toFixed(2)}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={live}
                            onClick={() =>
                              setPick({
                                round_id: r.id,
                                selection: "away",
                                odds: r.odds.away,
                                label: r.away_team,
                                home: r.home_team,
                                away: r.away_team,
                              })
                            }
                            className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
                            style={{
                              background: "var(--mezzo-bg-tertiary)",
                              color: "var(--mezzo-accent-yellow)",
                              minWidth: 72,
                            }}
                          >
                            2 · {r.odds.away.toFixed(2)}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      <Betslip />
    </div>
  );
}
