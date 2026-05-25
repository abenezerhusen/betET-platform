import { Router, type NextFunction, type Request, type Response } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError } from '../../http/errors/http-error';
import * as swagger from '../../swagger/registry';

const router = Router();

function requireTenantId(req: Request): string {
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
  if (!tenantId) throw new BadRequestError('Tenant context required');
  return tenantId;
}

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

swagger.registerPath({
  method: 'get',
  path: '/api/games/live-casino',
  summary: 'List live casino lobby games',
  tags: ['Games'],
  security: [],
  responses: { '200': { description: 'Live casino games list' } },
});

router.get(
  '/live-casino',
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    return withTenantClient({ tenantId }, async (client) => {
      const integration = await client.query(
        `SELECT id, provider, status
           FROM api_integrations
          WHERE tenant_id = $1
            AND kind IN ('game_provider', 'live_casino')
            AND status = 'active'
          ORDER BY updated_at DESC
          LIMIT 1`,
        [tenantId]
      );

      if (!integration.rows[0]) {
        return {
          games: [],
          message: 'No live casino provider configured',
        };
      }

      const games = await client.query(
        `SELECT g.id, g.name,
                COALESCE(g.config->>'dealer', 'Live Dealer') AS dealer,
                COALESCE((g.config->>'players_online')::int, 0) AS players_online,
                COALESCE(g.image_url, g.config->>'thumbnail_url') AS thumbnail_url,
                COALESCE(g.config->>'launch_url', g.config->>'embed_url', '') AS launch_url,
                COALESCE(p.slug, p.name, $2) AS provider
           FROM casino_games g
           LEFT JOIN casino_providers p ON p.id = g.provider_id
          WHERE g.tenant_id = $1
            AND g.is_active = true
            AND (
              g.category_id IN (
                SELECT id FROM casino_categories
                WHERE tenant_id = $1 AND lower(name) LIKE '%live%'
              )
              OR lower(g.slug) LIKE '%live%'
              OR lower(g.name) LIKE '%live%'
            )
          ORDER BY g.display_order ASC, g.name ASC
          LIMIT 100`,
        [tenantId, String(integration.rows[0]?.provider ?? 'provider')]
      );

      return {
        games: games.rows,
        provider: integration.rows[0]?.provider ?? null,
      };
    });
  })
);

export default router;
