"use client";

import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";

export interface Bet {
  id: string;
  match: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  market: string;
  selection: string;
  odds: number;
  time: string;
  date: string;
  /**
   * Optional sportsbook IDs. When present on EVERY leg in the slip the
   * Betslip will place the bet via the spec-aligned multi-leg endpoint
   * (`POST /api/bets/place`, Section 18A). When absent the slip falls
   * back to the legacy internal-games path so demo data still works.
   */
  selectionId?: string;
  eventId?: string;
  marketId?: string;
}

/**
 * Bet Slip identifier — there are exactly three slips in the UI (1, 2, 3),
 * each operating as a fully isolated betting experience. Picks placed in
 * slip 1 must NOT appear in slip 2 or slip 3, and vice versa.
 */
export type SlipId = 1 | 2 | 3;

interface BetContextType {
  // Public API (unchanged signatures so every existing consumer — OddsButton,
  // MatchCard, MobileBottomNav, ResponsiveLayout, ThermalTicket, Betslip —
  // keeps working without a single edit).
  bets: Bet[];
  addBet: (bet: Bet) => void;
  removeBet: (id: string) => void;
  clearBets: () => void;
  isBetAdded: (id: string) => boolean;

  // Additive API used by Betslip to switch which slip the public API operates
  // on. Existing consumers that don't care about slips can ignore these.
  activeSlip: SlipId;
  setActiveSlip: (slip: SlipId) => void;
  /** Read-only count for any slip — used by callers that want to render
   *  per-tab badges without affecting the active slip. */
  slipCount: (slip: SlipId) => number;
}

const BetContext = createContext<BetContextType | undefined>(undefined);

/**
 * Stable identity for a single match across all markets. Two markets on the
 * same fixture (e.g. "Match Result · Home" and "Double Chance · 1X") share
 * this key, which is what enforces the "one selection per match" rule —
 * a new pick on a match replaces any previous pick on that same match
 * within the active slip.
 */
function matchKey(bet: Pick<Bet, "homeTeam" | "awayTeam" | "date" | "time">): string {
  return `${bet.homeTeam}__${bet.awayTeam}__${bet.date}__${bet.time}`;
}

function emptySlips(): Record<SlipId, Bet[]> {
  return { 1: [], 2: [], 3: [] };
}

export function BetProvider({ children }: { children: ReactNode }) {
  // Three isolated slips. Each slip owns its own list of selections; the
  // public `bets` field below transparently exposes the *active* slip's
  // list so existing consumers see exactly what they used to see.
  const [slips, setSlips] = useState<Record<SlipId, Bet[]>>(emptySlips);
  const [activeSlip, setActiveSlipState] = useState<SlipId>(1);

  const setActiveSlip = useCallback((slip: SlipId) => {
    setActiveSlipState(slip);
  }, []);

  const addBet = useCallback((bet: Bet) => {
    setSlips((prev) => {
      const current = prev[activeSlip];
      const sameIdIdx = current.findIndex((b) => b.id === bet.id);

      // 1) Clicking the SAME odds button that's already in this slip → toggle
      //    it off. Preserves the original UX where tapping an active odd
      //    removes it from the slip.
      if (sameIdIdx !== -1) {
        const next = current.filter((b) => b.id !== bet.id);
        return { ...prev, [activeSlip]: next };
      }

      // 2) NEW: Only one selection per match per slip. If a different odds
      //    button on the SAME match is already in this slip, replace it
      //    with the new pick. Other slips are untouched.
      const newKey = matchKey(bet);
      const sameMatchIdx = current.findIndex((b) => matchKey(b) === newKey);
      if (sameMatchIdx !== -1) {
        const next = [...current];
        next[sameMatchIdx] = bet;
        return { ...prev, [activeSlip]: next };
      }

      // 3) Otherwise append the pick to the active slip.
      return { ...prev, [activeSlip]: [...current, bet] };
    });
  }, [activeSlip]);

  const removeBet = useCallback((id: string) => {
    setSlips((prev) => ({
      ...prev,
      [activeSlip]: prev[activeSlip].filter((b) => b.id !== id),
    }));
  }, [activeSlip]);

  const clearBets = useCallback(() => {
    // Match the existing UX: the trash button next to the tabs clears the
    // slip the user is currently looking at, never the other two.
    setSlips((prev) => ({ ...prev, [activeSlip]: [] }));
  }, [activeSlip]);

  const isBetAdded = useCallback(
    (id: string) => slips[activeSlip].some((b) => b.id === id),
    [slips, activeSlip],
  );

  const slipCount = useCallback(
    (slip: SlipId) => slips[slip].length,
    [slips],
  );

  // The "current" bets that the rest of the app sees. Memoised so consumers
  // re-render only when the *active* slip changes, not when a non-active
  // slip is mutated.
  const bets = useMemo(() => slips[activeSlip], [slips, activeSlip]);

  const value = useMemo<BetContextType>(
    () => ({
      bets,
      addBet,
      removeBet,
      clearBets,
      isBetAdded,
      activeSlip,
      setActiveSlip,
      slipCount,
    }),
    [bets, addBet, removeBet, clearBets, isBetAdded, activeSlip, setActiveSlip, slipCount],
  );

  return <BetContext.Provider value={value}>{children}</BetContext.Provider>;
}

export function useBets() {
  const context = useContext(BetContext);
  if (!context) {
    throw new Error("useBets must be used within BetProvider");
  }
  return context;
}
