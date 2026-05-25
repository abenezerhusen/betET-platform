import type { Request } from 'express';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ForbiddenError } from '../../../http/errors/http-error';
import { listAuditLogs } from '../../audit/audit.repository';
import { getAdminScope } from '../admin-shared';
import type { ListAuditLogsQuery } from './audit-logs.dto';

export async function searchAuditLogs(req: Request, query: ListAuditLogsQuery) {
  const scope = getAdminScope(req);

  // Resolve effective tenant filter:
  //  - tenant_admin: forced to their own tenant.
  //  - superadmin:   honors ?tenant_id, then x-tenant-id header, else cross-tenant.
  let effectiveTenantId: string | null;
  if (!scope.isSuperadmin) {
    if (query.tenant_id && query.tenant_id !== scope.tenantId) {
      throw new ForbiddenError('Cannot view audit logs of other tenants');
    }
    effectiveTenantId = scope.tenantId;
  } else {
    effectiveTenantId = query.tenant_id ?? scope.tenantId ?? null;
  }

  const offset = (query.page - 1) * query.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      listAuditLogs(client, {
        tenantId: effectiveTenantId,
        actorId: query.actor_id ?? null,
        action: query.action ?? null,
        actionPrefix: query.action_prefix ?? null,
        resource: query.resource ?? null,
        resourceId: query.resource_id ?? null,
        status: query.status ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
        search: query.search ?? null,
        limit: query.limit,
        offset,
      })
  );

  return {
    items: data.rows,
    total: data.total,
    page: query.page,
    limit: query.limit,
    pages: Math.max(1, Math.ceil(data.total / query.limit)),
  };
}
