import type { Request } from 'express';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';
import * as repo from './roles.repository';
import type {
  CreateRoleInput,
  ListRolesQuery,
  UpdateRoleInput,
} from './roles.dto';

function pickAuditRole(r: repo.RoleRow): Record<string, unknown> {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    name: r.name,
    description: r.description,
    permissions: r.permissions,
    is_system: r.is_system,
    status: r.status,
  };
}

export async function listRoles(req: Request, params: ListRolesQuery) {
  const scope = getAdminScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listRoles(client, scope.tenantId, {
        status: params.status ?? null,
        search: params.search ?? null,
        limit: params.limit,
        offset,
      })
  );

  return {
    items: data.rows,
    total: data.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.total / params.limit)),
  };
}

export async function getRole(req: Request, id: string) {
  const scope = getAdminScope(req);
  const role = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.findRoleById(client, id)
  );
  if (!role) throw new NotFoundError('Role not found');
  if (!scope.isSuperadmin && role.tenant_id !== scope.tenantId) {
    throw new ForbiddenError('Role belongs to a different tenant');
  }
  return role;
}

export async function createRole(req: Request, body: CreateRoleInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  // Only superadmin may create system roles.
  if (body.is_system && !scope.isSuperadmin) {
    throw new ForbiddenError('Cannot create system role');
  }

  const created = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const dup = await repo.findRoleByName(client, tenantId, body.name);
      if (dup) {
        throw new BadRequestError('A role with this name already exists', {
          name: body.name,
        });
      }
      return repo.insertRole(client, {
        tenantId,
        name: body.name,
        description: body.description ?? null,
        permissions: body.permissions,
        isSystem: body.is_system ?? false,
      });
    }
  );

  await tryAudit(
    {
      tenantId: created.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.role.create',
      resource: 'role',
      resourceId: created.id,
      payload: { after: pickAuditRole(created) },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return created;
}

export async function updateRole(req: Request, id: string, body: UpdateRoleInput) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findRoleById(client, id);
      if (!before) throw new NotFoundError('Role not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Role belongs to a different tenant');
      }
      if (before.is_system && !scope.isSuperadmin) {
        throw new ForbiddenError('Cannot modify system role');
      }
      if (body.name && body.name !== before.name) {
        const dup = await repo.findRoleByName(client, before.tenant_id, body.name);
        if (dup && dup.id !== id) {
          throw new BadRequestError('A role with this name already exists', {
            name: body.name,
          });
        }
      }
      const after = await repo.updateRole(client, id, body);
      if (!after) throw new BadRequestError('No fields to update');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.role.update',
      resource: 'role',
      resourceId: id,
      payload: {
        before: pickAuditRole(result.before),
        after: pickAuditRole(result.after),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}

export async function deleteRole(req: Request, id: string) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findRoleById(client, id);
      if (!before) throw new NotFoundError('Role not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Role belongs to a different tenant');
      }
      if (before.is_system && !scope.isSuperadmin) {
        throw new ForbiddenError('Cannot delete system role');
      }
      const deleted = await repo.deleteRole(client, id);
      if (!deleted) throw new NotFoundError('Role not found');
      return { before, deleted };
    }
  );

  await tryAudit(
    {
      tenantId: result.deleted.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.role.delete',
      resource: 'role',
      resourceId: id,
      payload: { before: pickAuditRole(result.before) },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { success: true, id };
}
