import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ConflictError, NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

/* -------------------------------------------------------------------------- */
/* DTO common                                                                  */
/* -------------------------------------------------------------------------- */

const idParam = z.object({ id: z.string().uuid() });

function applyPatch<T extends Record<string, unknown>>(
  patch: Partial<T>,
  jsonbKeys: string[] = []
): { sets: string[]; values: unknown[]; nextIdx: number } {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (jsonbKeys.includes(k)) {
      sets.push(`${k} = $${i++}::jsonb`);
      values.push(JSON.stringify(v));
    } else {
      sets.push(`${k} = $${i++}`);
      values.push(v);
    }
  }
  return { sets, values, nextIdx: i };
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* SMS templates + provider config (provider config in `settings`)             */
/* -------------------------------------------------------------------------- */

const smsTemplateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2000),
  language: z.string().trim().min(1).max(8).default('en'),
  is_active: z.boolean().default(true),
});

const updateSmsTemplateSchema = smsTemplateSchema.partial();

const smsConfigSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  sender_id: z.string().trim().min(1).max(80),
  api_url: z.string().trim().url().optional(),
  api_key: z.string().trim().min(1).optional(),
  default_language: z.string().trim().min(1).max(8).default('en'),
  features: z.record(z.boolean()).optional(),
});

const SMS_CONFIG_KEY = 'sms.provider.config';
const SECURITY_CONFIG_KEY = 'security.config';
const MAINTENANCE_CONFIG_KEY = 'maintenance.config';

async function listSmsTemplates(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, code, name, body, language, is_active, created_at, updated_at
           FROM sms_templates
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY code, language`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function createSmsTemplate(req: Request, body: z.infer<typeof smsTemplateSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      try {
        const r = await client.query(
          `INSERT INTO sms_templates (tenant_id, code, name, body, language, is_active)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, tenant_id, code, name, body, language, is_active, created_at, updated_at`,
          [tenantId, body.code, body.name, body.body, body.language, body.is_active]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Template (code, language) already exists');
        }
        throw err;
      }
    }
  );
}

async function updateSmsTemplate(req: Request, id: string, body: z.infer<typeof updateSmsTemplateSchema>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const { sets, values, nextIdx } = applyPatch(body);
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE sms_templates SET ${sets.join(', ')} WHERE id = $${nextIdx}
         RETURNING id, tenant_id, code, name, body, language, is_active, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Template not found');
      return r.rows[0];
    }
  );
}

async function deleteSmsTemplate(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM sms_templates WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Template not found');
      return { ok: true };
    }
  );
}

async function readSettingsKey(req: Request, key: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2`,
        [tenantId, key]
      );
      return r.rows[0]?.value ?? {};
    }
  );
}

async function writeSettingsKey(req: Request, key: string, value: Record<string, unknown>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      await client.query(
        `INSERT INTO settings (tenant_id, key, value)
         VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (tenant_id, key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = now()`,
        [tenantId, key, JSON.stringify(value)]
      );
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: `admin.settings.${key.replace(/\./g, '_')}.update`,
          resource: 'settings',
          resourceId: key,
          payload: { after: { ...value, api_key: undefined, secret: undefined } },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return value;
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

const securitySchema = z.object({
  password_min_length: z.number().int().min(6).max(128).optional(),
  password_require_uppercase: z.boolean().optional(),
  password_require_number: z.boolean().optional(),
  password_require_symbol: z.boolean().optional(),
  password_expiry_days: z.number().int().nonnegative().optional(),
  session_timeout_minutes: z.number().int().positive().optional(),
  mfa_required_for_admins: z.boolean().optional(),
  ip_allowlist: z.array(z.string().min(2).max(64)).optional(),
  ip_blocklist: z.array(z.string().min(2).max(64)).optional(),
  max_failed_logins: z.number().int().positive().optional(),
  lockout_minutes: z.number().int().positive().optional(),
});

/* -------------------------------------------------------------------------- */
/* Maintenance                                                                 */
/* -------------------------------------------------------------------------- */

const maintenanceConfigSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().trim().max(2000).optional(),
  scheduled_start: z.coerce.date().optional(),
  scheduled_end: z.coerce.date().optional(),
  bypass_role: z.string().trim().max(80).optional(),
});

const maintenanceJobSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z
    .enum(['vacuum', 'archive_audit', 'rebuild_indexes', 'clear_cache', 'custom'])
    .default('custom'),
  schedule_cron: z.string().trim().max(120).optional(),
  config: z.record(z.unknown()).default({}),
  is_active: z.boolean().default(true),
});

const updateMaintenanceJobSchema = maintenanceJobSchema.partial();

async function listMaintenanceJobs(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, name, kind, schedule_cron, last_run_at, last_status,
                last_message, config, is_active, created_at, updated_at
           FROM maintenance_jobs
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY name`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function createMaintenanceJob(req: Request, body: z.infer<typeof maintenanceJobSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      try {
        const r = await client.query(
          `INSERT INTO maintenance_jobs (
             tenant_id, name, kind, schedule_cron, config, is_active
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
           RETURNING id, tenant_id, name, kind, schedule_cron, last_run_at,
                     last_status, last_message, config, is_active, created_at, updated_at`,
          [tenantId, body.name, body.kind, body.schedule_cron ?? null, JSON.stringify(body.config), body.is_active]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Maintenance job name already exists');
        }
        throw err;
      }
    }
  );
}

async function updateMaintenanceJob(
  req: Request,
  id: string,
  body: z.infer<typeof updateMaintenanceJobSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const { sets, values, nextIdx } = applyPatch(body, ['config']);
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE maintenance_jobs SET ${sets.join(', ')} WHERE id = $${nextIdx}
         RETURNING id, tenant_id, name, kind, schedule_cron, last_run_at,
                   last_status, last_message, config, is_active, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Maintenance job not found');
      return r.rows[0];
    }
  );
}

async function deleteMaintenanceJob(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM maintenance_jobs WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Maintenance job not found');
      return { ok: true };
    }
  );
}

async function runMaintenanceJob(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE maintenance_jobs
            SET last_run_at = now(), last_status = 'running'
          WHERE id = $1
          RETURNING id, tenant_id, kind, last_run_at, last_status`,
        [id]
      );
      if (!r.rows[0]) throw new NotFoundError('Maintenance job not found');
      // The job runner is asynchronous; immediate response so the UI can poll.
      return r.rows[0];
    }
  );
}

/* -------------------------------------------------------------------------- */
/* API keys                                                                    */
/* -------------------------------------------------------------------------- */

const apiKeySchema = z.object({
  name: z.string().trim().min(1).max(160),
  scopes: z.array(z.string().min(1).max(120)).default([]),
  expires_at: z.coerce.date().optional(),
});

async function listApiKeys(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, name, key_prefix, scopes, is_active, expires_at,
                last_used_at, created_by, created_at, updated_at
           FROM api_keys
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY created_at DESC`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function issueApiKey(req: Request, body: z.infer<typeof apiKeySchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const plaintext = `ek_${crypto.randomBytes(24).toString('base64url')}`;
      const keyHash = sha256(plaintext);
      const keyPrefix = plaintext.slice(0, 8);
      const r = await client.query(
        `INSERT INTO api_keys (
           tenant_id, name, key_hash, key_prefix, scopes, expires_at, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, tenant_id, name, key_prefix, scopes, is_active,
                   expires_at, last_used_at, created_by, created_at, updated_at`,
        [tenantId, body.name, keyHash, keyPrefix, body.scopes, body.expires_at ?? null, scope.actorId]
      );
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.api_key.issue',
          resource: 'api_keys',
          resourceId: r.rows[0].id,
          payload: { name: body.name, scopes: body.scopes, key_prefix: keyPrefix },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return { ...r.rows[0], plaintext };
    }
  );
}

async function revokeApiKey(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE api_keys SET is_active = false WHERE id = $1
         RETURNING id, name, key_prefix, is_active`,
        [id]
      );
      if (!r.rows[0]) throw new NotFoundError('API key not found');
      return r.rows[0];
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Iframe integrations                                                         */
/* -------------------------------------------------------------------------- */

const iframeSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(80),
  embed_url: z.string().trim().url(),
  width: z.string().trim().max(20).default('100%'),
  height: z.string().trim().max(20).default('600px'),
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
    throw new ConflictError('Invalid iframe URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new ConflictError('Only HTTPS iframe URLs are allowed');
  }
  if (parsed.hostname.toLowerCase() === 'localhost') {
    throw new ConflictError('Localhost iframe URLs are not allowed');
  }
  if (url.trim().toLowerCase().startsWith('javascript:')) {
    throw new ConflictError('javascript: iframe URLs are not allowed');
  }
  if (url.trim().toLowerCase().startsWith('data:')) {
    throw new ConflictError('data: iframe URLs are not allowed');
  }
}

