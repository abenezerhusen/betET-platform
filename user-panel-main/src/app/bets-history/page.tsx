"use client";

/**
 * `/bets-history` — User's personal sportsbook betting history.
 *
 * Data:
 *   GET /api/bets  (sportsbook tickets only)
 *
 * Each ticket card is collapsible — clicking "Show matches" expands a
 * per-match table that includes the match, market, selection, odds and the
 * individual per-selection result status.
 */

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Betslip } from "@/components/Betslip";
import {
  Clock,
  CheckCircle,
  XCircle,
  Target,
  Calendar,
  Filter,
  AlertTriangle,
  RefreshCw,
  Timer,
  Ban,
  Info,
  DollarSign,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { betsApi, publicConfigApi } from "@/lib/api";
import type { BetHistoryRow, GameBetRow, ReloadedTicket } from "@/lib/api/bets";
import { cancelBet, cashoutBet } from "@/lib/api/bets";

type StatusLabel =
  | "Won"
  | "Lost"
  | "Pending"
  | "Cancelled"
  | "Postponed"
  | "Awaiting Settlement"
  | "Partially Voided"
  | "Voided"
  | "Refunded"
  | "Manual Review";

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
  rawId: string;
  date: string;
  placedAt: number;
  status: StatusLabel;
  statusExplanation: string;
  stake: number;
  currency: string;
  totalOdds: number;
  potentialWin: number;
  actualWin: number;
  postponeDeadline: Date | null;
  legsCount: number;
  /** Coupon code / ID used to lazy-load the selections on expand. */
  reloadKey: string;
  /** True when the backend reports this pending ticket is eligible for
   * early cashout right now. */
  cashoutAvailable: boolean;
  /** Live cashout offer (boost already applied). Display-only. */
  cashoutValue: number;
}

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const STATUS_EXPLANATIONS: Record<string, string> = {
  pending:             "Your ticket is placed and waiting for the match results.",
  live:                "Your ticket contains a live match in progress.",
  won:                 "Congratulations! Your ticket won and the payout has been credited.",
  lost:                "Your ticket did not win this time. Better luck next time!",
  postponed:           "One or more events on your ticket were postponed. We are waiting for the event to be rescheduled.",
  awaiting_settlement: "Your ticket is ready for settlement. Results are being processed.",
  partially_voided:    "Some selections were voided. The ticket was recalculated with the remaining valid selections.",
  fully_voided:        "All selections were voided. Your full stake has been refunded.",
  refunded:            "Your stake has been fully refunded to your account.",
  cancelled:           "This ticket was cancelled. Your stake has been refunded.",
  manual_review:       "Your ticket has been flagged for manual review by our team.",
  error:               "There was an issue settling this ticket. Our team is reviewing it.",
  partial_won:         "You won! Some selections were voided and odds were recalculated.",
  cashed_out:          "You cashed out early. Payout has been credited.",
  cashout:             "You cashed out early. Payout has been credited.",
};

function getStatusExplanation(row: BetHistoryRow): string {
  const settlementStatus = (row.settlement_status ?? "").toLowerCase();
  const baseStatus = (row.status ?? "").toLowerCase();
  const key = settlementStatus || baseStatus;
  let explanation = STATUS_EXPLANATIONS[key] ?? STATUS_EXPLANATIONS[baseStatus] ?? "";
  if (row.void_reason) {
    explanation += ` Reason: ${row.void_reason.replace(/_/g, " ")}.`;
  }
  if (row.postponed_at && row.postpone_wait_hours) {
    const deadline = new Date(
      new Date(row.postponed_at).getTime() + row.postpone_wait_hours * 3600000
    );
    explanation += ` Waiting until ${formatDate(deadline.toISOString())} for the event to be played.`;
  }
  return explanation;
}

function mapStatus(s: string): StatusLabel {
  const v = (s ?? "").toLowerCase();
  if (v === "won" || v === "partial_won" || v === "cashed_out" || v === "cashout") return "Won";
  if (v === "partially_voided") return "Partially Voided";
  if (v === "lost") return "Lost";
  if (v === "fully_voided" || v === "void") return "Voided";
  if (v === "refunded") return "Refunded";
  if (v === "cancelled") return "Cancelled";
  if (v === "postponed") return "Postponed";
  if (v === "awaiting_settlement") return "Awaiting Settlement";
  if (v === "manual_review") return "Manual Review";
  if (v === "partial") return "Partially Voided";
  return "Pending";
}

