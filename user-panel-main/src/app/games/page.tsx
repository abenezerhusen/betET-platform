"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Search,
  Play,
  Maximize2,
  Minimize2,
  ArrowLeft,
} from "lucide-react";
import * as gamesApi from "@/lib/api/games";
import type { GameSummary } from "@/lib/api/types";
import { getAccessToken } from "@/lib/auth/session";

type ViewMode = "expanded" | "compact";

/**
 * Unified game record rendered in the lobby. Internal-engine games come
 * from /api/games/lobby (Aviator, JetX, Fast Keno, Multi Hot 5); external
 * provider games (Pragmatic Play / Spribe / …) come from
 * /api/games/external/list. The catalogue-style games (sports / live
 * casino / etc) keep arriving from /api/public/games.
 */
interface LobbyCard {
  key: string;
  id: string;
  name: string;
  provider: string;
  type: string;
  thumbnail_url: string;
  /** internal | external | catalog (legacy /api/public/games row) */
  source: "internal" | "external" | "catalog";
  internalSlug?: string | null;
  externalProviderId?: string;
  catalogRow?: GameSummary;
}

const GAME_ENGINE_URL =
  process.env.NEXT_PUBLIC_GAME_ENGINE_URL ?? "http://localhost:3002";

function gameThumbnail(g: GameSummary): string {
  const cfg = g.config as { thumbnail_url?: string; banner_url?: string };
  return cfg.thumbnail_url || cfg.banner_url || "/play-core-logo.png";
}

function typeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const THUMB_FALLBACK = "/play-core-logo.png";

// Swap any thumbnail that fails to load (404 / broken provider URL) for the
// PlayCore logo so the lobby never shows the browser's broken-image icon.
function handleThumbError(e: React.SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget;
  if (img.src.endsWith(THUMB_FALLBACK)) return;
  img.src = THUMB_FALLBACK;
}

