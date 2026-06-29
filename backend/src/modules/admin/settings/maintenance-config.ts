import type { PoolClient } from 'pg';

export const MAINTENANCE_CONFIG_KEY = 'maintenance.config';

export interface MaintenanceConfig {
  enabled: boolean;
  message: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  bypass_role: string | null;
}

const DEFAULT_MESSAGE =
  'System is on maintenance. Please wait until we finished.';

export function normalizeMaintenanceConfig(raw: unknown): MaintenanceConfig {
  const v = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: Boolean(v.enabled),
    message:
      typeof v.message === 'string' && v.message.trim()
        ? v.message.trim()
        : DEFAULT_MESSAGE,
    scheduled_start:
      typeof v.scheduled_start === 'string' ? v.scheduled_start : null,
    scheduled_end:
      typeof v.scheduled_end === 'string' ? v.scheduled_end : null,
    bypass_role:
      typeof v.bypass_role === 'string' && v.bypass_role.trim()
        ? v.bypass_role.trim()
        : null,
  };
}

/** True when maintenance is enabled and the current time is inside the window. */
export function isMaintenanceActive(
  cfg: MaintenanceConfig,
  now = new Date()
): boolean {
  if (!cfg.enabled) return false;
  if (cfg.scheduled_start) {
    const start = new Date(cfg.scheduled_start);
    if (!Number.isNaN(start.getTime()) && now < start) return false;
  }
  if (cfg.scheduled_end) {
    const end = new Date(cfg.scheduled_end);
    if (!Number.isNaN(end.getTime()) && now > end) return false;
  }
  return true;
}

export async function loadMaintenanceConfig(
  client: PoolClient,
  tenantId: string
): Promise<MaintenanceConfig> {
  const r = await client.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, MAINTENANCE_CONFIG_KEY]
  );
  return normalizeMaintenanceConfig(r.rows[0]?.value);
}

/** Staff roles that may bypass maintenance when configured. */
const STAFF_ROLES = new Set([
  'superadmin',
  'tenant_admin',
  'admin',
  'operator',
]);

export function shouldBypassMaintenance(
  cfg: MaintenanceConfig,
  role: string | undefined | null
): boolean {
  if (!role) return false;
  if (cfg.bypass_role && role === cfg.bypass_role) return true;
  return STAFF_ROLES.has(role);
}
