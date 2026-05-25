/**
 * Browser-side auth-token storage for the user panel.
 *
 * Why a custom module instead of Zustand:
 *   the user panel is a Next.js 15 app with server components, so we keep the
 *   token storage strictly client-side (localStorage) and expose a small
 *   subscribe/getSnapshot API that React's `useSyncExternalStore` can consume.
 *
 * The auth tokens here are end-user (role: user) tokens — a *different* set
 * from the admin panel's tokens. Persisted under a distinct key.
 */

const STORAGE_KEY = 'betet.user.auth';

export interface AuthSnapshot {
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  user: {
    id: string;
    tenant_id: string;
    role: string;
    email: string | null;
    phone: string | null;
  } | null;
}

const initial: AuthSnapshot = {
  accessToken: null,
  refreshToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  user: null,
};

let state: AuthSnapshot = initial;
const listeners = new Set<() => void>();

function read(): AuthSnapshot {
  if (typeof window === 'undefined') return initial;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initial;
    return JSON.parse(raw) as AuthSnapshot;
  } catch {
    return initial;
  }
}

function persist(s: AuthSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    if (s.accessToken || s.refreshToken) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function emit() {
  for (const l of listeners) l();
}

export function getSnapshot(): AuthSnapshot {
  return state;
}

export function getServerSnapshot(): AuthSnapshot {
  return initial;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call once during app bootstrap (e.g. AuthProvider mount) to hydrate. */
export function hydrate(): void {
  state = read();
  emit();
}

export function setSession(s: Partial<AuthSnapshot>): void {
  state = { ...state, ...s };
  persist(state);
  if (typeof window !== 'undefined') {
    try {
      if (state.accessToken) {
        window.localStorage.setItem('mezzobet_access_token', state.accessToken);
      } else {
        window.localStorage.removeItem('mezzobet_access_token');
      }
      if (state.refreshToken) {
        window.localStorage.setItem('mezzobet_refresh_token', state.refreshToken);
      } else {
        window.localStorage.removeItem('mezzobet_refresh_token');
      }
      if (state.user?.phone) {
        window.localStorage.setItem('mezzobet_current_user', state.user.phone);
      }
      if (state.user?.phone ?? state.user?.email) {
        window.localStorage.setItem(
          'mezzobet_current_user_fullname',
          state.user.phone ?? state.user.email ?? ''
        );
      }
      window.localStorage.setItem('mezzobet_logged_in', state.accessToken ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }
  emit();
}

export function clearSession(): void {
  state = initial;
  persist(state);
  if (typeof window !== 'undefined') {
    try {
      const legacy = [
        'mezzobet_access_token',
        'mezzobet_refresh_token',
        'mezzobet_logged_in',
        'mezzobet_balance',
        'mezzobet_bonus_balance',
        'mezzobet_current_user',
        'mezzobet_current_user_fullname',
      ];
      for (const k of legacy) window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  emit();
}

export function getAccessToken(): string | null {
  return state.accessToken;
}

export function getRefreshToken(): string | null {
  return state.refreshToken;
}
