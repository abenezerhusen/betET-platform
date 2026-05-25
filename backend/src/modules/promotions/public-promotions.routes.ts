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
  path: '/api/promotions/active',
  summary: 'List active public promotions',
  tags: ['Promotions'],
  security: [],
  responses: { '200': { description: 'Active promotions' } },
});

router.get(
  '/active',
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    const userId = req.user?.id ?? null;
    return withTenantClient({ tenantId }, async (client) => {
      const bonuses = await client.query(
        `SELECT r.id,
                r.name AS title,
                COALESCE(r.config->>'description', '') AS description,
                'bonus'::text AS type,
                COALESCE(r.config->>'image_url', 'https://ext.same-assets.com/1203561035/2427311734.jpeg') AS image_url,
                COALESCE(r.config->>'terms', r.name) AS terms,
                r.valid_to AS valid_to,
                'Claim Now'::text AS cta_label,
                '/deposit'::text AS cta_url,
                CASE
                  WHEN $2::uuid IS NULL THEN false
                  ELSE EXISTS (
                    SELECT 1
                    FROM bonus_assignments ba
                    WHERE ba.tenant_id = r.tenant_id
                      AND ba.bonus_rule_id = r.id
                      AND ba.user_id = $2::uuid
                  )
                END AS is_claimed
           FROM bonus_rules r
          WHERE r.tenant_id = $1
            AND r.is_active = true
            AND r.status = 'active'
            AND (r.valid_from IS NULL OR r.valid_from <= now())
            AND (r.valid_to IS NULL OR r.valid_to >= now())
          ORDER BY r.created_at DESC
          LIMIT 50`,
        [tenantId, userId]
      );

      const raffles = await client.query(
        `SELECT pr.id,
                pr.name AS title,
                COALESCE(pr.description, '') AS description,
                'raffle'::text AS type,
                COALESCE(pr.rules->>'image_url', 'https://ext.same-assets.com/1203561035/1120659285.jpeg') AS image_url,
                COALESCE(pr.rules->>'terms', pr.name) AS terms,
                pr.draw_at AS valid_to,
                'Enter Raffle'::text AS cta_label,
                '/deposit'::text AS cta_url,
                false AS is_claimed
           FROM promo_raffles pr
          WHERE pr.tenant_id = $1
            AND pr.status IN ('open', 'draft')
          ORDER BY pr.created_at DESC
          LIMIT 50`,
        [tenantId]
      );

      const tournaments = await client.query(
        `SELECT t.id,
                t.name AS title,
                COALESCE(t.description, '') AS description,
                'tournament'::text AS type,
                COALESCE(t.rules->>'image_url', 'https://ext.same-assets.com/1203561035/3783676933.jpeg') AS image_url,
                COALESCE(t.rules->>'terms', t.name) AS terms,
                t.ends_at AS valid_to,
                'Join Tournament'::text AS cta_label,
                '/promotions'::text AS cta_url,
                CASE
                  WHEN $2::uuid IS NULL THEN false
                  ELSE EXISTS (
                    SELECT 1 FROM tournament_entries te
                    WHERE te.tournament_id = t.id AND te.user_id = $2::uuid
                  )
                END AS is_claimed
           FROM tournaments t
          WHERE t.tenant_id = $1
            AND t.status IN ('scheduled', 'running')
          ORDER BY t.created_at DESC
          LIMIT 50`,
        [tenantId, userId]
      );

      return {
        items: [...bonuses.rows, ...raffles.rows, ...tournaments.rows],
      };
    });
  })
);

export default router;
