/**
 * HTTP client for the user panel.
 *
 * Responsibilities:
 *   - Always attach the tenant header (multi-tenant backend)
 *   - Attach the bearer access-token (when one exists)
 *   - Transparently refresh the access-token using the long-lived refresh-token
 *   - Convert non-2xx responses into a typed `ApiError`
 *
 * No third-party fetcher (axios/SWR) is pulled in here so the user panel can
 * keep its dependency footprint minimal.
 */

import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getSnapshot,
  setSession,
} from '../auth/session';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:4000';
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID?.trim() || 'default';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip Authorization header even if a token is present (login, refresh). */
  skipAuth?: boolean;
  /** When true, do not attempt to refresh the access token on a 401. */
  skipRefresh?: boolean;
  /** Optional tenant override (e.g. for super-admin tooling). */
  tenantId?: string;
  /** Optional query params helper. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /**
   * In-memory response cache TTL (ms) for GET requests. Use ONLY for static
   * or slow-changing data (config, catalogs, country/league lists). NEVER set
   * this on real-time betting data (odds, live matches, wallet, open bets).
   * Any successful mutating request (POST/PUT/PATCH/DELETE) clears the cache.
   */
  cacheTtl?: number;
  /** Disable in-flight de-duplication of identical concurrent GETs. */
  noDedupe?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = API_BASE_URL.replace(/\/+$/u, '');
  const norm = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${norm}`;
  if (!query) return url;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${url}?${s}` : url;
}

let refreshPromise: Promise<boolean> | null = null;
let sessionExpiredRedirecting = false;

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(buildUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': TENANT_ID,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      credentials: 'include',
    });
    if (!res.ok) return false;
    const raw = (await res.json()) as Record<string, unknown> & {
      access_token?: string;
      refresh_token?: string;
      access_token_expires_at?: string;
      refresh_token_expires_at?: string;
      user?: {
        id: string;
        tenant_id: string;
        role: string;
        email: string | null;
        phone: string | null;
      };
      data?: typeof raw;
    };
    const payload = (raw.data ?? raw) as typeof raw;
    if (!payload.access_token) return false;
    setSession({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? refreshToken,
      accessTokenExpiresAt: payload.access_token_expires_at ?? null,
      refreshTokenExpiresAt: payload.refresh_token_expires_at ?? null,
      user: payload.user ?? getSnapshot().user,
    });
    return true;
  } catch {
    return false;
  }
}

function refreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function redirectToSessionExpired(): void {
  if (typeof window === 'undefined' || sessionExpiredRedirecting) return;
  sessionExpiredRedirecting = true;
  clearSession();
  window.location.href = '/?session_expired=true';
}

/**
 * In-flight de-duplication + opt-in response cache.
 *
 * - `inFlight` coalesces identical concurrent GETs into a single network
 *   request, so a page that mounts several components all asking for the same
 *   catalog only hits the backend once.
 * - `memo` is a tiny TTL cache used only when a caller passes `cacheTtl`.
 *   It is wiped on any successful mutation to avoid serving stale data.
 */
const inFlight = new Map<string, Promise<unknown>>();
const memo = new Map<string, { expires: number; value: unknown }>();

function cacheKeyFor(method: string, url: string, tenant: string): string {
  return `${method} ${url} ${tenant}`;
}

/** Clear the opt-in GET cache (called automatically after mutations). */
export function clearApiCache(): void {
  memo.clear();
}

async function parseError(res: Response): Promise<never> {
  let message = `Request failed: ${res.status}`;
  let code: string | undefined;
  let details: unknown;
  try {
    const data = (await res.json()) as {
      error?: string | { message?: string; code?: string; details?: unknown };
      message?: string;
      details?: unknown;
    };
    if (typeof data?.error === 'object' && data.error !== null) {
      message = data.error.message ?? message;
      code = data.error.code;
      details = data.error.details ?? data.details;
    } else if (typeof data?.error === 'string') {
      code = data.error;
      message = data.message ?? message;
      details = data.details;
    } else if (data?.message) {
      message = data.message;
      details = data.details;
    }
  } catch {
    /* ignore */
  }
  throw new ApiError(message, res.status, code, details);
}

/** Performs the actual network round-trip (with 401 refresh + parsing). */
async function performRequest<T>(
  path: string,
  opts: RequestOptions,
  finalUrl: string
): Promise<T> {
  const {
    body,
    headers = {},
    skipAuth = false,
    skipRefresh = false,
    tenantId,
    // `query` is already baked into `finalUrl`; pull it out so it never lands
    // in `rest` (which is spread into fetch's RequestInit).
    query: _query,
    cacheTtl: _cacheTtl,
    noDedupe: _noDedupe,
    method = body !== undefined ? 'POST' : 'GET',
    ...rest
  } = opts;

  const finalHeaders: Record<string, string> = {
    'x-tenant-id': tenantId || TENANT_ID,
    accept: 'application/json',
    ...headers,
  };

  let serializedBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      serializedBody = body;
    } else {
      finalHeaders['content-type'] = finalHeaders['content-type'] ?? 'application/json';
      serializedBody = JSON.stringify(body);
    }
  }

  if (!skipAuth) {
    const token = getAccessToken();
    if (token) finalHeaders.authorization = `Bearer ${token}`;
  }

  const res = await fetch(finalUrl, {
    method,
    headers: finalHeaders,
    body: serializedBody,
    credentials: 'include',
    ...rest,
  });

  if (res.status === 401 && !skipAuth && !skipRefresh) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      return performRequest<T>(path, { ...opts, skipRefresh: true }, finalUrl);
    }
    redirectToSessionExpired();
  }

  if (!res.ok) await parseError(res);

  // A successful mutation can change server state any cached GET depends on,
  // so invalidate the opt-in cache to keep subsequent reads correct.
  if (method !== 'GET' && method !== 'HEAD') clearApiCache();

  if (res.status === 204) return undefined as unknown as T;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return undefined as unknown as T;
  const data = (await res.json()) as unknown;
  if (data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
    return (data as { data: T }).data;
  }
  return data as T;
}

export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {}
): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const finalUrl = buildUrl(path, opts.query);
  const isGet = method === 'GET';
  // Caller-supplied AbortSignals make a shared promise unsafe to reuse, so we
  // never dedupe/cache those requests.
  const cacheable = isGet && !opts.signal;
  const key = cacheKeyFor(method, finalUrl, opts.tenantId || TENANT_ID);

  if (cacheable && opts.cacheTtl) {
    const hit = memo.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
  }

  if (cacheable && !opts.noDedupe) {
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const exec = performRequest<T>(path, opts, finalUrl).then((value) => {
    if (cacheable && opts.cacheTtl) {
      memo.set(key, { value, expires: Date.now() + opts.cacheTtl });
    }
    return value;
  });

  if (cacheable && !opts.noDedupe) {
    inFlight.set(key, exec as Promise<unknown>);
    void exec.finally(() => {
      if (inFlight.get(key) === (exec as Promise<unknown>)) inFlight.delete(key);
    });
  }

  return exec;
}

export const apiConfig = {
  baseUrl: API_BASE_URL,
  tenantId: TENANT_ID,
};
