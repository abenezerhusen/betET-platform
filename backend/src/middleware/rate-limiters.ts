import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env } from '../config/env';

function normalizeIp(ip: string): string {
  // Bucket IPv6 addresses to /64 to avoid trivial rotation evasion.
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

function tenantScopedKey(prefix: string) {
  return (req: Request, _res: Response): string => {
    const tenant = req.tenant?.id ?? 'no-tenant';
    const ip = req.ip ?? 'no-ip';
    return `${prefix}:${normalizeIp(ip)}:${tenant}`;
  };
}

/**
 * Per-IP key generator (no tenant). Used for unauthenticated surfaces
 * like /api/auth/* where the tenant may not be resolved yet.
 */
function ipScopedKey(prefix: string) {
  return (req: Request, _res: Response): string => {
    const ip = req.ip ?? 'no-ip';
    return `${prefix}:${normalizeIp(ip)}`;
  };
}

/**
 * Per-authenticated-user key generator. Falls back to IP when no user is
 * attached to the request, which means the limit still has *some* effect
 * on misconfigured public routes.
 */
function userScopedKey(prefix: string) {
  return (req: Request, _res: Response): string => {
    if (req.user?.id) return `${prefix}:user:${req.user.id}`;
    const ip = req.ip ?? 'no-ip';
    return `${prefix}:ip:${normalizeIp(ip)}`;
  };
}

const STANDARD_HEADERS = { standardHeaders: true, legacyHeaders: false } as const;

/* ------------------------------------------------------------------------- */
/* Login / refresh / password reset                                          */
/* ------------------------------------------------------------------------- */

export const loginRateLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: env.LOGIN_RATE_LIMIT_MAX,
  ...STANDARD_HEADERS,
  keyGenerator: tenantScopedKey('login'),
  message: {
    error: 'too_many_requests',
    message: 'Too many login attempts. Please try again later.',
  },
});

export const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  ...STANDARD_HEADERS,
  keyGenerator: tenantScopedKey('pwreset'),
  message: {
    error: 'too_many_requests',
    message: 'Too many password reset requests. Please try again later.',
  },
});

export const refreshRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  ...STANDARD_HEADERS,
  keyGenerator: tenantScopedKey('refresh'),
  message: {
    error: 'too_many_requests',
    message: 'Too many refresh attempts. Please try again later.',
  },
});

/* ------------------------------------------------------------------------- */
/* Generic per-surface limiters from the spec                                */
/* ------------------------------------------------------------------------- */

/**
 * Auth endpoints: 5 requests / minute / IP.
 *
 * This is the broad limiter applied to every /api/auth/* route — the
 * narrower loginRateLimiter is still applied on top so login itself has
 * the stricter 5/15min cap.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.RATE_LIMIT_AUTH_PER_MIN,
  ...STANDARD_HEADERS,
  keyGenerator: ipScopedKey('auth'),
  message: {
    error: 'too_many_requests',
    message: 'Too many auth requests. Please slow down.',
  },
});

/**
 * Bet placement: 10 requests / minute / user. Keyed by user id so a single
 * burst of bets from one IP across multiple users isn't penalized.
 */
export const betPlacementRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.RATE_LIMIT_BET_PER_MIN,
  ...STANDARD_HEADERS,
  keyGenerator: userScopedKey('bet'),
  message: {
    error: 'too_many_requests',
    message: 'Too many bet requests. Please wait a moment.',
  },
});

/**
 * Admin reports: 30 requests / minute / admin. Heavy queries are also
 * cached server-side (60s) by the reports module.
 */
export const adminReportsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.RATE_LIMIT_ADMIN_REPORTS_PER_MIN,
  ...STANDARD_HEADERS,
  keyGenerator: userScopedKey('admin-reports'),
  message: {
    error: 'too_many_requests',
    message: 'Too many report requests. Please wait a moment.',
  },
});

/**
 * Paths the global fallback limiter must never throttle.
 *
 * The general limiter is mounted at the very top of the app — *before* any
 * route-level authentication runs — so for these surfaces `req.user` is not
 * yet populated and the limiter would fall back to keying by IP. Behind a
 * load balancer/NAT every cashier (potentially thousands, per the
 * "millions of concurrent users" requirement) shares that single IP bucket,
 * which collapses instantly and blocks legitimate work with
 * "Rate limit exceeded".
 *
 * These surfaces are already protected by their own auth + permission
 * checks (and, for agents, a dedicated per-device limiter), so we exempt
 * them from the blunt global floor entirely. Cashier accounts therefore
 * never get throttled by it — but every action still requires the correct
 * permission, so an operation with no permission still does nothing.
 */
function skipGeneralLimiter(req: Request): boolean {
  if (req.path === '/health' || req.path === '/ready') return true;
  // Auth routes (/api/auth/*) carry their own dedicated limiters
  // (loginRateLimiter + authRateLimiter). Letting the blunt IP-keyed global
  // floor also apply here just produced confusing "Rate limit exceeded"
  // blocks on legitimate logins/registrations, so it is exempted — users can
  // log in at any time, while the targeted login limiter still deters
  // brute-force.
  if (req.path.startsWith('/api/auth')) return true;
  // High-throughput, permission-gated panel/device surfaces.
  return (
    req.path.startsWith('/api/cashier') ||
    req.path.startsWith('/api/agent')
  );
}

/**
 * General fallback limiter. Mounted at the top of the app so it covers
 * public/user API routes. Authenticated panel surfaces (cashier, agent)
 * are skipped — see `skipGeneralLimiter`. Per-route limiters (auth, bet
 * placement, admin reports) still apply on top of this floor.
 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.RATE_LIMIT_GENERAL_PER_MIN,
  ...STANDARD_HEADERS,
  keyGenerator: userScopedKey('general'),
  skip: skipGeneralLimiter,
  message: {
    error: 'too_many_requests',
    message: 'Rate limit exceeded.',
  },
});
