"use client";

import React from "react";
import { useBets } from "@/context/BetContext";

interface OddsButtonProps {
  // Match context
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
  time: string;
  // Bet context
  market: string;
  selection: string;
  odds: number;
  /**
   * Optional sportsbook IDs threaded through to the BetContext. When
   * every leg in the slip carries `selectionId` the Betslip routes the
   * placement through the spec-aligned `POST /api/bets/place` endpoint
   * (Section 18A) instead of the legacy internal-games fallback.
   */
  selectionId?: string;
  eventId?: string;
  marketId?: string;
  // Visual
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  // Optional extra behavior (e.g. stopPropagation, parent handler)
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * Generic odds button that adds / removes a selection from the Betslip when
 * clicked. Visual styling is provided by the caller via `className` / `style`
 * so it can blend into any existing UI (home detailed view, sport page,
 * match-details page, etc.) while preserving the site's design.
 *
 * Selected state — UNIFIED across the app:
 *   When the bet is in the Betslip we apply the same "lemon" indicator that
 *   MatchCard uses (`.odds-btn.active`): a lemon-green background with a
 *   yellow border. This is wired up here in two layers so it works on every
 *   page regardless of how callers style the button:
 *     1. The `.is-selected-odd` CSS class (defined in `globals.css`) — paints
 *        the foreground/border and forces descendant text to black.
 *     2. An inline `style` override — beats inline `style.background` props
 *        that callers pass (e.g. `style={{ background: "var(--mezzo-bg-...)" }}`),
 *        which would otherwise win over a CSS class.
 */
export function OddsButton({
  homeTeam,
  awayTeam,
  league,
  date,
  time,
  market,
  selection,
  odds,
  selectionId,
  eventId,
  marketId,
  className = "",
  style,
  children,
  onClick,
}: OddsButtonProps) {
  const { addBet, isBetAdded } = useBets();
  // Use the real selection UUID as the slip key when available so two
  // different markets on the same fixture remain individually toggleable.
  const betId = selectionId ?? `${homeTeam}-${awayTeam}-${market}-${selection}`;
  const active = isBetAdded(betId);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    addBet({
      id: betId,
      match: `${homeTeam} V ${awayTeam}`,
      homeTeam,
      awayTeam,
      league,
      market,
      selection,
      odds,
      time,
      date,
      selectionId,
      eventId,
      marketId,
    });
    onClick?.(e);
  };

  // When active, override the caller-supplied background/colour inline so
  // the lemon indicator wins regardless of which page mounts the button.
  const mergedStyle: React.CSSProperties | undefined = active
    ? {
        ...(style || {}),
        background: "var(--mezzo-accent-green)",
        color: "#000",
      }
    : style;

  return (
    <button
      onClick={handleClick}
      className={`${className} ${active ? "is-selected-odd" : ""}`.trim()}
      style={mergedStyle}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
