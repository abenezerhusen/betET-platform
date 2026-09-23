"use client";

/**
 * Home-page casino game surfaces.
 *
 * Two presentational pieces share a single data fetch via `useHomeGames()`:
 *   - `HomeGamesStrip`   — a horizontally-scrollable rail of available games
 *                          shown where the old Upcoming/Top-Leagues tabs were.
 *   - `HomePopularGames` — the admin-curated "Popular Games" grid rendered
 *                          near the bottom of the home page.
 *
 * Games come from the exact same sources the Games page uses (internal engine
 * + external providers + catalog), so nothing about the game/launch/betting
 * logic changes. Tapping a game routes to `/games?play=<key>`, which the Games
 * page consumes to auto-launch that game through the existing permission +
 * launch/iframe flow — no duplicated launch logic here.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import * as gamesApi from "@/lib/api/games";
import { publicConfigApi } from "@/lib/api";
import type {
  GameThumbnailOverride,
  PopularGameEntry,
} from "@/lib/api/publicConfig";

const THUMB_FALLBACK = "/play-core-logo.png";

/** How many games the top rail shows (quick-access rail; the full catalogue
 *  lives on the Games page). */
const STRIP_MAX = 24;
/** How many games the Popular Games grid shows. */
const POPULAR_MAX = 10;

export interface HomeGameItem {
  id: string;
  name: string;
  provider: string;
  type: string;
  thumbnail_url: string;
  /** Value passed to `/games?play=` — matches internal slug or any game id. */
  playKey: string;
  internalSlug?: string;
}

function handleThumbError(e: React.SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget;
  if (img.src.endsWith(THUMB_FALLBACK)) return;
  img.src = THUMB_FALLBACK;
}

/**
 * Fetch + merge the game universe (internal + external + catalog), apply admin
 * thumbnail overrides, and load the admin-curated Popular Games list. Shared by
 * both home game surfaces so the page only fetches once.
 */
export function useHomeGames(): {
  games: HomeGameItem[];
  popular: HomeGameItem[];
  loading: boolean;
} {
  const [games, setGames] = useState<HomeGameItem[]>([]);
  const [popular, setPopular] = useState<HomeGameItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [lobby, ext, catalog, thumbsRes, popularRes] = await Promise.all([
        gamesApi.getInternalGamesLobby().catch(() => ({ all_games: [] })),
        gamesApi.listExternalGames().catch(() => ({ games: [] })),
        gamesApi.listGames({ page: 1, limit: 100 }).catch(() => ({ items: [] })),
        publicConfigApi.listGameThumbnails().catch(() => ({ items: [] as GameThumbnailOverride[] })),
        publicConfigApi.listPopularGames().catch(() => ({ items: [] as PopularGameEntry[] })),
      ]);
      if (cancelled) return;

      const merged: HomeGameItem[] = [];
      const seen = new Set<string>();
      const pushUnique = (g: HomeGameItem) => {
        const key = g.name.toLowerCase();
        if (!g.id || !g.name || seen.has(key)) return;
        seen.add(key);
        merged.push(g);
      };

      for (const g of lobby.all_games ?? []) {
        const slug = g.slug ?? g.id;
        pushUnique({
          id: g.id,
          name: g.name,
          provider: g.provider,
          type: g.game_type ?? "casino",
          thumbnail_url: g.thumbnail_url ?? THUMB_FALLBACK,
          playKey: slug ?? g.id,
          internalSlug: slug ?? undefined,
        });
      }
      for (const g of ext.games ?? []) {
        pushUnique({
          id: g.id,
          name: g.name,
          provider: g.provider,
          type: "casino",
          thumbnail_url: g.thumbnail_url,
          playKey: g.id,
        });
      }
      for (const g of catalog.items ?? []) {
        const cfg = (g.config as { thumbnail_url?: string; banner_url?: string }) ?? {};
        pushUnique({
          id: g.id,
          name: g.name,
          provider: g.provider,
          type: g.type,
          thumbnail_url: cfg.thumbnail_url || cfg.banner_url || THUMB_FALLBACK,
          playKey: g.id,
        });
      }

      // Apply admin thumbnail overrides (Settings → General → Game Thumbnails)
      // so the home rail matches the Games page visuals.
      const overrides = new Map(
        (thumbsRes.items ?? [])
          .filter((t) => t.is_active !== false)
          .map((t) => [t.game_id.toLowerCase(), t.thumbnail_url]),
      );
      const withThumbs = overrides.size === 0
        ? merged
        : merged.map((g) => {
            const o =
              overrides.get(g.id.toLowerCase()) ??
              overrides.get(g.internalSlug?.toLowerCase() ?? "");
            return o ? { ...g, thumbnail_url: o } : g;
          });

      setGames(withThumbs.slice(0, STRIP_MAX));

      // Resolve the admin Popular Games list against the merged universe. Fall
      // back to the first N games so the section is never empty out of the box.
      const byId = new Map<string, HomeGameItem>();
      for (const g of withThumbs) {
        byId.set(g.id.toLowerCase(), g);
        if (g.internalSlug) byId.set(g.internalSlug.toLowerCase(), g);
      }
      const configured = (popularRes.items ?? [])
        .filter((p) => p.is_active !== false && p.game_id)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

      let popularList: HomeGameItem[];
      if (configured.length > 0) {
        popularList = configured
          .map((p) => {
            const match = byId.get(p.game_id.toLowerCase());
            if (!match) return null;
            // Prefer an admin-provided thumbnail on the popular entry itself.
            return p.thumbnail_url
              ? { ...match, thumbnail_url: p.thumbnail_url }
              : match;
          })
          .filter((g): g is HomeGameItem => g !== null)
          .slice(0, POPULAR_MAX);
      } else {
        popularList = withThumbs.slice(0, POPULAR_MAX);
      }
      setPopular(popularList);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { games, popular, loading };
}

