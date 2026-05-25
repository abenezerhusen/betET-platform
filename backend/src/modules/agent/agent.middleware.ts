import type { NextFunction, Request, Response } from 'express';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import {
  ForbiddenError,
  HttpError,
  UnauthorizedError,
} from '../../http/errors/http-error';

import * as repo from './agent.repository';
import { verifyAgentToken } from './agent.tokens';

/**
 * Authenticate `/api/agent/*` requests:
 *   1. Extract bearer token, verify with the agent HS256 secret.
 *   2. Look up the agent + open session under bypass-RLS (we don't have
 *      tenant context yet on agent traffic). The verified token already
 *      carries `tid`, so the lookups are still tenant-scoped at the
 *      query level.
 *   3. Reject if:
 *      - the agent row is missing (deleted),
 *      - the agent is not 'active' (suspended/inactive → 403 so the
 *        Flutter app can render its lock screen),
 *      - the device id on the token doesn't match the paired device id
 *        on the agent row (indicates token replay from another device),
 *      - the session is closed.
 *   4. Attach `req.agent`, `req.tenant`, and bump `last_active_at` +
 *      `last_seen_at`.
 *
 * The bumps run inside the same transaction as the lookups, but
 * intentionally use `bypassRls: true` so they cannot fail when no
 * tenant context is on the request.
 */
export function authenticateAgent() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.header('authorization');
      if (!auth || !/^bearer\s+/i.test(auth)) {
        throw new UnauthorizedError('Missing bearer token');
      }
      const token = auth.replace(/^bearer\s+/i, '').trim();
      if (!token) throw new UnauthorizedError('Empty bearer token');

      let claims;
      try {
        claims = verifyAgentToken(token);
      } catch (err) {
        // Backward-compatible path: allow raw p2p device_token bearer auth
        // for Prompt-2 mobile flow.
        const byDeviceToken = await withTenantClient(
          { tenantId: null, bypassRls: true },
          async (client) => {
            const r = await client.query<{
              id: string;
              tenant_id: string;
              telebirr_phone: string;
            }>(
              `SELECT id, tenant_id, telebirr_phone
                 FROM p2p_devices
                WHERE device_token = $1
                LIMIT 1`,
              [token]
            );
            return r.rows[0] ?? null;
          }
        );
        if (!byDeviceToken) {
          const name = (err as { name?: string } | null)?.name;
          if (name === 'TokenExpiredError') {
            throw new UnauthorizedError('Agent token expired', {
              reason: 'token_expired',
            });
          }
          throw new UnauthorizedError('Invalid agent token', {
            reason: 'token_invalid',
          });
        }
        req.agent = {
          id: byDeviceToken.id,
          tenantId: byDeviceToken.tenant_id,
          deviceId: byDeviceToken.id,
          sessionId: 'p2p-device-token',
        };
        req.tenant = { id: byDeviceToken.tenant_id };
        return next();
      }

      // Cross-check optional X-Device-Id header (some operator setups
      // send it explicitly). If present and disagreeing with the JWT,
      // reject — a mismatch means either the token was stolen or the
      // device was re-paired and a stale token is still in flight.
      const headerDeviceId = req.header('x-device-id')?.trim();
      if (headerDeviceId && headerDeviceId !== claims.did) {
        throw new UnauthorizedError(
          'Device id header does not match token claim',
          { reason: 'device_changed' }
        );
      }

      const session = await withTenantClient(
        { tenantId: claims.tid, bypassRls: true },
        async (client) => {
          const agent = await repo.findAgentById(client, claims.aid);
          if (!agent) {
            throw new UnauthorizedError('Agent not found', {
              reason: 'agent_not_found',
            });
          }
          if (agent.tenant_id !== claims.tid) {
            // Should be impossible (token tid is signed) but kept as a
            // belt-and-braces guard.
            throw new UnauthorizedError('Tenant mismatch on agent token', {
              reason: 'tenant_mismatch',
            });
          }
          if (agent.status !== 'active') {
            throw new ForbiddenError(`Agent is ${agent.status}`, {
              reason: 'agent_suspended',
              agent_status: agent.status,
            });
          }
          if (agent.device_id !== claims.did) {
            throw new UnauthorizedError(
              'Device id on token does not match paired device',
              { reason: 'device_changed' }
            );
          }
          const sess = await repo.findOpenSession(
            client,
            agent.id,
            claims.sid
          );
          if (!sess) {
            throw new UnauthorizedError('Session is closed', {
              reason: 'session_closed',
            });
          }
          const now = new Date();
          await repo.bumpSessionActivity(client, sess.id, now);
          await repo.bumpAgentLastSeen(client, agent.id, now);
          return { agent, session: sess };
        }
      );

      req.agent = {
        id: session.agent.id,
        tenantId: session.agent.tenant_id,
        deviceId: session.agent.device_id,
        sessionId: session.session.id,
      };
      // Mirror onto req.tenant so existing helpers (e.g. tenant-scoped
      // rate limiters) see the right tenant on agent routes.
      req.tenant = { id: session.agent.tenant_id };

      next();
    } catch (err) {
      if (err instanceof HttpError) return next(err);
      logger.warn({ err }, 'agent authentication failed');
      next(new UnauthorizedError('Authentication failed'));
    }
  };
}