export default function GamesPage() {
  const router = useRouter();
  const [cards, setCards] = useState<LobbyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeGame, setActiveGame] = useState<LobbyCard | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [externalLaunch, setExternalLaunch] = useState<{
    sessionId: string;
    launchUrl: string;
    name: string;
    provider: string;
  } | null>(null);
  const [launching, setLaunching] = useState(false);
  // Guards the one-shot auto-launch triggered by the `?play=<slug>` query
  // param (used by the navbar Aviator / JetX / Fast Keno shortcuts). Without
  // it the game would re-open every time the card list refreshes.
  const launchedFromQueryRef = useRef(false);

  const categories = ["all", ...new Set(cards.map((g) => g.type))].sort();

  const fetchGames = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const typeFilter =
        selectedCategory !== "all" && selectedCategory !== "crash" &&
        selectedCategory !== "keno" && selectedCategory !== "slot"
          ? (selectedCategory as NonNullable<
              Parameters<typeof gamesApi.listGames>[0]
            >["type"])
          : undefined;

      // Catalog games (sports / live_casino / casino / etc)
      const catalogPromise = gamesApi
        .listGames({
          page: 1,
          limit: 100,
          search: searchApplied.trim() || undefined,
          type: typeFilter,
        })
        .catch(() => ({ items: [] as GameSummary[] }));

      // Internal engine games (4 games: aviator, jetx, fast-keno, multi-hot-5)
      const lobbyPromise = gamesApi
        .getInternalGamesLobby()
        .catch(() => ({ all_games: [] }));

      // External provider games (Pragmatic Play, Spribe, …)
      const externalPromise = gamesApi
        .listExternalGames()
        .catch(() => ({ games: [] }));

      const [catalog, lobby, ext] = await Promise.all([
        catalogPromise,
        lobbyPromise,
        externalPromise,
      ]);

      const merged: LobbyCard[] = [];

      for (const g of lobby.all_games ?? []) {
        merged.push({
          key: `internal-${g.id}`,
          id: g.id,
          name: g.name,
          provider: g.provider,
          type: g.game_type ?? "casino",
          thumbnail_url: g.thumbnail_url ?? "/play-core-logo.png",
          source: "internal",
          internalSlug: g.slug ?? g.id,
        });
      }

      for (const g of ext.games ?? []) {
        merged.push({
          key: `ext-${g.provider_id}-${g.id}`,
          id: g.id,
          name: g.name,
          provider: g.provider,
          type: "casino",
          thumbnail_url: g.thumbnail_url,
          source: "external",
          externalProviderId: g.provider_id,
        });
      }

      for (const g of catalog.items ?? []) {
        // Drop catalog rows whose name collides with an internal game so we
        // don't render Aviator/JetX twice when the admin also added them as
        // casino_games rows.
        if (merged.some((m) => m.name.toLowerCase() === g.name.toLowerCase())) {
          continue;
        }
        merged.push({
          key: `cat-${g.id}`,
          id: g.id,
          name: g.name,
          provider: g.provider,
          type: g.type,
          thumbnail_url: gameThumbnail(g),
          source: "catalog",
          catalogRow: g,
        });
      }

      const filtered = searchApplied.trim()
        ? merged.filter(
            (m) =>
              m.name.toLowerCase().includes(searchApplied.toLowerCase()) ||
              m.provider.toLowerCase().includes(searchApplied.toLowerCase())
          )
        : merged;

      setCards(filtered);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load games");
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, searchApplied]);

  useEffect(() => {
    void fetchGames();
  }, [fetchGames]);

  useEffect(() => {
    const t = setTimeout(() => setSearchApplied(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filteredGames =
    selectedCategory === "all"
      ? cards
      : cards.filter((g) => g.type === selectedCategory);

  const gridClass =
    viewMode === "expanded"
      ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
      : "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3";

  const openRealPlay = async (game: LobbyCard) => {
    if (game.source === "internal") {
      // Internal engine — embed the game engine iframe directly. The game
      // engine reads the user JWT from URL and resolves the wallet itself.
      const slug = game.internalSlug ?? game.id;
      const token = typeof window !== "undefined"
        ? getAccessToken() ?? localStorage.getItem("mezzobet_access_token") ?? ""
        : "";
      const url = `${GAME_ENGINE_URL.replace(/\/$/, "")}/games/${slug}?token=${encodeURIComponent(token)}`;
      setExternalLaunch({
        sessionId: "",
        launchUrl: url,
        name: game.name,
        provider: game.provider,
      });
      return;
    }
    if (game.source === "external") {
      if (!game.externalProviderId) return;
      setLaunching(true);
      try {
        const res = await gamesApi.launchExternalGame({
          provider_id: game.externalProviderId,
          game_id: game.id,
        });
        setExternalLaunch({
          sessionId: res.session_id,
          launchUrl: res.launch_url,
          name: game.name,
          provider: game.provider,
        });
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : "Could not launch external game"
        );
      } finally {
        setLaunching(false);
      }
      return;
    }
    // Catalog row — use the existing /games/play page which wires up the
    // /api/game/session/create endpoint + iframe.
    if (game.catalogRow) {
      const c = game.catalogRow;
      if (!c.is_iframe || !c.iframe_url) {
        window.alert(
          "This title is not configured as an iframe game yet. Enable iframe + iframe URL in admin."
        );
        return;
      }
      router.push(`/games/play?gameId=${encodeURIComponent(c.id)}`);
    }
  };

  const closeLaunch = async () => {
    if (externalLaunch?.sessionId) {
      try {
        await gamesApi.endExternalGameSession(externalLaunch.sessionId);
      } catch {
        /* ignore */
      }
    }
    setExternalLaunch(null);
  };

  // Navbar shortcuts (Aviator / JetX / Fast Keno) and the dedicated game
  // routes funnel here via `/games?play=<slug>` so they use the exact same
  // launch + permission flow as clicking a card. We only auto-open a game
  // that actually exists in the loaded lobby — i.e. an Active / permitted
  // internal game — so a shortcut can never bypass the catalogue or open a
  // game that isn't allowed.
  useEffect(() => {
    if (loading || launchedFromQueryRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const play = params.get("play");
    if (!play) return;

    // Consume the param once and strip it from the URL so a refresh / back
    // doesn't re-launch the game.
    launchedFromQueryRef.current = true;
    params.delete("play");
    const qs = params.toString();
    window.history.replaceState({}, "", `/games${qs ? `?${qs}` : ""}`);

    const card = cards.find(
      (c) =>
        c.source === "internal" &&
        (c.internalSlug === play || c.id === play),
    );
    if (card) void openRealPlay(card);
    // openRealPlay is recreated each render; the ref guard keeps this a
    // one-shot effect so we intentionally exclude it from the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cards]);

  // The game engine runs inside the launch iframe. When the player taps the
  // in-game back control it posts a message asking us to close the game and
  // return to this list — instead of navigating the iframe to the engine's
  // own lobby (which would expose every game directly).
  useEffect(() => {
    let engineOrigin: string | null = null;
    try {
      engineOrigin = new URL(GAME_ENGINE_URL).origin;
    } catch {
      engineOrigin = null;
    }
    const onMessage = (event: MessageEvent) => {
      if (engineOrigin && event.origin !== engineOrigin) return;
      const data = event.data as { type?: string } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "GAME_BACK" || data.type === "SESSION_END") {
        setExternalLaunch(null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="flex flex-col min-h-[calc(100vh-120px)] md:min-h-[calc(100vh-180px)]">
      <div className="flex-1" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="p-4 border-b" style={{ borderColor: "var(--mezzo-border)" }}>
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="md:hidden inline-flex items-center gap-2 mb-3 px-2 py-1 -ml-2 rounded text-sm text-gray-200 hover:text-white hover:bg-[var(--mezzo-bg-tertiary)] transition-colors touch-target"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-semibold">Back</span>
          </button>
          <h1 className="text-2xl font-bold mb-4">Casino Games</h1>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search games..."
              className="pl-10 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)]"
            />
          </div>
        </div>

        <div
          className="flex gap-2 px-4 py-3 border-b overflow-x-auto"
          style={{ borderColor: "var(--mezzo-border)" }}
        >
          {categories.map((cat) => {
            const label = cat === "all" ? "All Games" : typeLabel(cat);
            const countAll = cards.length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === cat ? "text-black" : "text-gray-300 hover:text-white"
                }`}
                style={
                  selectedCategory === cat
                    ? { background: "var(--mezzo-accent-green)" }
                    : { background: "var(--mezzo-bg-tertiary)" }
                }
              >
                {cat === "all"
                  ? `${label}${loading ? "" : ` (${countAll})`}`
                  : label}
              </button>
            );
          })}
        </div>

        {loadError && (
          <div className="px-4 py-3 text-sm text-red-400 border-b" style={{ borderColor: "var(--mezzo-border)" }}>
            {loadError}
          </div>
        )}

        {!activeGame ? (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-gray-400">
                {loading ? "Loading…" : `${filteredGames.length} game${filteredGames.length === 1 ? "" : "s"}`}
              </div>
              <div
                className="inline-flex items-center rounded-lg p-1"
                style={{ background: "var(--mezzo-bg-tertiary)" }}
                role="group"
                aria-label="Game card size"
              >
                <button
                  type="button"
                  onClick={() => setViewMode("expanded")}
                  aria-pressed={viewMode === "expanded"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
                  style={{
                    background:
                      viewMode === "expanded"
                        ? "var(--mezzo-accent-green)"
                        : "transparent",
                    color: viewMode === "expanded" ? "#000" : "#d1d5db",
                  }}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Expanded</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("compact")}
                  aria-pressed={viewMode === "compact"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
                  style={{
                    background:
                      viewMode === "compact"
                        ? "var(--mezzo-accent-green)"
                        : "transparent",
                    color: viewMode === "compact" ? "#000" : "#d1d5db",
                  }}
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Compact</span>
                </button>
              </div>
            </div>

            <div className={gridClass}>
              {filteredGames.map((game) =>
                viewMode === "expanded" ? (
                  <ExpandedGameCard
                    key={game.key}
                    game={game}
                    onOpen={() => setActiveGame(game)}
                    onPlayReal={() => void openRealPlay(game)}
                  />
                ) : (
                  <CompactGameCard
                    key={game.key}
                    game={game}
                    onOpen={() => setActiveGame(game)}
                    onPlayReal={() => void openRealPlay(game)}
                  />
                ),
              )}
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-xl font-bold">{activeGame.name}</h2>
                <p className="text-sm text-gray-400">{activeGame.provider}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveGame(null)}
                  className="px-4 py-2 rounded"
                  style={{ background: "var(--mezzo-bg-tertiary)" }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void openRealPlay(activeGame)}
                  className="px-4 py-2 rounded font-semibold text-black"
                  style={{ background: "var(--mezzo-accent-green)" }}
                >
                  Play (real)
                </button>
              </div>
            </div>
            <div
              className="rounded-lg overflow-hidden"
              style={{ background: "var(--mezzo-bg-secondary)" }}
            >
              <div className="aspect-video flex items-center justify-center p-6">
                <div className="text-center max-w-md">
                  <div
                    className="w-24 h-24 mx-auto mb-4 rounded-full flex items-center justify-center"
                    style={{ background: "var(--mezzo-accent-green)" }}
                  >
                    <Play className="w-12 h-12 text-white" />
                  </div>
                  <p className="text-gray-300 font-medium">{activeGame.name}</p>
                  <p className="text-sm text-gray-500 mt-2">
                    Press <strong>Play (real)</strong> to launch via the platform backend with your wallet session.
                  </p>
                  {activeGame.source === "catalog" &&
                  activeGame.catalogRow &&
                  (!activeGame.catalogRow.is_iframe ||
                    !activeGame.catalogRow.iframe_url) ? (
                    <p className="text-xs text-amber-400 mt-3">
                      Admin must mark this game as iframe and set iframe URL (e.g. game engine embed URL).
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Launch iframe overlay for internal-engine + external provider games */}
      {externalLaunch && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center gap-3 p-3 bg-gray-900 text-white">
            <button
              type="button"
              onClick={() => void closeLaunch()}
              aria-label="Back to games"
              className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="font-semibold truncate">{externalLaunch.name}</span>
          </div>
          <iframe
            src={externalLaunch.launchUrl}
            className="flex-1 w-full border-0"
            allow="fullscreen autoplay payment"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
            title={externalLaunch.name}
          />
        </div>
      )}

      {launching && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
            <p>Loading game…</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface GameCardProps {
  game: LobbyCard;
  onOpen: () => void;
  onPlayReal: () => void;
}

function ExpandedGameCard({ game, onOpen, onPlayReal }: GameCardProps) {
  const thumb = game.thumbnail_url;
  const playable =
    game.source === "internal" ||
    game.source === "external" ||
    Boolean(game.catalogRow?.is_iframe && game.catalogRow?.iframe_url);
  return (
    <div
      className="group relative rounded-xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.02] shadow-lg"
      style={{ background: "var(--mezzo-bg-secondary)" }}
      onClick={onOpen}
    >
      <div className="aspect-[3/2] relative">
        <img
          src={thumb}
          alt={game.name}
          onError={handleThumbError}
          loading="lazy"
          className="w-full h-full object-cover"
        />
        <span
          className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[11px] font-semibold"
          style={{
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            backdropFilter: "blur(4px)",
          }}
        >
          {typeLabel(game.type)}
        </span>
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 flex-wrap px-2">
          <button
            type="button"
            className="px-5 py-2 rounded-full flex items-center gap-2 text-black font-semibold text-sm"
            style={{ background: "var(--mezzo-accent-green)" }}
            onClick={(e) => {
              e.stopPropagation();
              onPlayReal();
            }}
            disabled={!playable}
          >
            <Play className="w-4 h-4" />
            Play
          </button>
        </div>
      </div>
      <div className="p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-base truncate">{game.name}</h3>
          <p className="text-xs text-gray-400 truncate">{game.provider}</p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlayReal();
          }}
          disabled={!playable}
          aria-label={`Play ${game.name}`}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-110 disabled:opacity-40"
          style={{ background: "var(--mezzo-accent-green)" }}
        >
          <Play className="w-4 h-4 text-black" />
        </button>
      </div>
    </div>
  );
}

function CompactGameCard({ game, onOpen, onPlayReal }: GameCardProps) {
  const thumb = game.thumbnail_url;
  const playable =
    game.source === "internal" ||
    game.source === "external" ||
    Boolean(game.catalogRow?.is_iframe && game.catalogRow?.iframe_url);
  return (
    <div
      className="group relative rounded-lg overflow-hidden cursor-pointer transition-transform hover:scale-105"
      style={{ background: "var(--mezzo-bg-secondary)" }}
      onClick={onOpen}
      title={`${game.name} — ${game.provider}`}
    >
      <div className="aspect-[3/2] relative">
        <img
          src={thumb}
          alt={game.name}
          onError={handleThumbError}
          loading="lazy"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            type="button"
            disabled={!playable}
            className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40"
            style={{ background: "var(--mezzo-accent-green)" }}
            onClick={(e) => {
              e.stopPropagation();
              onPlayReal();
            }}
          >
            <Play className="w-4 h-4 text-black" />
          </button>
        </div>
        <div
          className="absolute inset-x-0 bottom-0 p-2"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 100%)",
          }}
        >
          <div className="text-[11px] font-semibold text-white truncate">{game.name}</div>
        </div>
      </div>
    </div>
  );
}
