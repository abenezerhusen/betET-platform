"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { Betslip } from "@/components/Betslip";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ApiError, betsApi, gamesApi } from "@/lib/api";
import type { ReloadedTicket } from "@/lib/api/bets";
import { useSearchParams } from "next/navigation";

type LegacyResult = Awaited<ReturnType<typeof gamesApi.getCouponByCode>>;

/**
 * Lookup result. We try the legacy internal-games coupon endpoint first
 * (covers Fast Keno / Aviator / MultiHot5 / JetX coupons) and, when that
 * misses, fall back to the sportsbook ticket reload endpoint (covers
 * SBK-XXXXXXXX tickets created online or via the cashier branch flow).
 * Whichever resolves first wins; only one source ever returns rows for a
 * given code.
 */
type LookupResult =
  | { kind: "legacy"; data: LegacyResult }
  | { kind: "sportsbook"; data: ReloadedTicket };

function statusBadgeClasses(status: string): string {
  const s = status.toLowerCase();
  if (s === "won" || s === "partial_won") return "bg-green-500/20 text-green-400 border-green-500/40";
  if (s === "lost") return "bg-red-500/20 text-red-400 border-red-500/40";
  if (s === "void" || s === "cancelled") return "bg-gray-500/20 text-gray-300 border-gray-500/40";
  return "bg-yellow-500/20 text-yellow-300 border-yellow-500/40";
}

function legStatusBadge(result: "won" | "lost" | "void" | null): {
  label: string;
  classes: string;
} {
  if (result === "won") return { label: "Won", classes: "bg-green-500/20 text-green-400" };
  if (result === "lost") return { label: "Lost", classes: "bg-red-500/20 text-red-400" };
  if (result === "void") return { label: "Void", classes: "bg-gray-500/20 text-gray-300" };
  return { label: "Pending", classes: "bg-yellow-500/20 text-yellow-300" };
}

