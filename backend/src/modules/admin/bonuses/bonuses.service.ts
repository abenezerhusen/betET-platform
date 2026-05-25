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
import * as repo from './bonuses.repository';
import type {
  AssignBonusInput,
  CreateBonusInput,
  InternalEvaluateInput,
  ListBonusClaimsInput,
  ListBonusesQuery,
  ManualAwardInput,
  PatchBonusStatusInput,
  UpdateBonusInput,
} from './bonuses.dto';

const MAX_SEGMENT_USERS = 10000;

function pickAuditBonus(b: repo.BonusRuleRow): Record<string, unknown> {
  return {
    id: b.id,
    tenant_id: b.tenant_id,
    name: b.name,
    type: b.type,
    config: b.config,
    is_active: b.is_active,
    valid_from: b.valid_from,
    valid_to: b.valid_to,
    priority: b.priority,
    status: b.status,
  };
}

export async function listBonuses(req: Request, params: ListBonusesQuery) {
  const scope = getAdminScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listBonuses(client, scope.tenantId, {
        type: params.type ?? null,
        status: params.status ?? null,
        isActive: params.is_active ?? null,
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

export async function getBonus(req: Request, id: string) {
  const scope = getAdminScope(req);
  const bonus = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.findBonusById(client, id)
  );
  if (!bonus) throw new NotFoundError('Bonus rule not found');
  if (!scope.isSuperadmin && bonus.tenant_id !== scope.tenantId) {
    throw new ForbiddenError('Bonus rule belongs to a different tenant');
  }
  return bonus;
}

export async function createBonus(req: Request, body: CreateBonusInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const created = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const dup = await repo.findBonusByName(client, tenantId, body.name);
      if (dup) {
        throw new BadRequestError('A bonus rule with this name already exists', {
          name: body.name,
        });
      }
      return repo.insertBonus(client, {
        tenantId,
        name: body.name,
        type: body.type,
        config: body.config ?? {},
        isActive: body.is_active,
        validFrom: body.valid_from ?? null,
        validTo: body.valid_to ?? null,
        priority: body.priority,
        status: body.status,
      });
    }
  );

  await tryAudit(
    {
      tenantId: created.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bonus.create',
      resource: 'bonus_rule',
      resourceId: created.id,
      payload: { after: pickAuditBonus(created) },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return created;
}

export async function updateBonus(req: Request, id: string, body: UpdateBonusInput) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findBonusById(client, id);
      if (!before) throw new NotFoundError('Bonus rule not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Bonus rule belongs to a different tenant');
      }
      if (body.name && body.name !== before.name) {
        const dup = await repo.findBonusByName(client, before.tenant_id, body.name);
        if (dup && dup.id !== id) {
          throw new BadRequestError(
            'A bonus rule with this name already exists',
            { name: body.name }
          );
        }
      }
      const after = await repo.updateBonus(client, id, body);
      if (!after) throw new BadRequestError('No fields to update');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bonus.update',
      resource: 'bonus_rule',
      resourceId: id,
      payload: {
        before: pickAuditBonus(result.before),
        after: pickAuditBonus(result.after),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}

export async function deleteBonus(req: Request, id: string) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findBonusById(client, id);
      if (!before) throw new NotFoundError('Bonus rule not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Bonus rule belongs to a different tenant');
      }
      const deleted = await repo.deleteBonus(client, id);
      if (!deleted) throw new NotFoundError('Bonus rule not found');
      return { before };
    }
  );

  await tryAudit(
    {
      tenantId: result.before.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bonus.delete',
      resource: 'bonus_rule',
      resourceId: id,
      payload: { before: pickAuditBonus(result.before) },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { success: true, id };
}

export async function assignBonus(req: Request, id: string, body: AssignBonusInput) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const bonus = await repo.findBonusById(client, id);
      if (!bonus) throw new NotFoundError('Bonus rule not found');
      if (!scope.isSuperadmin && bonus.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Bonus rule belongs to a different tenant');
      }
      if (!bonus.is_active || bonus.status !== 'active') {
        throw new BadRequestError('Bonus rule is not active', {
          is_active: bonus.is_active,
          status: bonus.status,
        });
      }

      let userIds: string[] = [];
      if (body.user_ids && body.user_ids.length > 0) {
        userIds = await repo.filterValidUserIds(
          client,
          bonus.tenant_id,
          body.user_ids
        );
      } else if (body.segment) {
        userIds = await repo.resolveSegment(
          client,
          bonus.tenant_id,
          body.segment,
          MAX_SEGMENT_USERS
        );
      }

      if (userIds.length === 0) {
        throw new BadRequestError('No matching users for assignment', {
          requested: body.user_ids?.length ?? 0,
          segment: body.segment ?? null,
        });
      }

      const cfg = bonus.config as Record<string, unknown>;
      const awardedAmount =
        body.amount_override ??
        (typeof cfg.amount === 'number' ? (cfg.amount as number) : 0);
      const wageringMultiplier =
        typeof cfg.wagering_multiplier === 'number'
          ? (cfg.wagering_multiplier as number)
          : 0;
      const wageringRequired =
        body.wagering_required_override ?? awardedAmount * wageringMultiplier;
      const expiresAt =
        body.expires_at !== undefined
          ? body.expires_at
          : typeof cfg.expires_in_days === 'number'
            ? new Date(
                Date.now() + (cfg.expires_in_days as number) * 24 * 60 * 60 * 1000
              )
            : null;

      const assignments = await repo.bulkInsertAssignments(client, {
        tenantId: bonus.tenant_id,
        bonusRuleId: bonus.id,
        awardedBy: scope.actorId,
        userIds,
        awardedAmount,
        wageringRequired,
        expiresAt,
        metadata: body.metadata ?? {},
      });

      return { bonus, userIds, assignments, awardedAmount, wageringRequired, expiresAt };
    }
  );

  await tryAudit(
    {
      tenantId: result.bonus.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bonus.assign',
      resource: 'bonus_rule',
      resourceId: id,
      payload: {
        target: body.segment
          ? { segment: body.segment }
          : { user_ids_count: body.user_ids?.length ?? 0 },
        resolved_user_count: result.userIds.length,
        awarded_amount: result.awardedAmount,
        wagering_required: result.wageringRequired,
        expires_at: result.expiresAt,
        assignment_ids: result.assignments.map((a) => a.id),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return {
    bonus_rule_id: result.bonus.id,
    target: body.segment
      ? { type: 'segment', value: body.segment }
      : { type: 'users', count: body.user_ids?.length ?? 0 },
    awarded_user_count: result.userIds.length,
    awarded_amount: result.awardedAmount,
    wagering_required: result.wageringRequired,
    expires_at: result.expiresAt,
    assignments: result.assignments,
  };
}

export async function patchBonusStatus(
  req: Request,
  id: string,
  body: PatchBonusStatusInput
) {
  const scope = getAdminScope(req);
  const statusUpdated = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findBonusById(client, id);
      if (!before) throw new NotFoundError('Bonus rule not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Bonus rule belongs to a different tenant');
      }
      const after = await repo.updateBonus(client, id, {
        status: body.status,
        is_active: body.is_active ?? body.status === 'active',
      });
      if (!after) throw new NotFoundError('Bonus rule not found');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: statusUpdated.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bonus.status',
      resource: 'bonus_rule',
      resourceId: id,
      payload: {
        before: pickAuditBonus(statusUpdated.before),
        after: pickAuditBonus(statusUpdated.after),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return statusUpdated.after;
}

export async function listBonusClaims(
  req: Request,
  id: string,
  query: ListBonusClaimsInput
) {
  const scope = getAdminScope(req);
  const offset = (query.page - 1) * query.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const bonus = await repo.findBonusById(client, id);
      if (!bonus) throw new NotFoundError('Bonus rule not found');
      if (!scope.isSuperadmin && bonus.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Bonus rule belongs to a different tenant');
      }
      const out = await repo.listBonusClaims(client, {
        bonusRuleId: id,
        status: query.status ?? null,
        limit: query.limit,
        offset,
      });
      return {
        items: out.rows,
        total: out.total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(out.total / query.limit)),
      };
    }
  );
}