async function listIframes(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, name, slug, embed_url, width, height, allowed_origins,
                is_active, visibility, config, created_at, updated_at
           FROM iframe_integrations
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY name`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function createIframe(req: Request, body: z.infer<typeof iframeSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      validateIframeUrl(body.embed_url);
      try {
        const r = await client.query(
          `INSERT INTO iframe_integrations (
             tenant_id, name, slug, embed_url, width, height, allowed_origins,
             is_active, visibility, config
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
           RETURNING id, tenant_id, name, slug, embed_url, width, height,
                     allowed_origins, is_active, visibility, config, created_at, updated_at`,
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
            JSON.stringify(body.config),
          ]
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
}

async function updateIframe(req: Request, id: string, body: z.infer<typeof updateIframeSchema>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      if (body.embed_url) validateIframeUrl(body.embed_url);
      const { sets, values, nextIdx } = applyPatch(body, ['config']);
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE iframe_integrations SET ${sets.join(', ')} WHERE id = $${nextIdx}
         RETURNING id, tenant_id, name, slug, embed_url, width, height,
                   allowed_origins, is_active, visibility, config, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Iframe not found');
      return r.rows[0];
    }
  );
}

async function toggleIframe(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE iframe_integrations
            SET is_active = NOT is_active
          WHERE id = $1
          RETURNING id, tenant_id, name, slug, embed_url, width, height,
                    allowed_origins, is_active, visibility, config, created_at, updated_at`,
        [id]
      );
      if (!r.rows[0]) throw new NotFoundError('Iframe not found');
      return r.rows[0];
    }
  );
}

async function deleteIframe(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM iframe_integrations WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Iframe not found');
      return { ok: true };
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Packages                                                                    */
/* -------------------------------------------------------------------------- */

const packageSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(80),
  period: z.enum(['monthly', 'yearly', 'one_time']).default('monthly'),
  price: z.number().nonnegative().default(0),
  currency: z.string().trim().min(1).max(8).default('ETB'),
  features: z.array(z.string().min(1)).default([]),
  limits: z.record(z.unknown()).default({}),
  is_active: z.boolean().default(true),
  is_popular: z.boolean().default(false),
  display_order: z.number().int().nonnegative().default(100),
});

const updatePackageSchema = packageSchema.partial();

