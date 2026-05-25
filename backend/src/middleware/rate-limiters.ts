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
 * General fallback: 100 requests / minute / user. Mounted at the very
 * top of the app so it covers every API route. Per-route limiters above
 * still apply with their own (typically lower) caps.
 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.RATE_LIMIT_GENERAL_PER_MIN,
  ...STANDARD_HEADERS,
  keyGenerator: userScopedKey('general'),
  // Health and ready probes should never be throttled — important for k8s.
  skip: (req) => req.path === '/health' || req.path === '/ready',
  message: {
    error: 'too_many_requests',
    message: 'Rate limit exceeded.',
  },
});
