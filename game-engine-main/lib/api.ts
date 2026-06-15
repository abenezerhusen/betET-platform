const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

const DEFAULT_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "default";
let sessionExpiredRedirecting = false;

interface AuthSnapshotLike {
  accessToken?: string | null;
}

function getUserAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("betet.user.auth");
    if (!raw) return window.localStorage.getItem("1birr_access_token");
    const parsed = JSON.parse(raw) as AuthSnapshotLike;
    return parsed.accessToken ?? window.localStorage.getItem("1birr_access_token");
  } catch {
    return window.localStorage.getItem("1birr_access_token");
  }
}

function clearUserSessionStorage(): void {
  if (typeof window === "undefined") return;
  const keys = [
    "betet.user.auth",
    "1birr_access_token",
    "1birr_refresh_token",
    "1birr_logged_in",
    "1birr_balance",
    "1birr_bonus_balance",
    "1birr_current_user",
    "1birr_current_user_fullname",
    "user_token",
    "user_data",
  ];
  for (const key of keys) window.localStorage.removeItem(key);
}

function redirectToSessionExpired(): void {
  if (typeof window === "undefined" || sessionExpiredRedirecting) return;
  sessionExpiredRedirecting = true;
  clearUserSessionStorage();
  window.location.href = "/?session_expired=true";
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const r = body as Record<string, unknown>;
    if (typeof r.message === "string") return r.message;
    if (typeof r.error === "string") return r.error;
  }
  return fallback;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & {
    tenantId?: string;
    auth?: boolean;
    query?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("x-tenant-id", options.tenantId ?? DEFAULT_TENANT_ID);
  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (options.auth !== false) {
    const token = getUserAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }

  const qs = new URLSearchParams();
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}${suffix}`;

  const { query: _query, ...fetchOptions } = options;
  const res = await fetch(url, { ...fetchOptions, headers });
  const body = await parseBody(res);
  if (res.status === 401 && options.auth !== false) {
    redirectToSessionExpired();
    throw new ApiError(401, "Session expired", body);
  }
  if (!res.ok) {
    throw new ApiError(res.status, messageFromBody(body, `Request failed (${res.status})`), body);
  }
  return body as T;
}

export interface GameSummary {
  id: string;
  provider: string;
  name: string;
  type: string;
  is_active: boolean;
  is_iframe: boolean;
  iframe_url: string | null;
  status: string;
}

export async function listGames(query: {
  page?: number;
  limit?: number;
  type?: string;
  provider?: string;
  search?: string;
} = {}): Promise<{ items: GameSummary[]; total: number; page: number; limit: number; pages: number }> {
  return apiRequest("/api/public/games", {
    auth: false,
    query: query as Record<string, string | number | undefined>,
  });
}
