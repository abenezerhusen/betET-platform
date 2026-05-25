import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { http } from '../lib/api/client';

/**
 * Security settings governed by the Super Admin.
 *
 * IMPORTANT: All flags default to false. When every flag is false, every
 * existing login / feature behaves exactly as it did before this file was
 * added. The flags are additive and only unlock new OTP-gated pages /
 * features when the Super Admin turns them on.
 */
interface SecuritySettingsState {
  /**
   * When true, administrators (role === "admin" / "Administrator") are
   * required to verify a 6-digit OTP after entering their password at
   * /login. Super Admin is unaffected. When false, the login flow is the
   * original flow (password-only).
   */
  adminsOtpRequired: boolean;

  /**
   * When true, super admin login also requires an OTP verification step.
   * Defaults to false to preserve existing login behavior.
   */
  superAdminOtpRequired: boolean;
  loading: boolean;
  lastLoadedAt: string | null;

  setAdminsOtpRequired: (v: boolean) => Promise<void>;
  setSuperAdminOtpRequired: (v: boolean) => Promise<void>;
  fetchSecuritySettings: () => Promise<void>;
}

export const useSecuritySettings = create<SecuritySettingsState>()(
  persist(
    (set, get) => ({
      adminsOtpRequired: false,
      superAdminOtpRequired: false,
      loading: false,
      lastLoadedAt: null,
      fetchSecuritySettings: async () => {
        set({ loading: true });
        try {
          const cfg = await http.get<{
            mfa_required_for_admins?: boolean;
            require_2fa_admin?: boolean;
            require_2fa_cashier?: boolean;
            require_2fa_users?: boolean;
          }>('/api/admin/settings/security', { auth: false });
          set({
            adminsOtpRequired:
              cfg.mfa_required_for_admins ?? cfg.require_2fa_admin ?? false,
            superAdminOtpRequired:
              cfg.require_2fa_cashier ?? cfg.require_2fa_users ?? false,
            lastLoadedAt: new Date().toISOString(),
          });
        } catch {
          // Login page should remain usable even when this protected endpoint
          // is unavailable pre-auth; keep safe defaults.
          set({
            adminsOtpRequired: false,
            superAdminOtpRequired: false,
          });
        } finally {
          set({ loading: false });
        }
      },
      setAdminsOtpRequired: async (v) => {
        await http.put('/api/admin/settings/security', {
          mfa_required_for_admins: v,
        });
        set({ adminsOtpRequired: v, lastLoadedAt: new Date().toISOString() });
      },
      setSuperAdminOtpRequired: async (v) => {
        // The existing backend security payload has no explicit super-admin OTP
        // key. Keep this mapped to an additive 2FA flag so state persists in DB.
        await http.put('/api/admin/settings/security', {
          require_2fa_cashier: v,
        });
        set({ superAdminOtpRequired: v, lastLoadedAt: new Date().toISOString() });
      },
    }),
    {
      name: 'security-settings-v1',
      partialize: (state) => ({
        adminsOtpRequired: state.adminsOtpRequired,
        superAdminOtpRequired: state.superAdminOtpRequired,
        lastLoadedAt: state.lastLoadedAt,
      }),
    }
  )
);

/**
 * Known super admin usernames. Used to gate the forgot-password flow
 * (only the super admin can reset via email/OTP per product requirement).
 * Regular admins use their existing login form only.
 */
export const SUPER_ADMIN_USERNAMES = [
  'superadmin',
  'super_admin',
  'super.admin',
  'super-admin',
];

export function isSuperAdminUsername(raw: string): boolean {
  const u = raw.trim().toLowerCase();
  if (!u) return false;
  if (SUPER_ADMIN_USERNAMES.includes(u)) return true;
  // Also accept "Super Admin" style role names entered as username
  return u.startsWith('superadmin') || u === 'super admin';
}
