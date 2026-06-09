import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { HttpError, UnauthorizedError } from '../http/errors/http-error';

export interface AccessTokenPayload {
  sub: string;
  tid: string;
  role: string;
  /** Section 22 — flattened permission IDs. ['*'] for super admin. */
  permissions?: string[];
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

interface GameLaunchTokenPayload {
  sub: string;
  tid: string;
  role: 'user' | 'affiliate';
  sid: string;
  wid: string;
  gid: string;
  cur: string;
  typ: 'game_launch';
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

/**
 * Verifies the bearer access token (RS256), attaches the authenticated user
 * to req.user, and ensures req.tenant matches the token's tenant claim.
 */
export function authenticateToken() {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.header('authorization');
      if (!auth || !/^bearer\s+/i.test(auth)) {
        throw new UnauthorizedError('Missing bearer token');
      }
      const token = auth.replace(/^bearer\s+/i, '').trim();
      if (!token) throw new UnauthorizedError('Empty bearer token');

      let payload: AccessTokenPayload;
      try {
        payload = jwt.verify(token, env.jwt.publicKey, {
          algorithms: ['RS256'],
          issuer: env.jwt.issuer,
          audience: env.jwt.audience,
        }) as AccessTokenPayload;
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === 'TokenExpiredError') {
          throw new UnauthorizedError('Access token expired');
        }
        throw new UnauthorizedError('Invalid access token');
      }

      if (!payload.sub || !payload.tid || !payload.role || !payload.jti) {
        throw new UnauthorizedError('Malformed access token');
      }

      req.user = {
        id: payload.sub,
        tenantId: payload.tid,
        role: payload.role,
        jti: payload.jti,
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      };

      if (!req.tenant) {
        req.tenant = { id: payload.tid };
      } else if (req.tenant.id !== payload.tid) {
        throw new UnauthorizedError('Tenant mismatch between request and token');
      }

      next();
    } catch (err) {
      if (err instanceof HttpError) return next(err);
      next(new UnauthorizedError('Authentication failed'));
    }
  };
}

/**
 * Game read-surface authentication.
 *
 * Accepts EITHER:
 *  - a short-lived game launch token (`typ='game_launch'`), or
 *  - a regular user/affiliate access token.
 *
 * Both arrive from the game iframe — the user panel launches the engine with
 * the player's access token (`?token=`), while a provider-style launch flow
 * uses a dedicated launch token. The money-moving routes (`/bet`, `/cashout`,
 * `/spin`) already accept the plain access token via `authenticateToken()`,
 * so allowing it for the read-only `/round/current` + `/slots/history`
 * endpoints keeps the whole internal-game flow usable with a single token.
 *
 * Token source: Authorization: Bearer <token> first, then `?token=` (the
 * iframe launch path cannot set an Authorization header on the initial load).
 */
export function authenticateGameLaunchToken() {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.header('authorization');
      const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
      const token =
        auth && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : queryToken;
      if (!token) throw new UnauthorizedError('Missing game launch token');

      let payload: GameLaunchTokenPayload | AccessTokenPayload;
      try {
        payload = jwt.verify(token, env.jwt.publicKey, {
          algorithms: ['RS256'],
          issuer: env.jwt.issuer,
          audience: env.jwt.audience,
        }) as GameLaunchTokenPayload | AccessTokenPayload;
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === 'TokenExpiredError') {
          throw new UnauthorizedError('Game token expired');
        }
        throw new UnauthorizedError('Invalid game token');
      }

      if ((payload as GameLaunchTokenPayload).typ === 'game_launch') {
        const launch = payload as GameLaunchTokenPayload;
        if (
          !launch.sub ||
          !launch.tid ||
          !launch.role ||
          !launch.sid ||
          !launch.wid ||
          !launch.gid ||
          !launch.jti
        ) {
          throw new UnauthorizedError('Malformed game launch token');
        }
        req.user = {
          id: launch.sub,
          tenantId: launch.tid,
          role: launch.role,
          jti: launch.jti,
        };
      } else {
        // Fall back to a regular user/affiliate access token.
        const access = payload as AccessTokenPayload;
        if (!access.sub || !access.tid || !access.role || !access.jti) {
          throw new UnauthorizedError('Malformed access token');
        }
        req.user = {
          id: access.sub,
          tenantId: access.tid,
          role: access.role,
          jti: access.jti,
          permissions: Array.isArray(access.permissions) ? access.permissions : [],
        };
      }
      const tokenTenantId = req.user.tenantId;

      if (!req.tenant) {
        req.tenant = { id: tokenTenantId };
      } else if (req.tenant.id !== tokenTenantId) {
        throw new UnauthorizedError('Tenant mismatch between request and token');
      }

      next();
    } catch (err) {
      if (err instanceof HttpError) return next(err);
      next(new UnauthorizedError('Authentication failed'));
    }
  };
}
