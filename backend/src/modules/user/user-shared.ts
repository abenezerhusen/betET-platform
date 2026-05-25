import type { Request } from 'express';
import { BadRequestError, ForbiddenError } from '../../http/errors/http-error';

/**
 * Resolved scope for an end-user request.
 *  - Allowed roles: 'user' or 'affiliate' (the same self-service surface).
 *  - tenantId is pinned to the user's own tenant.
 *  - bypassRls is always false; RLS guarantees per-tenant isolation.
 */
export interface UserScope {
  tenantId: string;
  userId: string;
  role: string;
}

const ALLOWED_ROLES = new Set(['user', 'affiliate']);

export function getUserScope(req: Request): UserScope {
  if (!req.user) throw new ForbiddenError('Authentication required');
  if (!ALLOWED_ROLES.has(req.user.role)) {
    throw new ForbiddenError('User role required');
  }
  if (req.tenant && req.tenant.id !== req.user.tenantId) {
    throw new ForbiddenError('Cannot operate outside your tenant');
  }
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
  };
}

export function getIdempotencyKey(
  req: Request,
  bodyKey: string | undefined
): string | null {
  const headerKey = req.header('idempotency-key');
  const key = (headerKey ?? bodyKey ?? '').trim();
  if (!key) return null;
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