async function listPackages(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, name, slug, period, price, currency, features, limits,
                is_active, is_popular, display_order, created_at, updated_at
           FROM package_plans
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY display_order ASC, name`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function createPackage(req: Request, body: z.infer<typeof packageSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      try {
        const r = await client.query(
          `INSERT INTO package_plans (
             tenant_id, name, slug, period, price, currency, features, limits,
             is_active, is_popular, display_order
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)
           RETURNING id, tenant_id, name, slug, period, price, currency, features,
                     limits, is_active, is_popular, display_order, created_at, updated_at`,
          [
            tenantId,
            body.name,
            body.slug,
            body.period,
            body.price,
            body.currency,
            JSON.stringify(body.features),
            JSON.stringify(body.limits),
            body.is_active,
            body.is_popular,
            body.display_order,
          ]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Package slug already exists');
        }
        throw err;
      }
    }
  );
}

async function updatePackage(req: Request, id: string, body: z.infer<typeof updatePackageSchema>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const { sets, values, nextIdx } = applyPatch(body, ['features', 'limits']);
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE package_plans SET ${sets.join(', ')} WHERE id = $${nextIdx}
         RETURNING id, tenant_id, name, slug, period, price, currency, features,
                   limits, is_active, is_popular, display_order, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Package not found');
      return r.rows[0];
    }
  );
}

async function deletePackage(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM package_plans WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Package not found');
      return { ok: true };
    }
  );
}

/* -------------------------------------------------------------------------- */
/* External API integrations                                                   */
/* -------------------------------------------------------------------------- */

const integrationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['payment', 'sms', 'game_provider', 'analytics', 'custom']).default('custom'),
  provider: z.string().trim().min(1).max(120),
  base_url: z.string().trim().url().optional(),
  secrets: z.record(z.unknown()).default({}),
  config: z.record(z.unknown()).default({}),
  status: z.enum(['active', 'inactive', 'error']).default('active'),
});

const updateIntegrationSchema = integrationSchema.partial();

async function listIntegrations(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, name, kind, provider, base_url, config, status,
                last_health_at, created_at, updated_at,
                jsonb_object_keys(secrets) AS _secret_keys
           FROM api_integrations
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY name`,
        scope.tenantId ? [scope.tenantId] : []
      );
      // Group secret keys per row (so we never expose values).
      const grouped = new Map<string, { row: typeof r.rows[number]; keys: string[] }>();
      for (const row of r.rows) {
        const e = grouped.get(row.id);
        if (e) e.keys.push(row._secret_keys);
        else grouped.set(row.id, { row, keys: row._secret_keys ? [row._secret_keys] : [] });
      }
      return {
        items: Array.from(grouped.values()).map(({ row, keys }) => ({
          id: row.id,
          tenant_id: row.tenant_id,
          name: row.name,
          kind: row.kind,
          provider: row.provider,
          base_url: row.base_url,
          config: row.config,
          status: row.status,
          last_health_at: row.last_health_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          configured_secret_keys: keys,
        })),
      };
    }
  );
}

async function upsertIntegration(req: Request, body: z.infer<typeof integrationSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `INSERT INTO api_integrations (
           tenant_id, name, kind, provider, base_url, secrets, config, status
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
         ON CONFLICT (tenant_id, provider) DO UPDATE SET
           name = EXCLUDED.name,
           kind = EXCLUDED.kind,
           base_url = EXCLUDED.base_url,
           secrets = api_integrations.secrets || EXCLUDED.secrets,
           config = api_integrations.config || EXCLUDED.config,
           status = EXCLUDED.status
         RETURNING id, tenant_id, name, kind, provider, base_url, status,
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
          action: 'admin.api_integration.upsert',
          resource: 'api_integrations',
          resourceId: r.rows[0].id,
          payload: { provider: body.provider, kind: body.kind, status: body.status },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return r.rows[0];
    }
  );
}

async function updateIntegration(
  req: Request,
  id: string,
  body: z.infer<typeof updateIntegrationSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const { sets, values, nextIdx } = applyPatch(body, ['secrets', 'config']);
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE api_integrations SET ${sets.join(', ')} WHERE id = $${nextIdx}
         RETURNING id, tenant_id, name, kind, provider, base_url, status,
                   last_health_at, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Integration not found');
      return r.rows[0];
    }
  );
}

async function deleteIntegration(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM api_integrations WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Integration not found');
      return { ok: true };
    }
  );
}

async function pingIntegration(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE api_integrations SET last_health_at = now()
           WHERE id = $1
           RETURNING id, last_health_at, status`,
        [id]
      );
      if (!r.rows[0]) throw new NotFoundError('Integration not found');
      return r.rows[0];
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Game picks                                                                  */
/* -------------------------------------------------------------------------- */