function CouponCheckContent() {
  const searchParams = useSearchParams();
  const [couponCode, setCouponCode] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runLookup = useCallback(async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    setLoading(true);
    setError("");
    setResult(null);
    // 1) Try the legacy internal-games coupon endpoint. If it succeeds
    //    we're done — these codes are short numeric strings (e.g. "K1234").
    try {
      const legacy = await gamesApi.getCouponByCode(code);
      setResult({ kind: "legacy", data: legacy });
      return;
    } catch (legacyErr) {
      const isNotFound =
        legacyErr instanceof ApiError &&
        (legacyErr.status === 404 ||
          /not\s*found/i.test(legacyErr.message ?? ""));
      // Real auth / server errors should surface as-is.
      if (legacyErr instanceof ApiError && !isNotFound) {
        setError(legacyErr.message || "Could not load coupon");
        return;
      }
    }
    // 2) Fall back to the sportsbook reload endpoint. Handles SBK-XXXXXXXX
    //    tickets created online or via cashier branch-pay reservations.
    try {
      const sportsbook = await betsApi.reloadTicket(code);
      setResult({ kind: "sportsbook", data: sportsbook });
      return;
    } catch (sportsErr) {
      if (sportsErr instanceof ApiError && sportsErr.status === 401) {
        setError("Please log in to view this ticket.");
      } else {
        setError("Coupon not found");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const checkCoupon = () => {
    void runLookup(couponCode);
  };

  // Deep-link support — /coupon-check?code=SBK-XXXXXXXX auto-runs lookup.
  useEffect(() => {
    const code = searchParams.get("code")?.trim();
    if (!code) return;
    setCouponCode(code);
    void runLookup(code);
  }, [searchParams, runLookup]);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      {/* Coupon Check Content */}
      <div
        className="flex-1 flex items-start justify-center p-8"
        style={{ background: "var(--mezzo-bg-primary)" }}
      >
        <div className="w-full max-w-2xl">
          <div
            className="p-6 rounded-lg"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <h1 className="text-2xl font-bold mb-6 text-[var(--mezzo-accent-green)]">
              BET DETAILS
            </h1>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Enter Bet ID
                </label>
                <div className="flex gap-2">
                  <Input
                    value={couponCode}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setCouponCode(e.target.value)
                    }
                    placeholder="Enter your bet ID here..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && couponCode.trim() && !loading) {
                        checkCoupon();
                      }
                    }}
                    className="flex-1 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                  />
                  <Button
                    onClick={checkCoupon}
                    disabled={loading || !couponCode.trim()}
                    className="text-black font-semibold px-8"
                    style={{ background: "var(--mezzo-accent-green)" }}
                  >
                    {loading ? "CHECKING..." : "CHECK"}
                  </Button>
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {result?.kind === "legacy" && (
                <div className="rounded-md border border-[var(--mezzo-border)] bg-[var(--mezzo-bg-tertiary)] p-4 space-y-2 text-sm text-gray-300">
                  <div className="grid grid-cols-2 gap-3">
                    <p>
                      <span className="text-gray-400">Bet ID:</span>{" "}
                      {result.data.bet_id}
                    </p>
                    <p>
                      <span className="text-gray-400">Status:</span>{" "}
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${statusBadgeClasses(result.data.status)}`}
                      >
                        {result.data.status}
                      </span>
                    </p>
                    <p>
                      <span className="text-gray-400">Stake:</span>{" "}
                      {result.data.stake} {result.data.currency}
                    </p>
                    <p>
                      <span className="text-gray-400">Potential:</span>{" "}
                      {result.data.potential_win} {result.data.currency}
                    </p>
                    <p>
                      <span className="text-gray-400">Payout:</span>{" "}
                      {result.data.payout
                        ? `${result.data.payout} ${result.data.currency}`
                        : "-"}
                    </p>
                    <p>
                      <span className="text-gray-400">Placed:</span>{" "}
                      {new Date(result.data.placed_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}

              {result?.kind === "sportsbook" && (
                <SportsbookCouponDetails ticket={result.data} />
              )}

              {!couponCode && !result && !loading && !error && (
                <div className="text-center py-12">
                  <p className="text-gray-500">
                    Enter a bet ID to check your coupon status
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* How to use */}
          <div
            className="mt-6 p-6 rounded-lg"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <h3 className="font-bold mb-3">How to check your bet</h3>
            <div className="space-y-2 text-sm text-gray-400">
              <p>1. Enter your bet ID in the field above</p>
              <p>2. Click the "Check" button</p>
              <p>3. View your bet details and status</p>
              <p className="mt-4 text-xs text-gray-500">
                You can find your bet ID in your bet history or on your bet
                receipt
              </p>
            </div>
          </div>
        </div>
      </div>

      <Betslip />
    </div>
  );
}

/**
 * Sportsbook ticket detail card — header (code + status), summary row
 * (stake / odds / payout) and one row per selection with its individual
 * settlement status. Mirrors the My Bets expanded view so both surfaces
 * feel consistent.
 */
function SportsbookCouponDetails({ ticket }: { ticket: ReloadedTicket }) {
  const placed = new Date(ticket.bet.placed_at);
  const placedLabel = Number.isNaN(placed.getTime())
    ? ticket.bet.placed_at
    : placed.toLocaleString();
  const stakeNum = Number(ticket.bet.stake) || 0;
  const oddsNum = Number(ticket.bet.total_odds) || 0;
  const payoutNum = Number(ticket.bet.potential_payout) || 0;

  return (
    <div className="rounded-md border border-[var(--mezzo-border)] bg-[var(--mezzo-bg-tertiary)] p-4 space-y-4 text-sm text-gray-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-bold text-[var(--mezzo-accent-yellow)]">
            {ticket.bet.coupon_code}
          </div>
          <div className="text-[11px] text-gray-500">Placed {placedLabel}</div>
        </div>
        <span
          className={`px-3 py-1 rounded text-xs font-semibold border uppercase ${statusBadgeClasses(ticket.bet.status)}`}
        >
          {ticket.bet.status}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
        <div>
          <div className="text-gray-400">Stake</div>
          <div className="font-bold text-white">
            {stakeNum.toFixed(2)} {ticket.bet.currency}
          </div>
        </div>
        <div>
          <div className="text-gray-400">Total Odds</div>
          <div className="font-bold text-[var(--mezzo-accent-green)]">
            {oddsNum.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-gray-400">Potential Payout</div>
          <div className="font-bold text-white">
            {payoutNum.toFixed(2)} {ticket.bet.currency}
          </div>
        </div>
        <div>
          <div className="text-gray-400">Selections</div>
          <div className="font-bold text-white">{ticket.selections.length}</div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-400 uppercase mb-2">
          Selections
        </div>
        <div className="space-y-2">
          {ticket.selections.map((leg) => {
            const badge = legStatusBadge(leg.selection_result);
            const oddVal =
              Number(leg.odds_at_placement) ||
              Number(leg.current_odds) ||
              0;
            const kickoff = new Date(leg.starts_at);
            const kickoffLabel = Number.isNaN(kickoff.getTime())
              ? ""
              : kickoff.toLocaleString();
            return (
              <div
                key={leg.selection_id}
                className="rounded p-3 bg-[var(--mezzo-bg-secondary)] border border-[var(--mezzo-border)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">
                      {leg.home_team} vs {leg.away_team}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {leg.league} · {kickoffLabel}
                    </div>
                    <div className="text-[12px] text-gray-300 mt-1">
                      <span className="text-gray-500">
                        {leg.market_label}:
                      </span>{" "}
                      <span className="font-semibold text-white">
                        {leg.selection_label}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1">
                    <span className="font-bold text-[var(--mezzo-accent-green)]">
                      {oddVal.toFixed(2)}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function CouponCheckPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-sm text-gray-400">
          Loading coupon check...
        </div>
      }
    >
      <CouponCheckContent />
    </Suspense>
  );
}
