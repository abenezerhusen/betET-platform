import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import { writeAudit, type AuditEvent } from './audit.repository';

/**
 * Best-effort audit log writer.
 *
 * Runs in a transaction independent of the caller's work transaction so
 * that:
 *   - the audit row is not rolled back when the caller's work transaction
 *     succeeds and the caller later throws (e.g. business rule violation),
 *   - failures to write audit never escalate into HTTP 5xx for callers.
 *
 * For superadmin / cross-tenant flows pass `bypassRls: true` so the audit
 * insert is not blocked by RLS when the request's tenant context differs
 * from the affected tenant.
 */
export async function tryAudit(
  event: AuditEvent,
  opts: { bypassRls?: boolean } = {}
): Promise<void> {
  try {
    await withTenantClient(
      { tenantId: event.tenantId, bypassRls: opts.bypassRls ?? false },
      async (client) => {
        await writeAudit(client, event);
      }
    );
  } catch (err) {
    logger.error(
      { err, action: event.action, status: event.status, resource: event.resource },
      'failed to write audit log'
    );
  }
}
