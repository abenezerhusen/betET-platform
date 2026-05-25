/**
 * Section 14 — Iframe Integration.
 *
 * Spec endpoints:
 *   GET    /api/admin/iframe/configs
 *   POST   /api/admin/iframe/configs
 *   PUT    /api/admin/iframe/configs/:id
 *   PATCH  /api/admin/iframe/configs/:id/toggle
 *   DELETE /api/admin/iframe/configs/:id
 *
 * All persistence goes through the existing `iframe_integrations` table
 * (created by 20260516175001_create_settings_extra_tables.js). This module
 * is the spec-aligned alias router; the legacy mountpoint under
 * /api/admin/configurations/iframes/* keeps working for old clients.
 *
 * URL safety: every embed_url is validated to be HTTPS, non-localhost,
 * and free of javascript:/data: schemes — matching the spec "Backend
 * validates all URLs are HTTPS before saving".
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { BadRequestError, ConflictError, NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { getAdminScope, getIp, getUa, requireScopedTenantId } from '../admin-shared';
import outboundRouter from './outbound.routes';
import inboundProvidersRouter from '../external-games/external-providers.routes';

const router = Router();

// Section 15 — Outbound iframe (we provide our games to white-label clients)
//   /api/admin/iframe/outbound/config, /api/admin/iframe/outbound/domains
router.use('/outbound', outboundRouter);

// Section 15 — Inbound iframe (external providers feed games to OUR user panel)
//   /api/admin/iframe/providers, /api/admin/iframe/providers/:id/games, ...
router.use('/providers', inboundProvidersRouter);

const idParam = z.object({ id: z.string().uuid() });

const iframeSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(80),
  embed_url: z.string().trim().url(),
  /** Spec field; tolerated as a JSON-extra here. */
  category: z.string().trim().max(80).optional(),
  width: z.string().trim().max(20).default('100%'),
  height: z.string().trim().max(20).default('600px'),
  allow: z.string().trim().max(500).optional(),
  sandbox: z.string().trim().max(500).optional(),
  allowed_origins: z.array(z.string().trim().min(1).max(160)).default([]),
  is_active: z.boolean().default(true),
  visibility: z.enum(['admin', 'user', 'public']).default('admin'),
  config: z.record(z.unknown()).default({}),
});
const updateIframeSchema = iframeSchema.partial();

function validateIframeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestError('Invalid iframe URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestError('Only HTTPS iframe URLs are allowed');
  }
  if (parsed.hostname.toLowerCase() === 'localhost') {
    throw new BadRequestError('Localhost iframe URLs are not allowed');
  }
  if (url.trim().toLowerCase().startsWith('javascript:')) {
    throw new BadRequestError('javascript: iframe URLs are not allowed');
  }
  if (url.trim().toLowerCase().startsWith('data:')) {
    throw new BadRequestError('data: iframe URLs are not allowed');
  }
}

const SELECT_COLS = `id, tenant_id, name, slug, embed_url, width, height,
                     allowed_origins, is_active, visibility, config,
                     created_at, updated_at`;

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

router.get(
  '/configs',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `SELECT ${SELECT_COLS}
             FROM iframe_integrations
             ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
             ORDER BY name`,
          scope.tenantId ? [scope.tenantId] : []
        );
        return { items: r.rows };
      }
    );
  })
);

router.post(
  '/configs',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = iframeSchema.parse(req.body);
    validateIframeUrl(body.embed_url);

    // Pack spec-only fields (category/allow/sandbox) into config json so we
    // don't have to migrate the table just for these UI hints.
    const config = {
      ...body.config,
      ...(body.category ? { category: body.category } : {}),
      ...(body.allow ? { allow: body.allow } : {}),
      ...(body.sandbox ? { sandbox: body.sandbox } : {}),
    };

    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        try {
          const r = await client.query(
            `INSERT INTO iframe_integrations (
               tenant_id, name, slug, embed_url, width, height, allowed_origins,
               is_active, visibility, config
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
             RETURNING ${SELECT_COLS}`,
            [
              tenantId,
              body.name,
              body.slug,
              body.embed_url,
              body.width,
              body.height,
              body.allowed_origins,
              body.is_active,
              body.visibility,
              JSON.stringify(config),
            ]
          );
          void tryAudit(
            {
              tenantId,
              actorId: scope.actorId,
              actorType: scope.actorType,
              action: 'admin.iframe.create',
              resource: 'iframe_integrations',
              resourceId: r.rows[0].id,
              payload: { name: body.name, slug: body.slug },
              ip: getIp(req),
              userAgent: getUa(req),
              status: 'success',
            },
            { bypassRls: true }
          );
          return r.rows[0];
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            throw new ConflictError('Iframe slug already exists');
          }
          throw err;
        }
      }
    );
  })
);

router.put(
  '/configs/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    const body = updateIframeSchema.parse(req.body);
    if (body.embed_url) validateIframeUrl(body.embed_url);

    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const sets: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        const directKeys: (keyof typeof body)[] = [
          'name',
          'slug',
          'embed_url',
          'width',
          'height',
          'allowed_origins',
          'is_active',
          'visibility',
        ];
        for (const k of directKeys) {
          if (body[k] !== undefined) {
            sets.push(`${k} = $${i++}`);
            values.push(body[k]);
          }
        }
        // Merge config json + spec extras.
        if (body.config || body.category || body.allow || body.sandbox) {
          const extra = {
            ...(body.config ?? {}),
            ...(body.category ? { category: body.category } : {}),
            ...(body.allow ? { allow: body.allow } : {}),
            ...(body.sandbox ? { sandbox: body.sandbox } : {}),
          };
          sets.push(`config = config || $${i++}::jsonb`);
          values.push(JSON.stringify(extra));
        }
        if (!sets.length) throw new ConflictError('Nothing to update');
        values.push(id);
        const r = await client.query(
          `UPDATE iframe_integrations SET ${sets.join(', ')}, updated_at = now()
             WHERE id = $${i}
           RETURNING ${SELECT_COLS}`,
          values
        );
        if (!r.rows[0]) throw new NotFoundError('Iframe not found');
        return r.rows[0];
      }
    );
  })
);

router.patch(
  '/configs/:id/toggle',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `UPDATE iframe_integrations
              SET is_active = NOT is_active, updated_at = now()
            WHERE id = $1
            RETURNING ${SELECT_COLS}`,
          [id]
        );
        if (!r.rows[0]) throw new NotFoundError('Iframe not found');
        return r.rows[0];
      }
    );
  })
);

router.delete(
  '/configs/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `DELETE FROM iframe_integrations WHERE id = $1 RETURNING id`,
          [id]
        );
        if (!r.rows[0]) throw new NotFoundError('Iframe not found');
        return { ok: true, id };
      }
    );
  })
);

export default router;
