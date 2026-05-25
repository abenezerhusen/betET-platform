import crypto from 'node:crypto';
import type { Request } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import ipaddr from 'ipaddr.js';

import { env } from '../../config/env';

/* ------------------------------------------------------------------------- */
/* Launch token                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Claims embedded in the short-lived JWT we hand to the game iframe. The
 * `typ='game_launch'` discriminator prevents this token from being mistaken
 * for an access or refresh token by the standard auth middleware.
 *
 * `sid` (session_id) is the single source of truth for revocation: the
 * JWT itself is RS256-signed, but we treat it as single-use because every
 * webhook that arrives later validates the session row's status, not just
 * the JWT signature.
 */
export interface LaunchTokenClaims {
  sub: string; // user_id
  tid: string; // tenant_id
  role: 'user' | 'affiliate';
  sid: string; // session_id
  wid: string; // wallet_id
  gid: string; // game_id
  cur: string; // currency
  typ: 'game_launch';
}

export interface IssuedLaunchToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

const LAUNCH_TTL_SECONDS = 15 * 60;

export function signLaunchToken(claims: LaunchTokenClaims): IssuedLaunchToken {
  const jti = crypto.randomUUID();
  const opts: SignOptions = {
    algorithm: 'RS256',
    expiresIn: LAUNCH_TTL_SECONDS,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
    subject: claims.sub,
    jwtid: jti,
  };
  const token = jwt.sign(
    {
      tid: claims.tid,
      role: claims.role,
      sid: claims.sid,
      wid: claims.wid,
      gid: claims.gid,
      cur: claims.cur,
      typ: claims.typ,
    },
    env.jwt.privateKey,
    opts
  );
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) throw new Error('failed to decode launch token exp');
  return { token, jti, expiresAt: new Date(decoded.exp * 1000) };
}

export interface VerifiedLaunchToken extends LaunchTokenClaims {
  jti: string;
  iat: number;
  exp: number;
}

export function verifyLaunchToken(token: string): VerifiedLaunchToken {
  const payload = jwt.verify(token, env.jwt.publicKey, {
    algorithms: ['RS256'],
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  }) as VerifiedLaunchToken & { jti?: string };

  if (payload.typ !== 'game_launch') {
    throw Object.assign(new Error('Not a game_launch token'), {
      name: 'JsonWebTokenError',
    });
  }
  if (!payload.sub || !payload.tid || !payload.role || !payload.sid || !payload.wid || !payload.gid) {
    throw Object.assign(new Error('Malformed launch token'), {
      name: 'JsonWebTokenError',
    });
  }
  return payload as VerifiedLaunchToken;
}

/* ------------------------------------------------------------------------- */
/* HMAC signature verification                                               */
/* ------------------------------------------------------------------------- */

/**
 * The provider sends us this header and computes:
 *   X-Game-Signature: hex(HMAC-SHA256(secret, timestamp + '.' + raw_body))
 * where timestamp is the X-Game-Timestamp epoch-seconds header. Including
 * the timestamp prevents trivial replay of a captured request body.
 */
export const SIGNATURE_HEADER = 'x-game-signature';
export const TIMESTAMP_HEADER = 'x-game-timestamp';
const MAX_TIMESTAMP_SKEW_SECONDS = 300; // 5 minutes

export interface VerifyHmacResult {
  ok: boolean;
  reason?: 'missing_signature' | 'missing_timestamp' | 'stale' | 'invalid_signature';
}

export function computeHmacSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer | string
): string {
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(timestamp);
  hmac.update('.');
  hmac.update(body);
  return hmac.digest('hex');
}

export function verifyHmacSignature(
  secret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  rawBody: Buffer
): VerifyHmacResult {
  if (!signature) return { ok: false, reason: 'missing_signature' };
  if (!timestamp) return { ok: false, reason: 'missing_timestamp' };

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'missing_timestamp' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - tsNum) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { ok: false, reason: 'stale' };
  }

  const expected = computeHmacSignature(secret, timestamp, rawBody);
  // Lengths must match before timingSafeEqual to avoid throwing.
  if (expected.length !== signature.length) {
    return { ok: false, reason: 'invalid_signature' };
  }
  const ok = crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(signature, 'utf8')
  );
  return ok ? { ok: true } : { ok: false, reason: 'invalid_signature' };
}

/* ------------------------------------------------------------------------- */
/* IP allowlist                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Match an IPv4 or IPv6 address against an allowlist of literal addresses
 * or CIDR ranges. Empty allowlist denies everyone (fail-closed).
 */
export function ipMatchesAllowlist(
  ip: string,
  allowlist: readonly string[]
): boolean {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;

  let parsed;
  try {
    parsed = ipaddr.process(ip);
  } catch {
    return false;
  }

  for (const entry of allowlist) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      if (trimmed.includes('/')) {
        const range = ipaddr.parseCIDR(trimmed);
        // ipaddr.process() collapses ::ffff:1.2.3.4 to plain IPv4; ensure
        // both sides are the same kind before comparing.
        if (parsed.kind() === range[0].kind() && parsed.match(range)) {
          return true;
        }
      } else {
        const target = ipaddr.process(trimmed);
        if (
          parsed.kind() === target.kind() &&
          parsed.toNormalizedString() === target.toNormalizedString()
        ) {
          return true;
        }
      }
    } catch {
      // Malformed allowlist entry — skip it.
    }
  }
  return false;
}

/* ------------------------------------------------------------------------- */
/* Raw body capture                                                          */
/* ------------------------------------------------------------------------- */

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}

export function getRawBody(req: Request): Buffer | null {
  return req.rawBody ?? null;
}

export function getRequestIp(req: Request): string | null {
  return req.ip ?? null;
}
