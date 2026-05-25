/**
 * Section 15 — External (inbound) Game Providers.
 *
 * Admin endpoints for managing Pragmatic Play / Spribe / Evolution-style
 * providers that feed games INTO the user panel via iframe.
 *
 *   GET    /api/admin/iframe/providers
 *   POST   /api/admin/iframe/providers
 *   PATCH  /api/admin/iframe/providers/:id
 *   PATCH  /api/admin/iframe/providers/:id/status
 *   DELETE /api/admin/iframe/providers/:id
 *   POST   /api/admin/iframe/providers/:id/games
 *   DELETE /api/admin/iframe/providers/:id/games/:gameId
 *
 * Secrets are SEALED with AES-256-GCM (sealSecret) before persisting and
 * NEVER returned to the frontend — the list endpoint only exposes whether
 * `has_secret` is true.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { BadRequestError, NotFoundError } from '../../../http/errors/http-error';
import { sealSecret } from '../../../infrastructure/crypto/secret-cipher';
import { tryAudit } from '../../audit/audit.service';
import { env } from '../../../config/env';
import { getAdminScope, getIp, getUa, requireScopedTenantId } from '../admin-shared';

const router = Router();

const idParam = z.object({ id: z.string().uuid() });
const idGameParam = z.object({
  id: z.string().uuid(),
  gameId: z.string().min(1).max(100),
});

const providerCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  base_url: z.string().trim().url(),
  auth_method: z.enum(['token', 'apikey', 'none']).default('token'),
  secret: z.string().trim().min(1).optional(),
  callback_url: z.string().trim().url().optional(),
  sandbox: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

const providerPatchSchema = providerCreateSchema
  .partial()
  .extend({
    status: z.enum(['Active', 'Paused']).optional(),
  });

const statusSchema = z.object({ status: z.enum(['Active', 'Paused']) });

const addGameSchema = z.object({
  game_id: z.string().trim().min(1).max(100),
  name: z.string().trim().max(120).optional(),
  thumbnail_url: z.string().trim().url().optional(),
  enabled: z.boolean().default(true),
});

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };
const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

function slugifyProviderName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface ProviderRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  base_url: string;
  auth_method: 'token' | 'apikey' | 'none';
  callback_url: string | null;
  sandbox: boolean;
  status: 'Active' | 'Paused';
  last_ping: string | null;
  config: Record<string, unknown>;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
}

router.get(
  '/',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<ProviderRow>(
          `SELECT id, tenant_id, name, slug, base_url, auth_method,
                  callback_url, sandbox, status, last_ping, config,
                  (encrypted_secret IS NOT NULL) AS has_secret,
                  created_at, updated_at
             FROM external_game_providers
             ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
             ORDER BY name`,
          scope.tenantId ? [scope.tenantId] : []
        );
        const providerIds = r.rows.map((p) => p.id);
        const games =
          providerIds.length === 0
            ? { rows: [] as Array<{ provider_id: string; game_id: string; enabled: boolean }> }
            : await client.query<{ provider_id: string; game_id: string; enabled: boolean }>(
                `SELECT provider_id, game_id, enabled
                   FROM external_game_provider_games
                  WHERE provider_id = ANY($1::uuid[])
                  ORDER BY game_id`,
                [providerIds]
              );
        return {
          items: r.rows.map((p) => ({
            ...p,
            games: games.rows
              .filter((g) => g.provider_id === p.id)
              .map((g) => ({ game_id: g.game_id, enabled: g.enabled })),
          })),
        };
      }
    );
  })
);

router.post(
  '/',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = providerCreateSchema.parse(req.body);
    if (!/^https:/i.test(body.base_url)) {
      throw new BadRequestError('Provider base_url must use HTTPS');
    }

    const slug = slugifyProviderName(body.name);
    const callback =
      body.callback_url ?? `${env.BACKEND_URL ?? 'http://localhost:4000'}/hooks/${slug}`;
    const sealed = body.secret ? sealSecret(body.secret) : null;

    const out = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<ProviderRow>(
          `INSERT INTO external_game_providers
             (tenant_id, name, slug, base_url, auth_method, encrypted_secret,
              callback_url, sandbox, status, config)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active', $9::jsonb)
           RETURNING id, tenant_id, name, slug, base_url, auth_method,
                     callback_url, sandbox, status, last_ping, config,
                     (encrypted_secret IS NOT NULL) AS has_secret,
                     created_at, updated_at`,
          [
            tenantId,
            body.name,
            slug,
            body.base_url,
            body.auth_method,
            sealed,
            callback,
            body.sandbox,
            JSON.stringify(body.config),
          ]
        );
        return r.rows[0];
      }
    );

    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.external_provider.create',
        resource: 'external_game_providers',
        resourceId: out.id,
        payload: { name: body.name, slug, base_url: body.base_url, sandbox: body.sandbox },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );

    return out;
  })
);

router.patch(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    const body = providerPatchSchema.parse(req.body);

    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const sets: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (body.name !== undefined) {
          sets.push(`name = $${i++}`);
          values.push(body.name);
          sets.push(`slug = $${i++}`);
          values.push(slugifyProviderName(body.name));
        }
        if (body.base_url !== undefined) {
          if (!/^https:/i.test(body.base_url)) {
            throw new BadRequestError('Provider base_url must use HTTPS');
          }
          sets.push(`base_url = $${i++}`);
          values.push(body.base_url);
        }
        if (body.auth_method !== undefined) {
          sets.push(`auth_method = $${i++}`);
          values.push(body.auth_method);
        }
        if (body.callback_url !== undefined) {
          sets.push(`callback_url = $${i++}`);
          values.push(body.callback_url);
        }
        if (body.sandbox !== undefined) {
          sets.push(`sandbox = $${i++}`);
          values.push(body.sandbox);
        }
        if (body.status !== undefined) {
          sets.push(`status = $${i++}`);
          values.push(body.status);
        }
        if (body.secret !== undefined && body.secret.length > 0) {
          sets.push(`encrypted_secret = $${i++}`);
          values.push(sealSecret(body.secret));
        }
        if (body.config !== undefined) {
          sets.push(`config = config || $${i++}::jsonb`);
          values.push(JSON.stringify(body.config));
        }
        if (sets.length === 0) {
          throw new BadRequestError('Nothing to update');
        }
        values.push(id);
        const r = await client.query<ProviderRow>(
          `UPDATE external_game_providers SET ${sets.join(', ')}, updated_at = now()
             WHERE id = $${i}
           RETURNING id, tenant_id, name, slug, base_url, auth_method,
                     callback_url, sandbox, status, last_ping, config,
                     (encrypted_secret IS NOT NULL) AS has_secret,
                     created_at, updated_at`,
          values
        );
        if (!r.rows[0]) throw new NotFoundError('Provider not found');

        void tryAudit(
          {
            tenantId: r.rows[0].tenant_id,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.external_provider.update',
            resource: 'external_game_providers',
            resourceId: id,
            payload: { fields: Object.keys(body).filter((k) => k !== 'secret') },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );

        return r.rows[0];
      }
    );
  })
);

router.patch(
  '/:id/status',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    const body = statusSchema.parse(req.body);

    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<{ id: string; status: string; tenant_id: string }>(
          `UPDATE external_game_providers
              SET status = $2, updated_at = now()
            WHERE id = $1
            RETURNING id, status, tenant_id`,
          [id, body.status]
        );
        if (!r.rows[0]) throw new NotFoundError('Provider not found');

        void tryAudit(
          {
            tenantId: r.rows[0].tenant_id,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.external_provider.status',
            resource: 'external_game_providers',
            resourceId: id,
            payload: { status: body.status },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );

        return { ok: true, id, status: r.rows[0].status };
      }
    );
  })
);

router.delete(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<{ id: string; tenant_id: string }>(
          `DELETE FROM external_game_providers WHERE id = $1 RETURNING id, tenant_id`,
          [id]
        );
        if (!r.rows[0]) throw new NotFoundError('Provider not found');

        void tryAudit(
          {
            tenantId: r.rows[0].tenant_id,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.external_provider.delete',
            resource: 'external_game_providers',
            resourceId: id,
            payload: {},
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );

        return { ok: true, id };
      }
    );
  })
);

router.post(
  '/:id/games',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    const body = addGameSchema.parse(req.body);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const p = await client.query<{ id: string }>(
          `SELECT id FROM external_game_providers WHERE id = $1`,
          [id]
        );
        if (!p.rows[0]) throw new NotFoundError('Provider not found');

        const r = await client.query(
          `INSERT INTO external_game_provider_games
             (provider_id, game_id, name, thumbnail_url, enabled)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (provider_id, game_id) DO UPDATE SET
             name = EXCLUDED.name,
             thumbnail_url = EXCLUDED.thumbnail_url,
             enabled = EXCLUDED.enabled
           RETURNING id, provider_id, game_id, name, thumbnail_url, enabled`,
          [id, body.game_id, body.name ?? null, body.thumbnail_url ?? null, body.enabled]
        );
        return { ok: true, game: r.rows[0] };
      }
    );
  })
);

router.delete(
  '/:id/games/:gameId',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id, gameId } = idGameParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `DELETE FROM external_game_provider_games
             WHERE provider_id = $1 AND game_id = $2
             RETURNING id`,
          [id, gameId]
        );
        if (!r.rows[0]) throw new NotFoundError('Game not allowed for this provider');
        return { ok: true };
      }
    );
  })
);

export default router;
