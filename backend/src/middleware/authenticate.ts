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
 * Accepts the short-lived game launch token from either:
 * - Authorization: Bearer <token>
 * - query string: ?token=<token> (iframe launch path)
 */
export function authenticateGameLaunchToken() {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.header('authorization');
      const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
      const token =
        auth && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : queryToken;
      if (!token) throw new UnauthorizedError('Missing game launch token');

      let payload: GameLaunchTokenPayload;
      try {
        payload = jwt.verify(token, env.jwt.publicKey, {
          algorithms: ['RS256'],
          issuer: env.jwt.issuer,
          audience: env.jwt.audience,
        }) as GameLaunchTokenPayload;
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === 'TokenExpiredError') {
          throw new UnauthorizedError('Game launch token expired');
        }
        throw new UnauthorizedError('Invalid game launch token');
      }

      if (
        payload.typ !== 'game_launch' ||
        !payload.sub ||
        !payload.tid ||
        !payload.role ||
        !payload.sid ||
        !payload.wid ||
        !payload.gid ||
        !payload.jti
      ) {
        throw new UnauthorizedError('Malformed game launch token');
      }

      req.user = {
        id: payload.sub,
        tenantId: payload.tid,
        role: payload.role,
        jti: payload.jti,
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
