import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

import { env } from '../../config/env';

const STANDARD_HEADERS = { standardHeaders: true, legacyHeaders: false } as const;

function normalizeIp(ip: string): string {
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

/**
 * Agent login: keyed by deviceId (preferred — survives IP rotation by
 * mobile carriers, which is common on Telebirr networks). Falls back
 * to IP when deviceId is absent so the limiter still has *some* effect
 * before validation runs.
 *
 * Spec: 10 attempts per device per hour.
 */
function deviceScopedKey(req: Request, _res: Response): string {
  const body = (req.body ?? {}) as { deviceId?: string };
  const headerDeviceId = req.header('x-device-id')?.trim();
  const deviceId = headerDeviceId || body.deviceId;
  if (deviceId && typeof deviceId === 'string') {
    return `agent-login:device:${deviceId}`;
  }
  const ip = req.ip ?? 'no-ip';
  return `agent-login:ip:${normalizeIp(ip)}`;
}

/**
 * Authenticated agent traffic: keyed by agent id (set by
 * `authenticateAgent`). When the limiter runs before the middleware
 * chain (e.g. on a public-ish endpoint), it falls back to IP.
 *
 * Spec: 200 requests / minute / agent. SMS often arrive in bursts.
 */
function agentScopedKey(req: Request, _res: Response): string {
  if (req.agent?.id) return `agent:${req.agent.id}`;
  const ip = req.ip ?? 'no-ip';
  return `agent:ip:${normalizeIp(ip)}`;
}

/* ------------------------------------------------------------------------- */
/* Limiters                                                                  */
/* ------------------------------------------------------------------------- */

export const agentLoginRateLimiter = rateLimit({
  windowMs: env.agent.loginRateLimitWindowMinutes * 60 * 1000,
  max: env.agent.loginRateLimitMax,
  ...STANDARD_HEADERS,
  keyGenerator: deviceScopedKey,
  message: {
    error: 'too_many_requests',
    message: 'Too many login attempts for this device. Try again later.',
  },
});

export const agentGeneralRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.agent.rateLimitPerMin,
  ...STANDARD_HEADERS,
  keyGenerator: agentScopedKey,
  message: {
    error: 'too_many_requests',
    message: 'Agent rate limit exceeded.',
  },
});
