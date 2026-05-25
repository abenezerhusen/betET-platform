import crypto from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';

export interface AccessTokenClaims {
  sub: string;
  tid: string;
  role: string;
  /**
   * Section 22 — denormalised permission list embedded directly in the
   * access token. Super admins carry the sentinel ['*']; other roles
   * carry the full list resolved from the `roles` table.
   */
  permissions?: string[];
  jti?: string;
  expiresIn?: SignOptions['expiresIn'];
}

export interface RefreshTokenClaims {
  sub: string;
  tid: string;
  fid: string;
  jti?: string;
  expiresIn?: SignOptions['expiresIn'];
}

export interface IssuedToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

export interface IssuedRefreshToken extends IssuedToken {
  tokenHash: string;
}

function decodedExp(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded || typeof decoded.exp !== 'number') {
    throw new Error('Failed to decode JWT exp');
  }
  return new Date(decoded.exp * 1000);
}

export function signAccessToken(claims: AccessTokenClaims): IssuedToken {
  const jti = claims.jti ?? crypto.randomUUID();
  const opts: SignOptions = {
    algorithm: 'RS256',
    expiresIn: claims.expiresIn ?? (env.jwt.accessTtl as SignOptions['expiresIn']),
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
    subject: claims.sub,
    jwtid: jti,
  };
  const token = jwt.sign(
    {
      tid: claims.tid,
      role: claims.role,
      permissions: claims.permissions ?? [],
      typ: 'access',
    },
    env.jwt.privateKey,
    opts
  );
  return { token, jti, expiresAt: decodedExp(token) };
}

export function signRefreshToken(claims: RefreshTokenClaims): IssuedRefreshToken {
  const jti = claims.jti ?? crypto.randomUUID();
  const opts: SignOptions = {
    algorithm: 'RS256',
    expiresIn: claims.expiresIn ?? (env.jwt.refreshTtl as SignOptions['expiresIn']),
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
    subject: claims.sub,
    jwtid: jti,
  };
  const token = jwt.sign(
    { tid: claims.tid, fid: claims.fid, typ: 'refresh' },
    env.jwt.privateKey,
    opts
  );
  return {
    token,
    jti,
    expiresAt: decodedExp(token),
    tokenHash: hashToken(token),
  };
}

export interface VerifiedRefreshToken {
  sub: string;
  tid: string;
  fid: string;
  jti: string;
  iat: number;
  exp: number;
  typ?: string;
}

export function verifyRefreshToken(token: string): VerifiedRefreshToken {
  const payload = jwt.verify(token, env.jwt.publicKey, {
    algorithms: ['RS256'],
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  }) as VerifiedRefreshToken;

  if (payload.typ !== 'refresh') {
    throw Object.assign(new Error('Not a refresh token'), {
      name: 'JsonWebTokenError',
    });
  }
  if (!payload.sub || !payload.tid || !payload.fid || !payload.jti) {
    throw Object.assign(new Error('Malformed refresh token'), {
      name: 'JsonWebTokenError',
    });
  }
  return payload;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
