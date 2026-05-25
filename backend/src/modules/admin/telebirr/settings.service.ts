import type { Request } from 'express';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { tryAudit } from '../../audit/audit.service';
import { invalidateScope } from '../../../infrastructure/cache';
import * as settingsRepo from '../settings/settings.repository';
import {
  loadTelebirrSettings,
  TELEBIRR_DEFAULTS,
  TELEBIRR_SETTINGS_KEY,
  type TelebirrSettings,
} from '../../telebirr';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

import type { UpdateTelebirrSettingsInput } from './admin.telebirr.dto';

export async function getSettings(req: Request) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const merged = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => loadTelebirrSettings(client, tenantId)
  );

  return {
    tenant_id: tenantId,
    defaults: TELEBIRR_DEFAULTS,
    settings: merged,
  };
}

export async function updateSettings(
  req: Request,
  body: UpdateTelebirrSettingsInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const result = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await loadTelebirrSettings(client, tenantId);
      const after: TelebirrSettings = { ...before };
      // Apply only the fields the caller provided. We deliberately do
      // NOT use Object.assign(before, body) because Zod returns the
      // input shape and we want defaults preserved for fields not
      // touched by the caller.
      const afterMutable = after as unknown as Record<string, unknown>;
      for (const k of Object.keys(body) as (keyof UpdateTelebirrSettingsInput)[]) {
        const v = body[k];
        if (v !== undefined) {
          // The Zod schema guarantees that each field's runtime type
          // matches the corresponding TelebirrSettings field, so the
          // assignment is sound.
          afterMutable[k] = v;
        }
      }

      const row = await settingsRepo.upsertSetting(client, {
        tenantId,
        key: TELEBIRR_SETTINGS_KEY,
        value: after,
        description: 'Telebirr deposit configuration',
        category: 'telebirr',
        updatedBy: scope.actorId,
      });

      return { before, after, row };
    }
  );

  // Bust the same scope key the global settings module uses so any
  // service hot-loading config picks up the new values.
  await invalidateScope(`tenant_settings:${tenantId}`).catch(() => {});

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.settings.update',
      resource: 'setting',
      resourceId: TELEBIRR_SETTINGS_KEY,
      payload: {
        before: result.before,
        after: result.after,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return {
    tenant_id: tenantId,
    settings: result.after,
    updated_at: result.row.updated_at.toISOString(),
  };
}
