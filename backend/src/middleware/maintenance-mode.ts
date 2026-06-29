import type { Request } from 'express';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { ServiceUnavailableError } from '../http/errors/http-error';
import {
  isMaintenanceActive,
  loadMaintenanceConfig,
  shouldBypassMaintenance,
} from '../modules/admin/settings/maintenance-config';

/**
 * Block user-facing write operations while site maintenance is active.
 * Admin / cashier routes are not mounted through this helper.
 */
export async function assertSiteAvailable(req: Request): Promise<void> {
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
  if (!tenantId) return;

  const cfg = await withTenantClient({ tenantId }, (client) =>
    loadMaintenanceConfig(client, tenantId)
  );

  if (!isMaintenanceActive(cfg)) return;

  const role = req.user?.role;
  if (shouldBypassMaintenance(cfg, role)) return;

  throw new ServiceUnavailableError(cfg.message, {
    reason: 'maintenance_mode',
  });
}
