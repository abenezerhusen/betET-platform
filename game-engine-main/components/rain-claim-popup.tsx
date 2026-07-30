"use client";

/**
 * Rain Bonus claim popup.
 *
 * Self-contained widget dropped into a game page (Fast Keno / Aviator). It:
 *   • fetches any rain already open when the page loads,
 *   • listens on the shared game socket for `rain:open` / `rain:closed`
 *     / `rain:claimed` (filtered to this page's `game`),
 *   • shows a floating "🌧️ Rain Bonus — Claim X" card with a live countdown,
 *   • calls the claim endpoint and surfaces the awarded amount (or the reason
 *     the player is ineligible),
 *   • invokes `onClaimed` so the host page can refresh the wallet balance.
 *
 * No game logic lives here — the amount, schedule and eligibility are all
 * decided server-side.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectGameSocket,
  ensureGameToken,
  getActiveRain,
  claimRain,
  type RainActive,
  type RainClosedEvent,
  type RainClaimedEvent,
  type RainGameId,
} from "@/lib/game-engine";
import { ApiError } from "@/lib/api";

type Phase = "idle" | "open" | "claiming" | "claimed" | "error";

export function RainClaimPopup({
  game,
  onClaimed,
}: {
  game: RainGameId;
  onClaimed?: () => void;
}) {
  const [rain, setRain] = useState<RainActive | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [claimedAmount, setClaimedAmount] = useState(0);
  const [currency, setCurrency] = useState("ETB");
  const [errorMsg, setErrorMsg] = useState("");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror the latest phase so socket handlers (stable closures) can read it.
  const phaseRef = useRef<Phase>("idle");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const openRain = useCallback((r: RainActive) => {
    if (r.game !== game) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setRain(r);
    setCurrency(r.currency || "ETB");
    setSecondsLeft(Math.max(0, r.seconds_left));
    setErrorMsg("");
    setPhase("open");
  }, [game]);

  const dismissLater = useCallback((ms: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setPhase("idle");
      setRain(null);
    }, ms);
  }, []);

  // Load any rain that's already live when we mount + subscribe to updates.
  useEffect(() => {
    let cancelled = false;
    let socket: ReturnType<typeof connectGameSocket> = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const onOpen = (ev: RainActive) => openRain(ev);
    const onClosed = (ev: RainClosedEvent) => {
      if (ev.game !== game) return;
      // Keep a "claimed" celebration on screen; otherwise fade out.
      if (phaseRef.current !== "claimed") {
        setPhase("idle");
        setRain(null);
      }
    };
    const onClaimed = (ev: RainClaimedEvent) => {
      if (ev.game !== game) return;
      setClaimedAmount(ev.amount);
      setCurrency(ev.currency || "ETB");
      setPhase("claimed");
      dismissLater(6000);
    };

    const attach = (s: NonNullable<ReturnType<typeof connectGameSocket>>) => {
      socket = s;
      s.on("rain:open", onOpen);
      s.on("rain:closed", onClosed);
      s.on("rain:claimed", onClaimed);
    };

    // The shared socket may not exist yet if the popup mounts before the host
    // page finishes connecting — retry until it's available so we never miss a
    // rain event.
    const connect = () => {
      if (cancelled) return;
      const s = connectGameSocket();
      if (s) attach(s);
      else retry = setTimeout(connect, 1000);
    };

    void (async () => {
      // Make sure we have a usable player token before touching the API.
      await ensureGameToken().catch(() => null);
      if (cancelled) return;
      getActiveRain(game)
        .then((r) => {
          if (!cancelled && r) openRain(r);
        })
        .catch(() => {});
      connect();
    })();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (socket) {
        socket.off("rain:open", onOpen);
        socket.off("rain:closed", onClosed);
        socket.off("rain:claimed", onClaimed);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, openRain, dismissLater]);

  // Countdown ticker.
  useEffect(() => {
    if (phase !== "open" || !rain) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        const next = s - 1;
        if (next <= 0) {
          setPhase("idle");
          setRain(null);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, rain]);

  const handleClaim = useCallback(async () => {
    if (!rain) return;
    setPhase("claiming");
    try {
      const res = await claimRain(game);
      setClaimedAmount(res.amount);
      setCurrency(res.currency || "ETB");
      setPhase("claimed");
      onClaimed?.();
      dismissLater(6000);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? (err.body as { message?: string })?.message || err.message
          : "Could not claim rain";
      setErrorMsg(msg);
      setPhase("error");
      dismissLater(4000);
    }
  }, [rain, game, onClaimed, dismissLater]);

  if (phase === "idle" || (!rain && phase !== "claimed" && phase !== "error")) {
    return null;
  }

  return (
    <div className="fixed left-1/2 top-4 z-[9999] -translate-x-1/2 px-3 w-full max-w-sm pointer-events-none">
      <div className="pointer-events-auto rounded-2xl border border-sky-300/60 bg-gradient-to-br from-sky-500 to-indigo-700 p-4 text-white shadow-2xl shadow-sky-900/40 ring-1 ring-white/10 animate-in fade-in slide-in-from-top-4 duration-300">
        {phase === "claimed" ? (
          <div className="flex flex-col items-center text-center gap-1 py-1">
            <div className="text-3xl">🌧️</div>
            <p className="text-sm font-semibold tracking-wide">Rain Bonus!</p>
            <p className="text-2xl font-extrabold drop-shadow">
              +{claimedAmount.toFixed(2)} {currency}
            </p>
            <p className="text-xs text-sky-100/90">Added to your wallet</p>
          </div>
        ) : phase === "error" ? (
          <div className="flex items-center gap-3">
            <div className="text-2xl">🌧️</div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Rain Bonus</p>
              <p className="text-xs text-amber-100 truncate">{errorMsg}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="text-3xl animate-bounce">🌧️</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold tracking-wide">Rain Bonus is here!</p>
              <p className="text-xs text-sky-100/90">
                {rain?.distribution === "random" ? "Grab a random share · " : ""}
                {rain ? `${rain.remaining_claims} left` : ""} · {secondsLeft}s
              </p>
            </div>
            <button
              onClick={handleClaim}
              disabled={phase === "claiming"}
              className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow hover:bg-sky-50 active:scale-95 transition disabled:opacity-60"
            >
              {phase === "claiming"
                ? "Claiming…"
                : `Claim ${rain ? rain.amount.toFixed(2) : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RainClaimPopup;
