import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { ForbiddenError, NotFoundError } from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import * as repo from './mobile.repository';
import type { RegisterDeviceInput } from './mobile.dto';

interface AuthScope {
  tenantId: string;
  userId: string;
  role: string;
}

function getAuthScope(req: Request): AuthScope {
  if (!req.user) throw new ForbiddenError('Authentication required');
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
  };
}

export async function registerDevice(req: Request, body: RegisterDeviceInput) {
  const scope = getAuthScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      repo.upsertDevice(client, {
        tenantId: scope.tenantId,
        userId: scope.userId,
        deviceToken: body.device_token,
        platform: body.platform,
        appVersion: body.app_version ?? null,
        deviceModel: body.device_model ?? null,
      })
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: result.created ? 'mobile.device.register' : 'mobile.device.update',
    resource: 'mobile_token',
    resourceId: result.row.id,
    payload: {
      platform: body.platform,
      app_version: body.app_version ?? null,
      device_model: body.device_model ?? null,
      // device_token intentionally NOT logged (PII / secret-ish).
    },
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    status: 'success',
  });

  return { device: result.row, created: result.created };
}

export async function listMyDevices(req: Request) {
  const scope = getAuthScope(req);
  const items = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => repo.listDevicesByUser(client, scope.tenantId, scope.userId)
  );
  return { items };
}

export async function unregisterDevice(req: Request, id: string) {
  const scope = getAuthScope(req);
  const row = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      repo.revokeDevice(client, scope.tenantId, scope.userId, id)
  );
  if (!row) throw new NotFoundError('Device not found');

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: 'mobile.device.revoke',
    resource: 'mobile_token',
    resourceId: id,
    payload: { platform: row.platform },
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    status: 'success',
  });

  return { device: row };
}
