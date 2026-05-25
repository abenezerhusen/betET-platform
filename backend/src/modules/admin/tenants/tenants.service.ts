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
  type AdminScope,
} from '../admin-shared';
import * as repo from './tenants.repository';
import type {
  CreateTenantInput,
  ListTenantsQuery,
  UpdateTenantInput,
} from './tenants.dto';

function pickAuditFields(t: repo.TenantRow): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    config: t.config,
    status: t.status,
  };
}

function ensureSuperadmin(scope: AdminScope): void {
  if (!scope.isSuperadmin) {
    throw new ForbiddenError('Tenant management is restricted to superadmin');
  }
}

export async function listTenants(req: Request, params: ListTenantsQuery) {
  const scope = getAdminScope(req);
  ensureSuperadmin(scope);

  const offset = (params.page - 1) * params.limit;
  const data = await withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client) =>
      repo.listTenantsWithStats(client, {
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

export async function getTenant(req: Request, id: string) {
  const scope = getAdminScope(req);
  ensureSuperadmin(scope);

  const tenant = await withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client) => repo.findTenantById(client, id)
  );
  if (!tenant) throw new NotFoundError('Tenant not found');
  return tenant;
}

export async function createTenant(req: Request, body: CreateTenantInput) {
  const scope = getAdminScope(req);
  ensureSuperadmin(scope);

  const created = await withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client) => {
      const existing = await repo.findTenantBySlug(client, body.slug);
      if (existing) {
        throw new BadRequestError('A tenant with this slug already exists', {
          slug: body.slug,
        });
      }
      const inserted = await repo.insertTenant(client, {
        name: body.name,
        slug: body.slug,
        config: body.config ?? {},
        status: body.status ?? 'active',
      });
      await repo.insertDefaultSettings(client, inserted.id, scope.actorId);
      return inserted;
    }
  );

  await tryAudit(
    {
      tenantId: created.id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.tenant.create',
      resource: 'tenant',
      resourceId: created.id,
      payload: {
        after: pickAuditFields(created),
        default_settings_seeded: true,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return created;
}

export async function updateTenant(req: Request, id: string, body: UpdateTenantInput) {
  const scope = getAdminScope(req);
  ensureSuperadmin(scope);

  const result = await withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client) => {
      const before = await repo.findTenantById(client, id);
      if (!before) {
        throw new NotFoundError('Tenant not found');
      }
      if (body.slug && body.slug !== before.slug) {
        const existing = await repo.findTenantBySlug(client, body.slug);
        if (existing && existing.id !== id) {
          throw new BadRequestError('A tenant with this slug already exists', {
            slug: body.slug,
          });
        }
      }
      const after = await repo.updateTenant(client, id, body);
      if (!after) throw new BadRequestError('No fields to update');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.tenant.update',
      resource: 'tenant',
      resourceId: id,
      payload: {
        before: pickAuditFields(result.before),
        after: pickAuditFields(result.after),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}

export async function softDeleteTenant(req: Request, id: string) {
  const scope = getAdminScope(req);
  ensureSuperadmin(scope);

  const result = await withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client) => {
      const before = await repo.findTenantById(client, id);
      if (!before) throw new NotFoundError('Tenant not found');
      const after = await repo.softDeleteTenant(client, id);
      if (!after) throw new NotFoundError('Tenant not found');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.tenant.soft_delete',
      resource: 'tenant',
      resourceId: id,
      payload: {
        before: pickAuditFields(result.before),
        after: pickAuditFields(result.after),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}
