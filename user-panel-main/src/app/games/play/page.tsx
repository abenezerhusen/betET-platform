"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import * as gamesApi from "@/lib/api/games";

function GamePlayInner() {
  const params = useSearchParams();
  const router = useRouter();
  const gameId = params.get("gameId");
  const { isAuthenticated } = useAuth();

  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) void gamesApi.endGameSession(sid).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !gameId) return;
    let cancelled = false;
    void (async () => {
      try {
        const returnUrl =
          typeof window !== "undefined"
            ? `${window.location.origin}/games`
            : undefined;
        const res = await gamesApi.createGameSession({
          game_id: gameId,
          return_url: returnUrl,
          metadata: { device: "web" },
        });
        if (cancelled) return;
        setLaunchUrl(res.launch_url);
        setSessionId(res.session_id);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Could not start game");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, gameId]);

  useEffect(() => {
    if (!launchUrl) return;
    let iframeOrigin: string;
    try {
      iframeOrigin = new URL(launchUrl).origin;
    } catch {
      return;
    }

    const handler = async (ev: MessageEvent) => {
      if (ev.origin !== iframeOrigin) return;
      const d = ev.data as { type?: string } | null;
      if (!d || typeof d !== "object") return;
      if (d.type === "SESSION_END" && sessionIdRef.current) {
        try {
          await gamesApi.endGameSession(sessionIdRef.current);
        } catch {
          /* ignore */
        }
        router.push("/games");
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [launchUrl, router]);

  if (!gameId) {
    return (
      <div className="p-6 text-gray-300" style={{ background: "var(--mezzo-bg-primary)" }}>
        Missing game id.
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-6 text-gray-300" style={{ background: "var(--mezzo-bg-primary)" }}>
        Please log in using the header, then open the game again from the lobby.
      </div>
    );
  }

  if (err) {
    return (
      <div className="p-6 space-y-4" style={{ background: "var(--mezzo-bg-primary)" }}>
        <p className="text-red-400">{err}</p>
        <button
          type="button"
          onClick={() => router.push("/games")}
          className="text-sm underline text-gray-300"
        >
          Back to games
        </button>
      </div>
    );
  }

  if (!launchUrl) {
    return (
      <div className="p-6 text-gray-400" style={{ background: "var(--mezzo-bg-primary)" }}>
        Starting game…
      </div>
    );
  }

  return (
    <div
      className="flex flex-col min-h-[calc(100vh-120px)] md:min-h-[calc(100vh-180px)]"
      style={{ background: "var(--mezzo-bg-primary)" }}
    >
      <div
        className="flex items-center gap-2 p-3 border-b shrink-0"
        style={{ borderColor: "var(--mezzo-border)" }}
      >
        <button
          type="button"
          onClick={() => router.push("/games")}
          className="text-sm text-gray-300 hover:text-white px-2 py-1 rounded hover:bg-[var(--mezzo-bg-tertiary)]"
        >
          ← Back to lobby
        </button>
      </div>
      <iframe
        src={launchUrl}
        className="w-full flex-1 min-h-[75vh] border-0 bg-black"
        title="Game"
        allow="fullscreen; autoplay; payment"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
      />
    </div>
  );
}

export default function GamePlayPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-gray-400" style={{ background: "var(--mezzo-bg-primary)" }}>
          Loading…
        </div>
      }
    >
      <GamePlayInner />
    </Suspense>
  );
}
