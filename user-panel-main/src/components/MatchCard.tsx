"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useBets } from "@/context/BetContext";
import { useFavorites } from "@/context/FavoritesContext";
import { Star, Activity } from "lucide-react";

interface MatchCardProps {
  league: string;
  leagueFlag: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  time: string;
  sideBets: number;
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
  isLive?: boolean;
  score?: { home: number; away: number };
  minute?: string;
  onSideBetsClick?: () => void;
}

export function MatchCard({
  league,
  leagueFlag,
  homeTeam,
  awayTeam,
  date,
  time,
  sideBets,
  odds,
  isLive,
  score,
  minute,
  onSideBetsClick,
}: MatchCardProps) {
  const [selectedOdd, setSelectedOdd] = useState<string | null>(null);
  const [liveScore, setLiveScore] = useState(score || { home: 0, away: 0 });
  const [liveMinute, setLiveMinute] = useState(minute || "");
  const tickRef = useRef(0);
  const router = useRouter();
  const { addBet, isBetAdded } = useBets();
  const { toggleFavoriteMatch, isFavoriteMatch } = useFavorites();

  const matchId = `${homeTeam}-${awayTeam}-${date}-${time}`;
  const isFavorite = isFavoriteMatch(matchId);

  // Deterministic live display progression (no client RNG in production).
  useEffect(() => {
    if (isLive) {
      const interval = setInterval(() => {
        tickRef.current += 1;
        setLiveScore((prev) => {
          if (tickRef.current % 6 === 0) return { ...prev, home: prev.home + 1 };
          if (tickRef.current % 9 === 0) return { ...prev, away: prev.away + 1 };
          return prev;
        });

        // Update minute
        const currentMin = parseInt(liveMinute.replace("'", "")) || 0;
        if (currentMin < 90) {
          setLiveMinute(`${currentMin + 1}'`);
        }
      }, 5000); // Update every 5 seconds

      return () => clearInterval(interval);
    }
  }, [isLive, liveMinute]);

  const handleOddClick = (oddType: string, oddValue: number, market: string) => {
    const betId = `${homeTeam}-${awayTeam}-${oddType}`;

    // Create bet object
    const bet = {
      id: betId,
      match: `${homeTeam} V ${awayTeam}`,
      homeTeam,
      awayTeam,
      league,
      market,
      selection: oddType,
      odds: oddValue,
      time,
      date,
    };

    // Add or remove bet
    addBet(bet);

    // Toggle selected state
    setSelectedOdd(selectedOdd === oddType ? null : oddType);
  };

  const handleMatchClick = () => {
    const matchId = `${homeTeam}-vs-${awayTeam}`.toLowerCase().replace(/\s+/g, '-');
    router.push(`/match/${matchId}`);
  };

  const handleSideBets = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSideBetsClick) {
      onSideBetsClick();
    } else {
      handleMatchClick();
    }
  };

  return (
    <div
      className="border-b transition-colors hover:bg-[var(--mezzo-bg-tertiary)]"
      style={{ borderColor: "var(--mezzo-border)" }}
    >
      {/* League Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-400"
        style={{ background: "var(--mezzo-bg-tertiary)" }}
      >
        <div className="flex items-center gap-2">
          <img src={leagueFlag} alt="" className="w-4 h-3 rounded-sm" />
          <span>{league}</span>
          {isLive && (
            <span className="flex items-center gap-1 text-red-500 animate-pulse">
              <Activity className="w-3 h-3" />
              LIVE
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavoriteMatch(matchId);
          }}
          className="hover:scale-110 transition-transform"
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            className={`w-4 h-4 ${isFavorite ? 'fill-yellow-500 text-yellow-500' : 'text-gray-500'}`}
          />
        </button>
      </div>

      {/* Match Row
          <lg: teams + date/side-bets on the top row, all odds buttons in
          an evenly-sized grid below so every selection stays tappable and
          nothing overflows (grid reflows to 2 rows on <sm phones).
          lg+ (≥1024px): original single-row layout with each market
          grouped — identical to the pre-existing desktop design. */}
      <div className="px-3 py-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
          {/* Top meta row below lg combines teams + date + side-bets. */}
          <div className="flex items-start justify-between gap-3 lg:flex-1 lg:min-w-0">
            <div
              className="flex-1 min-w-0 cursor-pointer"
              onClick={handleMatchClick}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-white truncate">{homeTeam}</span>
                {isLive && (
                  <span className="text-[var(--mezzo-accent-green)] font-bold text-base sm:text-lg">{liveScore.home}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white truncate">{awayTeam}</span>
                {isLive && (
                  <span className="text-[var(--mezzo-accent-green)] font-bold text-base sm:text-lg">{liveScore.away}</span>
                )}
              </div>
            </div>

            {/* Date + side-bets inline on the top row (mobile/tablet). The
                lg+ desktop layout renders them on the far right instead. */}
            <div className="flex flex-col items-end gap-1 shrink-0 lg:hidden">
              <div className="text-[10px] text-gray-400">
                {isLive ? (
                  <div className="flex items-center gap-1">
                    <Activity className="w-3 h-3 text-red-500 animate-pulse" />
                    <span className="text-[var(--mezzo-accent-green)] font-bold">{liveMinute}</span>
                  </div>
                ) : (
                  <>
                    {date} {time}
                  </>
                )}
              </div>
              <button
                onClick={handleSideBets}
                className="px-2.5 py-1 rounded text-[11px] font-bold whitespace-nowrap hover:opacity-80 transition-opacity touch-target"
                style={{ background: "var(--mezzo-accent-green)", color: "#000" }}
              >
                +{sideBets}
              </button>
            </div>
          </div>

          {/* Odds grid below lg. 4 cols on the tightest phones (Z Fold 5
              folded @344, Galaxy S8+ @360, iPhone SE @375 …) to keep each
              button legible; 8 cols once there's room (≥sm / 640px). */}
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 lg:hidden">
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("1", odds.home, "Match Result"); }}
              className={`odds-btn text-center ${isBetAdded(`${homeTeam}-${awayTeam}-1`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">1</div>
              <div className="font-semibold">{odds.home.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("X", odds.draw, "Match Result"); }}
              className={`odds-btn text-center ${isBetAdded(`${homeTeam}-${awayTeam}-X`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">X</div>
              <div className="font-semibold">{odds.draw.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("2", odds.away, "Match Result"); }}
              className={`odds-btn text-center ${isBetAdded(`${homeTeam}-${awayTeam}-2`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">2</div>
              <div className="font-semibold">{odds.away.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("1X", odds.home1x, "Double Chance"); }}
              className={`odds-btn text-center ${isBetAdded(`${homeTeam}-${awayTeam}-1X`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">1X</div>
              <div className="font-semibold">{odds.home1x.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("12", odds.draw12, "Double Chance"); }}
              className={`odds-btn text-center ${isBetAdded(`${homeTeam}-${awayTeam}-12`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">12</div>
              <div className="font-semibold">{odds.draw12.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("X2", odds.away2x, "Double Chance"); }}
              className={`odds-btn text-center ${isBetAdded(`${homeTeam}-${awayTeam}-X2`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">X2</div>
              <div className="font-semibold">{odds.away2x.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("Yes", odds.yesScore, "Both Teams to Score"); }}
              className={`odds-btn text-center ${isBetAdded(`${homeTeam}-${awayTeam}-Yes`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">Yes</div>
              <div className="font-semibold">{odds.yesScore.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("No", odds.noScore, "Both Teams to Score"); }}
              className={`odds-btn text-center ${isBetAdded(`${homeTeam}-${awayTeam}-No`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">No</div>
              <div className="font-semibold">{odds.noScore.toFixed(2)}</div>
            </button>
          </div>

          {/* Desktop Match Result Odds */}
          <div className="hidden lg:flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("1", odds.home, "Match Result"); }}
              className={`odds-btn min-w-[40px] text-center ${isBetAdded(`${homeTeam}-${awayTeam}-1`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">1</div>
              <div className="font-semibold">{odds.home.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("X", odds.draw, "Match Result"); }}
              className={`odds-btn min-w-[40px] text-center ${isBetAdded(`${homeTeam}-${awayTeam}-X`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">X</div>
              <div className="font-semibold">{odds.draw.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("2", odds.away, "Match Result"); }}
              className={`odds-btn min-w-[40px] text-center ${isBetAdded(`${homeTeam}-${awayTeam}-2`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">2</div>
              <div className="font-semibold">{odds.away.toFixed(2)}</div>
            </button>
          </div>

          {/* Desktop Double Chance Odds */}
          <div className="hidden lg:flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("1X", odds.home1x, "Double Chance"); }}
              className={`odds-btn min-w-[40px] text-center ${isBetAdded(`${homeTeam}-${awayTeam}-1X`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">1X</div>
              <div className="font-semibold">{odds.home1x.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("12", odds.draw12, "Double Chance"); }}
              className={`odds-btn min-w-[40px] text-center ${isBetAdded(`${homeTeam}-${awayTeam}-12`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">12</div>
              <div className="font-semibold">{odds.draw12.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("X2", odds.away2x, "Double Chance"); }}
              className={`odds-btn min-w-[40px] text-center ${isBetAdded(`${homeTeam}-${awayTeam}-X2`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">X2</div>
              <div className="font-semibold">{odds.away2x.toFixed(2)}</div>
            </button>
          </div>

          {/* Desktop Both Score Odds */}
          <div className="hidden lg:flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("Yes", odds.yesScore, "Both Teams to Score"); }}
              className={`odds-btn min-w-[40px] text-center ${isBetAdded(`${homeTeam}-${awayTeam}-Yes`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">Yes</div>
              <div className="font-semibold">{odds.yesScore.toFixed(2)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOddClick("No", odds.noScore, "Both Teams to Score"); }}
              className={`odds-btn min-w-[40px] text-center ${isBetAdded(`${homeTeam}-${awayTeam}-No`) ? "active" : ""}`}
            >
              <div className="text-[10px] text-gray-500">No</div>
              <div className="font-semibold">{odds.noScore.toFixed(2)}</div>
            </button>
          </div>

          {/* Desktop Date/Time and Side Bets */}
          <div className="hidden lg:flex flex-col items-end gap-0.5">
            <div className="text-[10px] text-gray-400">
              {isLive ? (
                <div className="flex items-center gap-1">
                  <Activity className="w-3 h-3 text-red-500 animate-pulse" />
                  <span className="text-[var(--mezzo-accent-green)] font-bold">{liveMinute}</span>
                </div>
              ) : (
                <>
                  {date} {time}
                </>
              )}
            </div>
            <button
              onClick={handleSideBets}
              className="px-3 py-1 rounded text-xs font-bold whitespace-nowrap hover:opacity-80 transition-opacity"
              style={{ background: "var(--mezzo-accent-green)", color: "#000" }}
            >
              {sideBets} Side Bets
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
