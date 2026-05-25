"use client";

/**
 * `/bets-history` — User's personal betting history (Section 15).
 *
 * Data: GET /api/user/me/bets?page=1&limit=30
 *
 * The UI design from the original mock page is preserved verbatim; only
 * the data source is swapped from a hardcoded array to the real backend
 * endpoint. Each backend bet may be a sportsbook entry (with multiple
 * selections) or a casino entry (single selection); both are normalised
 * to the same display shape so the existing card layout still works.
 */

import { useEffect, useMemo, useState } from "react";
import { Betslip } from "@/components/Betslip";
import {
  Clock,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Calendar,
  Filter,
} from "lucide-react";
import { profileApi } from "@/lib/api";
import type { BetSummaryItem } from "@/lib/api/types";

type StatusLabel = "Won" | "Lost" | "Pending" | "Void";

interface DisplayBet {
  ticketId: string;
  date: string;
  status: StatusLabel;
  stake: number;
  totalOdds: number;
  potentialWin: number;
  actualWin: number;
  accumulatorBonus: number;
  matches: {
    homeTeam: string;
    awayTeam: string;
    bet: string;
    odd: number;
    result: StatusLabel;
  }[];
}

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapStatus(s: string): StatusLabel {
  const v = (s ?? "").toLowerCase();
  if (v === "won" || v === "partial_won" || v === "cashed_out") return "Won";
  if (v === "lost") return "Lost";
  if (v === "void" || v === "cancelled") return "Void";
  return "Pending";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function toDisplay(b: BetSummaryItem): DisplayBet {
  const stake = toNumber(b.stake);
  const potential = toNumber(b.potential_payout);
  const actual = toNumber(b.actual_payout);
  const oddsHeadline = toNumber(b.odds);
  const totalOdds = oddsHeadline > 0
    ? oddsHeadline
    : stake > 0
      ? Number((potential / stake).toFixed(2))
      : 0;
  const selections = Array.isArray(b.selections) && b.selections.length > 0
    ? b.selections.map((sel) => {
        const rec = sel as unknown as Record<string, unknown>;
        const market = typeof rec.market === "string" ? rec.market : "";
        const selection = typeof rec.selection === "string" ? rec.selection : "";
        const homeTeam = typeof rec.home_team === "string" ? rec.home_team : "—";
        const awayTeam = typeof rec.away_team === "string" ? rec.away_team : "—";
        const legOdds = toNumber(
          (rec.odds as number | string | null | undefined) ?? null,
        );
        const result = mapStatus(
          (rec.status as string) ?? (rec.result as string) ?? b.status,
        );
        return {
          homeTeam,
          awayTeam,
          bet: market ? `${market}${selection ? `: ${selection}` : ""}` : selection,
          odd: legOdds > 0 ? legOdds : totalOdds,
          result,
        };
      })
    : [
        {
          homeTeam: "Casino / Game",
          awayTeam: b.bet_type ?? "—",
          bet: b.bet_type ?? "Bet",
          odd: totalOdds,
          result: mapStatus(b.status),
        },
      ];

  return {
    ticketId: b.id.slice(0, 12).toUpperCase(),
    date: formatDate(b.placed_at),
    status: mapStatus(b.status),
    stake,
    totalOdds,
    potentialWin: potential,
    actualWin: actual,
    accumulatorBonus: 0,
    matches: selections,
  };
}

export default function BetsHistoryPage() {
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [rawRows, setRawRows] = useState<BetSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    profileApi
      .listBets({ page: 1, limit: 30 })
      .then((res) => {
        if (cancelled) return;
        setRawRows(res.items ?? []);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load bets");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const betsHistory = useMemo(() => rawRows.map(toDisplay), [rawRows]);

  const wonBets = betsHistory.filter((b) => b.status === "Won");
  const lostBets = betsHistory.filter((b) => b.status === "Lost");
  const pendingBets = betsHistory.filter((b) => b.status === "Pending");

  const totalStaked = betsHistory.reduce((sum, bet) => sum + bet.stake, 0);
  const totalWon = wonBets.reduce((sum, bet) => sum + bet.actualWin, 0);
  const totalLost = lostBets.reduce((sum, bet) => sum + bet.stake, 0);
  const netProfit = totalWon - totalLost;
  const winRate =
    wonBets.length + lostBets.length > 0
      ? (wonBets.length / (wonBets.length + lostBets.length)) * 100
      : 0;

  const filteredBets = betsHistory.filter((bet) => {
    if (filterStatus !== "All" && bet.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div className="flex-1 p-8" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Target className="w-8 h-8 text-[var(--mezzo-accent-yellow)]" />
              <h1 className="text-3xl font-bold">Betting History</h1>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-400">Last 30 days</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-lg" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-gray-400" />
                <span className="text-xs text-gray-400">Total Staked</span>
              </div>
              <div className="text-2xl font-bold">{totalStaked.toFixed(0)} ETB</div>
            </div>

            <div className="p-4 rounded-lg" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <span className="text-xs text-gray-400">Total Won</span>
              </div>
              <div className="text-2xl font-bold text-green-500">{totalWon.toFixed(0)} ETB</div>
            </div>

            <div className="p-4 rounded-lg" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-[var(--mezzo-accent-yellow)]" />
                <span className="text-xs text-gray-400">Win Rate</span>
              </div>
              <div className="text-2xl font-bold text-[var(--mezzo-accent-yellow)]">{winRate.toFixed(1)}%</div>
            </div>

            <div className="p-4 rounded-lg" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className={`w-4 h-4 ${netProfit >= 0 ? "text-green-400" : "text-red-400"}`} />
                <span className="text-xs text-gray-400">Net Profit/Loss</span>
              </div>
              <div className={`text-2xl font-bold ${netProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                {netProfit >= 0 ? "+" : ""}{netProfit.toFixed(0)} ETB
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-lg border-l-4 border-green-500" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <div className="text-xs text-gray-400 mb-1">Won Bets</div>
              <div className="text-xl font-bold text-green-500">{wonBets.length}</div>
            </div>
            <div className="p-4 rounded-lg border-l-4 border-red-500" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <div className="text-xs text-gray-400 mb-1">Lost Bets</div>
              <div className="text-xl font-bold text-red-500">{lostBets.length}</div>
            </div>
            <div className="p-4 rounded-lg border-l-4 border-yellow-500" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <div className="text-xs text-gray-400 mb-1">Pending Bets</div>
              <div className="text-xl font-bold text-yellow-500">{pendingBets.length}</div>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-6 p-4 rounded-lg" style={{ background: "var(--mezzo-bg-secondary)" }}>
            <Filter className="w-5 h-5 text-gray-400" />
            <span className="text-sm font-semibold">Filter:</span>
            <div className="flex gap-2">
              {["All", "Won", "Lost", "Pending"].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-4 py-2 rounded text-sm font-semibold transition-all ${
                    filterStatus === status ? "text-black" : "text-gray-400 hover:text-white"
                  }`}
                  style={
                    filterStatus === status
                      ? { background: "var(--mezzo-accent-green)" }
                      : { background: "var(--mezzo-bg-tertiary)" }
                  }
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-gray-400 text-sm">Loading your bets…</div>
          ) : error ? (
            <div className="p-10 text-center text-red-400 text-sm">{error}</div>
          ) : filteredBets.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              No bets yet. Place a bet from the home page and it will appear here.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredBets.map((ticket) => (
                <div
                  key={ticket.ticketId}
                  className="rounded-lg p-5 border-l-4"
                  style={{
                    background: "var(--mezzo-bg-secondary)",
                    borderColor:
                      ticket.status === "Won"
                        ? "#4CAF50"
                        : ticket.status === "Lost"
                          ? "#f44336"
                          : "#FFC107",
                  }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-bold text-lg text-[var(--mezzo-accent-yellow)]">
                          {ticket.ticketId}
                        </span>
                        <span className="text-xs px-3 py-1 rounded font-semibold" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                          {ticket.matches.length} Bets • Odds: {ticket.totalOdds.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-400">{ticket.date}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {ticket.status === "Won" && (
                        <div className="flex items-center gap-2 text-green-500">
                          <CheckCircle className="w-6 h-6" />
                          <span className="font-bold text-lg">WON</span>
                        </div>
                      )}
                      {ticket.status === "Lost" && (
                        <div className="flex items-center gap-2 text-red-500">
                          <XCircle className="w-6 h-6" />
                          <span className="font-bold text-lg">LOST</span>
                        </div>
                      )}
                      {ticket.status === "Pending" && (
                        <div className="flex items-center gap-2 text-[var(--mezzo-accent-yellow)]">
                          <Clock className="w-6 h-6" />
                          <span className="font-bold text-lg">PENDING</span>
                        </div>
                      )}
                      {ticket.status === "Void" && (
                        <div className="flex items-center gap-2 text-gray-400">
                          <XCircle className="w-6 h-6" />
                          <span className="font-bold text-lg">VOID</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    {ticket.matches.map((match, idx) => (
                      <div key={idx} className="p-3 rounded" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-semibold mb-1">
                              {match.homeTeam} vs {match.awayTeam}
                            </div>
                            <div className="text-xs text-gray-400">{match.bet}</div>
                          </div>
                          <div className="text-right flex items-center gap-3">
                            <div className="font-bold text-[var(--mezzo-accent-green)]">
                              {match.odd.toFixed(2)}
                            </div>
                            <div
                              className={`text-xs font-semibold px-2 py-1 rounded ${
                                match.result === "Won"
                                  ? "bg-green-500/20 text-green-500"
                                  : match.result === "Lost"
                                    ? "bg-red-500/20 text-red-500"
                                    : "bg-yellow-500/20 text-yellow-500"
                              }`}
                            >
                              {match.result}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-4 gap-4 pt-4 border-t" style={{ borderColor: "var(--mezzo-border)" }}>
                    <div>
                      <div className="text-xs text-gray-400">Stake</div>
                      <div className="font-bold text-white">{ticket.stake} ETB</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Total Odds</div>
                      <div className="font-bold text-[var(--mezzo-accent-green)]">{ticket.totalOdds.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Potential Win</div>
                      <div className="font-bold text-white">{ticket.potentialWin.toFixed(0)} ETB</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">
                        {ticket.status === "Won" ? "Payout" : ticket.status === "Pending" ? "Possible Win" : "Loss"}
                      </div>
                      <div
                        className={`font-bold text-lg ${
                          ticket.status === "Won"
                            ? "text-green-500"
                            : ticket.status === "Pending"
                              ? "text-[var(--mezzo-accent-yellow)]"
                              : "text-red-500"
                        }`}
                      >
                        {ticket.actualWin > 0
                          ? `${ticket.actualWin.toFixed(2)} ETB`
                          : ticket.status === "Pending"
                            ? `${ticket.potentialWin.toFixed(0)} ETB`
                            : "0 ETB"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Betslip />
    </div>
  );
}
