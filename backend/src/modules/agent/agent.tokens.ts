import crypto from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';

import { env } from '../../config/env';

/**
 * Agent device tokens are intentionally separate from user/admin tokens:
 *   - signed with HS256 using `env.agent.jwtSecret` (NOT the RS256 user
 *     keypair),
 *   - issued with `iss = env.agent.issuer`, `aud = env.agent.audience`,
 *     so verification cannot accidentally accept a user token,
 *   - 12h default TTL (spec) — short enough that a stolen device token
 *     ages out before it can be widely abused, long enough that an SMS
 *     burst doesn't trip a re-login mid-batch,
 *   - bound to a `deviceId` claim so middleware can compare against the
 *     paired device on `telebirr_agents` (defence-in-depth on top of
 *     network-level controls).
 *
 * The session id (`sid`) lets us revoke a single device session without
 * rotating the secret for the entire fleet.
 */

export interface AgentTokenClaims {
  /** telebirr_agents.id — the principal of every authenticated request. */
  aid: string;
  /** Tenant the agent belongs to. */
  tid: string;
  /** Device fingerprint reported at login; checked by middleware. */
  did: string;
  /** telebirr_agent_sessions.id; lets us hard-revoke one device session. */
  sid: string;
}

export interface IssuedAgentToken {
  token: string;
  expiresAt: Date;
  jti: string;
}

function decodedExp(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded || typeof decoded.exp !== 'number') {
    throw new Error('Failed to decode agent JWT exp');
  }
  return new Date(decoded.exp * 1000);
}

export function signAgentToken(claims: AgentTokenClaims): IssuedAgentToken {
  const jti = crypto.randomUUID();
  const opts: SignOptions = {
    algorithm: 'HS256',
    expiresIn: env.agent.ttl as SignOptions['expiresIn'],
    issuer: env.agent.issuer,
    audience: env.agent.audience,
    subject: claims.aid,
    jwtid: jti,
  };
  const token = jwt.sign(
    {
      tid: claims.tid,
      did: claims.did,
      sid: claims.sid,
      typ: 'agent',
    },
    env.agent.jwtSecret,
    opts
  );
  return { token, jti, expiresAt: decodedExp(token) };
}

export interface VerifiedAgentToken {
  aid: string;
  tid: string;
  did: string;
  sid: string;
  jti: string;
  iat: number;
  exp: number;
}

export function verifyAgentToken(token: string): VerifiedAgentToken {
  const payload = jwt.verify(token, env.agent.jwtSecret, {
    algorithms: ['HS256'],
    issuer: env.agent.issuer,
    audience: env.agent.audience,
  }) as {
    sub?: string;
    tid?: string;
    did?: string;
    sid?: string;
    jti?: string;
    iat?: number;
    exp?: number;
    typ?: string;
  };

  if (payload.typ !== 'agent') {
    throw Object.assign(new Error('Not an agent token'), {
      name: 'JsonWebTokenError',
    });
  }
  if (
    !payload.sub ||
    !payload.tid ||
    !payload.did ||
    !payload.sid ||
    !payload.jti ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    throw Object.assign(new Error('Malformed agent token'), {
      name: 'JsonWebTokenError',
    });
  }
  return {
    aid: payload.sub,
    tid: payload.tid,
    did: payload.did,
    sid: payload.sid,
    jti: payload.jti,
    iat: payload.iat,
    exp: payload.exp,
  };
}
