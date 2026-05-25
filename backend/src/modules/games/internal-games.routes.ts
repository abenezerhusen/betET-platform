/**
 * Public + worker-side endpoints for the 4 internal games.
 *
 *   GET /api/games/lobby           — public lobby for the user-panel:
 *                                    returns Active internal games grouped
 *                                    into top_games / new_games /
 *                                    popular_games / all_games.
 *
 *   GET /api/games/rtp/:gameId     — backend game-engine workers fetch the
 *                                    effective RTP per round. Honours the
 *                                    per-client override when ?client_id=
 *                                    is supplied; otherwise returns
 *                                    internal_games.default_rtp.
 *
 *   GET /api/games/external/list   — public list of Active external
 *                                    provider games for the user panel.
 *
 * These endpoints are mounted at /api/games (see app.ts) and intentionally
 * accept tenant context from the x-tenant-id header / subdomain — but they
 * do NOT require user authentication: the lobby is the first thing a
 * visitor sees, and the worker reads the RTP from inside the backend.
 *
 * Internal_games is a GLOBAL table, so the lobby endpoint does not need a
 * tenant context to return the catalogue. The external games are
 * tenant-scoped (every white-label client wires up their own providers).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError, NotFoundError } from '../../http/errors/http-error';
import * as swagger from '../../swagger/registry';

const router = Router();

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

interface InternalGameRow {
  id: string;
  name: string;
  provider: string;
  default_rtp: string;
  status: string;
  slug: string | null;
  thumbnail_url: string | null;
  game_type: string | null;
  min_bet: string;
  max_bet: string;
}

swagger.registerPath({
  method: 'get',
  path: '/api/games/lobby',
  summary: 'Public lobby: internal games grouped by bucket',
  tags: ['Games'],
  responses: { '200': { description: 'Lobby payload' } },
});

router.get(
  '/lobby',
  wrap(async () => {
    return withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
      const r = await client.query<InternalGameRow>(
        `SELECT id, name, provider, default_rtp::text, status,
                slug, thumbnail_url, game_type, min_bet::text, max_bet::text
           FROM internal_games
          WHERE status = 'Active'
          ORDER BY name`
      );
      const games = r.rows.map((g) => ({
        id: g.id,
        name: g.name,
        provider: g.provider,
        slug: g.slug,
        thumbnail_url: g.thumbnail_url,
        game_type: g.game_type,
        min_bet: Number(g.min_bet),
        max_bet: Number(g.max_bet),
        rtp: Number(g.default_rtp),
      }));

      return {
        top_games: games.filter((g) => g.id === 'aviator' || g.id === 'jetx'),
        new_games: games.filter((g) => g.id === 'fast-keno'),
        popular_games: games.filter((g) => g.id === 'multi-hot-5'),
        all_games: games,
      };
    });
  })
);

swagger.registerPath({
  method: 'get',
  path: '/api/games/rtp/{gameId}',
  summary: 'Effective RTP for an internal game (engine reader)',
  tags: ['Games'],
  responses: { '200': { description: 'RTP payload' }, '404': { description: 'Game not found' } },
});

router.get(
  '/rtp/:gameId',
  wrap(async (req) => {
    const gameId = String(req.params.gameId);
    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : null;

    return withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
      const g = await client.query<{ id: string; default_rtp: string; status: string }>(
        `SELECT id, default_rtp::text, status FROM internal_games WHERE id = $1`,
        [gameId]
      );
      if (!g.rows[0]) throw new NotFoundError('Game not found');
      if (g.rows[0].status !== 'Active') {
        return {
          game_id: gameId,
          rtp: Number(g.rows[0].default_rtp),
          status: g.rows[0].status,
          source: 'disabled',
        };
      }
      let rtp = Number(g.rows[0].default_rtp);
      let source: 'default' | 'override' = 'default';
      if (clientId) {
        const o = await client.query<{ rtp: string }>(
          `SELECT rtp::text FROM game_rtp_overrides WHERE game_id = $1 AND client_id = $2`,
          [gameId, clientId]
        );
        if (o.rows[0]) {
          rtp = Number(o.rows[0].rtp);
          source = 'override';
        }
      }
      return { game_id: gameId, rtp, status: g.rows[0].status, source };
    });
  })
);

swagger.registerPath({
  method: 'get',
  path: '/api/games/external/list',
  summary: 'Public list of active external provider games',
  tags: ['Games'],
  responses: { '200': { description: 'External games list' } },
});

router.get(
  '/external/list',
  wrap(async (req) => {
    const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
    if (!tenantId) {
      throw new BadRequestError('Tenant context required for external games');
    }
    return withTenantClient({ tenantId }, async (client) => {
      const providers = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM external_game_providers WHERE status = 'Active' AND tenant_id = $1`,
        [tenantId]
      );
      const games: Array<{
        id: string;
        name: string;
        thumbnail_url: string;
        provider: string;
        provider_id: string;
        is_external: true;
      }> = [];
      for (const p of providers.rows) {
        const pg = await client.query<{
          game_id: string;
          name: string | null;
          thumbnail_url: string | null;
        }>(
          `SELECT game_id, name, thumbnail_url
             FROM external_game_provider_games
            WHERE provider_id = $1 AND enabled = true`,
          [p.id]
        );
        for (const g of pg.rows) {
          games.push({
            id: g.game_id,
            name: g.name ?? g.game_id,
            thumbnail_url: g.thumbnail_url ?? '/games/external-placeholder.png',
            provider: p.name,
            provider_id: p.id,
            is_external: true,
          });
        }
      }
      return { games };
    });
  })
);

export default router;
