import type { Request } from 'express';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { invalidateScope } from '../../../infrastructure/cache';
import {
  TICKET_EXPIRY_DAYS_KEY,
  TICKET_EXPIRY_DAYS_MIN,
  TICKET_EXPIRY_DAYS_MAX,
} from './business-settings';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';
import * as repo from './settings.repository';
import type {
  BulkUpdateSettingsInput,
  ListSettingsQuery,
  UpsertSettingInput,
} from './settings.dto';

function bustSettingsCache(tenantId: string): Promise<void> {
  // Best-effort; never let cache invalidation failure affect the response.
  return invalidateScope(`tenant_settings:${tenantId}`);
}

/**
 * Validate setting values that have typed semantics (range, shape, …).
 *
 * The settings table is generically key/value, so the bulk endpoint
 * happily accepts arbitrary JSON. For business-critical keys we add a
 * small validation layer here so a typo in the admin form doesn't break
 * downstream behaviour (e.g. a 0-day ticket expiry).
 */
function assertSettingValueValid(key: string, value: unknown): void {
  if (key === TICKET_EXPIRY_DAYS_KEY) {
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN;
    if (
      !Number.isFinite(n) ||
      !Number.isInteger(n) ||
      n < TICKET_EXPIRY_DAYS_MIN ||
      n > TICKET_EXPIRY_DAYS_MAX
    ) {
      throw new BadRequestError(
        `ticket_expiry_days must be an integer between ${TICKET_EXPIRY_DAYS_MIN} and ${TICKET_EXPIRY_DAYS_MAX}`,
        { reason: 'invalid_ticket_expiry_days' }
      );
    }
  }
}

function pickAuditSetting(s: repo.SettingRow): Record<string, unknown> {
  return {
    key: s.key,
    value: s.value,
    description: s.description,
    category: s.category,
  };
}

export async function listSettings(req: Request, params: ListSettingsQuery) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const rows = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listSettings(client, tenantId, {
        category: params.category ?? null,
        keyPrefix: params.key_prefix ?? null,
      })
  );

  // Return as a flat map { key: value } plus full descriptors for UI.
  const map: Record<string, unknown> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return {
    tenant_id: tenantId,
    map,
    items: rows,
  };
}

export async function getSetting(req: Request, key: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.findSetting(client, tenantId, key)
  );
  if (!row) throw new NotFoundError(`Setting '${key}' not found`);
  return row;
}

export async function upsertSetting(
  req: Request,
  key: string,
  body: UpsertSettingInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  assertSettingValueValid(key, body.value);

  const result = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findSetting(client, tenantId, key);
      const after = await repo.upsertSetting(client, {
        tenantId,
        key,
        value: body.value,
        description: body.description,
        category: body.category,
        updatedBy: scope.actorId,
      });
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: result.before ? 'admin.setting.update' : 'admin.setting.create',
      resource: 'setting',
      resourceId: key,
      payload: {
        before: result.before ? pickAuditSetting(result.before) : null,
        after: pickAuditSetting(result.after),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  await bustSettingsCache(tenantId);
  return result.after;
}

export async function bulkUpdateSettings(
  req: Request,
  body: BulkUpdateSettingsInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const entries = Object.entries(body);
  // Validate typed keys up-front so the request fails atomically before
  // we touch the DB for any of the other keys in the batch.
  for (const [key, value] of entries) {
    assertSettingValueValid(key, value);
  }
  const result = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const beforeMap: Record<string, repo.SettingRow | null> = {};
      const afterMap: Record<string, repo.SettingRow> = {};
      for (const [key, value] of entries) {
        const before = await repo.findSetting(client, tenantId, key);
        const after = await repo.upsertSetting(client, {
          tenantId,
          key,
          value,
          description: undefined,
          category: undefined,
          updatedBy: scope.actorId,
        });
        beforeMap[key] = before;
        afterMap[key] = after;
      }
      return { beforeMap, afterMap };
    }
  );

  // One audit row per changed key.
  await Promise.all(
    entries.map(async ([key]) => {
      const before = result.beforeMap[key];
      const after = result.afterMap[key];
      await tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: before ? 'admin.setting.update' : 'admin.setting.create',
          resource: 'setting',
          resourceId: key,
          payload: {
            before: before ? pickAuditSetting(before) : null,
            after: pickAuditSetting(after),
            bulk: true,
          },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
    })
  );

  await bustSettingsCache(tenantId);
  return {
    tenant_id: tenantId,
    items: Object.values(result.afterMap),
  };
}

export async function deleteSetting(req: Request, key: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const deleted = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.deleteSetting(client, tenantId, key)
  );
  if (!deleted) throw new NotFoundError(`Setting '${key}' not found`);

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.setting.delete',
      resource: 'setting',
      resourceId: key,
      payload: { before: pickAuditSetting(deleted) },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  await bustSettingsCache(tenantId);
  return { success: true, key };
}
