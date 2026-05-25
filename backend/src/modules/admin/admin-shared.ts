import type { Request } from 'express';
import { BadRequestError, ForbiddenError } from '../../http/errors/http-error';

/**
 * Resolved scope for an admin request.
 *
 *  - superadmin: may operate cross-tenant. tenantId comes from x-tenant-id
 *    header / subdomain when set; otherwise null (callers that need a
 *    tenant must call requireScopedTenantId). bypassRls is always true so
 *    queries can read across tenants.
 *
 *  - tenant_admin: pinned to their own tenant. Any attempt to set a
 *    different x-tenant-id header is rejected with 403.
 */
export interface AdminScope {
  tenantId: string | null;
  bypassRls: boolean;
  isSuperadmin: boolean;
  actorId: string;
  actorRole: string;
  actorType: 'admin' | 'superadmin';
}

export function getAdminScope(req: Request): AdminScope {
  if (!req.user) {
    throw new ForbiddenError('Authentication required');
  }
  const isSuperadmin = req.user.role === 'superadmin';

  if (isSuperadmin) {
    return {
      tenantId: req.tenant?.id ?? null,
      bypassRls: true,
      isSuperadmin: true,
      actorId: req.user.id,
      actorRole: req.user.role,
      actorType: 'superadmin',
    };
  }

  if (req.tenant && req.tenant.id !== req.user.tenantId) {
    throw new ForbiddenError('Cannot operate outside your tenant');
  }

  return {
    tenantId: req.user.tenantId,
    bypassRls: false,
    isSuperadmin: false,
    actorId: req.user.id,
    actorRole: req.user.role,
    actorType: 'admin',
  };
}

export function requireScopedTenantId(
  scope: AdminScope,
  message = 'Tenant id required (set x-tenant-id header or use a tenant subdomain)'
): string {
  if (!scope.tenantId) {
    throw new BadRequestError(message, { reason: 'missing_tenant' });
  }
  return scope.tenantId;
}

export function getIp(req: Request): string | null {
  return req.ip ?? null;
}
export function getUa(req: Request): string | null {
  return req.header('user-agent') ?? null;
}
