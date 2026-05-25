import type { CorsOptions } from 'cors';
import { env } from './env';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { logger } from '../infrastructure/logger';

const globalOrigins = new Set(
  env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

let tenantOrigins = new Set<string>();
let lastLoadedAt = 0;
const REFRESH_INTERVAL_MS = 60_000;
let refreshTimer: NodeJS.Timeout | null = null;

/**
 * Load every active tenant's allowed origins from
 * tenants.config->'cors_origins' (JSON array of strings). The lookup runs
 * with bypassRls because CORS happens before tenant context is known.
 */
export async function preloadTenantOrigins(): Promise<void> {
  const next = new Set<string>();
  await withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
    const r = await client.query<{ origins: unknown }>(
      `SELECT (config->'cors_origins') AS origins
       FROM tenants
       WHERE status = 'active'`
    );
    for (const row of r.rows) {
      const origins = row.origins;
      if (Array.isArray(origins)) {
        for (const o of origins) {
          if (typeof o === 'string' && o.trim().length > 0) {
            next.add(o.trim());
          }
        }
      }
    }
  });
  tenantOrigins = next;
  lastLoadedAt = Date.now();
  logger.info({ count: tenantOrigins.size }, 'loaded tenant CORS origins');
}

export function startTenantOriginsRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    preloadTenantOrigins().catch((err) => {
      logger.warn({ err }, 'failed to refresh tenant CORS origins');
    });
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

export function stopTenantOriginsRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function isAllowed(origin: string): boolean {
  if (globalOrigins.has(origin)) return true;
  if (globalOrigins.has('*')) return true;
  if (tenantOrigins.has(origin)) return true;
  return false;
}

/** Public origin check used by Socket.io and other CORS-aware features. */
export function isAllowedOrigin(origin: string): boolean {
  return isAllowed(origin);
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Same-origin / curl / server-to-server requests have no Origin header.
    if (!origin) return callback(null, true);
    if (isAllowed(origin)) return callback(null, true);

    // If we haven't loaded tenant origins recently, attempt a refresh once.
    if (Date.now() - lastLoadedAt > REFRESH_INTERVAL_MS) {
      preloadTenantOrigins()
        .then(() => callback(null, isAllowed(origin)))
        .catch(() => callback(null, false));
      return;
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    env.TENANT_HEADER,
    'X-Requested-With',
  ],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600,
};
