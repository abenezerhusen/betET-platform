/**
 * Section 14 — APIs & Integrations.
 *
 * Spec endpoints:
 *   GET   /api/admin/integrations             — list configured providers
 *   POST  /api/admin/integrations             — register new integration
 *   PATCH /api/admin/integrations/:id         — enable/disable + partial patch
 *   POST  /api/admin/integrations/:id/key     — rotate / update API key
 *                                                (secret stored backend-only)
 *   POST  /api/admin/integrations/:id/test    — test connection (ping)
 *   DELETE /api/admin/integrations/:id        — remove an integration
 *
 * Persistence reuses the existing `api_integrations` table that the legacy
 * /api/admin/configurations/integrations router writes into. We never echo
 * secret values back to the client — only the set of configured key names.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ConflictError, NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { getAdminScope, getIp, getUa, requireScopedTenantId } from '../admin-shared';

const router = Router();

const idParam = z.object({ id: z.string().uuid() });

const integrationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['payment', 'sms', 'game_provider', 'odds', 'analytics', 'custom']).default('custom'),
  provider: z.string().trim().min(1).max(120),
  base_url: z.string().trim().url().optional(),
  secrets: z.record(z.unknown()).default({}),
  config: z.record(z.unknown()).default({}),
  status: z.enum(['active', 'inactive', 'error']).default('active'),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  kind: z
    .enum(['payment', 'sms', 'game_provider', 'odds', 'analytics', 'custom'])
    .optional(),
  provider: z.string().trim().min(1).max(120).optional(),
  base_url: z.string().trim().url().optional(),
  config: z.record(z.unknown()).optional(),
  /** Spec uses a boolean "enabled" toggle; we map to status under the hood. */
  enabled: z.boolean().optional(),
  status: z.enum(['active', 'inactive', 'error']).optional(),
});

const keySchema = z.object({
  api_key: z.string().trim().min(1).optional(),
  secret: z.string().trim().min(1).optional(),
  /** Free-form bag of additional secret keys to merge in. */
  secrets: z.record(z.unknown()).optional(),
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

function shapeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  // Never return raw `secrets` jsonb to the client; expose key names only.
  delete out.secrets;
  return out;
}

router.get(
  '/',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<Record<string, unknown>>(
          `SELECT id, tenant_id, name, kind, provider, base_url, config, status,
                  last_health_at, created_at, updated_at,
                  COALESCE(
                    (SELECT array_agg(k)
                       FROM jsonb_object_keys(secrets) AS k),
                    '{}'::text[]
                  ) AS configured_secret_keys
             FROM api_integrations
             ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
             ORDER BY name`,
          scope.tenantId ? [scope.tenantId] : []
        );
        return { items: r.rows.map(shapeRow) };
      }
    );
  })
);

router.post(
  '/',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = integrationSchema.parse(req.body);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<Record<string, unknown>>(
          `INSERT INTO api_integrations (
             tenant_id, name, kind, provider, base_url, secrets, config, status
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
           ON CONFLICT (tenant_id, provider) DO UPDATE SET
             name = EXCLUDED.name,
             kind = EXCLUDED.kind,
             base_url = EXCLUDED.base_url,
             secrets = api_integrations.secrets || EXCLUDED.secrets,
             config = api_integrations.config || EXCLUDED.config,
             status = EXCLUDED.status,
             updated_at = now()
           RETURNING id, tenant_id, name, kind, provider, base_url, config, status,
                     last_health_at, created_at, updated_at`,
          [
            tenantId,
            body.name,
            body.kind,
            body.provider,
            body.base_url ?? null,
            JSON.stringify(body.secrets),
            JSON.stringify(body.config),
            body.status,
          ]
        );
        void tryAudit(
          {
            tenantId,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.integration.upsert',
            resource: 'api_integrations',
            resourceId: r.rows[0].id as string,
            payload: { provider: body.provider, kind: body.kind, status: body.status },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );
        return shapeRow(r.rows[0]);
      }
    );
  })
);

router.patch(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    const body = patchSchema.parse(req.body);

    const status =
      body.status ??
      (body.enabled === undefined ? undefined : body.enabled ? 'active' : 'inactive');

    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const sets: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (body.name !== undefined) {
          sets.push(`name = $${i++}`);
          values.push(body.name);
        }
        if (body.kind !== undefined) {
          sets.push(`kind = $${i++}`);
          values.push(body.kind);
        }
        if (body.provider !== undefined) {
          sets.push(`provider = $${i++}`);
          values.push(body.provider);
        }
        if (body.base_url !== undefined) {
          sets.push(`base_url = $${i++}`);
          values.push(body.base_url);
        }
        if (body.config !== undefined) {
          sets.push(`config = config || $${i++}::jsonb`);
          values.push(JSON.stringify(body.config));
        }
        if (status !== undefined) {
          sets.push(`status = $${i++}`);
          values.push(status);
        }
        if (!sets.length) throw new ConflictError('Nothing to update');
        sets.push('updated_at = now()');
        values.push(id);
        const r = await client.query<Record<string, unknown>>(
          `UPDATE api_integrations SET ${sets.join(', ')}
             WHERE id = $${i}
           RETURNING id, tenant_id, name, kind, provider, base_url, config, status,
                     last_health_at, created_at, updated_at`,
          values
        );
        if (!r.rows[0]) throw new NotFoundError('Integration not found');
        void tryAudit(
          {
            tenantId: r.rows[0].tenant_id as string,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.integration.patch',
            resource: 'api_integrations',
            resourceId: id,
            payload: { status, fields: Object.keys(body) },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );
        return shapeRow(r.rows[0]);
      }
    );
  })
);

