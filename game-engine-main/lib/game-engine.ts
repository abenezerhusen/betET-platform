/**
 * Section 17 — Game Engine integration layer
 * ------------------------------------------
 * Centralises every backend touchpoint the in-iframe game pages need:
 *
 *   • token handling  — the user-panel opens the game in an iframe with
 *                       `?token=<jwt>`. We persist it in sessionStorage for
 *                       the lifetime of the tab so reloads keep working.
 *   • REST helpers    — `/api/users/me`, place-bet / cashout / spin for the
 *                       four canonical internal games (aviator, jetx,
 *                       fast-keno, multi-hot-5) plus the public lobby.
 *   • socket.io       — single shared connection with JWT handshake. Game
 *                       pages subscribe via `subscribeGameEvents`.
 *
 * NO `Math.random()` is used here — every outcome (crash point, drawn
 * numbers, reel symbols) must originate from the backend per the spec.
 */
import { io, type Socket } from "socket.io-client";

import { apiRequest, ApiError } from "./api";

/* ------------------------------------------------------------------------ */
/* Configuration                                                            */
/* ------------------------------------------------------------------------ */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:4000";

const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "default";

const TOKEN_KEY = "game_engine_token";

/* ------------------------------------------------------------------------ */
/* Token management                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Read the access token. Order of precedence:
 *   1. URL `?token=` (freshly minted by the user panel iframe wrapper)
 *   2. sessionStorage (persists across reloads inside the same tab)
 *   3. legacy localStorage keys used by the rest of the platform
 *
 * Whenever a URL token is found we move it into sessionStorage so the
 * URL bar stays clean and reloads stay authenticated.
 */
export function readGameToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("token")?.trim();
    if (fromUrl) {
      try {
        window.sessionStorage.setItem(TOKEN_KEY, fromUrl);
        url.searchParams.delete("token");
        window.history.replaceState({}, "", url.toString());
      } catch {
        /* ignore — non-secure context may block storage */
      }
      return fromUrl;
    }
  } catch {
    /* ignore — bad URL */
  }
  try {
    const stored = window.sessionStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  try {
    const raw = window.localStorage.getItem("betet.user.auth");
    if (raw) {
      const parsed = JSON.parse(raw) as { accessToken?: string };
      if (parsed.accessToken) return parsed.accessToken;
    }
    const direct = window.localStorage.getItem("1birr_access_token");
    if (direct) return direct;
  } catch {
    /* ignore */
  }
  return null;
}

export function clearGameToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function isLocalHost(): boolean {
  if (typeof window === "undefined") return false;
  return LOCAL_HOSTS.has(window.location.hostname);
}

/**
 * Ask the backend for a development player token. Only meaningful on a
 * local machine — the backend route returns 400 on production builds. The
 * fetched token is stashed in sessionStorage so the rest of the page (REST
 * + socket) picks it up exactly like a user-panel launch token.
 */
