"use client";

/**
 * `/bets-history` — User's personal betting history (Section 15).
 *
 * Data:
 *   GET /api/user/me/bets   (legacy/game bets)
 *   GET /api/bets           (sportsbook tickets)
 *
 * Both sources are normalised to the same display shape so the existing
 * card layout still works. Tickets can be filtered by status
 * (Won / Lost / Pending / Cancelled) and searched by date range.
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
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { betsApi, profileApi } from "@/lib/api";
import type { BetHistoryRow, ReloadedTicket } from "@/lib/api/bets";
import type { BetSummaryItem } from "@/lib/api/types";

type StatusLabel = "Won" | "Lost" | "Pending" | "Cancelled";

interface DisplayLeg {
  homeTeam: string;
  awayTeam: string;
  league?: string;
  market?: string;
  selection?: string;
  bet: string;
  odd: number;
  result: StatusLabel;
  kickoff?: string;
}

interface DisplayBet {
  ticketId: string;
  date: string;
  /** Epoch ms of placement — used to sort merged sources newest-first. */
  placedAt: number;
  status: StatusLabel;
  stake: number;
  totalOdds: number;
  potentialWin: number;
  actualWin: number;
  accumulatorBonus: number;
  matches: DisplayLeg[];
  /**
   * Source identifier used to lazily load the full leg list. For sportsbook
   * tickets this is the coupon code (SBK-XXXXXXXX); for legacy game bets
   * the leg list is already inlined so `reloadKey` is null and no
   * additional fetch is needed.
   */
  reloadKey: string | null;
  /** Number of legs even before they're expanded — drives the count badge. */
  legsCount: number;
}

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapStatus(s: string): StatusLabel {
  const v = (s ?? "").toLowerCase();
  if (
    v === "won" ||
    v === "partial_won" ||
    v === "partial" ||
    v === "cashed_out" ||
    v === "cashout"
  )
    return "Won";
  if (v === "lost") return "Lost";
  if (v === "void" || v === "cancelled") return "Cancelled";
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
    placedAt: new Date(b.placed_at).getTime() || 0,
    status: mapStatus(b.status),
    stake,
    totalOdds,
    potentialWin: potential,
    actualWin: actual,
    accumulatorBonus: 0,
    matches: selections,
    reloadKey: null, // legs inlined
    legsCount: selections.length,
  };
}

/** Normalise a sportsbook ticket (GET /api/bets) to the same card shape.
 *  The legs are populated lazily on expand via `betsApi.reloadTicket` so the
 *  list endpoint stays light — we just stash the coupon code in `reloadKey`. */
function sportsbookToDisplay(b: BetHistoryRow): DisplayBet {
  const stake = toNumber(b.stake);
  const totalOdds = toNumber(b.total_odds);
  const potential = toNumber(b.potential_payout);
  const actual = toNumber(b.actual_payout ?? b.cashout_amount);
  const status = mapStatus(b.status);
  return {
    ticketId: b.coupon_code || b.id.slice(0, 12).toUpperCase(),
    date: formatDate(b.placed_at),
    placedAt: new Date(b.placed_at).getTime() || 0,
    status,
    stake,
    totalOdds,
    potentialWin: potential,
    actualWin: actual,
    accumulatorBonus: 0,
    matches: [
      {
        homeTeam: "Sports Ticket",
        awayTeam: `${b.legs_count} selection${b.legs_count === 1 ? "" : "s"}`,
        bet: (b.bet_type || "combo").toUpperCase(),
        odd: totalOdds,
        result: status,
      },
    ],
    reloadKey: b.coupon_code || b.id,
    legsCount: b.legs_count,
  };
}

/** Map a sportsbook leg's per-selection result onto our display status. */
function legResultLabel(
  result: "won" | "lost" | "void" | null,
): StatusLabel {
  if (result === "won") return "Won";
  if (result === "lost") return "Lost";
  if (result === "void") return "Cancelled";
  return "Pending";
}

/** Convert a freshly-loaded ReloadedTicket into displayable per-leg rows. */
function reloadedToLegs(ticket: ReloadedTicket): DisplayLeg[] {
  return ticket.selections.map((leg) => {
    const oddVal =
      Number(leg.odds_at_placement) || Number(leg.current_odds) || 0;
    const kickoff = new Date(leg.starts_at);
    return {
      homeTeam: leg.home_team,
      awayTeam: leg.away_team,
      league: leg.league,
      market: leg.market_label,
      selection: leg.selection_label,
      bet: `${leg.market_label}: ${leg.selection_label}`,
      odd: oddVal,
      result: legResultLabel(leg.selection_result),
      kickoff: Number.isNaN(kickoff.getTime())
        ? undefined
        : kickoff.toLocaleString(),
    };
  });
}

