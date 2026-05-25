import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../http/errors/http-error';

/**
 * Restrict a route to a set of roles. Must be used after authenticateToken()
 * which populates req.user.
 */
export function requireRole(...roles: string[]) {
  const allowed = new Set(roles);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    if (!allowed.has(req.user.role)) {
      return next(
        new ForbiddenError('Insufficient role', {
          required: Array.from(allowed),
          actual: req.user.role,
        })
      );
    }
    next();
  };
}
