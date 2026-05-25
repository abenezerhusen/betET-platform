import type { PoolClient } from 'pg';
import { pool } from './pool';

export interface TenantClientOptions {
  /** Tenant UUID. Pass null for public/superadmin queries (paired with bypassRls). */
  tenantId: string | null;
  /** Set app.bypass_rls = on for this transaction (superadmin / cross-tenant). */
  bypassRls?: boolean;
  /** Use READ ONLY mode (default false). */
  readOnly?: boolean;
}

/**
 * Acquires a pooled client, starts a transaction, calls
 *   SELECT set_tenant_context($1::uuid);
 * (and optionally `set_bypass_rls(true)`), runs `fn`, then COMMITs and
 * releases the client. ROLLBACK happens on any thrown error.
 *
 * This is the ONLY way the application should talk to the database — it
 * guarantees Row Level Security is activated for every connection.
 */
export async function withTenantClient<T>(
  options: TenantClientOptions,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(options.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');

    if (options.tenantId) {
      await client.query('SELECT set_tenant_context($1::uuid)', [options.tenantId]);
    } else {
      await client.query("SELECT set_config('app.tenant_id', '', true)");
    }

    if (options.bypassRls) {
      await client.query('SELECT set_bypass_rls(true)');
    }

    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    client.release();
  }
}
