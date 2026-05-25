/**
 * Module augmentation for Express Request to carry tenant + authenticated
 * user / agent context populated by middleware.
 */

export interface TenantContext {
  id: string;
  slug?: string;
}

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  role: string;
  jti: string;
  /** Section 22 — permission IDs from the JWT. ['*'] = super admin. */
  permissions?: string[];
}

/**
 * A Telebirr SMS Pay Client device (Flutter app) authenticated against
 * the `/api/agent/*` surface. Distinct from `req.user` because the auth
 * model, JWT secret, and resource graph are entirely separate.
 */
export interface AuthenticatedAgent {
  id: string;
  tenantId: string;
  deviceId: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: TenantContext | null;
      user?: AuthenticatedUser | null;
      agent?: AuthenticatedAgent | null;
    }
  }
}

export {};