function playHref(g: HomeGameItem): string {
  return `/games?play=${encodeURIComponent(g.playKey)}`;
}

/* -------------------------------------------------------------------------- */
/* Horizontal rail (replaces the old Upcoming / Top-Leagues tab toggle)        */
/* -------------------------------------------------------------------------- */

export function HomeGamesStrip({
  games,
  loading,
}: {
  games: HomeGameItem[];
  loading: boolean;
}) {
  const router = useRouter();
  if (!loading && games.length === 0) return null;
  return (
    <div
      className="border-b"
      style={{ background: "var(--mezzo-bg-secondary)", borderColor: "var(--mezzo-border)" }}
    >
      <div className="flex gap-2.5 px-3 py-3 overflow-x-auto hide-scrollbar">
        {loading && games.length === 0
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="shrink-0 w-24 sm:w-28 aspect-[3/2] rounded-lg animate-pulse"
                style={{ background: "var(--mezzo-bg-tertiary)" }}
              />
            ))
          : games.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => router.push(playHref(g))}
                title={`${g.name} — ${g.provider}`}
                aria-label={`Play ${g.name}`}
                className="group relative shrink-0 w-24 sm:w-28 rounded-lg overflow-hidden transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[var(--mezzo-accent-green)]"
                style={{ background: "var(--mezzo-bg-tertiary)" }}
              >
                <div className="aspect-[3/2] relative">
                  <img
                    src={g.thumbnail_url}
                    alt={g.name}
                    onError={handleThumbError}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: "var(--mezzo-accent-green)" }}
                    >
                      <Play className="w-4 h-4 text-black" />
                    </span>
                  </div>
                </div>
                <div className="px-1.5 py-1 text-[10px] font-semibold text-white truncate text-left">
                  {g.name}
                </div>
              </button>
            ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Popular Games grid (bottom of the home page)                                */
/* -------------------------------------------------------------------------- */

export function HomePopularGames({
  popular,
  loading,
}: {
  popular: HomeGameItem[];
  loading: boolean;
}) {
  const router = useRouter();
  if (!loading && popular.length === 0) return null;
  return (
    <div className="px-3 sm:px-4 py-4">
      <h2 className="text-sm sm:text-base font-bold mb-3 text-white">Popular Games</h2>
      {/* Mobile: 3 across • Desktop: 5 across — 10 games wrap responsively. */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
        {loading && popular.length === 0
          ? Array.from({ length: POPULAR_MAX }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/2] rounded-lg animate-pulse"
                style={{ background: "var(--mezzo-bg-tertiary)" }}
              />
            ))
          : popular.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => router.push(playHref(g))}
                title={`${g.name} — ${g.provider}`}
                aria-label={`Play ${g.name}`}
                className="group relative rounded-lg overflow-hidden transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[var(--mezzo-accent-green)]"
                style={{ background: "var(--mezzo-bg-secondary)" }}
              >
                <div className="aspect-[3/2] relative">
                  <img
                    src={g.thumbnail_url}
                    alt={g.name}
                    onError={handleThumbError}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span
                      className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ background: "var(--mezzo-accent-green)" }}
                    >
                      <Play className="w-4 h-4 text-black" />
                    </span>
                  </div>
                  <div
                    className="absolute inset-x-0 bottom-0 p-1.5"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 100%)",
                    }}
                  >
                    <div className="text-[11px] font-semibold text-white truncate text-left">
                      {g.name}
                    </div>
                  </div>
                </div>
              </button>
            ))}
      </div>
    </div>
  );
}
