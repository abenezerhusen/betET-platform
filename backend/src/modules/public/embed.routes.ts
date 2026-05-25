/**
 * Section 15 — OUTBOUND iframe embed endpoint.
 *
 *   GET /embed?client_id=playx&game=aviator&token=SESSION_TOKEN
 *
 * Public — but security-checked:
 *   1. Origin / Referer header host MUST be in iframe_whitelisted_domains.
 *   2. (tenant_id, client_id) MUST have a row in iframe_outbound_configs
 *      with enabled=true and game_id matching the requested game.
 *   3. If use_token=true, a session token is required (validated as a
 *      placeholder here — wire to the client's session API as needed).
 *
 * On success we redirect to the game engine URL with a short-lived
 * internal token that the engine can introspect.
 */
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import { env } from '../../config/env';

const router = Router();

function getOriginHost(req: Request): string | null {
  const origin = String(req.headers.origin ?? req.headers.referer ?? '');
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function makeInternalToken(clientId: string, gameId: string): string {
  const payload = JSON.stringify({
    cid: clientId,
    gid: gameId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
  });
  const sig = crypto.createHmac('sha256', env.encryptionKey).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

router.get('/embed', async (req: Request, res: Response) => {
  const clientId = String(req.query.client_id ?? '').trim();
  const game = String(req.query.game ?? '').trim();
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  if (!clientId || !game) {
    return res.status(400).send('Missing client_id or game');
  }

  const host = getOriginHost(req);
  if (!host) {
    return res.status(403).send('Origin header required');
  }

  try {
    await withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
      const wl = await client.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM iframe_whitelisted_domains WHERE LOWER(domain) = $1 LIMIT 1`,
        [host]
      );
      if (!wl.rows[0]) {
        const err = new Error('Domain not whitelisted');
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
      const tenantId = wl.rows[0].tenant_id;

      const cfg = await client.query<{
        id: string;
        client_id: string;
        game_id: string | null;
        enabled: boolean;
        use_token: boolean;
      }>(
        `SELECT id, client_id, game_id, enabled, use_token
           FROM iframe_outbound_configs
          WHERE tenant_id = $1 AND client_id = $2 AND enabled = true
            AND (game_id IS NULL OR game_id = $3)
          LIMIT 1`,
        [tenantId, clientId, game]
      );
      if (!cfg.rows[0]) {
        const err = new Error('Game not enabled for this client');
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
      if (cfg.rows[0].use_token && !token) {
        const err = new Error('Session token required');
        (err as Error & { status?: number }).status = 401;
        throw err;
      }

      const gameStillActive = await client.query<{ id: string }>(
        `SELECT id FROM internal_games WHERE id = $1 AND status = 'Active'`,
        [game]
      );
      if (!gameStillActive.rows[0]) {
        const err = new Error('Game is not available');
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    logger.warn({ err, host, clientId, game }, 'Embed request rejected');
    return res.status(status).send((err as Error).message);
  }

  const internalToken = makeInternalToken(clientId, game);
  const target = new URL(`${env.GAME_ENGINE_URL.replace(/\/$/, '')}/games/${game}`);
  target.searchParams.set('token', internalToken);
  target.searchParams.set('client', clientId);
  return res.redirect(302, target.toString());
});

export default router;