export async function manualAwardBonus(
  req: Request,
  id: string,
  body: ManualAwardInput
) {
  const scope = getAdminScope(req);
  const out = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const bonus = await repo.findBonusById(client, id);
      if (!bonus) throw new NotFoundError('Bonus rule not found');
      if (!scope.isSuperadmin && bonus.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Bonus rule belongs to a different tenant');
      }
      const validUsers = await repo.filterValidUserIds(client, bonus.tenant_id, [
        body.user_id,
      ]);
      if (validUsers.length === 0) {
        throw new BadRequestError('Target user not found in tenant');
      }
      const cfg = bonus.config as Record<string, unknown>;
      const resolvedAmount =
        body.override_amount ??
        (typeof cfg.amount === 'number'
          ? (cfg.amount as number)
          : typeof cfg.percentage === 'number'
            ? (cfg.percentage as number)
            : 0);
      if (resolvedAmount <= 0) {
        throw new BadRequestError(
          'Resolved bonus amount must be greater than zero'
        );
      }
      const wageringRequired =
        body.wagering_required_override ??
        resolvedAmount *
          (typeof cfg.wagering_multiplier === 'number'
            ? (cfg.wagering_multiplier as number)
            : 0);
      const inserted = await repo.bulkInsertAssignments(client, {
        tenantId: bonus.tenant_id,
        bonusRuleId: bonus.id,
        awardedBy: scope.actorId,
        userIds: [body.user_id],
        awardedAmount: resolvedAmount,
        wageringRequired,
        expiresAt: body.expires_at ?? null,
        metadata: {
          source: 'manual_award',
          ...(body.metadata ?? {}),
        },
      });
      return { bonus, assignment: inserted[0] };
    }
  );

  await tryAudit(
    {
      tenantId: out.bonus.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bonus.award_manual',
      resource: 'bonus_rule',
      resourceId: id,
      payload: {
        user_id: body.user_id,
        assignment_id: out.assignment.id,
        awarded_amount: out.assignment.awarded_amount,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return out.assignment;
}

export async function evaluateInternalBonusEvent(body: InternalEvaluateInput) {
  return withTenantClient(
    { tenantId: body.tenant_id, bypassRls: true },
    async (client) => {
      const awarded = await repo.evaluateAndAwardForEvent(client, {
        tenantId: body.tenant_id,
        userId: body.user_id,
        eventType: body.event_type,
        amount: body.amount ?? 0,
        metadata: body.metadata ?? {},
      });
      return {
        user_id: body.user_id,
        event_type: body.event_type,
        awarded_count: awarded.length,
        assignments: awarded,
      };
    }
  );
}