const gamePickSchema = z.object({
  bucket: z.enum(['featured', 'hot', 'upcoming', 'top_odds']).default('featured'),
  event_id: z.string().uuid().optional(),
  casino_game_id: z.string().uuid().optional(),
  display_order: z.number().int().nonnegative().default(100),
  is_active: z.boolean().default(true),
});

async function listGamePicks(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, bucket, event_id, casino_game_id, display_order,
                is_active, created_at, updated_at
           FROM game_picks
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY bucket, display_order ASC`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function createGamePick(req: Request, body: z.infer<typeof gamePickSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  if (!body.event_id && !body.casino_game_id) {
    throw new ConflictError('Provide event_id or casino_game_id');
  }
  if (body.event_id && body.casino_game_id) {
    throw new ConflictError('Provide only one of event_id or casino_game_id');
  }
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `INSERT INTO game_picks (
           tenant_id, bucket, event_id, casino_game_id, display_order, is_active
         ) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, tenant_id, bucket, event_id, casino_game_id, display_order,
                   is_active, created_at, updated_at`,
        [
          tenantId,
          body.bucket,
          body.event_id ?? null,
          body.casino_game_id ?? null,
          body.display_order,
          body.is_active,
        ]
      );
      return r.rows[0];
    }
  );
}

async function deleteGamePick(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM game_picks WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Game pick not found');
      return { ok: true };
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Match stats                                                                 */
/* -------------------------------------------------------------------------- */

const matchStatsSchema = z.object({
  event_id: z.string().uuid(),
  period: z.string().trim().min(1).max(40).default('live'),
  stats: z.record(z.unknown()),
});

async function getMatchStats(req: Request, eventId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, event_id, period, stats, fetched_at, updated_at
           FROM match_stats
           WHERE event_id = $1
           ORDER BY period`,
        [eventId]
      );
      return { items: r.rows };
    }
  );
}

async function upsertMatchStats(req: Request, body: z.infer<typeof matchStatsSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `INSERT INTO match_stats (tenant_id, event_id, period, stats, fetched_at)
         VALUES ($1,$2,$3,$4::jsonb, now())
         ON CONFLICT (event_id, period) DO UPDATE
           SET stats = EXCLUDED.stats, fetched_at = now()
         RETURNING id, tenant_id, event_id, period, stats, fetched_at, updated_at`,
        [tenantId, body.event_id, body.period, JSON.stringify(body.stats)]
      );
      return r.rows[0];
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

const router = Router();

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
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

/* SMS templates + provider config */
router.get('/sms/templates', wrap((req) => listSmsTemplates(req)));
router.post(
  '/sms/templates',
  wrapStatus(201, (req) => createSmsTemplate(req, smsTemplateSchema.parse(req.body)))
);
router.put(
  '/sms/templates/:id',
  wrap((req) => updateSmsTemplate(req, idParam.parse(req.params).id, updateSmsTemplateSchema.parse(req.body)))
);
router.delete(
  '/sms/templates/:id',
  wrap((req) => deleteSmsTemplate(req, idParam.parse(req.params).id))
);
router.get('/sms/config', wrap((req) => readSettingsKey(req, SMS_CONFIG_KEY)));
router.put(
  '/sms/config',
  wrap((req) => writeSettingsKey(req, SMS_CONFIG_KEY, smsConfigSchema.parse(req.body)))
);

/* Security settings */
router.get('/security', wrap((req) => readSettingsKey(req, SECURITY_CONFIG_KEY)));
router.put(
  '/security',
  wrap((req) => writeSettingsKey(req, SECURITY_CONFIG_KEY, securitySchema.parse(req.body)))
);

