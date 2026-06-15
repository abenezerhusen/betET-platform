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
    const fromUrl = url.searchParams.get("token");
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
  if (!isLocalHost()) return null;
  return fetchDevGameToken();
}

/* ------------------------------------------------------------------------ */
/* Authenticated fetch                                                      */
/* ------------------------------------------------------------------------ */

async function authedRequest<T>(
  path: string,
  init: RequestInit = {}
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

/* ------------------------------------------------------------------------ */
/* Fast Keno                                                                */
/* ------------------------------------------------------------------------ */

export interface KenoRoundSnapshot {
  round_id: string | null;
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

  if (sharedSocket && sharedSocket.connected) {
    if (room) sharedSocket.emit("join", room);
    return sharedSocket;
  }

  if (sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
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
  betting_seconds: number;
}

export interface KenoNumberDrawnEvent {
  round_id: string;
  number: number;
  position: number;
}

export interface KenoRoundCompleteEvent {
  round_id: string;
  all_numbers: number[];
  server_seed: string | null;
}
