/**
 * Section 15 — User-facing external games launch.
 *
 *   POST /api/games/external/launch
 *     User clicks an external game in the user panel; backend calls the
 *     provider's `/launch` API with our user/session/currency, stores the
 *     session row, and returns the iframe URL to embed.
 *
 *   POST /api/games/external/sessions/:id/end
 *     Best-effort session close.
 *
 * Webhook receiver lives in webhooks/external-games.webhook.routes.ts and
 * is mounted at /hooks/:provider so external providers can call our
 * debit/credit/balance/rollback endpoints. The webhook does NOT require
 * a user JWT — it authenticates with an HMAC-SHA256 signature derived from
 * the provider's stored secret.
 */
import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../http/errors/http-error';
import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import { openSecret } from '../../infrastructure/crypto/secret-cipher';
import { env } from '../../config/env';
import { logger } from '../../infrastructure/logger';
import { tryAudit } from '../audit/audit.service';

const router = Router();

router.use(authenticateToken());
router.use(requireRole('user', 'affiliate'));

const launchSchema = z.object({
  provider_id: z.string().uuid(),
  game_id: z.string().trim().min(1).max(100),
  currency: z.string().trim().length(3).default('ETB'),
  language: z.string().trim().min(2).max(8).default('en'),
});

const sessionIdParam = z.object({ id: z.string().uuid() });

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

function authHeadersFor(authMethod: string, secret: string): Record<string, string> {
  if (authMethod === 'token') return { Authorization: `Bearer ${secret}` };
  if (authMethod === 'apikey') return { 'X-API-Key': secret };
  return {};
}

router.post(
  '/launch',
  wrap(async (req) => {
    if (!req.user) throw new ForbiddenError('Authentication required');
    const body = launchSchema.parse(req.body);
    const tenantId = req.user.tenantId;

    return withTenantClient({ tenantId }, async (client) => {
      const providerQ = await client.query<{
        id: string;
        name: string;
        base_url: string;
        auth_method: 'token' | 'apikey' | 'none';
        encrypted_secret: string | null;
        callback_url: string | null;
        sandbox: boolean;
        status: 'Active' | 'Paused';
      }>(
        `SELECT id, name, base_url, auth_method, encrypted_secret,
                callback_url, sandbox, status
           FROM external_game_providers
          WHERE id = $1 AND status = 'Active'`,
        [body.provider_id]
      );
      const provider = providerQ.rows[0];
      if (!provider) throw new NotFoundError('Provider not available');

      const allowed = await client.query<{ id: string }>(
        `SELECT id FROM external_game_provider_games
          WHERE provider_id = $1 AND game_id = $2 AND enabled = true`,
        [provider.id, body.game_id]
      );
      if (!allowed.rows[0]) throw new ForbiddenError('Game not available');

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const callback =
        provider.callback_url ?? `${env.BACKEND_URL ?? ''}/hooks/${provider.name.toLowerCase().replace(/\s+/g, '-')}`;
      let launchUrl: string | null = null;
      let upstreamError: string | null = null;

      const launchBody = {
        game_id: body.game_id,
        player_id: req.user!.id,
        tenant_id: tenantId,
        session_token: sessionToken,
        currency: body.currency,
        language: body.language,
        return_url: `${env.FRONTEND_URL}/games`,
        callback_url: callback,
      };

      try {
        const secret = provider.encrypted_secret ? openSecret(provider.encrypted_secret) : '';
        const upstream = await fetch(`${provider.base_url.replace(/\/$/, '')}/launch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...authHeadersFor(provider.auth_method, secret),
          },
          body: JSON.stringify(launchBody),
        });
        if (!upstream.ok) {
          upstreamError = `Provider responded ${upstream.status}`;
        } else {
          const json = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
          launchUrl =
            (typeof json.launch_url === 'string' && json.launch_url) ||
            (typeof json.url === 'string' && json.url) ||
            (typeof json.gameUrl === 'string' && json.gameUrl) ||
            null;
        }
      } catch (err) {
        upstreamError = err instanceof Error ? err.message : 'launch fetch failed';
        logger.warn(
          { err, provider: provider.name, gameId: body.game_id },
          'External provider launch failed'
        );
      }

      // Sandbox fallback: when the provider is unreachable but flagged as
      // sandbox we still build a deterministic launch URL so QA can verify
      // the iframe wiring end-to-end without real provider credentials.
      if (!launchUrl) {
        if (!provider.sandbox) {
          throw new BadRequestError(
            upstreamError ?? 'Provider returned no launch URL',
            { provider: provider.name }
          );
        }
        const u = new URL(`${provider.base_url.replace(/\/$/, '')}/play`);
        u.searchParams.set('game', body.game_id);
        u.searchParams.set('player', req.user!.id);
        u.searchParams.set('token', sessionToken);
        u.searchParams.set('demo', 'true');
        launchUrl = u.toString();
      }

      const session = await client.query<{ id: string }>(
        `INSERT INTO external_game_sessions
           (tenant_id, user_id, provider_id, game_id, session_token,
            launch_url, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', now() + interval '4 hours')
         RETURNING id`,
        [
          tenantId,
          req.user!.id,
          provider.id,
          body.game_id,
          sessionToken,
          launchUrl,
        ]
      );

      void tryAudit(
        {
          tenantId,
          actorId: req.user!.id,
          actorType: 'user',
          action: 'external_game.launch',
          resource: 'external_game_sessions',
          resourceId: session.rows[0].id,
          payload: {
            provider: provider.name,
            game_id: body.game_id,
            sandbox: provider.sandbox,
            upstream_error: upstreamError,
          },
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          status: 'success',
        },
        { bypassRls: true }
      );

      return {
        session_id: session.rows[0].id,
        session_token: sessionToken,
        launch_url: launchUrl,
        provider: { id: provider.id, name: provider.name },
        game_id: body.game_id,
      };
    });
  })
);

router.post(
  '/sessions/:id/end',
  wrap(async (req) => {
    if (!req.user) throw new ForbiddenError('Authentication required');
    const { id } = sessionIdParam.parse(req.params);
    return withTenantClient({ tenantId: req.user.tenantId }, async (client) => {
      const r = await client.query<{ id: string }>(
        `UPDATE external_game_sessions
            SET status = 'ended', closed_at = now()
          WHERE id = $1 AND user_id = $2 AND status = 'active'
          RETURNING id`,
        [id, req.user!.id]
      );
      return { ok: true, ended: Boolean(r.rows[0]) };
    });
  })
);

export default router;
