/**
 * HTTP client shared by every admin-panel API module.
 *
 * Behaviour:
 *  - reads `VITE_API_BASE_URL` and `VITE_TENANT_ID` from the build env
 *  - injects `x-tenant-id` on every request
 *  - injects `Authorization: Bearer <access>` from the persisted auth store
 *  - on `401 / Access token expired`, transparently calls /auth/refresh once
 *    and retries the original request
 *  - on permanent auth failure, calls `logout()` so the UI bounces to /login
 *  - throws an ApiError with the JSON body attached, so callers can show a
 *    useful toast.
 *
 * The module is intentionally framework-agnostic: it imports from
 * `../../store/auth` (zustand) but only via the public `getState()` /
 * `setState()` surface, so it works inside React components and from
 * non-React utility code.
 */

import { useAuthStore } from '../../store/auth';

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:4000';

export const TENANT_ID: string =
  (import.meta.env.VITE_TENANT_ID as string | undefined) ?? 'default';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  /** When false, omits Authorization header even if a token exists. */
  auth?: boolean;
  /** Override the tenant header for this request. */
  tenantId?: string;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(
    path.startsWith('http') ? path : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  );
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
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
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (typeof b.message === 'string') return b.message;
    if (typeof b.error === 'string') return b.error;
    if (typeof b.reason === 'string') return b.reason;
  }
  if (typeof body === 'string' && body) return body;
  return fallback;
}

/**
 * Detect "access token expired" responses across the small variety the
 * backend may emit. The error-handler middleware standardises on
 * `{ message: "Access token expired" }` with a 401 status, but we also
 * accept 403/expired-token bodies defensively.
 */
function isTokenExpired(status: number, body: unknown): boolean {
  if (status !== 401 && status !== 403) return false;
  if (!body || typeof body !== 'object') return false;
  const msg = String((body as Record<string, unknown>).message ?? '').toLowerCase();
  const reason = String((body as Record<string, unknown>).reason ?? '').toLowerCase();
  return (
    msg.includes('access token expired') ||
    msg.includes('token expired') ||
    msg === 'jwt expired' ||
    reason.includes('expired')
  );
}

async function rawRequest(
  path: string,
  opts: RequestOptions,
  accessTokenOverride?: string | null
): Promise<{ status: number; body: unknown; ok: boolean }> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  if (opts.body !== undefined && method !== 'GET') {
    headers['content-type'] = 'application/json';
  }

  const tenant = opts.tenantId ?? TENANT_ID;
  if (tenant) headers['x-tenant-id'] = tenant;

  if (opts.auth !== false) {
    const token =
      accessTokenOverride !== undefined
        ? accessTokenOverride
        : useAuthStore.getState().accessToken;
    if (token) headers['authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: opts.body === undefined || method === 'GET' ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
    credentials: 'omit',
  });

  const body = await parseBody(res);
  return { status: res.status, body, ok: res.ok };
}

/**
 * In-flight refresh promise so concurrent 401s only trigger one refresh.
 */
let refreshInFlight: Promise<string | null> | null = null;
let sessionExpiredRedirecting = false;

function handleSessionExpiredRedirect(): void {
  if (typeof window === 'undefined' || sessionExpiredRedirecting) return;
  sessionExpiredRedirecting = true;
  useAuthStore.getState().logout();
  window.location.href = '/login?reason=session_expired';
}

async function performRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = useAuthStore
      .getState()
      .refreshAccessToken()
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function request<T = unknown>(
  path: string,
  opts: RequestOptions = {}
): Promise<T> {
  const hasSessionToken = Boolean(useAuthStore.getState().accessToken);
  const first = await rawRequest(path, opts);
  if (first.ok) return first.body as T;

  // Try a single refresh + retry on token-expired responses.
  if (opts.auth !== false && hasSessionToken && isTokenExpired(first.status, first.body)) {
    const newToken = await performRefresh();
    if (newToken) {
      const retry = await rawRequest(path, opts, newToken);
      if (retry.ok) return retry.body as T;
      if (retry.status === 401) handleSessionExpiredRedirect();
      throw new ApiError(
        retry.status,
        messageFromBody(retry.body, `Request failed (${retry.status})`),
        retry.body
      );
    }
    // Refresh failed — the auth store has already cleared itself.
  }

  if (first.status === 401 && opts.auth !== false && hasSessionToken) {
    handleSessionExpiredRedirect();
  }

  throw new ApiError(
    first.status,
    messageFromBody(first.body, `Request failed (${first.status})`),
    first.body
  );
}

export const http = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
