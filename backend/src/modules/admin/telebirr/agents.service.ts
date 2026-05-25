import type { Request } from 'express';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { hashPassword } from '../../auth/password';
import * as telebirrRepo from '../../telebirr/telebirr.repository';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

import type {
  CreateAgentInput,
  ListAgentsQuery,
  ToggleAgentInput,
  UpdateAgentInput,
} from './admin.telebirr.dto';

/* ------------------------------------------------------------------------- */
/* List                                                                      */
/* ------------------------------------------------------------------------- */

export async function listAgents(req: Request, params: ListAgentsQuery) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      telebirrRepo.listAgents(client, {
        tenantId,
        status: params.status ?? null,
        search: params.search ?? null,
        limit: params.limit,
        offset,
      })
  );

  return {
    items: data.rows.map(maskAgent),
    total: data.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.total / params.limit)),
  };
}

/* ------------------------------------------------------------------------- */
/* Create                                                                    */
/* ------------------------------------------------------------------------- */

export async function createAgent(req: Request, body: CreateAgentInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  if (body.assigned_cashier_id) {
    await assertCashierBelongsToTenant(tenantId, body.assigned_cashier_id);
  }

  // bcrypt the password BEFORE the transaction so the hash work doesn't
  // hold a DB connection open for ~80ms.
  const authTokenHash = await hashPassword(body.password);

  const inserted = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      try {
        return await telebirrRepo.insertAgent(client, {
          tenantId,
          agentName: body.agent_name,
          telebirrNumber: body.telebirr_number,
          deviceId: body.device_id,
          deviceName: body.device_name ?? null,
          authTokenHash,
          assignedCashierId: body.assigned_cashier_id ?? null,
        });
      } catch (err) {
        // 23505 = unique_violation. Two reasons we'd hit this:
        //   - (tenant_id, device_id) already exists
        //   - (tenant_id, telebirr_number) WHERE status='active' partial uniq
        const code = (err as { code?: string }).code;
        if (code === '23505') {
          throw new ConflictError(
            'Agent already exists with this device id or active Telebirr number',
            { reason: 'duplicate_agent' }
          );
        }
        throw err;
      }
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.agent.create',
      resource: 'telebirr_agent',
      resourceId: inserted.id,
      payload: {
        agent_name: inserted.agent_name,
        telebirr_number: inserted.telebirr_number,
        device_id: inserted.device_id,
        assigned_cashier_id: inserted.assigned_cashier_id,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return maskAgent({
    ...inserted,
    device_name: body.device_name ?? null,
    app_version: null,
    last_seen_at: null,
    today_volume: '0',
    today_count: 0,
  });
}

/* ------------------------------------------------------------------------- */
/* Update                                                                    */
/* ------------------------------------------------------------------------- */

export async function updateAgent(
  req: Request,
  id: string,
  body: UpdateAgentInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  if (body.assigned_cashier_id) {
    await assertCashierBelongsToTenant(tenantId, body.assigned_cashier_id);
  }

  // Hash password outside the transaction so the lock window stays small.
  const authTokenHash = body.password
    ? await hashPassword(body.password)
    : null;

  const updated = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await telebirrRepo.findAgentById(client, id);
      if (!existing || existing.tenant_id !== tenantId) {
        throw new NotFoundError('Agent not found');
      }

      let row;
      try {
        row = await telebirrRepo.updateAgentMetadata(client, id, {
          agentName: body.agent_name,
          telebirrNumber: body.telebirr_number,
          deviceName: body.device_name,
          assignedCashierId: body.assigned_cashier_id ?? null,
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '23505') {
          throw new ConflictError(
            'Telebirr number conflicts with another active agent in this tenant',
            { reason: 'duplicate_telebirr_number' }
          );
        }
        throw err;
      }
      if (!row) throw new NotFoundError('Agent not found');

      if (authTokenHash) {
        await client.query(
          `UPDATE telebirr_agents SET auth_token_hash = $2 WHERE id = $1`,
          [id, authTokenHash]
        );
        // Force outstanding sessions to re-login when password changes.
        await telebirrRepo.closeAllOpenAgentSessions(client, id);
      }

      return { row, before: existing };
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.agent.update',
      resource: 'telebirr_agent',
      resourceId: updated.row.id,
      payload: {
        before: pickAgentForAudit(updated.before),
        after: pickAgentForAudit(updated.row),
        password_rotated: Boolean(authTokenHash),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return maskAgent({
    ...updated.row,
    device_name: null,
    app_version: null,
    last_seen_at: null,
    today_volume: '0',
    today_count: 0,
  });
}

/* ------------------------------------------------------------------------- */
/* Toggle status                                                             */
/* ------------------------------------------------------------------------- */

export async function toggleAgentStatus(
  req: Request,
  id: string,
  body: ToggleAgentInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const out = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await telebirrRepo.findAgentById(client, id);
      if (!existing || existing.tenant_id !== tenantId) {
        throw new NotFoundError('Agent not found');
      }
      if (existing.status === body.status) {
        return { existing, updated: existing, sessionsClosed: 0 };
      }
      const updated = await telebirrRepo.setAgentStatus(client, id, body.status);
      if (!updated) throw new NotFoundError('Agent not found');

      // Suspending or de-activating an agent should immediately revoke
      // its sessions so the device app gets a 401 on its next call.
      let sessionsClosed = 0;
      if (body.status !== 'active') {
        sessionsClosed = await telebirrRepo.closeAllOpenAgentSessions(client, id);
      }
      return { existing, updated, sessionsClosed };
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.agent.toggle',
      resource: 'telebirr_agent',
      resourceId: out.updated.id,
      payload: {
        from: out.existing.status,
        to: out.updated.status,
        reason: body.reason ?? null,
        sessions_closed: out.sessionsClosed,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return {
    id: out.updated.id,
    status: out.updated.status,
    sessions_closed: out.sessionsClosed,
  };
}

/* ------------------------------------------------------------------------- */
/* Reset token                                                               */
/* ------------------------------------------------------------------------- */

export async function resetAgentToken(req: Request, id: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const out = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await telebirrRepo.findAgentById(client, id);
      if (!existing || existing.tenant_id !== tenantId) {
        throw new NotFoundError('Agent not found');
      }
      const closed = await telebirrRepo.closeAllOpenAgentSessions(client, id);
      return { existing, closed };
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.agent.reset_token',
      resource: 'telebirr_agent',
      resourceId: id,
      payload: {
        sessions_closed: out.closed,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { id, sessions_closed: out.closed };
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

async function assertCashierBelongsToTenant(
  tenantId: string,
  cashierId: string
): Promise<void> {
  const row = await withTenantClient(
    { tenantId },
    async (client) => {
      const r = await client.query<{ id: string; role: string; status: string }>(
        `SELECT id, role, status FROM users WHERE id = $1 LIMIT 1`,
        [cashierId]
      );
      return r.rows[0] ?? null;
    }
  );
  if (!row) throw new NotFoundError('Assigned cashier not found in this tenant');
  if (row.role !== 'cashier') {
    throw new BadRequestError('assigned_cashier_id must reference a cashier user', {
      reason: 'not_a_cashier',
      role: row.role,
    });
  }
  if (row.status !== 'active') {
    throw new ForbiddenError('Cannot assign an inactive cashier', {
      reason: 'cashier_inactive',
      status: row.status,
    });
  }
}

function pickAgentForAudit(
  a: { id: string; agent_name: string; telebirr_number: string; status: string; assigned_cashier_id: string | null }
): Record<string, unknown> {
  return {
    id: a.id,
    agent_name: a.agent_name,
    telebirr_number: a.telebirr_number,
    status: a.status,
    assigned_cashier_id: a.assigned_cashier_id,
  };
}

function maskAgent(a: telebirrRepo.AgentWithStats) {
  // Never leak the auth_token_hash; the rest of the fields are safe
  // for tenant_admin / superadmin consumption.
  return {
    id: a.id,
    tenant_id: a.tenant_id,
    agent_name: a.agent_name,
    telebirr_number: a.telebirr_number,
    device_id: a.device_id,
    device_name: a.device_name,
    app_version: a.app_version,
    status: a.status,
    balance: a.balance,
    assigned_cashier_id: a.assigned_cashier_id,
    last_seen_at: a.last_seen_at ? a.last_seen_at.toISOString() : null,
    created_at: a.created_at.toISOString(),
    today_volume: a.today_volume,
    today_count: a.today_count,
  };
}