router.post(
  '/:id/key',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    const body = keySchema.parse(req.body);
    const newSecrets = {
      ...(body.secrets ?? {}),
      ...(body.api_key ? { api_key: body.api_key } : {}),
      ...(body.secret ? { secret: body.secret } : {}),
    };
    if (Object.keys(newSecrets).length === 0) {
      throw new ConflictError('Provide api_key, secret, or a secrets object');
    }
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<{
          id: string;
          tenant_id: string;
          provider: string;
          configured: string[];
        }>(
          `UPDATE api_integrations
              SET secrets = secrets || $1::jsonb,
                  updated_at = now()
            WHERE id = $2
            RETURNING id, tenant_id, provider,
                      COALESCE(
                        (SELECT array_agg(k)
                           FROM jsonb_object_keys(secrets) AS k),
                        '{}'::text[]
                      ) AS configured`,
          [JSON.stringify(newSecrets), id]
        );
        if (!r.rows[0]) throw new NotFoundError('Integration not found');
        void tryAudit(
          {
            tenantId: r.rows[0].tenant_id,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.integration.key.update',
            resource: 'api_integrations',
            resourceId: id,
            // Never store the actual secret in audit payloads.
            payload: { provider: r.rows[0].provider, keys: Object.keys(newSecrets) },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );
        return {
          id: r.rows[0].id,
          provider: r.rows[0].provider,
          configured_secret_keys: r.rows[0].configured,
        };
      }
    );
  })
);

/**
 * Real provider ping. Reads the encrypted secret stored under
 * `api_integrations.secrets.api_key` (or .token), then issues a HEAD/GET to
 * a well-known health URL for each supported provider. The actual key never
 * leaves the backend.
 */
async function probeProvider(args: {
  provider: string;
  base_url: string | null;
  apiKey: string;
}): Promise<{ ok: boolean; status: 'connected' | 'failed' | 'unsupported' | 'untested'; detail?: string }> {
  const provider = args.provider.toLowerCase().trim();
  const headers: Record<string, string> = { Accept: 'application/json' };

  try {
    if (provider === 'chapa') {
      const url = 'https://api.chapa.co/v1/banks';
      const res = await fetch(url, {
        method: 'GET',
        headers: { ...headers, Authorization: `Bearer ${args.apiKey}` },
      });
      return res.ok
        ? { ok: true, status: 'connected', detail: `HTTP ${res.status}` }
        : { ok: false, status: 'failed', detail: `HTTP ${res.status}` };
    }
    if (provider === 'betradar' || provider === 'sportradar') {
      if (!args.base_url) {
        return { ok: false, status: 'failed', detail: 'base_url required' };
      }
      const url = `${args.base_url.replace(/\/$/, '')}/health`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { ...headers, 'X-API-KEY': args.apiKey },
      });
      return res.ok
        ? { ok: true, status: 'connected', detail: `HTTP ${res.status}` }
        : { ok: false, status: 'failed', detail: `HTTP ${res.status}` };
    }
    if (provider === 'stripe') {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        method: 'GET',
        headers: { ...headers, Authorization: `Bearer ${args.apiKey}` },
      });
      return res.ok
        ? { ok: true, status: 'connected', detail: `HTTP ${res.status}` }
        : { ok: false, status: 'failed', detail: `HTTP ${res.status}` };
    }
    if (args.base_url) {
      const res = await fetch(args.base_url.replace(/\/$/, '') + '/health', {
        method: 'GET',
        headers,
      });
      return res.ok
        ? { ok: true, status: 'connected', detail: `HTTP ${res.status}` }
        : { ok: false, status: 'failed', detail: `HTTP ${res.status}` };
    }
    return { ok: false, status: 'unsupported', detail: 'No probe known for this provider' };
  } catch (err) {
    return { ok: false, status: 'failed', detail: (err as Error).message };
  }
}

router.post(
  '/:id/test',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const row = await client.query<{
          id: string;
          provider: string;
          base_url: string | null;
          api_key: string | null;
          token: string | null;
        }>(
          `SELECT id, provider, base_url,
                  secrets->>'api_key' AS api_key,
                  secrets->>'token'   AS token
             FROM api_integrations WHERE id = $1`,
          [id]
        );
        if (!row.rows[0]) throw new NotFoundError('Integration not found');
        const key = row.rows[0].api_key ?? row.rows[0].token ?? '';

        const probe = key.length
          ? await probeProvider({
              provider: row.rows[0].provider,
              base_url: row.rows[0].base_url,
              apiKey: key,
            })
          : { ok: false, status: 'untested' as const, detail: 'No key configured' };

        const newStatus =
          probe.status === 'connected'
            ? 'active'
            : probe.status === 'failed'
            ? 'error'
            : undefined;
        const upd = await client.query<{
          id: string;
          last_health_at: string;
          status: string;
        }>(
          newStatus
            ? `UPDATE api_integrations
                 SET last_health_at = now(), status = $2
               WHERE id = $1
               RETURNING id, last_health_at, status`
            : `UPDATE api_integrations
                 SET last_health_at = now()
               WHERE id = $1
               RETURNING id, last_health_at, status`,
          newStatus ? [id, newStatus] : [id]
        );
        return {
          ...upd.rows[0],
          ok: probe.ok,
          probe_status: probe.status,
          detail: probe.detail ?? null,
        };
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
        const r = await client.query(
          `DELETE FROM api_integrations WHERE id = $1 RETURNING id`,
          [id]
        );
        if (!r.rows[0]) throw new NotFoundError('Integration not found');
        return { ok: true, id };
      }
    );
  })
);

export default router;