export default function BetsHistoryPage() {
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [rawRows, setRawRows] = useState<BetSummaryItem[]>([]);
  const [sportsRows, setSportsRows] = useState<BetHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracks which tickets the user has expanded. We keep loaded legs in a
  // separate map so toggling collapse/expand again is instant — no
  // re-fetch — and an error string per ticket when a leg load fails.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [legsCache, setLegsCache] = useState<Record<string, DisplayLeg[]>>({});
  const [legsLoading, setLegsLoading] = useState<Record<string, boolean>>({});
  const [legsError, setLegsError] = useState<Record<string, string>>({});

  const toggleExpand = (ticket: DisplayBet) => {
    const id = ticket.ticketId;
    const willOpen = !expanded[id];
    setExpanded((prev) => ({ ...prev, [id]: willOpen }));
    if (!willOpen) return;
    // Only sportsbook tickets need an on-demand fetch; legacy tickets
    // ship their selections inline so they're already in `ticket.matches`.
    if (!ticket.reloadKey) return;
    if (legsCache[id]) return; // already loaded
    setLegsLoading((prev) => ({ ...prev, [id]: true }));
    setLegsError((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    betsApi
      .reloadTicket(ticket.reloadKey)
      .then((res) => {
        setLegsCache((prev) => ({ ...prev, [id]: reloadedToLegs(res) }));
      })
      .catch((err) => {
        setLegsError((prev) => ({
          ...prev,
          [id]: err?.message ?? "Failed to load selections",
        }));
      })
      .finally(() => {
        setLegsLoading((prev) => ({ ...prev, [id]: false }));
      });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // ISO bounds for the optional date-range search. `to` is pushed to the
    // end of the selected day so the chosen date is inclusive.
    const fromIso = fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined;
    const toIso = toDate ? new Date(`${toDate}T23:59:59.999`).toISOString() : undefined;

    const legacyPromise = profileApi
      .listBets({ page: 1, limit: 50, from: fromIso, to: toIso })
      .then((res) => res.items ?? [])
      .catch(() => [] as BetSummaryItem[]);
    const sportsPromise = betsApi
      .listMyBets({ page: 1, limit: 50, from: fromIso, to: toIso })
      .then((res) => res.items ?? [])
      .catch(() => [] as BetHistoryRow[]);

    Promise.all([legacyPromise, sportsPromise])
      .then(([legacy, sports]) => {
        if (cancelled) return;
        setRawRows(legacy);
        setSportsRows(sports);
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
  }, [fromDate, toDate]);

  const betsHistory = useMemo(() => {
    const merged = [
      ...rawRows.map(toDisplay),
      ...sportsRows.map(sportsbookToDisplay),
    ];
    // Newest first across both sources.
    return merged.sort((a, b) => b.placedAt - a.placedAt);
  }, [rawRows, sportsRows]);

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
            <div className="flex items-center gap-2 flex-wrap">
              <Calendar className="w-5 h-5 text-gray-400" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="From date"
                className="px-2 py-1.5 rounded text-xs text-white border outline-none"
                style={{ background: "var(--mezzo-bg-secondary)", borderColor: "var(--mezzo-border)" }}
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="To date"
                className="px-2 py-1.5 rounded text-xs text-white border outline-none"
                style={{ background: "var(--mezzo-bg-secondary)", borderColor: "var(--mezzo-border)" }}
              />
              {(fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                  }}
                  className="text-xs text-gray-400 hover:text-white underline"
                >
                  Clear
                </button>
              )}
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
            <div className="flex gap-2 flex-wrap">
              {["All", "Won", "Lost", "Pending", "Cancelled"].map((status) => (
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
                          {ticket.legsCount} Bets • Odds: {ticket.totalOdds.toFixed(2)}
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
                      {ticket.status === "Cancelled" && (
                        <div className="flex items-center gap-2 text-gray-400">
                          <XCircle className="w-6 h-6" />
                          <span className="font-bold text-lg">CANCELLED</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expand / collapse toggle. Sportsbook tickets fetch their
                      leg list lazily on first open and cache it for instant
                      re-toggling; legacy game bets ship the selections inline
                      so the toggle is a pure visibility flip. */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(ticket)}
                    className="w-full flex items-center justify-between text-xs font-semibold text-gray-300 hover:text-white px-3 py-2 rounded mb-2 transition-colors"
                    style={{ background: "var(--mezzo-bg-tertiary)" }}
                    aria-expanded={Boolean(expanded[ticket.ticketId])}
                  >
                    <span>
                      {expanded[ticket.ticketId] ? "Hide" : "Show"} selections
                      ({ticket.legsCount})
                    </span>
                    {expanded[ticket.ticketId] ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {expanded[ticket.ticketId] && (
                    <div className="space-y-2 mb-4">
                      {(() => {
                        const cached = legsCache[ticket.ticketId];
                        const fromTicket =
                          !ticket.reloadKey ? ticket.matches : null;
                        const legs = cached ?? fromTicket;
                        if (legsLoading[ticket.ticketId]) {
                          return (
                            <div className="p-3 text-xs text-gray-400 text-center">
                              Loading selections…
                            </div>
                          );
                        }
                        if (legsError[ticket.ticketId]) {
                          return (
                            <div className="p-3 text-xs text-red-400 text-center rounded border border-red-500/40 bg-red-500/10">
                              {legsError[ticket.ticketId]}
                            </div>
                          );
                        }
                        if (!legs || legs.length === 0) {
                          return (
                            <div className="p-3 text-xs text-gray-400 text-center">
                              No selections recorded.
                            </div>
                          );
                        }
                        return legs.map((match, idx) => (
                          <div key={idx} className="p-3 rounded" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold mb-0.5 truncate">
                                  {match.homeTeam} vs {match.awayTeam}
                                </div>
                                {(match.league || match.kickoff) && (
                                  <div className="text-[11px] text-gray-500 truncate">
                                    {[match.league, match.kickoff]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </div>
                                )}
                                <div className="text-xs text-gray-400 mt-1">
                                  {match.bet}
                                </div>
                              </div>
                              <div className="text-right flex flex-col items-end gap-1 shrink-0">
                                <div className="font-bold text-[var(--mezzo-accent-green)]">
                                  {match.odd.toFixed(2)}
                                </div>
                                <div
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                    match.result === "Won"
                                      ? "bg-green-500/20 text-green-500"
                                      : match.result === "Lost"
                                        ? "bg-red-500/20 text-red-500"
                                        : match.result === "Cancelled"
                                          ? "bg-gray-500/20 text-gray-300"
                                          : "bg-yellow-500/20 text-yellow-500"
                                  }`}
                                >
                                  {match.result}
                                </div>
                              </div>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}

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