/* Maintenance */
router.get('/maintenance/config', wrap((req) => readSettingsKey(req, MAINTENANCE_CONFIG_KEY)));
router.put(
  '/maintenance/config',
  wrap((req) => writeSettingsKey(req, MAINTENANCE_CONFIG_KEY, maintenanceConfigSchema.parse(req.body)))
);
router.get('/maintenance/jobs', wrap((req) => listMaintenanceJobs(req)));
router.post(
  '/maintenance/jobs',
  wrapStatus(201, (req) => createMaintenanceJob(req, maintenanceJobSchema.parse(req.body)))
);
router.put(
  '/maintenance/jobs/:id',
  wrap((req) =>
    updateMaintenanceJob(req, idParam.parse(req.params).id, updateMaintenanceJobSchema.parse(req.body))
  )
);
router.delete(
  '/maintenance/jobs/:id',
  wrap((req) => deleteMaintenanceJob(req, idParam.parse(req.params).id))
);
router.post(
  '/maintenance/jobs/:id/run',
  wrap((req) => runMaintenanceJob(req, idParam.parse(req.params).id))
);

/* API keys */
router.get('/api-keys', wrap((req) => listApiKeys(req)));
router.post(
  '/api-keys',
  wrapStatus(201, (req) => issueApiKey(req, apiKeySchema.parse(req.body)))
);
router.post(
  '/api-keys/:id/revoke',
  wrap((req) => revokeApiKey(req, idParam.parse(req.params).id))
);

/* Iframe integrations */
router.get('/iframes', wrap((req) => listIframes(req)));
router.post(
  '/iframes',
  wrapStatus(201, (req) => createIframe(req, iframeSchema.parse(req.body)))
);
router.put(
  '/iframes/:id',
  wrap((req) => updateIframe(req, idParam.parse(req.params).id, updateIframeSchema.parse(req.body)))
);
router.patch(
  '/iframes/:id/toggle',
  wrap((req) => toggleIframe(req, idParam.parse(req.params).id))
);
router.delete(
  '/iframes/:id',
  wrap((req) => deleteIframe(req, idParam.parse(req.params).id))
);

/* Packages */
router.get('/packages', wrap((req) => listPackages(req)));
router.post(
  '/packages',
  wrapStatus(201, (req) => createPackage(req, packageSchema.parse(req.body)))
);
router.put(
  '/packages/:id',
  wrap((req) => updatePackage(req, idParam.parse(req.params).id, updatePackageSchema.parse(req.body)))
);
router.delete(
  '/packages/:id',
  wrap((req) => deletePackage(req, idParam.parse(req.params).id))
);

/* External integrations */
router.get('/integrations', wrap((req) => listIntegrations(req)));
router.post(
  '/integrations',
  wrapStatus(201, (req) => upsertIntegration(req, integrationSchema.parse(req.body)))
);
router.put(
  '/integrations/:id',
  wrap((req) =>
    updateIntegration(req, idParam.parse(req.params).id, updateIntegrationSchema.parse(req.body))
  )
);
router.delete(
  '/integrations/:id',
  wrap((req) => deleteIntegration(req, idParam.parse(req.params).id))
);
router.post(
  '/integrations/:id/ping',
  wrap((req) => pingIntegration(req, idParam.parse(req.params).id))
);

/* Game picks */
router.get('/game-picks', wrap((req) => listGamePicks(req)));
router.post(
  '/game-picks',
  wrapStatus(201, (req) => createGamePick(req, gamePickSchema.parse(req.body)))
);
router.delete(
  '/game-picks/:id',
  wrap((req) => deleteGamePick(req, idParam.parse(req.params).id))
);

/* Match stats */
router.get(
  '/match-stats/:eventId',
  wrap((req) => {
    const { eventId } = z.object({ eventId: z.string().uuid() }).parse(req.params);
    return getMatchStats(req, eventId);
  })
);
router.put(
  '/match-stats',
  wrap((req) => upsertMatchStats(req, matchStatsSchema.parse(req.body)))
);

export default router;
