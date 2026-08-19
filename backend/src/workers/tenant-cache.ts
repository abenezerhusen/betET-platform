/**
 * Shared tenant ID cache for game loops.
 *
 * Prevents repeated heavy queries against game_rounds on every tick. The
 * game loops (aviator/jetx/keno) fire several times per second; previously
 * each tick ran `SELECT DISTINCT tenant_id FROM game_rounds` which scans a
 * table that grows without bound, pinning the CPU.
 *
 * Instead we read the active tenants (1 row here) and cache the result for
 * 5 minutes. The read goes through `withTenantClient({ bypassRls: true })`
 * exactly like the original loops did, because the `tenants` table has
 * FORCE row-level security — a raw pooled query with no tenant context
 * could return zero rows under a restricted DB role and silently stall the
 * loops. Using the RLS-safe path preserves the original behaviour.
 */
import { withTenantClient } from '../infrastructure/db/tenant-client';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedIds: string[] = [];
let refreshedAt = 0;

export async function getActiveTenantIds(): Promise<string[]> {
  if (Date.now() - refreshedAt < CACHE_TTL_MS && cachedIds.length > 0) {
    return cachedIds;
  }
  const ids = await withTenantClient(
    { tenantId: null, bypassRls: true, readOnly: true },
    async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM tenants WHERE status = 'active'`
      );
      return result.rows.map((r) => r.id);
    }
  );
  // Only overwrite the cache when we actually got tenants, so a transient
  // empty read never wipes a good cache mid-operation.
  if (ids.length > 0) {
    cachedIds = ids;
    refreshedAt = Date.now();
  }
  return cachedIds;
}