async function fetchDevGameToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/dev/game-token`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-tenant-id": TENANT_ID,
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string };
    const token = body.access_token ?? null;
    if (token && typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* ignore */
      }
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * Resolve a usable game token, guaranteeing the game can always open:
 *   • Live / user-panel launch  → the iframe `?token=` (or stored) token.
 *   • Local development direct   → auto-mint a seeded player token so the
 *     engine opens and is playable without the user-panel handshake.
 *
 * Returns null only when no token exists and we're not on a local host
 * (i.e. a misconfigured live launch) — callers then surface the normal
 * unauthenticated state.
 */
export async function ensureGameToken(): Promise<string | null> {
  const existing = readGameToken();
  if (existing) return existing;
  // Embedded from the user panel — must receive ?token= from the parent.
  // Never mint a dev token here; that would show the wrong player's wallet.
  if (typeof window !== "undefined" && window.self !== window.top) {
    return null;
  }
  if (!isLocalHost()) return null;
  return fetchDevGameToken();
}

/** Re-fetch balance when the backend pushes WALLET_UPDATED (sportsbook bets,
 *  admin credits, other tabs, etc.). */
export function onWalletUpdated(cb: () => void): () => void {
  const socket = connectGameSocket();
  if (!socket) return () => {};
  const handler = () => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  };
  socket.on("WALLET_UPDATED", handler);
  return () => {
    socket.off("WALLET_UPDATED", handler);
  };
}

/**
 * When the game engine runs inside the user-panel iframe, the parent can
 * push the logged-in player's token + wallet balance via postMessage
 * (see user-panel games page). This gives an immediate balance while the
 * REST `/api/users/me` call completes and covers edge cases where the
 * iframe cannot reach the API on first paint.
 */
export function listenEmbeddedWalletInit(
  onInit: (data: { balance: number; token?: string }) => void
): () => void {
  if (typeof window === "undefined" || window.self === window.top) {
    return () => {};
  }
  const handler = (ev: MessageEvent) => {
    const d = ev.data as { type?: string; balance?: unknown; token?: unknown } | null;
    if (!d || typeof d !== "object" || d.type !== "WALLET_INIT") return;
    const parentOrigin = process.env.NEXT_PUBLIC_PARENT_ORIGIN?.trim();
    if (parentOrigin && parentOrigin !== "*" && ev.origin !== parentOrigin) {
      return;
    }
    const balance = Number(d.balance);
    if (Number.isFinite(balance)) {
      onInit({ balance, token: typeof d.token === "string" ? d.token : undefined });
    }
    if (typeof d.token === "string" && d.token.trim()) {
      try {
        window.sessionStorage.setItem(TOKEN_KEY, d.token.trim());
      } catch {
        /* ignore */
      }
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/* ------------------------------------------------------------------------ */
/* Authenticated fetch                                                      */
/* ------------------------------------------------------------------------ */

/**
 * When embedded in the user panel the game holds only a short-lived access
 * token (handed over via `?token=`). Once it expires every REST call 401s.
 * The parent panel keeps the refresh token, so we ask it to mint a fresh
 * access token and post it back (`TOKEN_REFRESH` / `WALLET_INIT`). Running
 * standalone on a local host we fall back to a dev token instead.
 *
 * Concurrent callers share a single in-flight request so an expired token
 * only triggers one refresh handshake.
 */
let pendingTokenRefresh: Promise<string | null> | null = null;

function requestParentTokenRefresh(): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  // Standalone (not in an iframe) — no parent to ask; try a dev token locally.
  if (window.self === window.top) {
    return isLocalHost() ? fetchDevGameToken() : Promise.resolve(null);
  }
  if (pendingTokenRefresh) return pendingTokenRefresh;

  pendingTokenRefresh = new Promise<string | null>((resolve) => {
    const parentOrigin = process.env.NEXT_PUBLIC_PARENT_ORIGIN?.trim();
    let settled = false;
    const finish = (tok: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      pendingTokenRefresh = null;
      resolve(tok);
    };
    const onMsg = (ev: MessageEvent) => {
      if (parentOrigin && parentOrigin !== "*" && ev.origin !== parentOrigin) {
        return;
      }
      const d = ev.data as { type?: string; token?: unknown } | null;
      if (!d || typeof d !== "object") return;
      if (d.type !== "TOKEN_REFRESH" && d.type !== "WALLET_INIT") return;
      if (typeof d.token === "string" && d.token.trim()) {
        const tok = d.token.trim();
        try {
          window.sessionStorage.setItem(TOKEN_KEY, tok);
        } catch {
          /* ignore */
        }
        finish(tok);
      }
    };
    window.addEventListener("message", onMsg);
    const timer = setTimeout(() => finish(null), 8000);
    try {
      window.parent.postMessage(
        { type: "GAME_TOKEN_REFRESH_REQUEST", source: "game", ts: Date.now() },
        parentOrigin || "*"
      );
    } catch {
      finish(null);
    }
  });
  return pendingTokenRefresh;
}

async function authedRequest<T>(
  path: string,
  init: RequestInit = {},
  retryOnAuthError = true
): Promise<T> {
  const token = readGameToken();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-tenant-id", TENANT_ID);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (token) headers.set("authorization", `Bearer ${token}`);

  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  const body: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    // Access token expired mid-session: ask the parent panel for a fresh
    // token and replay the request once before surfacing an error.
    if (res.status === 401 && retryOnAuthError) {
      const fresh = await requestParentTokenRefresh();
      if (fresh) {
        return authedRequest<T>(path, init, false);
      }
    }
    const msg =
      (body &&
        typeof body === "object" &&
        (body as Record<string, unknown>).message) ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, String(msg), body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ------------------------------------------------------------------------ */
/* User profile + balance                                                   */
/* ------------------------------------------------------------------------ */

export interface PlayerMe {
  profile: {
    id: string;
    username?: string | null;
    full_name?: string | null;
    phone?: string | null;
  };
  wallets: Array<{ currency: string; balance: string | number }>;
}

export async function fetchPlayerMe(): Promise<PlayerMe> {
  return authedRequest<PlayerMe>("/api/users/me");
}

export function readBalance(me: PlayerMe | null, currency = "ETB"): number {
  if (!me) return 0;
  const row =
    me.wallets.find((w) => (w.currency ?? "").toUpperCase() === currency) ??
    me.wallets[0];
  return Number(row?.balance ?? 0);
}

/* ------------------------------------------------------------------------ */
/* Lobby                                                                    */
/* ------------------------------------------------------------------------ */

export interface LobbyGame {
  id: string;
  name: string;
  provider: string;
  slug: string | null;
  thumbnail_url: string | null;
  game_type: string;
  min_bet: number;
  max_bet: number;
  rtp: number;
}

export interface LobbyResponse {
  top_games: LobbyGame[];
  new_games: LobbyGame[];
  popular_games: LobbyGame[];
  all_games: LobbyGame[];
}

export async function fetchLobby(): Promise<LobbyResponse> {
  return apiRequest<LobbyResponse>("/api/games/lobby", { auth: false });
}

export interface GameLimits {
  min_bet: number;
  max_bet: number;
}

/**
 * Fetch the admin-configured bet limits (Minimum Bet / Maximum Bet) for a
 * single internal game. The public lobby already exposes per-game
 * `min_bet`/`max_bet`, so we read it and pick the matching game. Returns
 * `null` on any failure so callers keep their built-in defaults instead of
 * breaking play when the config endpoint is briefly unavailable.
 */
export async function fetchGameLimits(gameId: string): Promise<GameLimits | null> {
  try {
    const lobby = await fetchLobby();
    const all = [
      ...(lobby.all_games ?? []),
      ...(lobby.top_games ?? []),
      ...(lobby.new_games ?? []),
      ...(lobby.popular_games ?? []),
    ];
    const g = all.find((x) => x.id === gameId);
    if (!g) return null;
    const min = Number(g.min_bet);
    const max = Number(g.max_bet);
    return {
      min_bet: Number.isFinite(min) && min > 0 ? min : 0,
      max_bet: Number.isFinite(max) && max > 0 ? max : 0,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Aviator                                                                  */
/* ------------------------------------------------------------------------ */

export interface AviatorRoundSnapshot {
  round_id: string | null;
  phase: "waiting" | "flying" | "crashed" | string;
  server_seed_hash?: string;
  client_seed?: string;
  started_at?: string;
  current_multiplier?: number | null;
  crash_point?: number | null;
}

export async function getAviatorRound(): Promise<AviatorRoundSnapshot> {
  return authedRequest<AviatorRoundSnapshot>("/api/games/aviator/round/current");
}

export interface AviatorBetResponse {
  bet_id: string;
  round_id: string;
  amount: number;
  balance_after: number;
}

export async function placeAviatorBet(input: {
  round_id: string;
  amount: number;
  auto_cashout?: number;
}): Promise<AviatorBetResponse> {
  return authedRequest<AviatorBetResponse>("/api/games/aviator/bet", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface AviatorCashoutResponse {
  payout: number;
  multiplier_at_cashout: number;
  balance_after: number;
}

export async function cashoutAviator(input: {
  bet_id: string;
  round_id: string;
}): Promise<AviatorCashoutResponse> {
  return authedRequest<AviatorCashoutResponse>("/api/games/aviator/cashout", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ---- Aviator sidebar stats (real data) --------------------------------- */

/** One row in the All Bets / Previous feed. `multiplier`/`won` are null while
 *  the bet is still active or was lost. */
export interface AviatorBetRow {
  user: string; // masked, e.g. "d***v"
  bet: number;
  multiplier: number | null;
  won: number | null;
}

export interface AviatorBetsResponse {
  current: AviatorBetRow[];
  previous: AviatorBetRow[];
  recent_multipliers: number[];
}

/** Live + previous round bets plus the recent crash-point strip. */
export async function getAviatorBets(): Promise<AviatorBetsResponse> {
  return authedRequest<AviatorBetsResponse>("/api/games/aviator/bets");
}

export type AviatorTopMetric = "x" | "win" | "rounds";
export type AviatorTopPeriod = "day" | "month" | "year";

export interface AviatorTopPlayer {
  user: string;
  date: string;
  betETB: number;
  winETB: number;
  result: number;
  roundMax: number;
}

export interface AviatorTopRound {
  dateTime: string;
  multiplier: number;
}

export interface AviatorTopResponse {
  metric: AviatorTopMetric;
  period: AviatorTopPeriod;
  items: AviatorTopPlayer[] | AviatorTopRound[];
}

/** "Top" tab: biggest multipliers / wins / round crash-points for a period. */
export async function getAviatorTop(
  metric: AviatorTopMetric,
  period: AviatorTopPeriod
): Promise<AviatorTopResponse> {
  return authedRequest<AviatorTopResponse>(
    `/api/games/aviator/top?metric=${metric}&period=${period}`
  );
}

/* ------------------------------------------------------------------------ */
/* Fast Keno                                                                */
/* ------------------------------------------------------------------------ */

export interface KenoRoundSnapshot {
  round_id: string | null;
  /** 8-digit human-readable round Game ID (game_rounds.game_code). */
  game_code?: string | null;
  phase: "betting" | "drawing" | "complete" | string;
  numbers_drawn: number[];
  time_remaining: number;
}

export async function getKenoRound(): Promise<KenoRoundSnapshot> {
  return authedRequest<KenoRoundSnapshot>("/api/games/keno/round/current");
}

export interface KenoBetResponse {
  bet_id: string;
  balance_after: number;
}

export async function placeKenoBet(input: {
  round_id: string;
  selected_numbers: number[];
  spots: number;
  amount: number;
}): Promise<KenoBetResponse> {
  return authedRequest<KenoBetResponse>("/api/games/keno/bet", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ------------------------------------------------------------------------ */
/* Slots — Multi Hot 5                                                      */
/* ------------------------------------------------------------------------ */

export interface SlotsSpinResponse {
  round_id: string;
  game_code?: string; // 8-digit human-readable Game ID for this round
  reels: string[][]; // outer = reel index, inner = symbols (length 3 per reel)
  win_lines: number[];
  multiplier: number; // multiplier reel value (1–5) chosen server-side
  total_payout: number;
  balance_after: number;
  server_seed_hash: string;
  server_seed: string;
  client_seed: string;
}

export async function spinSlots(input: {
  game_id: "multi-hot-5";
  bet_per_line: number;
  lines: number;
}): Promise<SlotsSpinResponse> {
  return authedRequest<SlotsSpinResponse>("/api/games/slots/spin", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ------------------------------------------------------------------------ */
/* Rain Bonus                                                               */
/* ------------------------------------------------------------------------ */

export type RainGameId = "fast-keno" | "aviator";

/** A live rain event as advertised to players. */
export interface RainActive {
  id: string;
  game: RainGameId;
  currency: string;
  /** Advertised per-claim amount (equal) or the remaining pool (random). */
  amount: number;
  distribution: "equal" | "random";
  remaining_claims: number;
  total_claims: number;
  closes_at: number;
  seconds_left: number;
}

/** Broadcast when a new rain opens (payload matches RainActive). */
export type RainOpenEvent = RainActive;

/** Broadcast when a rain closes. */
export interface RainClosedEvent {
  id: string;
  game: RainGameId;
  reason: "expired" | "depleted" | "disabled";
}

/** Emitted to a specific player after they successfully claim. */
export interface RainClaimedEvent {
  rain_id: string;
  game: RainGameId;
  amount: number;
  currency: string;
}

export interface RainClaimResponse {
  ok: boolean;
  amount: number;
  currency: string;
  credit_target: "bonus" | "main";
  balance_after: number;
  rain_id: string;
}

/** Fetch the currently claimable rain for a game (null when none). */
export async function getActiveRain(game: RainGameId): Promise<RainActive | null> {
  const res = await authedRequest<{ active: RainActive | null }>(
    `/api/games/rain/active?game=${encodeURIComponent(game)}`
  );
  return res.active ?? null;
}

/** Claim the live rain for a game. Throws ApiError on ineligibility. */
export async function claimRain(game: RainGameId): Promise<RainClaimResponse> {
  return authedRequest<RainClaimResponse>("/api/games/rain/claim", {
    method: "POST",
    body: JSON.stringify({ game }),
  });
}

/* ------------------------------------------------------------------------ */
/* Socket.io                                                                */
/* ------------------------------------------------------------------------ */

let sharedSocket: Socket | null = null;

/**
 * Connect (or reuse) a single Socket.io connection authenticated with the
 * current player JWT. The backend auto-joins each socket to the tenant
 * broadcast room used by all game workers, so the only thing the page has
 * to do is listen for the documented `aviator:*` / `keno:*` events.
 *
 * The optional `room` argument is forwarded as a legacy `socket.emit('join',
 * room)` for compatibility with the spec wording "joins room 'aviator'".
 */
export function connectGameSocket(room?: "aviator" | "keno" | "live_betting"): Socket | null {
  if (typeof window === "undefined") return null;
  const token = readGameToken();
  if (!token) return null;

  // Reuse the existing shared socket whether it is already connected OR still
  // handshaking. Multiple consumers (e.g. the game page + the Rain popup) call
  // this concurrently on mount; tearing a connecting socket down here would
  // orphan the first caller's listeners and stall the game. Socket.io
  // auto-reconnects (reconnectionAttempts: Infinity), so a temporarily
  // disconnected shared socket recovers on its own — never recreate it.
  if (sharedSocket) {
    if (room && sharedSocket.connected) sharedSocket.emit("join", room);
    return sharedSocket;
  }

  const socket = io(API_BASE_URL, {
    transports: ["websocket", "polling"],
    auth: { token },
    query: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
  });

  socket.on("connect", () => {
    if (room) socket.emit("join", room);
  });

  sharedSocket = socket;
  return socket;
}

export function disconnectGameSocket(): void {
  if (sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }
}

/* ------------------------------------------------------------------------ */
/* Aviator round-state helpers                                              */
/* ------------------------------------------------------------------------ */

export interface AviatorRoundStartEvent {
  round_id: string;
  server_seed_hash: string;
  client_seed: string;
  phase: "waiting";
  waiting_seconds: number;
}

export interface AviatorRoundFlyingEvent {
  round_id: string;
  multiplier: number;
}

export interface AviatorRoundCrashedEvent {
  round_id: string;
  crash_point: number;
  server_seed: string | null;
}

export interface KenoRoundStartEvent {
  round_id: string;
  /** 8-digit human-readable round Game ID. */
  game_code?: string;
  betting_seconds: number;
  /** Live players online (base 100 + real extra connections). */
  online?: number;
}

export interface KenoOnlineEvent {
  online: number;
}

export interface KenoNumberDrawnEvent {
  round_id: string;
  number: number;
  position: number;
}

export interface KenoRoundCompleteEvent {
  round_id: string;
  /** 8-digit human-readable round Game ID. */
  game_code?: string;
  all_numbers: number[];
  server_seed: string | null;
}
