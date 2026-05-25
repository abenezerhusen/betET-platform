/**
 * Section 22 — `requirePermission(id)` Express middleware.
 *
 * Gates a single permission ID. Super admins (permissions === ['*'])
 * always pass. The middleware must run after `authenticateToken()` so
 * `req.user.permissions` is populated.
 */

import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../http/errors/http-error';
import { hasPermission } from '../modules/auth/permissions.helper';

export function requirePermission(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError('Authentication required'));
    if (required.length === 0) return next();
    const perms = req.user.permissions ?? [];
    const ok = required.every((id) => hasPermission(perms, id));
    if (!ok) {
      return next(new ForbiddenError('Insufficient permissions', { required }));
    }
    next();
  };
}
