/**
 * Section 15 — Iframe Integration: OUTBOUND MODE
 *
 * "Outbound" means YOUR internal games are embedded by external white-label
 * clients. The admin panel uses these endpoints to wire the (client_id,
 * game_id, enabled, use_token) tuple plus a list of host whitelist entries.
 *
 *   GET    /api/admin/iframe/outbound/config        — load active config + whitelist
 *   PUT    /api/admin/iframe/outbound/config        — upsert (client_id, game_id, ...)
 *   POST   /api/admin/iframe/outbound/domains       — add a whitelist domain
 *   DELETE /api/admin/iframe/outbound/domains/:dom  — remove a whitelist domain
 *
 * The corresponding public endpoint is GET /embed (mounted at the app root —
 * see app.ts). It validates the requesting Origin against the whitelist,
 * checks the game-for-client config is enabled, and redirects to the game
 * engine with a short-lived internal token.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { BadRequestError, NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { getAdminScope, getIp, getUa, requireScopedTenantId } from '../admin-shared';

const router = Router();

const upsertSchema = z.object({
  client_id: z.string().trim().min(1).max(80),
  game_id: z.string().trim().min(1).max(50),
  enabled: z.boolean().default(true),
  use_token: z.boolean().default(true),
});

const domainBodySchema = z.object({
  domain: z.string().trim().min(2).max(255),
});

const domainParamSchema = z.object({
  domain: z.string().trim().min(2).max(255),
});

function normalizeDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
  domain = domain.split('/')[0]!;
  domain = domain.split(':')[0]!;
  return domain;
}

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.get(
  '/config',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const cfg = await client.query<{
          id: string;
          tenant_id: string;
          client_id: string;
          game_id: string | null;
          enabled: boolean;
          use_token: boolean;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT id, tenant_id, client_id, game_id, enabled, use_token,
                  created_at, updated_at
             FROM iframe_outbound_configs
             ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
             ORDER BY updated_at DESC`,
          scope.tenantId ? [scope.tenantId] : []
        );
        const domains = await client.query<{ id: string; domain: string }>(
          `SELECT id, domain FROM iframe_whitelisted_domains
             ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
             ORDER BY domain`,
          scope.tenantId ? [scope.tenantId] : []
        );
        return {
          configs: cfg.rows,
          whitelisted_domains: domains.rows,
        };
      }
    );
  })
);

router.put(
  '/config',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = upsertSchema.parse(req.body);

    const out = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const game = await client.query<{ id: string }>(
          `SELECT id FROM internal_games WHERE id = $1`,
          [body.game_id]
        );
        if (!game.rows[0]) throw new NotFoundError('Internal game not found');

        const r = await client.query(
          `INSERT INTO iframe_outbound_configs
             (tenant_id, client_id, game_id, enabled, use_token)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, client_id) DO UPDATE SET
             game_id = EXCLUDED.game_id,
             enabled = EXCLUDED.enabled,
             use_token = EXCLUDED.use_token,
             updated_at = now()
           RETURNING id, tenant_id, client_id, game_id, enabled, use_token,
                     created_at, updated_at`,
          [tenantId, body.client_id, body.game_id, body.enabled, body.use_token]
        );
        return r.rows[0];
      }
    );

    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.iframe.outbound.upsert',
        resource: 'iframe_outbound_configs',
        resourceId: out.id,
        payload: body,
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );

    return { ok: true, config: out };
  })
);

router.post(
  '/domains',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = domainBodySchema.parse(req.body);
    const domain = normalizeDomain(body.domain);
    if (!domain) throw new BadRequestError('Domain is required');
    if (domain.includes('/')) {
      throw new BadRequestError('Enter domain only (no path), e.g. playx.et');
    }

    const r = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) =>
        client.query(
          `INSERT INTO iframe_whitelisted_domains (tenant_id, domain)
           VALUES ($1, $2)
           ON CONFLICT (tenant_id, domain) DO UPDATE SET domain = EXCLUDED.domain
           RETURNING id, domain, created_at`,
          [tenantId, domain]
        )
    );

    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.iframe.outbound.whitelist.add',
        resource: 'iframe_whitelisted_domains',
        resourceId: r.rows[0].id,
        payload: { domain },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );

    return { ok: true, domain: r.rows[0] };
  })
);

router.delete(
  '/domains/:domain',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const { domain } = domainParamSchema.parse(req.params);
    const normalized = normalizeDomain(domain);

    const r = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) =>
        client.query(
          `DELETE FROM iframe_whitelisted_domains
             WHERE tenant_id = $1 AND domain = $2
             RETURNING id`,
          [tenantId, normalized]
        )
    );
    if (!r.rows[0]) throw new NotFoundError('Domain not in whitelist');

    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.iframe.outbound.whitelist.remove',
        resource: 'iframe_whitelisted_domains',
        resourceId: r.rows[0].id,
        payload: { domain: normalized },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );

    return { ok: true, domain: normalized };
  })
);

export default router;
