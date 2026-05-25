import type { Request } from 'express';

import { UnauthorizedError } from '../../http/errors/http-error';
import type { AuthenticatedAgent } from '../../types/express';

export function getIp(req: Request): string | null {
  return req.ip ?? null;
}

export function getUa(req: Request): string | null {
  return req.header('user-agent') ?? null;
}

/**
 * Read the authenticated agent off the request, throwing 401 if absent.
 * Use only in handlers that have already passed `authenticateAgent`.
 */
export function getAgentScope(req: Request): AuthenticatedAgent {
  if (!req.agent || !req.agent.id || !req.agent.tenantId) {
    throw new UnauthorizedError('Agent context missing');
  }
  return req.agent;
}
