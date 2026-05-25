import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as auth from '../lib/api/auth';
import { SUPERADMIN_WILDCARD } from '../lib/permissions';

interface User {
  id: string;
  username: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  tenantId: string;
  /**
   * Section 22 — permission IDs from the JWT. Super admin carries
   * ['*']; the `hasPermission` helper treats it as a wildcard.
   */
  permissions: string[];
}

interface LoginLog {
  timestamp: string;
  username: string;
  status: string;
  ipAddress: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  loginLogs: LoginLog[];
  login: (username: string, password: string) => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
  logout: () => void;
  /** Section 22 — true if the current user holds the permission (or '*'). */
  hasPermission: (id: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      loginLogs: [],

      login: async (username: string, password: string) => {
        const out = await auth.login(username, password);
        const display = out.user.email ?? out.user.phone ?? username;
        set({
          isAuthenticated: true,
          accessToken: out.access_token,
          refreshToken: out.refresh_token,
          accessTokenExpiresAt: out.access_token_expires_at,
          refreshTokenExpiresAt: out.refresh_token_expires_at,
          user: {
            id: out.user.id,
            username,
            role: out.user.role,
            firstName: display,
            lastName: '',
            email: out.user.email,
            phone: out.user.phone,
            tenantId: out.user.tenant_id,
            permissions: Array.isArray(out.user.permissions)
              ? out.user.permissions
              : [],
          },
          loginLogs: [
            {
              timestamp: new Date().toISOString(),
              username,
              status: 'success',
              ipAddress: '-',
            },
            ...useAuthStore.getState().loginLogs.slice(0, 19),
          ],
        });
      },

      refreshAccessToken: async () => {
        const state = useAuthStore.getState();
        if (!state.refreshToken) return null;
        try {
          const out = await auth.refresh(state.refreshToken);
          const current = useAuthStore.getState().user;
          set({
            isAuthenticated: true,
            accessToken: out.access_token,
            refreshToken: out.refresh_token,
            accessTokenExpiresAt: out.access_token_expires_at,
            refreshTokenExpiresAt: out.refresh_token_expires_at,
            // Pick up any role permission edits that landed while
            // the session was active. We keep the existing display
            // info; only the dynamic claims are refreshed.
            user: current
              ? {
                  ...current,
                  role: out.user.role,
                  permissions: Array.isArray(out.user.permissions)
                    ? out.user.permissions
                    : current.permissions,
                }
              : current,
          });
          return out.access_token;
        } catch {
          set({
            isAuthenticated: false,
            user: null,
            accessToken: null,
            refreshToken: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
          });
          return null;
        }
      },

      logout: () => {
        const current = useAuthStore.getState().refreshToken;
        if (current) {
          // Fire-and-forget revoke; even if the network call fails we still
          // wipe local state.
          void auth.logout(current).catch(() => {});
        }
        set({
          isAuthenticated: false,
          user: null,
          accessToken: null,
          refreshToken: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
        });
      },

      hasPermission: (id: string) => {
        const u = useAuthStore.getState().user;
        if (!u) return false;
        const perms = u.permissions ?? [];
        if (perms.includes(SUPERADMIN_WILDCARD)) return true;
        // Builtin role shortcut — superadmin role is always treated as
        // god-mode even if the JWT didn't ship the wildcard sentinel.
        if (u.role === 'superadmin' || u.role === 'super_admin') return true;
        return perms.includes(id);
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);
