"use client";

/**
 * Reusable wrapper that embeds an internal game from the game engine.
 *
 * The Aviator / Fast Keno / JetX user-panel pages all share the same
 * shape per Section 15: pure iframe wrappers, no client-side game logic.
 * The iframe URL is `${GAME_ENGINE_URL}/games/${slug}?token=${jwt}` where
 * `GAME_ENGINE_URL` defaults to `http://localhost:3002` and the token is
 * the customer's user-panel JWT (so the engine can authenticate the
 * play session against the backend).
 */

import { useEffect, useState } from "react";
import Link from "next/link";

const GAME_ENGINE_URL =
  process.env.NEXT_PUBLIC_GAME_ENGINE_URL ?? "http://localhost:3002";

interface GameIframeWrapperProps {
  /** Game slug expected by the game engine, e.g. "aviator". */
  slug: string;
  /** Human-readable title rendered above the iframe. */
  title: string;
  /** Optional subtitle / strapline. */
  subtitle?: string;
}

export function GameIframeWrapper({
  slug,
  title,
  subtitle,
}: GameIframeWrapperProps) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Token is set by the auth flow on login. We read it on mount so the
    // iframe URL includes a fresh value on every navigation to the page.
    if (typeof window === "undefined") return;
    setToken(window.localStorage.getItem("auth_token"));
    setReady(true);
  }, []);

  const url = `${GAME_ENGINE_URL.replace(/\/$/, "")}/games/${slug}?token=${encodeURIComponent(
    token ?? "",
  )}`;

  return (
    <main
      className="flex min-h-[calc(100vh-180px)] flex-col"
      style={{ background: "var(--mezzo-bg-primary)" }}
    >
      <header
        className="px-4 py-3 border-b flex items-center gap-3"
        style={{
          background: "var(--mezzo-bg-secondary)",
          borderColor: "var(--mezzo-border)",
        }}
      >
        <h1 className="text-base sm:text-lg font-bold capitalize">{title}</h1>
        {subtitle && (
          <span className="text-xs text-gray-400 hidden sm:inline">{subtitle}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/games"
            className="text-xs px-3 py-1.5 rounded text-black font-semibold"
            style={{ background: "var(--mezzo-accent-green)" }}
          >
            Back to lobby
          </Link>
        </div>
      </header>

      <div className="flex-1 min-h-0">
        {!ready ? (
          <div className="flex h-full items-center justify-center text-gray-400 text-sm">
            Loading {title}…
          </div>
        ) : !token ? (
          <div className="flex h-full items-center justify-center text-center px-6">
            <div className="max-w-md">
              <p className="text-sm text-gray-300">
                You need to be signed in to play {title}.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-block px-4 py-2 rounded font-semibold text-black text-sm"
                style={{ background: "var(--mezzo-accent-yellow)" }}
              >
                Sign in
              </Link>
            </div>
          </div>
        ) : (
          <iframe
            src={url}
            title={title}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="w-full h-[calc(100vh-220px)] border-0"
          />
        )}
      </div>
    </main>
  );
}
