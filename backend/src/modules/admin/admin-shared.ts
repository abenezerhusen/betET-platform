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

/* ------------------------------------------------------------------ */
/* Format-tolerant phone search                                        */
/* ------------------------------------------------------------------ */

/**
 * Phones are stored in mixed formats (+2519…, 2519…, 09…) while admins
 * search in whichever format they know — so a plain `phone ILIKE '%x%'`
 * only matches when the two formats happen to align. These helpers compare
 * DIGITS ONLY and strip the Ethiopian country code / trunk 0 from the
 * search input, so `0911…`, `+251911…`, and `251911…` all find the same
 * user regardless of the stored representation.
 *
 * Usage: pair `phoneSearchPattern(input)` (the bind value) with
 * `phoneDigitsSql(column, $n)` (the WHERE fragment). Keep the original
 * ILIKE clause ORed alongside so non-Ethiopian or partial searches keep
 * their existing behaviour.
 */
export function phoneSearchPattern(input: string): string | null {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (!digits) return null;
  let d = digits;
  // Full international form → significant subscriber digits.
  if (d.length >= 12 && d.startsWith('251')) d = d.slice(3);
  // Trunk prefix (09… local form) — not present in +2519… stored numbers.
  if (d.startsWith('0')) d = d.slice(1);
  return `%${d || digits}%`;
}

/** WHERE fragment: digits-only comparison of a phone column. */
export function phoneDigitsSql(column: string, paramIdx: number): string {
  return `regexp_replace(COALESCE(${column}, ''), '\\D', '', 'g') LIKE $${paramIdx}`;
}
