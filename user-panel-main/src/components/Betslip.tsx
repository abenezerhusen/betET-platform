"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import {
  Trash2,
  Minus,
  Plus,
  X,
  Copy,
  Share2,
  Gift,
  Wallet,
  Lock,
  AlertCircle,
  ShoppingCart,
  Ticket,
  Search,
} from "lucide-react";
import { ThermalTicket } from "@/components/ThermalTicket";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBets } from "@/context/BetContext";
import { BetConfirmationModal } from "@/components/BetConfirmationModal";
import { FastButton } from "@/components/FastButton";
import { betsApi, gamesApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const stakeSchema = z
  .number({ message: "Stake is required" })
  .min(10, "Minimum stake is 10 ETB")
  .max(1_000_000, "Maximum stake is 1,000,000 ETB");

interface BetslipProps {
  onClose?: () => void;
}

export function Betslip({ onClose }: BetslipProps = {}) {
  const { bets, removeBet, clearBets, activeSlip, setActiveSlip } = useBets();
  // Local mirror of the active slip for purely visual highlighting. Kept
  // in sync with the context so each Bet Slip tab (1/2/3) is fully
  // isolated — picks made on one tab never appear in the others.
  const [activeTab, setActiveTab] = useState<number>(activeSlip);
  const [copyTicket, setCopyTicket] = useState(false);
  const [sortByTime, setSortByTime] = useState(false);
  const [ticketNumber, setTicketNumber] = useState("");
  const [showCopyTicketInput, setShowCopyTicketInput] = useState(false);
  const [mobileCouponNumber, setMobileCouponNumber] = useState("");

  const handleCheckMobileCoupon = () => {
    if (mobileCouponNumber.trim()) {
      if (typeof window !== "undefined") {
        window.location.href = `/coupon-check?code=${encodeURIComponent(mobileCouponNumber.trim())}`;
      }
      setMobileCouponNumber("");
    }
  };
  const [showTicketPreview, setShowTicketPreview] = useState(false);
  const [placingBet, setPlacingBet] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationData, setConfirmationData] = useState<any>(null);
  const [lastCouponCode, setLastCouponCode] = useState<string | null>(null);
  // Balance-source chooser. Only shown when the user actually has a bonus
  // wallet > 0, because bonus funds follow admin rules (non-withdrawable,
  // min-odds, rollover, etc.) and must not be mixed with real balance.
  const [balanceChoiceOpen, setBalanceChoiceOpen] = useState(false);
  const [pendingBetMode, setPendingBetMode] = useState<"offline" | "online" | null>(null);
  const [bonusBalanceSnapshot, setBonusBalanceSnapshot] = useState(0);
  const [mainBalanceSnapshot, setMainBalanceSnapshot] = useState(0);
  const [previewTicketNumber, setPreviewTicketNumber] = useState("");
  const { refreshWallet } = useAuth();

  const handleCopyTicket = () => {
    if (ticketNumber.trim()) {
      if (typeof window !== "undefined") {
        window.location.href = `/coupon-check?code=${encodeURIComponent(ticketNumber.trim())}`;
      }
      setTicketNumber("");
      setShowCopyTicketInput(false);
    }
  };

  const handleTicketPreview = () => {
    if (totalBetAmount === 0) {
      alert("Please add at least one bet to your betslip!");
      return;
    }

    const parsedStake = stakeSchema.safeParse(stake);
    if (!parsedStake.success) {
      alert(parsedStake.error.issues[0]?.message ?? "Invalid stake");
      return;
    }

    const generated = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    setPreviewTicketNumber(`${generated.slice(0, 5)}-${generated.slice(5)}`);
    setShowTicketPreview(true);
  };

  // Read the current bonus wallet. Kept as a helper so the chooser and the
  // actual placement read the *same* snapshot and cannot race each other.
  const readBonusBalance = () =>
    typeof window !== "undefined"
      ? parseFloat(localStorage.getItem("mezzobet_bonus_balance") || "0") || 0
      : 0;
  const readMainBalance = () =>
    typeof window !== "undefined"
      ? parseFloat(localStorage.getItem("mezzobet_balance") || "0") || 0
      : 0;

  const runOfflinePlacement = () => {
    setPlacingBet(true);
    setTimeout(() => {
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
      const ticketNumber = `${id.slice(0, 5)}-${id.slice(5)}`;
      const stakeTax = stake * 0.15;
      const winTax = 0;

      setConfirmationData({
        ticketNumber,
        stake,
        potentialWin,
        netPayout,
        betsCount: totalBetAmount,
        isOnline: false,
        totalOdds,
        stakeTax,
        winTax,
      });

      setShowConfirmation(true);
      setPlacingBet(false);
    }, 1500);
  };

  // Place an online bet debiting the selected wallet.
  // `source` = "main" → deducts from mezzobet_balance (existing behaviour).
  // `source` = "bonus" → deducts from mezzobet_bonus_balance (promo wallet).
  const runOnlinePlacement = async (source: "main" | "bonus") => {
    if (typeof window === "undefined") return;

    if (source === "bonus") {
      const bonus = readBonusBalance();
      if (bonus < stake) {
        alert(
          `Insufficient bonus! Available: ${bonus.toFixed(2)} ETB, Required: ${stake} ETB`
        );
        return;
      }
    } else {
      const balance = readMainBalance();
      if (balance < stake) {
        alert(
          `Insufficient balance! Available: ${balance.toFixed(2)} ETB, Required: ${stake} ETB`
        );
        return;
      }
    }

    setPlacingBet(true);
    try {
      // Section 18A — when every pick carries a real sportsbook selection
      // ID we POST to /api/bets/place which handles multi-leg slips, odds
      // freeze, tax preview and atomic wallet debit. The legacy
      // internal-games path remains as a fallback so the UI keeps
      // working when fed mock data without IDs.
      const allHaveSelectionIds = bets.length > 0 && bets.every((b) => Boolean(b.selectionId));

      let betId = "";
      let ticketNumber = "";
      let stakeTax = stake * 0.15;
      let winTax = 0;

      if (allHaveSelectionIds) {
        const slip = await betsApi.placeBet({
          stake,
          bet_type: bets.length > 1 ? "combo" : "single",
          selections: bets.map((b) => ({
            selection_id: b.selectionId!,
            odds_seen: b.odds,
          })),
          idempotency_key: crypto.randomUUID(),
          accept_odds_changed: false,
          metadata: {
            placed_from: "user_panel",
            balance_source: source,
            picks_count: bets.length,
          },
        });
        betId = slip.bet.id;
        ticketNumber = slip.bet.coupon_code || slip.bet.id;
        stakeTax = 0; // Section 18B — tax applies at settlement, not placement.
        winTax = Number(slip.bet.estimated_tax || 0);
      } else {
        // Legacy fallback: stash the picks on an internal-games bet so
        // demo / mock data without selection IDs still records a slip.
        const games = await gamesApi.listGames({ limit: 1 });
        const gameId = games.items?.[0]?.id;
        if (!gameId) {
          alert("No active game available for bet placement.");
          return;
        }

        const placement = await gamesApi.placeBet({
          game_id: gameId,
          stake,
          potential_win: potentialWin,
          idempotency_key: crypto.randomUUID(),
          selection: {
            source: "sportsbook",
            picks: bets.map((b) => ({
              match: b.match,
              league: b.league,
              market: b.market,
              selection: b.selection,
              odds: b.odds,
              date: b.date,
              time: b.time,
            })),
          },
          metadata: {
            placed_from: "user_panel",
            balance_source: source,
            picks_count: bets.length,
          },
        });

        betId = placement.bet?.id ?? "";
        if (!betId) {
          throw new Error("Bet placement returned no bet id.");
        }
        const coupon = await gamesApi.getCouponByCode(betId);
        ticketNumber = placement.transaction?.reference || coupon.coupon_code || betId;
        stakeTax = stake * 0.15;
        winTax = 0;
      }

      await refreshWallet();
      const newBalance = readMainBalance();
      const newBonus = readBonusBalance();
      setLastCouponCode(ticketNumber);

      setConfirmationData({
        ticketNumber,
        betId,
        couponCode: ticketNumber,
        stake,
        potentialWin,
        netPayout,
        betsCount: totalBetAmount,
        isOnline: true,
        newBalance,
        totalOdds,
        stakeTax,
        winTax,
        balanceSource: source,
        newBonus,
      });

      setShowConfirmation(true);
      setTimeout(() => {
        clearBets();
      }, 1000);
    } catch (err) {
      alert((err as Error)?.message || "Failed to place online bet.");
    } finally {
      setPlacingBet(false);
    }
  };

  const handlePlaceBet = () => {
    if (totalBetAmount === 0) {
      alert("Please add at least one bet to your betslip!");
      return;
    }
    const parsedStake = stakeSchema.safeParse(stake);
    if (!parsedStake.success) {
      alert(parsedStake.error.issues[0]?.message ?? "Invalid stake");
      return;
    }
    runOfflinePlacement();
  };

  const handlePlaceBetOnline = () => {
    if (totalBetAmount === 0) {
      alert("Please add at least one bet to your betslip!");
      return;
    }

    const parsedStake = stakeSchema.safeParse(stake);
    if (!parsedStake.success) {
      alert(parsedStake.error.issues[0]?.message ?? "Invalid stake");
      return;
    }

    const isLoggedIn =
      typeof window !== "undefined" &&
      localStorage.getItem("mezzobet_logged_in") === "true";

    if (!isLoggedIn) {
      alert("Please login to place bets online!");
      return;
    }

    const bonus = readBonusBalance();
    const balance = readMainBalance();

    // If the user has an active bonus wallet we must let them choose which
    // balance to bet with, because bonus funds follow admin rules and cannot
    // be mixed with real money. Without a bonus, keep the original flow.
    if (bonus > 0) {
      setBonusBalanceSnapshot(bonus);
      setMainBalanceSnapshot(balance);
      setPendingBetMode("online");
      setBalanceChoiceOpen(true);
      return;
    }

    if (balance < stake) {
      alert(
        `Insufficient balance! Available: ${balance.toFixed(2)} ETB, Required: ${stake} ETB`
      );
      return;
    }

    runOnlinePlacement("main");
  };

  const confirmBalanceChoice = (source: "main" | "bonus") => {
    setBalanceChoiceOpen(false);
    if (pendingBetMode === "online") {
      void runOnlinePlacement(source);
    }
    setPendingBetMode(null);
  };
  const [stake, setStake] = useState(20);
  // Defaults to false so that on phones/tablets the "Show more detail"
  // section is collapsed from the very first paint (arrow pointing down).
  // The effect below flips it open only on xl+ desktops, preserving the
  // original desktop design where the bonus/tax breakdown is visible by
  // default.
  const [showBonus, setShowBonus] = useState(false);

  // Calculate betting values
  const hasBets = bets.length > 0;
  const totalOdds = bets.reduce((acc, bet) => acc * bet.odds, 1);
  const totalBetAmount = bets.length;
  const deposit = stake;

  // Accumulator Bonus Calculator
  const calculateAccumulatorBonus = (numBets: number) => {
    if (numBets < 2) return 0;
    if (numBets === 2) return 3;
    if (numBets === 3) return 5;
    if (numBets === 4) return 7;
    if (numBets === 5) return 10;
    if (numBets >= 6 && numBets <= 8) return 15;
    if (numBets >= 9 && numBets <= 11) return 20;
    if (numBets >= 12 && numBets <= 15) return 25;
    if (numBets >= 16) return 30;
    return 0;
  };

  const accumulatorBonus = calculateAccumulatorBonus(totalBetAmount);
  const bonusAmount = (stake * totalOdds * accumulatorBonus) / 100;
  const potentialWin = stake * totalOdds + bonusAmount;
  const incomeTax = potentialWin * 0.15;
  const netPayout = potentialWin - incomeTax;
  const currentBonus = accumulatorBonus;

  const incrementStake = () => setStake(prev => prev + 10);
  const decrementStake = () => setStake(prev => Math.max(10, prev - 10));

  // Mobile/tablet default is collapsed (see `useState(false)` above).
  // On xl+ desktops the original design shows the bonus/tax breakdown
  // expanded, so flip it open here on first mount for wide viewports.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 1280px)");
    if (mql.matches) setShowBonus(true);
  }, []);

  // Mobile/tablet drawer state. Desktop (xl+) ignores this because the aside
  // is rendered inline with `xl:translate-x-0` overriding the transform.
  // Using `xl` as the breakpoint keeps iPad Pro / Nest Hub / 1024–1279
  // laptops comfortable — all three columns don't fit at 1024px.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close the drawer whenever the viewport grows to desktop so it
  // doesn't stay mounted off-screen when the user rotates/resizes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1280px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  // Lock page scroll while the mobile betslip drawer is open so the body
  // behind doesn't scroll together with the slip.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileOpen]);

  // Let external UI (e.g. the mobile bottom navigation bar) request that the
  // drawer opens by firing `mezzobet:open-betslip`. This keeps the drawer
  // state encapsulated here while still being controllable from siblings
  // mounted higher up in the tree.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const open = () => setMobileOpen(true);
    window.addEventListener("mezzobet:open-betslip", open);
    return () => window.removeEventListener("mezzobet:open-betslip", open);
  }, []);

  return (
    <>
      {/* Floating cart button — shown only on tablets / small desktops
          (md ≤ viewport < xl). On phones the new `MobileBottomNav` exposes
          the Bet Slip via its elevated center tab, and on xl+ the aside
          renders inline, so the floating button would be redundant there. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open betslip"
        className="hidden md:flex xl:hidden fixed bottom-4 right-4 z-40 w-14 h-14 rounded-full shadow-xl items-center justify-center touch-target no-select"
        style={{ background: "var(--mezzo-accent-green)", color: "#000" }}
      >
        <ShoppingCart className="w-6 h-6" />
        {bets.length > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full flex items-center justify-center text-[11px] font-bold"
            style={{ background: "var(--mezzo-accent-yellow)", color: "#000" }}
          >
            {bets.length}
          </span>
        )}
      </button>

      {/* Backdrop for the drawer. Only rendered while open so pointer
          events don't block the rest of the page on desktop. */}
      {mobileOpen && (
        <div
          className="xl:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 right-0 z-50 w-full sm:w-96 max-w-full
          transform transition-transform duration-300 ease-out
          ${mobileOpen ? "translate-x-0" : "translate-x-full"}
          xl:static xl:z-auto xl:w-80 xl:max-w-none xl:translate-x-0 xl:transition-none
          flex-shrink-0 border-l flex flex-col min-h-0 h-dvh max-h-dvh
          xl:h-full xl:max-h-none overflow-y-auto xl:overflow-hidden
          overscroll-contain safe-area-inset
        `}
        style={{
          background: "var(--mezzo-bg-secondary)",
          borderColor: "var(--mezzo-border)",
        }}
      >
        {/* Close button shown only on mobile/tablet, so the user can dismiss
            the drawer without relying on the backdrop tap. */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close betslip"
          className="xl:hidden absolute top-2 right-2 z-10 p-2 rounded-full bg-black/40 text-white touch-target"
        >
          <X className="w-5 h-5" />
        </button>
      {/* Betslip Tabs */}
      <div
        className="border-b flex shrink-0 items-center justify-between px-2"
        style={{ borderColor: "var(--mezzo-border)", background: "#1a1a2e" }}
      >
        <div className="flex">
          {[1, 2, 3].map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setActiveSlip(tab as 1 | 2 | 3);
              }}
              className={`px-4 py-3 text-sm font-bold transition-colors ${
                activeTab === tab
                  ? "text-black"
                  : "text-gray-400"
              }`}
              style={activeTab === tab ? { background: "var(--mezzo-accent-yellow)" } : {}}
            >
              BETSLIP {tab}
            </button>
          ))}
        </div>
        <button
          onClick={clearBets}
          className="p-2 text-gray-400 hover:text-white hover:text-red-500 transition-colors"
          title="Clear all bets"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile-only — Bet Code and Check Coupon inputs always visible (no
          expand/collapse) so nothing is mistaken for a “more” menu step.
          Hidden on `xl+` where the desktop bottom panel handles both. */}
      <div
        className="xl:hidden border-b shrink-0"
        style={{
          borderColor: "var(--mezzo-border)",
          background: "var(--mezzo-bg-secondary)",
        }}
      >
        <div
          className="px-3 pt-2 pb-2 border-b"
          style={{ borderColor: "var(--mezzo-border)" }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Ticket className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="text-[11px] font-bold text-gray-200 tracking-wide">
              BET CODE
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mb-2">
            Paste a bet code to load it into your slip.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="text"
              placeholder="Bet code ..."
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 rounded bg-[#2a2a4a] border border-gray-700 text-white text-sm outline-none focus:border-purple-500 transition-colors placeholder:text-gray-500"
            />
            <button
              type="button"
              onClick={handleCopyTicket}
              className="shrink-0 px-4 py-2 rounded font-bold text-sm transition-all hover:opacity-80 touch-target"
              style={{
                background:
                  "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
                color: "#fff",
              }}
            >
              LOAD
            </button>
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="text-[11px] font-bold text-gray-200 tracking-wide">
              CHECK COUPON
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mb-2">
            Enter a coupon number to view its status.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="text"
              placeholder="Coupon number ..."
              value={mobileCouponNumber}
              onChange={(e) => setMobileCouponNumber(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 rounded bg-[#2a2a4a] border border-gray-700 text-white text-sm outline-none focus:border-purple-500 transition-colors placeholder:text-gray-500"
            />
            <button
              type="button"
              onClick={handleCheckMobileCoupon}
              className="shrink-0 px-4 py-2 rounded font-bold text-sm transition-all hover:opacity-80 touch-target"
              style={{
                background:
                  "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
                color: "#fff",
              }}
            >
              CHECK
            </button>
          </div>
        </div>
      </div>

      {hasBets ? (
        // Mobile: everything inside the slip scrolls together with the
        // <aside> (single scroll container) so users with 10+ picks can
        // reach every control, including the action buttons at the
        // bottom, simply by scrolling.
        // Desktop (`xl+`): keeps the original layout — bet list scrolls
        // internally while the action footer stays pinned.
        <div
          className="flex flex-col xl:flex-1 xl:min-h-0 xl:overflow-hidden"
          style={{ background: "#1a1a2e" }}
        >
          {/* Toggle Controls */}
          <div className="shrink-0 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Sort by Time</span>
              <button
                onClick={() => setSortByTime(!sortByTime)}
                className={`w-12 h-6 rounded-full transition-colors relative ${
                  sortByTime ? "bg-green-500" : "bg-gray-600"
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    sortByTime ? "translate-x-6" : ""
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Bet Items — `min-h-0` pairs with the parent's `min-h-0` so
              the scroll actually clips and the action buttons below
              stay pinned. */}
          <div className="px-3 pb-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain">
            {bets.map((bet, idx) => (
              <div
                key={bet.id}
                className="p-3 rounded mb-2 relative group"
                style={{ background: "#2a2a4a" }}
              >
                <button
                  onClick={() => removeBet(bet.id)}
                  className="absolute top-1 right-1 p-1 rounded-full bg-red-500/80 hover:bg-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove bet"
                >
                  <X className="w-3 h-3 text-white" />
                </button>

                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 pr-6">
                    <div className="text-xs font-bold text-white mb-1">{bet.match}</div>
                    <div className="text-xs text-gray-400">{bet.market}: {bet.selection}</div>
                    <div className="text-[10px] text-gray-500 mt-1">{bet.league}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold">{bet.time}</div>
                    <div
                      className="text-sm font-bold px-2 py-0.5 rounded mt-1"
                      style={{ background: "var(--mezzo-accent-green)", color: "#000" }}
                    >
                      {bet.odds.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Stake Section */}
            <div className="mt-4">
              <label className="text-sm font-semibold text-white mb-2 block">Stake</label>
              <div className="relative">
                <input
                  type="number"
                  value={stake}
                  onChange={(e) => setStake(Number(e.target.value) || 0)}
                  className="w-full px-3 py-3 rounded bg-[#2a2a4a] border border-gray-700 text-white text-lg font-semibold outline-none focus:border-purple-500 transition-colors"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col">
                  <button
                    onClick={incrementStake}
                    className="text-gray-400 hover:text-white p-0.5"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" transform="rotate(180 10 10)" />
                    </svg>
                  </button>
                  <button
                    onClick={decrementStake}
                    className="text-gray-400 hover:text-white p-0.5"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Quick Bet Amounts */}
              <div className="grid grid-cols-6 gap-1.5 mt-3">
                {[10, 20, 30, 50, 100, 1000].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setStake(prev => prev + amount)}
                    className="py-2 px-1 rounded text-[10px] font-bold transition-all hover:opacity-80"
                    style={{
                      background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
                      color: "#fff"
                    }}
                  >
                    +{amount}
                  </button>
                ))}
              </div>
            </div>

            {/* Bet Summary */}
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-white">Total Odd</span>
                <span className="font-bold text-white text-lg">{totalOdds.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white">Stake</span>
                <span className="font-bold text-white text-lg">{stake}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-t border-b" style={{ borderColor: "var(--mezzo-border)" }}>
                <span className="text-white font-semibold">Possible Win</span>
                <span className="font-bold text-white text-xl">{potentialWin.toFixed(2)}</span>
              </div>

              {/* Show More Detail - Collapsible */}
              <button
                onClick={() => setShowBonus(!showBonus)}
                className="flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors mt-3"
              >
                <span className="text-sm font-semibold">Show more detail</span>
                <svg
                  className={`w-4 h-4 transition-transform ${showBonus ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Detailed Information - Collapsible */}
              {showBonus && (
                <div className="mt-3 space-y-2 text-sm">
                  {totalBetAmount >= 2 && (
                    <div className="p-2 rounded" style={{ background: "#2a2a4a" }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">Accumulator Bonus</span>
                        <span className="text-xs font-bold text-[var(--mezzo-accent-green)]">+{bonusAmount.toFixed(0)} ETB ({currentBonus}%)</span>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Income Tax 15%</span>
                    <span className="font-bold text-gray-300">{incomeTax.toFixed(0)} ETB</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t" style={{ borderColor: "var(--mezzo-border)" }}>
                    <span className="text-gray-400">Net Payout</span>
                    <span className="font-bold text-[var(--mezzo-accent-green)] text-lg">{netPayout.toFixed(0)} ETB</span>
                  </div>
                </div>
              )}

              {/* Accept Odd Changes */}
              <div className="flex items-center gap-2 mt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="w-4 h-4 rounded border-gray-600 bg-transparent text-purple-500 focus:ring-purple-500 focus:ring-offset-0 cursor-pointer"
                    style={{ accentColor: '#a855f7' }}
                  />
                  <span className="text-sm text-gray-300">Accept all odd changes</span>
                </label>
              </div>
            </div>
          </div>

          {/* Action Buttons — compact vertical rhythm on phones/tablets
              so all four CTAs (Ticket Preview, Clear Slip, Place Bet,
              Place Bet Online) stay inside the drawer without clipping.
              Desktop (`xl+`) keeps the original generous spacing. */}
          <div
            className="shrink-0 border-t p-2.5 space-y-2 xl:space-y-3 xl:p-3"
            style={{ borderColor: "var(--mezzo-border)" }}
          >
            {/* Ticket Preview Button */}
            <button
              onClick={handleTicketPreview}
              disabled={totalBetAmount === 0}
              className="w-full py-2.5 xl:py-3 rounded font-bold flex items-center justify-center gap-2 transition-all hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed touch-target"
              style={{ background: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)", color: "#000" }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              TICKET PREVIEW
            </button>

            <div className="flex gap-2">
              <button
                onClick={clearBets}
                disabled={totalBetAmount === 0}
                className="flex-1 py-2.5 xl:py-3 rounded font-bold flex items-center justify-center gap-2 transition-all hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed touch-target"
                style={{ background: "linear-gradient(135deg, #dc2626 0%, #f97316 100%)", color: "#fff" }}
              >
                <Trash2 className="w-4 h-4" />
                CLEAR SLIP
              </button>
              <FastButton
                onClick={async () => {
                  return new Promise((resolve) => {
                    handlePlaceBet();
                    setTimeout(resolve, 1500);
                  });
                }}
                disabled={placingBet || totalBetAmount === 0}
                className="flex-1 py-2.5 xl:py-3 rounded font-bold flex items-center justify-center gap-2 touch-target"
                style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)", color: "#fff" }}
                optimistic={true}
              >
                PLACE BET
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </FastButton>
            </div>

            <FastButton
              onClick={async () => {
                return new Promise((resolve) => {
                  void handlePlaceBetOnline();
                  setTimeout(resolve, 1700);
                });
              }}
              disabled={placingBet || totalBetAmount === 0}
              className="w-full py-2.5 xl:py-3 rounded font-bold text-black flex items-center justify-center gap-2 touch-target"
              style={{ background: "var(--mezzo-accent-green)" }}
              optimistic={true}
            >
              PLACE BET ONLINE
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </FastButton>

            {/* Bet Code Section — desktop only. On mobile both sections sit
                in the always-visible block directly below the tabs. */}
            <div className="hidden xl:block mt-4 pt-4 border-t" style={{ borderColor: "var(--mezzo-border)" }}>
              <div className="mb-2">
                <p className="text-xs font-semibold text-white mb-1">Bet Code:</p>
                <p className="text-xs text-gray-400">You have a bet code? Paste it here to load.</p>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Bet code ..."
                  value={ticketNumber}
                  onChange={(e) => setTicketNumber(e.target.value)}
                  className="flex-1 px-3 py-2 rounded bg-[#2a2a4a] border border-gray-700 text-white text-sm outline-none focus:border-purple-500 transition-colors placeholder:text-gray-500"
                />
                <button
                  onClick={handleCopyTicket}
                  className="px-4 py-2 rounded font-bold text-sm transition-all hover:opacity-80"
                  style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)", color: "#fff" }}
                >
                  LOAD
                </button>
              </div>
            </div>

            {/* Check Coupon Section — desktop only (see note above). */}
            <div className="hidden xl:block mt-3">
              <button
                onClick={() => setShowCopyTicketInput(!showCopyTicketInput)}
                className="w-full flex items-center justify-between py-2 text-white font-semibold text-sm"
              >
                <span>Check Coupon</span>
                <svg
                  className={`w-4 h-4 transition-transform ${showCopyTicketInput ? 'rotate-0' : 'rotate-180'}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {showCopyTicketInput && (
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    placeholder="Coupon number ..."
                    className="flex-1 px-3 py-2 rounded bg-[#2a2a4a] border border-gray-700 text-white text-sm outline-none focus:border-purple-500 transition-colors placeholder:text-gray-500"
                  />
                  <button
                    className="px-4 py-2 rounded font-bold text-sm transition-all hover:opacity-80"
                    style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)", color: "#fff" }}
                  >
                    CHECK
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex flex-col xl:flex-1 xl:min-h-0 xl:overflow-hidden"
          style={{ background: "#1a1a2e" }}
        >
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <p className="text-gray-400 text-sm">
              <span className="text-[var(--mezzo-accent-yellow)]">&lt;&lt;&lt;</span>
              {" "}Click ODDS to Start{" "}
              <span className="text-[var(--mezzo-accent-yellow)]">&gt;&gt;&gt;</span>
            </p>
          </div>
          {/* Bet Code / Check Coupon on phones are in the `xl:hidden` block
              above the slip body for both empty and populated states. */}
        </div>
      )}

      {/* Bet Confirmation Modal */}
      {confirmationData && (
        <BetConfirmationModal
          open={showConfirmation}
          onClose={() => {
            setShowConfirmation(false);
            if (confirmationData.isOnline && typeof window !== 'undefined') {
              window.location.reload();
            }
          }}
          {...confirmationData}
        />
      )}

      {/* Choose which wallet to bet with. Only opens when a bonus > 0 is
          available. Main balance path behaves exactly as before. */}
      <Dialog open={balanceChoiceOpen} onOpenChange={setBalanceChoiceOpen}>
        <DialogContent className="bg-black border-gray-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[var(--mezzo-accent-yellow)]" />
              Choose betting wallet
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2 text-sm">
            <p className="text-xs text-gray-400">
              You have an active bonus. Pick which wallet to use for this bet —
              bonus bets follow specific admin rules and cannot be used like
              regular funds.
            </p>

            <button
              onClick={() => confirmBalanceChoice("main")}
              disabled={mainBalanceSnapshot < stake}
              className="w-full p-3 rounded border text-left flex items-center gap-3 transition-colors hover:border-[var(--mezzo-accent-green)] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "var(--mezzo-bg-tertiary)",
                borderColor: "var(--mezzo-border)",
              }}
            >
              <Wallet className="w-5 h-5 text-[var(--mezzo-accent-green)]" />
              <div className="flex-1">
                <div className="font-semibold">Main Balance</div>
                <div className="text-[11px] text-gray-400">
                  {mainBalanceSnapshot.toFixed(2)} ETB available · regular funds
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/40">
                Withdrawable
              </span>
            </button>

            <button
              onClick={() => confirmBalanceChoice("bonus")}
              disabled={bonusBalanceSnapshot < stake}
              className="w-full p-3 rounded border text-left flex items-center gap-3 transition-colors hover:border-[var(--mezzo-accent-yellow)] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "var(--mezzo-bg-tertiary)",
                borderColor: "var(--mezzo-border)",
              }}
            >
              <Gift className="w-5 h-5 text-[var(--mezzo-accent-yellow)]" />
              <div className="flex-1">
                <div className="font-semibold">Bonus Balance</div>
                <div className="text-[11px] text-gray-400">
                  {bonusBalanceSnapshot.toFixed(2)} ETB available · promo funds
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/40 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Non-withdrawable
              </span>
            </button>

            <div
              className="p-2 rounded text-[11px] text-gray-400 flex items-start gap-2"
              style={{ background: "var(--mezzo-bg-tertiary)" }}
            >
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--mezzo-accent-yellow)]" />
              <span>
                Bonus bets are subject to admin rules (min odds, rollover, max
                stake). Winnings from bonus bets may be locked until the rollover
                requirement is met.
              </span>
            </div>

            <Button
              variant="outline"
              onClick={() => {
                setBalanceChoiceOpen(false);
                setPendingBetMode(null);
              }}
              className="w-full h-9 border-gray-700 bg-transparent text-white hover:bg-gray-800"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ticket Preview Dialog */}
      <Dialog open={showTicketPreview} onOpenChange={setShowTicketPreview}>
        <DialogContent className="bg-black border-gray-700 text-white max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader className="no-print">
            <DialogTitle className="text-xl font-bold text-[var(--mezzo-accent-yellow)] text-center">
              TICKET PREVIEW
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Thermal Ticket Preview */}
            <ThermalTicket
              ticketNumber={lastCouponCode || previewTicketNumber || "PREVIEW-0000"}
              stake={stake}
              totalOdds={totalOdds}
              potentialWin={potentialWin}
              netPayout={netPayout}
              stakeTax={stake * 0.15}
              winTax={0}
              betsCount={totalBetAmount}
              timestamp={new Date().toISOString()}
              buralNumber={`088${(previewTicketNumber || "00000").replace(/\D/g, "").slice(0, 5).padEnd(5, "0")}`}
            />

            {/* Action Buttons — `no-print` ensures these UI controls never
                appear on the thermal printout. The ticket itself is the only
                thing that survives `@media print`. */}
            <div className="no-print flex gap-2 pt-2">
              <button
                onClick={() => {
                  const ticketNumber =
                    lastCouponCode || previewTicketNumber || "PREVIEW-0000";
                  navigator.clipboard.writeText(ticketNumber);
                  alert(`Ticket number ${ticketNumber} copied to clipboard!`);
                }}
                className="flex-1 py-2 rounded font-bold flex items-center justify-center gap-2"
                style={{ background: "var(--mezzo-accent-yellow)", color: "#000" }}
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
            </div>

            <button
              onClick={() => setShowTicketPreview(false)}
              className="no-print w-full py-2 rounded font-bold"
              style={{ background: "var(--mezzo-accent-green)", color: "#000" }}
            >
              CLOSE
            </button>
          </div>
        </DialogContent>
      </Dialog>
      </aside>
    </>
  );
}
