import type { Request } from 'express';
import { BadRequestError, ForbiddenError } from '../../http/errors/http-error';

/**
 * Resolved scope for a cashier request.
 *  - role MUST be 'cashier' (admins use the admin module).
 *  - tenantId is pinned to the cashier's own tenant (req.user.tenantId);
 *    a mismatched x-tenant-id header is rejected with 403.
 *  - bypassRls is always false: cashiers operate strictly within their tenant.
 */
export interface CashierScope {
  tenantId: string;
  cashierId: string;
}

export function getCashierScope(req: Request): CashierScope {
  if (!req.user) throw new ForbiddenError('Authentication required');
  if (!['cashier', 'sales'].includes(req.user.role)) {
    throw new ForbiddenError('Cashier or sales role required');
  }
  if (req.tenant && req.tenant.id !== req.user.tenantId) {
    throw new ForbiddenError('Cannot operate outside your tenant');
  }
  return {
    tenantId: req.user.tenantId,
    cashierId: req.user.id,
  };
}

/**
 * Resolve idempotency key from request.
 *  Priority: `Idempotency-Key` HTTP header > body.idempotency_key.
 *  Required for any state-changing money operation.
 */
export function getIdempotencyKey(
  req: Request,
  bodyKey: string | undefined
): string {
  const headerKey = req.header('idempotency-key');
  const key = (headerKey ?? bodyKey ?? '').trim();
  if (!key) {
    throw new BadRequestError(
      'Idempotency-Key header or idempotency_key body field is required',
      { reason: 'missing_idempotency_key' }
    );
  }
  if (key.length > 255) {
    throw new BadRequestError('Idempotency key too long (max 255 chars)', {
      reason: 'idempotency_key_too_long',
    });
  }
  return key;
}

export function getIp(req: Request): string | null {
  return req.ip ?? null;
}
export function getUa(req: Request): string | null {
  return req.header('user-agent') ?? null;
}