function mapRowStatus(row: BetHistoryRow): StatusLabel {
  return mapStatus(row.settlement_status ?? row.status ?? "");
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

/* ------------------------------------------------------------------ */
/* Status badge                                                          */
/* ------------------------------------------------------------------ */

const STATUS_UI: Record<
  StatusLabel,
  { icon: React.ReactNode; color: string; bg: string; label: string }
> = {
  Won:                { icon: <CheckCircle className="w-4 h-4" />, color: "text-green-400",  bg: "bg-green-500/15",  label: "WON" },
  Lost:               { icon: <XCircle className="w-4 h-4" />,    color: "text-red-400",    bg: "bg-red-500/15",    label: "LOST" },
  Pending:            { icon: <Clock className="w-4 h-4" />,       color: "text-yellow-400", bg: "bg-yellow-500/15", label: "PENDING" },
  Cancelled:          { icon: <Ban className="w-4 h-4" />,         color: "text-gray-400",   bg: "bg-gray-500/15",   label: "CANCELLED" },
  Postponed:          { icon: <Timer className="w-4 h-4" />,       color: "text-orange-400", bg: "bg-orange-500/15", label: "POSTPONED" },
  "Awaiting Settlement": { icon: <RefreshCw className="w-4 h-4" />, color: "text-purple-400", bg: "bg-purple-500/15", label: "SETTLING" },
  "Partially Voided": { icon: <AlertTriangle className="w-4 h-4" />, color: "text-amber-400", bg: "bg-amber-500/15", label: "PART. VOID" },
  Voided:             { icon: <Ban className="w-4 h-4" />,         color: "text-gray-400",   bg: "bg-gray-500/15",   label: "VOIDED" },
  Refunded:           { icon: <DollarSign className="w-4 h-4" />,  color: "text-cyan-400",   bg: "bg-cyan-500/15",   label: "REFUNDED" },
  "Manual Review":    { icon: <AlertTriangle className="w-4 h-4" />, color: "text-rose-400", bg: "bg-rose-500/15",   label: "REVIEW" },
};

function StatusBadge({ status }: { status: StatusLabel }) {
  const cfg = STATUS_UI[status] ?? STATUS_UI.Pending;
  return (
    <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold ${cfg.bg} ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </div>
  );
}

/* Small inline badge used inside match rows */
function MatchStatusDot({ result }: { result: StatusLabel }) {
  const cfg = STATUS_UI[result] ?? STATUS_UI.Pending;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function InfoTooltip({ explanation }: { explanation: string }) {
  const [open, setOpen] = useState(false);
  if (!explanation) return null;
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-gray-500 hover:text-gray-300 transition-colors"
        aria-label="More info"
      >
        <Info className="w-4 h-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-6 z-30 w-64 p-3 rounded-lg text-xs text-gray-300 shadow-xl border border-gray-600"
          style={{ background: "var(--mezzo-bg-secondary, #1a1a2e)" }}
        >
          {explanation}
          <button
            type="button"
            className="ml-2 text-gray-500 hover:text-white"
            onClick={() => setOpen(false)}
          >✕</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data mappers                                                          */
/* ------------------------------------------------------------------ */

/**
 * Convert a legacy-path sportsbook slip (stored in the `bets` table with
 * metadata.selection.source = 'sports' / 'sport') into the same
 * BetHistoryRow shape used by the proper `sportsbook_bets` flow, so the
 * My Bets page can display both sources uniformly.
 */
function legacyGameBetToHistoryRow(g: GameBetRow): BetHistoryRow {
  const stake = toNumber(g.stake);
  const potential = toNumber(g.potential_win);
  // Derive total odds from potential / stake when possible.
  const totalOdds = stake > 0 ? potential / stake : 0;
  const picks = Array.isArray(g.selection?.picks) ? g.selection!.picks! : [];
  return {
    id: g.id,
    // Display a short, readable code on the card; the full UUID is used
    // as reloadKey so the reload endpoint can find the legacy row.
    coupon_code: g.id.slice(0, 12).toUpperCase(),
    bet_type: "single",
    stake: g.stake,
    total_odds: String(totalOdds.toFixed(2)),
    potential_payout: g.potential_win,
    tax_amount: "0",
    actual_payout: g.payout,
    cashout_amount: null,
    status: g.status,
    settlement_status: null,
    void_reason: null,
    settlement_reason: null,
    postponed_at: null,
    postpone_wait_hours: null,
    currency: g.currency || "ETB",
    placed_at: g.placed_at,
    settled_at: g.settled_at,
    legs_count: picks.length || 1,
    cashout_available: false,
    cashout_value: null,
  };
}

function sportsbookToDisplay(b: BetHistoryRow): DisplayBet {
  const stake = toNumber(b.stake);
  const totalOdds = toNumber(b.total_odds);
  const potential = toNumber(b.potential_payout);
  const actual = toNumber(b.actual_payout ?? b.cashout_amount);
  const status = mapRowStatus(b);
  let postponeDeadline: Date | null = null;
  if (b.postponed_at && b.postpone_wait_hours) {
    postponeDeadline = new Date(
      new Date(b.postponed_at).getTime() + b.postpone_wait_hours * 3600000
    );
  }
  return {
    ticketId: b.coupon_code || b.id.slice(0, 12).toUpperCase(),
    rawId: b.id,
    date: formatDate(b.placed_at),
    placedAt: new Date(b.placed_at).getTime() || 0,
    status,
    statusExplanation: getStatusExplanation(b),
    stake,
    currency: b.currency || "ETB",
    totalOdds,
    potentialWin: potential,
    actualWin: actual,
    postponeDeadline,
    legsCount: b.legs_count,
    // Use the full UUID for reload when the coupon_code is a truncated
    // UUID (legacy bets don't have a real SBK- coupon). The backend
    // reload endpoint matches on either coupon_code OR id.
    reloadKey: b.coupon_code && b.coupon_code.startsWith("SBK-")
      ? b.coupon_code
      : b.id,
    cashoutAvailable: !!b.cashout_available,
    cashoutValue: toNumber(b.cashout_value),
  };
}

function legResultLabel(result: "won" | "lost" | "void" | null): StatusLabel {
  if (result === "won") return "Won";
  if (result === "lost") return "Lost";
  if (result === "void") return "Cancelled";
  return "Pending";
}

function reloadedToLegs(ticket: ReloadedTicket): DisplayLeg[] {
  return ticket.selections.map((leg) => {
    const oddVal = Number(leg.odds_at_placement) || Number(leg.current_odds) || 0;
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
        : formatDate(kickoff.toISOString()),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Match detail rows — rendered when ticket is expanded                 */
/* ------------------------------------------------------------------ */

function MatchRow({ match }: { match: DisplayLeg }) {
  return (
    <div
      className="grid gap-2 p-3 rounded-lg border"
      style={{
        background: "var(--mezzo-bg-primary)",
        borderColor: "var(--mezzo-border)",
        gridTemplateColumns: "1fr auto",
      }}
    >
      <div className="min-w-0">
        {/* Teams */}
        <div className="font-semibold text-sm text-white mb-0.5">
          {match.homeTeam}
          {match.awayTeam && match.awayTeam !== "Internal Game" && (
            <> <span className="text-gray-500">vs</span> {match.awayTeam}</>
          )}
        </div>
        {/* League · Kickoff */}
        {(match.league || match.kickoff) && (
          <div className="text-[11px] text-gray-500 mb-1">
            {[match.league, match.kickoff].filter(Boolean).join("  ·  ")}
          </div>
        )}
        {/* Market + Selection */}
        {match.market && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-gray-400">{match.market}:</span>
            <span className="text-[11px] text-white font-medium">{match.selection}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {/* Odds */}
        <span className="text-sm font-bold text-[var(--mezzo-accent-green)]">
          {match.odd > 0 ? match.odd.toFixed(2) : "—"}
        </span>
        {/* Per-match status */}
        <MatchStatusDot result={match.result} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Left border colour per ticket status                                  */
/* ------------------------------------------------------------------ */

function borderColor(status: StatusLabel): string {
  switch (status) {
    case "Won":                return "#4CAF50";
    case "Lost":               return "#f44336";
    case "Cancelled":
    case "Voided":             return "#6b7280";
    case "Postponed":          return "#f97316";
    case "Refunded":           return "#06b6d4";
    case "Manual Review":      return "#f43f5e";
    case "Awaiting Settlement": return "#a855f7";
    case "Partially Voided":   return "#f59e0b";
    default:                   return "#FFC107";   // Pending
  }
}

/* ================================================================== */
/* Page component                                                       */
/* ================================================================== */

export default function BetsHistoryPage() {
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [sportsRows, setSportsRows] = useState<BetHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which ticket IDs are expanded
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Per-ticket leg cache  { ticketId → legs[] }
  const [legsCache, setLegsCache] = useState<Record<string, DisplayLeg[]>>({});
  const [legsLoading, setLegsLoading] = useState<Record<string, boolean>>({});

  // Cancel state
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Admin-controlled feature flags (whether cashout + user-cancel are
  // enabled). Defaults assume both disabled — the UI only shows the
  // buttons once the backend confirms the admin has enabled them.
  const [cashoutEnabled, setCashoutEnabled] = useState(false);
  const [userCancelEnabled, setUserCancelEnabled] = useState(false);

  // Cashout state
  const [cashingOutId, setCashingOutId] = useState<string | null>(null);
  const [cashoutConfirmId, setCashoutConfirmId] = useState<string | null>(null);
  const [cashoutError, setCashoutError] = useState<string | null>(null);
  const [cashoutSuccess, setCashoutSuccess] = useState<string | null>(null);

  /* ---- Fetch admin-controlled feature flags ---- */
  useEffect(() => {
    let cancelled = false;
    publicConfigApi
      .getPublicFeatures()
      .then((feat) => {
        if (cancelled) return;
        setCashoutEnabled(!!feat.cashout_enabled);
        setUserCancelEnabled(!!feat.user_cancel_enabled);
      })
      .catch(() => {
        // Stay disabled on error — safer default.
      });
    return () => { cancelled = true; };
  }, []);

  /* ---- Fetch sportsbook bets (from both storage paths) ---- */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fromIso = fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined;
    const toIso   = toDate   ? new Date(`${toDate}T23:59:59.999`).toISOString() : undefined;

    // Primary source: proper sportsbook_bets table.
    const primary = betsApi.listMyBets({ page: 1, limit: 100, from: fromIso, to: toIso });
    // Secondary source: the legacy `bets` table also stores sportsbook slips
    // that were placed without a selectionId (they fell back to the internal
    // games placement endpoint). We surface them here so users always see
    // every sportsbook ticket they placed online, regardless of which path
    // the slip happened to take.
    const secondary = betsApi.listMyGameBets({ page: 1, limit: 100, from: fromIso, to: toIso });

    Promise.all([primary, secondary])
      .then(([sb, gb]) => {
        if (cancelled) return;
        const legacySports = (gb.items ?? []).filter((g) => {
          // Internal games have a real game_id; legacy sportsbook slips
          // share a single placeholder game id. The metadata.selection.source
          // field reliably marks them as sportsbook picks.
          const src = String(g.selection?.source ?? "").toLowerCase();
          return src.startsWith("sport");
        });
        const merged = [
          ...(sb.items ?? []),
          ...legacySports.map(legacyGameBetToHistoryRow),
        ];
        setSportsRows(merged);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load bets");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

  /* ---- Mapped list ---- */
  const betsHistory = useMemo(
    () => sportsRows.map(sportsbookToDisplay).sort((a, b) => b.placedAt - a.placedAt),
    [sportsRows],
  );

  /* ---- Expand / collapse toggle; loads legs on first expand ---- */
  const toggleTicket = useCallback((ticket: DisplayBet) => {
    const id = ticket.ticketId;
    const isOpening = !expanded[id];
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

    if (isOpening && !legsCache[id] && !legsLoading[id]) {
      setLegsLoading((prev) => ({ ...prev, [id]: true }));
      betsApi
        .reloadTicket(ticket.reloadKey)
        .then((res) => {
          setLegsCache((prev) => ({ ...prev, [id]: reloadedToLegs(res) }));
        })
        .catch(() => {
          // Falls back to empty — "No match data"
        })
        .finally(() => {
          setLegsLoading((prev) => ({ ...prev, [id]: false }));
        });
    }
  }, [expanded, legsCache, legsLoading]);

  /* ---- Cancel ---- */
  const handleCancelBet = (rawId: string) => {
    if (cancellingId) return;
    setCancellingId(rawId);
    setCancelConfirmId(null);
    setCancelError(null);
    cancelBet(rawId)
      .then(() => {
        setSportsRows((prev) =>
          prev.map((r) =>
            r.id === rawId
              ? { ...r, status: "void", settlement_status: "cancelled" }
              : r
          )
        );
      })
      .catch((err: Error) => {
        setCancelError(err?.message ?? "Failed to cancel ticket. Please try again.");
      })
      .finally(() => {
        setCancellingId(null);
      });
  };

  /* ---- Cash Out ---- */
  const handleCashoutBet = (rawId: string) => {
    if (cashingOutId) return;
    setCashingOutId(rawId);
    setCashoutConfirmId(null);
    setCashoutError(null);
    cashoutBet(rawId)
      .then((res) => {
        const amount = Number(res.cashout_amount ?? 0);
        setCashoutSuccess(
          `Cash out successful! ${amount.toFixed(2)} ${res.currency ?? ""} has been credited to your wallet.`
        );
        setSportsRows((prev) =>
          prev.map((r) =>
            r.id === rawId
              ? {
                  ...r,
                  status: "cashout",
                  settlement_status: "cashed_out",
                  cashout_amount: res.cashout_amount,
                  actual_payout: res.cashout_amount,
                  cashout_available: false,
                  cashout_value: null,
                }
              : r
          )
        );
      })
      .catch((err: Error) => {
        setCashoutError(err?.message ?? "Failed to cash out. Please try again.");
      })
      .finally(() => {
        setCashingOutId(null);
      });
  };

  /* ---- Filtered view ---- */
  const filteredBets = betsHistory.filter((bet) => {
    if (filterStatus !== "All" && bet.status !== filterStatus) return false;
    return true;
  });

  /* ================================================================ */
  /* Render                                                             */
  /* ================================================================ */

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div className="flex-1 p-6 md:p-8" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="max-w-4xl mx-auto">

          {/* Header */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Target className="w-8 h-8 text-[var(--mezzo-accent-yellow)]" />
              <div>
                <h1 className="text-2xl font-bold">My Bets</h1>
                <p className="text-xs text-gray-400 mt-0.5">Your full sportsbook betting history</p>
              </div>
            </div>
            {/* Date range */}
            <div className="flex items-center gap-2 flex-wrap">
              <Calendar className="w-4 h-4 text-gray-400" />
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
                  onClick={() => { setFromDate(""); setToDate(""); }}
                  className="text-xs text-gray-400 hover:text-white underline"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Filter chips */}
          <div
            className="flex items-center gap-3 mb-6 p-3 rounded-lg flex-wrap"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm font-semibold text-gray-300 shrink-0">Filter:</span>
            <div className="flex gap-2 flex-wrap">
              {["All", "Won", "Lost", "Pending", "Cancelled", "Postponed", "Voided", "Refunded"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                    filterStatus === s ? "text-black" : "text-gray-400 hover:text-white"
                  }`}
                  style={
                    filterStatus === s
                      ? { background: "var(--mezzo-accent-green)" }
                      : { background: "var(--mezzo-bg-tertiary)" }
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Cancel error */}
          {cancelError && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-400 text-sm flex items-center justify-between">
              <span>{cancelError}</span>
              <button type="button" onClick={() => setCancelError(null)} className="ml-2 hover:text-white">✕</button>
            </div>
          )}

          {/* Cancel confirm modal */}
          {cancelConfirmId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
              <div className="rounded-xl p-6 w-80 space-y-4 border border-gray-600" style={{ background: "var(--mezzo-bg-secondary)" }}>
                <div className="flex items-center gap-2 text-orange-400">
                  <Ban className="w-5 h-5" />
                  <h3 className="font-bold text-lg">Cancel Ticket?</h3>
                </div>
                <p className="text-sm text-gray-300">Your stake will be fully refunded. This cannot be undone.</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setCancelConfirmId(null)}
                    className="flex-1 px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:text-white text-sm"
                  >
                    Keep Bet
                  </button>
                  <button
                    type="button"
                    disabled={!!cancellingId}
                    onClick={() => handleCancelBet(cancelConfirmId)}
                    className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-60"
                  >
                    {cancellingId ? "Cancelling…" : "Yes, Cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Cashout success banner */}
          {cashoutSuccess && (
            <div className="mb-4 p-3 rounded-lg bg-green-500/15 border border-green-500/40 text-green-400 text-sm flex items-center justify-between">
              <span>{cashoutSuccess}</span>
              <button type="button" onClick={() => setCashoutSuccess(null)} className="ml-2 hover:text-white">✕</button>
            </div>
          )}

          {/* Cashout error */}
          {cashoutError && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-400 text-sm flex items-center justify-between">
              <span>{cashoutError}</span>
              <button type="button" onClick={() => setCashoutError(null)} className="ml-2 hover:text-white">✕</button>
            </div>
          )}

          {/* Cashout confirm modal */}
          {cashoutConfirmId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
              <div className="rounded-xl p-6 w-80 space-y-4 border border-gray-600" style={{ background: "var(--mezzo-bg-secondary)" }}>
                <div className="flex items-center gap-2 text-green-400">
                  <DollarSign className="w-5 h-5" />
                  <h3 className="font-bold text-lg">Cash Out?</h3>
                </div>
                <p className="text-sm text-gray-300">
                  The displayed amount will be credited to your wallet immediately and the ticket will be closed. This cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setCashoutConfirmId(null)}
                    className="flex-1 px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:text-white text-sm"
                  >
                    Keep Bet
                  </button>
                  <button
                    type="button"
                    disabled={!!cashingOutId}
                    onClick={() => handleCashoutBet(cashoutConfirmId)}
                    className="flex-1 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-60"
                  >
                    {cashingOutId ? "Cashing out…" : "Yes, Cash Out"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Main content */}
          {loading ? (
            <div className="p-12 text-center text-gray-400 text-sm">Loading your tickets…</div>
          ) : error ? (
            <div className="p-12 text-center text-red-400 text-sm">{error}</div>
          ) : filteredBets.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              No sportsbook tickets found. Place a sports bet and it will appear here.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredBets.map((ticket) => {
                const isExpanded = !!expanded[ticket.ticketId];
                const legs = legsCache[ticket.ticketId];
                const loadingLegs = !!legsLoading[ticket.ticketId];

                return (
                  <div
                    key={ticket.ticketId}
                    className="rounded-xl border-l-4 overflow-hidden"
                    style={{
                      background: "var(--mezzo-bg-secondary)",
                      borderColor: borderColor(ticket.status),
                    }}
                  >
                    {/* ── Ticket header ── */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">

                        {/* Left: ticket info */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-bold text-base text-[var(--mezzo-accent-yellow)]">
                              {ticket.ticketId}
                            </span>
                            <span
                              className="text-[11px] px-2 py-0.5 rounded font-semibold"
                              style={{ background: "var(--mezzo-bg-tertiary)", color: "var(--mezzo-text-muted, #9ca3af)" }}
                            >
                              {ticket.legsCount} match{ticket.legsCount !== 1 ? "es" : ""}
                            </span>
                            <span
                              className="text-[11px] px-2 py-0.5 rounded font-semibold"
                              style={{ background: "var(--mezzo-bg-tertiary)", color: "var(--mezzo-text-muted, #9ca3af)" }}
                            >
                              Odds&nbsp;{ticket.totalOdds.toFixed(2)}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">{ticket.date}</div>
                          {ticket.postponeDeadline && ticket.status === "Postponed" && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-orange-400">
                              <Timer className="w-3 h-3" />
                              Expires {formatDate(ticket.postponeDeadline.toISOString())}
                            </div>
                          )}
                        </div>

                        {/* Right: status + actions */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={ticket.status} />
                            <InfoTooltip explanation={ticket.statusExplanation} />
                          </div>
                          {ticket.status === "Pending" && ticket.cashoutAvailable && cashoutEnabled && ticket.cashoutValue > 0 && (
                            <button
                              type="button"
                              onClick={() => setCashoutConfirmId(ticket.rawId)}
                              disabled={cashingOutId === ticket.rawId}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-50"
                            >
                              <DollarSign className="w-3 h-3" />
                              {cashingOutId === ticket.rawId
                                ? "Cashing out…"
                                : `Cash Out ${ticket.cashoutValue.toFixed(2)}`}
                            </button>
                          )}
                          {ticket.status === "Pending" && userCancelEnabled && (
                            <button
                              type="button"
                              onClick={() => setCancelConfirmId(ticket.rawId)}
                              disabled={cancellingId === ticket.rawId}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                            >
                              <Ban className="w-3 h-3" />
                              {cancellingId === ticket.rawId ? "Cancelling…" : "Cancel"}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Financials row */}
                      <div
                        className="grid grid-cols-4 gap-3 mt-3 pt-3 border-t text-xs"
                        style={{ borderColor: "var(--mezzo-border)" }}
                      >
                        <div>
                          <div className="text-gray-500 mb-0.5">Stake</div>
                          <div className="font-bold text-white">{ticket.stake} <span className="text-gray-400">{ticket.currency}</span></div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-0.5">Total Odds</div>
                          <div className="font-bold text-[var(--mezzo-accent-green)]">{ticket.totalOdds.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-0.5">Potential Win</div>
                          <div className="font-bold text-white">{ticket.potentialWin.toFixed(0)} <span className="text-gray-400">{ticket.currency}</span></div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-0.5">
                            {ticket.status === "Won"
                              ? "Payout"
                              : ticket.status === "Voided" || ticket.status === "Refunded" || ticket.status === "Cancelled"
                                ? "Refunded"
                                : "Result"}
                          </div>
                          <div className={`font-bold text-sm ${
                            ticket.status === "Won" ? "text-green-400"
                              : ticket.status === "Pending" || ticket.status === "Postponed" ? "text-yellow-400"
                              : ticket.status === "Voided" || ticket.status === "Refunded" || ticket.status === "Cancelled" ? "text-cyan-400"
                              : "text-red-400"
                          }`}>
                            {ticket.actualWin > 0
                              ? `${ticket.actualWin.toFixed(2)} ${ticket.currency}`
                              : ticket.status === "Pending" || ticket.status === "Postponed"
                                ? `${ticket.potentialWin.toFixed(0)} ${ticket.currency}`
                                : ticket.status === "Voided" || ticket.status === "Refunded" || ticket.status === "Cancelled"
                                  ? `${ticket.stake} ${ticket.currency}`
                                  : `0 ${ticket.currency}`}
                          </div>
                        </div>
                      </div>

                      {/* Expand toggle button */}
                      <button
                        type="button"
                        onClick={() => toggleTicket(ticket)}
                        className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/5 transition-all border border-dashed"
                        style={{ borderColor: "var(--mezzo-border)" }}
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-4 h-4" />
                            Hide Matches
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-4 h-4" />
                            Show {ticket.legsCount} Match{ticket.legsCount !== 1 ? "es" : ""}
                          </>
                        )}
                      </button>
                    </div>

                    {/* ── Match detail panel (visible when expanded) ── */}
                    {isExpanded && (
                      <div
                        className="px-4 pb-4 border-t space-y-2"
                        style={{ borderColor: "var(--mezzo-border)" }}
                      >
                        <div className="pt-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Match Details
                        </div>
                        {loadingLegs && !legs ? (
                          <div className="py-4 text-center text-xs text-gray-400">
                            Loading match details…
                          </div>
                        ) : !legs || legs.length === 0 ? (
                          <div className="py-4 text-center text-xs text-gray-400">
                            No match data available.
                          </div>
                        ) : (
                          legs.map((match, idx) => (
                            <MatchRow key={idx} match={match} />
                          ))
                        )}
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
