import type { NextFunction, Request, Response } from 'express';
import { assertSiteAvailable } from './maintenance-mode';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Express middleware — blocks write requests while site maintenance is active.
 */
export async function requireSiteAvailable(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (MUTATION_METHODS.has(req.method.toUpperCase())) {
      await assertSiteAvailable(req);
    }
    next();
  } catch (err) {
    next(err);
  }
}
