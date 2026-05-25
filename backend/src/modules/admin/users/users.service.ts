import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { hashPassword } from '../../auth/password';
import { revokeAllUserRefreshTokens } from '../../auth/auth.repository';
import { emitUserSuspended } from '../../../realtime/socket';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';
import * as repo from './users.repository';
import type {
  AssignRoleInput,
  ChangeUserPasswordInput,
  CreateUserInput,
  KycRejectInput,
  ListUsersQuery,
  SuspendUserInput,
  UpdateUserInput,
  UserActivityQuery,
  UserStatusInput,
} from './users.dto';

function pickAuditUser(u: repo.AdminUserRow): Record<string, unknown> {
  return {
    id: u.id,
    tenant_id: u.tenant_id,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    kyc_status: u.kyc_status,
  };
}

/**
 * Tenant-admin may not assign superadmin role; this prevents privilege
 * escalation. Superadmin may assign any role.
 */
function ensureCanAssignRole(role: string, isSuperadmin: boolean) {
  if (!isSuperadmin && role === 'superadmin') {
    throw new ForbiddenError('Cannot assign superadmin role');
  }
}

/**
 * Agent → Branch → Sales hierarchy is **stored on `users.metadata`**:
 *
 *   role = 'branch' → metadata.agent_id  references a user with role='agent'
 *   role = 'sales'  → metadata.agent_id  references a user with role='agent'
 *                     metadata.branch_id references a user with role='branch'
 *                     AND that branch's metadata.agent_id MUST equal the
 *                     same agent_id (no cross-agent sales accounts).
 *
 * This helper runs on every create and on every metadata/role change so
 * the relationship can never drift out of sync via the admin "Edit user"
 * action.
 */
async function validateShopHierarchy(
  client: PoolClient,
  tenantId: string,
  role: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (role === 'branch') {
    const agentId = typeof metadata.agent_id === 'string' ? metadata.agent_id.trim() : '';
    if (!agentId) {
      throw new BadRequestError('Branch must be assigned to an agent', {
        field: 'metadata.agent_id',
      });
    }
    const agent = await repo.findUserByIdInTenantAndRole(
      client,
      tenantId,
      agentId,
      'agent'
    );
    if (!agent) {
      throw new BadRequestError(
        'Selected agent does not exist in this tenant',
        { field: 'metadata.agent_id' }
      );
    }
    return;
  }

  if (role === 'sales') {
    const agentId = typeof metadata.agent_id === 'string' ? metadata.agent_id.trim() : '';
    const branchId = typeof metadata.branch_id === 'string' ? metadata.branch_id.trim() : '';
    if (!agentId) {
      throw new BadRequestError('Sales must be assigned to an agent', {
        field: 'metadata.agent_id',
      });
    }
    if (!branchId) {
      throw new BadRequestError('Sales must be assigned to a branch', {
        field: 'metadata.branch_id',
      });
    }
    const [agent, branch] = await Promise.all([
      repo.findUserByIdInTenantAndRole(client, tenantId, agentId, 'agent'),
      repo.findUserByIdInTenantAndRole(client, tenantId, branchId, 'branch'),
    ]);
    if (!agent) {
      throw new BadRequestError(
        'Selected agent does not exist in this tenant',
        { field: 'metadata.agent_id' }
      );
    }
    if (!branch) {
      throw new BadRequestError(
        'Selected branch does not exist in this tenant',
        { field: 'metadata.branch_id' }
      );
    }
    const branchMeta = (branch.metadata ?? {}) as Record<string, unknown>;
    const branchAgentId =
      typeof branchMeta.agent_id === 'string' ? branchMeta.agent_id.trim() : '';
    if (!branchAgentId || branchAgentId !== agentId) {
      throw new BadRequestError(
        'Selected branch does not belong to the selected agent',
        { field: 'metadata.branch_id' }
      );
    }
  }
}

/* ------------------------------------------------------------------------- */
/* List                                                                      */
/* ------------------------------------------------------------------------- */

export async function listUsers(req: Request, params: ListUsersQuery) {
  const scope = getAdminScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listUsers(client, scope.tenantId, {
        role: params.role ?? null,
        status: params.status ?? null,
        kycStatus: params.kyc_status ?? null,
        search: params.search ?? null,
        limit: params.limit,
        offset,
        withBalance: params.with_balance ?? false,
        withActivity: params.with_activity ?? false,
        // When the admin panel hit the `online_user` alias, also defensively
        // exclude every offline/shop-based role even if a malformed row
        // ended up with `role='user'` plus shop-hierarchy metadata.
        excludeOfflineStaffRoles: params._online_users_alias ?? false,
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

/* ------------------------------------------------------------------------- */
/* Get                                                                       */
/* ------------------------------------------------------------------------- */

export async function getUser(req: Request, id: string) {
  const scope = getAdminScope(req);
  const user = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.findUserById(client, id)
  );
  if (!user) throw new NotFoundError('User not found');
  if (!scope.isSuperadmin && user.tenant_id !== scope.tenantId) {
    throw new ForbiddenError('User belongs to a different tenant');
  }
  return user;
}

/* ------------------------------------------------------------------------- */
/* Create                                                                    */
/* ------------------------------------------------------------------------- */

export async function createUser(req: Request, body: CreateUserInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  ensureCanAssignRole(body.role, scope.isSuperadmin);

  const metadata = (body.metadata ?? {}) as Record<string, unknown>;
  if (body.role === 'branch' || body.role === 'sales') {
    await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        await validateShopHierarchy(client, tenantId, body.role, metadata);
      }
    );
  }

  const passwordHash = body.password ? await hashPassword(body.password) : null;

  const created = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.insertUser(client, {
        tenantId,
        email: body.email ?? null,
        phone: body.phone ?? null,
        passwordHash,
        role: body.role,
        status: body.status ?? 'active',
        kycStatus: body.kyc_status ?? 'pending',
        metadata,
      })
  );

  await tryAudit(
    {
      tenantId: created.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.user.create',
      resource: 'user',
      resourceId: created.id,
      payload: {
        after: pickAuditUser(created),
        password_set: passwordHash !== null,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return created;
}

/* ------------------------------------------------------------------------- */
/* Update                                                                    */
/* ------------------------------------------------------------------------- */

export async function updateUser(req: Request, id: string, body: UpdateUserInput) {
  const scope = getAdminScope(req);
  if (body.role) ensureCanAssignRole(body.role, scope.isSuperadmin);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findUserById(client, id);
      if (!before) throw new NotFoundError('User not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }

      // Re-validate hierarchy whenever the role or metadata changes, using
      // the effective (post-update) row. This blocks situations like:
      //   • Editing a sales user's metadata.branch_id to a branch that
      //     belongs to a different agent.
      //   • Promoting a 'user' to 'branch' without setting agent_id.
      //   • Demoting an agent that still has dependent branches (covered
      //     separately in the dependent-check below).
      const effectiveRole = body.role ?? before.role;
      const effectiveMetadata =
        body.metadata !== undefined
          ? body.metadata
          : (before.metadata ?? {});
      if (effectiveRole === 'branch' || effectiveRole === 'sales') {
        await validateShopHierarchy(
          client,
          before.tenant_id,
          effectiveRole,
          effectiveMetadata as Record<string, unknown>
        );
      }

      // If the role itself is moving AWAY from 'agent' or 'branch', the
      // hierarchy below it would be orphaned. Refuse the change so the
      // admin must first reassign or delete the dependent rows.
      if (body.role && body.role !== before.role) {
        if (before.role === 'agent') {
          const depBranches = await client.query<{ c: number }>(
            `SELECT COUNT(*)::int AS c
               FROM users
              WHERE tenant_id = $1
                AND role IN ('branch','sales')
                AND metadata->>'agent_id' = $2`,
            [before.tenant_id, id]
          );
          if ((depBranches.rows[0]?.c ?? 0) > 0) {
            throw new BadRequestError(
              'Cannot change this agent\u2019s role while branches or sales accounts are still assigned to it. Reassign or remove them first.',
              { field: 'role' }
            );
          }
        }
        if (before.role === 'branch') {
          const depSales = await client.query<{ c: number }>(
            `SELECT COUNT(*)::int AS c
               FROM users
              WHERE tenant_id = $1
                AND role = 'sales'
                AND metadata->>'branch_id' = $2`,
            [before.tenant_id, id]
          );
          if ((depSales.rows[0]?.c ?? 0) > 0) {
            throw new BadRequestError(
              'Cannot change this branch\u2019s role while sales accounts are still assigned to it. Reassign or remove them first.',
              { field: 'role' }
            );
          }
        }
      }

      const after = await repo.updateUser(client, id, body);
      if (!after) throw new BadRequestError('No fields to update');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.user.update',
      resource: 'user',
      resourceId: id,
      payload: {
        before: pickAuditUser(result.before),
        after: pickAuditUser(result.after),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}

/* ------------------------------------------------------------------------- */
/* Suspend                                                                   */
/* ------------------------------------------------------------------------- */

export async function suspendUser(req: Request, id: string, body: SuspendUserInput) {
  const scope = getAdminScope(req);

  if (id === scope.actorId) {
    throw new BadRequestError('You cannot suspend your own account', {
      reason: 'self_status_change',
    });
  }

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findUserById(client, id);
      if (!before) throw new NotFoundError('User not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }
      if (before.role === 'superadmin' && !scope.isSuperadmin) {
        throw new ForbiddenError('Cannot suspend a Super Admin');
      }
      const after = await repo.setUserStatus(client, id, 'suspended');
      if (!after) throw new NotFoundError('User not found');
      // Kill every active session for this user.
      await revokeAllUserRefreshTokens(client, id);
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.user.suspend',
      resource: 'user',
      resourceId: id,
      payload: {
        before: { status: result.before.status },
        after: { status: result.after.status },
        reason: body.reason,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  // Emit USER_SUSPENDED to admin and the affected user. Frontends use this
  // to update dashboards live and to force-close active sessions on the
  // suspended user's devices.
  emitUserSuspended(result.after.tenant_id, {
    user_id: id,
    reason: body.reason,
    by: scope.actorId,
  });

  return result.after;
}

/* ------------------------------------------------------------------------- */
/* Set status (toggle active / suspended / disabled / banned)                */
/* ------------------------------------------------------------------------- */

/**
 * Generic status switcher used by the admin panel "Toggle Status" action.
 *
 * Rules enforced here (also documented in the spec):
 *  - You cannot suspend / disable / ban your own account.
 *  - When the new status is anything other than 'active', every active
 *    refresh token for the affected user is revoked so any existing
 *    sessions on web/mobile can no longer mint new access tokens.
 *  - The transition is recorded in the audit log.
 *  - The realtime layer is notified so dashboards refresh and any open
 *    panels for the affected user are forcefully signed out.
 */
export async function setUserStatus(
  req: Request,
  id: string,
  body: UserStatusInput
) {
  const scope = getAdminScope(req);

  if (id === scope.actorId && body.status !== 'active') {
    throw new BadRequestError('You cannot change the status of your own account', {
      reason: 'self_status_change',
    });
  }

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findUserById(client, id);
      if (!before) throw new NotFoundError('User not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }
      // Tenant-admins may not flip a superadmin (privilege escalation guard).
      if (before.role === 'superadmin' && !scope.isSuperadmin) {
        throw new ForbiddenError('Cannot change the status of a Super Admin');
      }
      const after = await repo.setUserStatus(client, id, body.status);
      if (!after) throw new NotFoundError('User not found');

      // When the user is being deactivated in any way, kill every existing
      // session immediately. revokeAllUserRefreshTokens is idempotent.
      if (body.status !== 'active') {
        await revokeAllUserRefreshTokens(client, id);
      }
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: `admin.user.status.${body.status}`,
      resource: 'user',
      resourceId: id,
      payload: {
        before: { status: result.before.status },
        after: { status: result.after.status },
        reason: body.reason ?? null,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  // Notify realtime listeners. The "suspended" event is reused for any
  // non-active transition so dashboards and the affected user's panels
  // both react.
  if (body.status !== 'active') {
    emitUserSuspended(result.after.tenant_id, {
      user_id: id,
      reason: body.reason,
      by: scope.actorId,
    });
  }

  return result.after;
}

/* ------------------------------------------------------------------------- */
/* Change password                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Admin "Change Password" action.
 *
 *  - Hashes the new password with the same primitive used at registration.
 *  - Wipes every existing refresh token so the user is forced to log in
 *    again on every device.
 *  - Records an audit event but never the password itself.
 */
export async function changeUserPassword(
  req: Request,
  id: string,
  body: ChangeUserPasswordInput
) {
  const scope = getAdminScope(req);

  const passwordHash = await hashPassword(body.password);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findUserById(client, id);
      if (!before) throw new NotFoundError('User not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }
      if (before.role === 'superadmin' && !scope.isSuperadmin) {
        throw new ForbiddenError('Cannot change the password of a Super Admin');
      }
      const after = await repo.setUserPasswordHash(client, id, passwordHash);
      if (!after) throw new NotFoundError('User not found');
      await revokeAllUserRefreshTokens(client, id);
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.user.change_password',
      resource: 'user',
      resourceId: id,
      payload: {
        target_user_id: id,
        // Never log password material; just record that it was changed.
        password_changed: true,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { id, password_changed: true };
}

/* ------------------------------------------------------------------------- */
/* KYC approve / reject                                                      */
/* ------------------------------------------------------------------------- */

export async function kycApprove(req: Request, id: string) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findUserById(client, id);
      if (!before) throw new NotFoundError('User not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }
      const after = await repo.setUserKyc(client, id, 'verified');
      if (!after) throw new NotFoundError('User not found');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.user.kyc_approve',
      resource: 'user',
      resourceId: id,
      payload: {
        before: { kyc_status: result.before.kyc_status },
        after: { kyc_status: result.after.kyc_status },
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}

export async function kycReject(req: Request, id: string, body: KycRejectInput) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findUserById(client, id);
      if (!before) throw new NotFoundError('User not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }
      const after = await repo.setUserKyc(client, id, 'rejected');
      if (!after) throw new NotFoundError('User not found');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.user.kyc_reject',
      resource: 'user',
      resourceId: id,
      payload: {
        before: { kyc_status: result.before.kyc_status },
        after: { kyc_status: result.after.kyc_status },
        reason: body.reason,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}

/* ------------------------------------------------------------------------- */
/* Activity                                                                  */
/* ------------------------------------------------------------------------- */

export async function userActivity(req: Request, id: string, params: UserActivityQuery) {
  const scope = getAdminScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const user = await repo.findUserById(client, id);
      if (!user) throw new NotFoundError('User not found');
      if (!scope.isSuperadmin && user.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }
      const activity = await repo.listUserActivity(client, id, {
        type: params.type,
        from: params.from ?? null,
        to: params.to ?? null,
        limit: params.limit,
        offset,
      });
      return { user, activity };
    }
  );

  return {
    user: { id: data.user.id, tenant_id: data.user.tenant_id },
    items: data.activity.rows,
    total: data.activity.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.activity.total / params.limit)),
  };
}

/* ------------------------------------------------------------------------- */
/* Assign role                                                               */
/* ------------------------------------------------------------------------- */

export async function assignRole(req: Request, id: string, body: AssignRoleInput) {
  const scope = getAdminScope(req);
  ensureCanAssignRole(body.role, scope.isSuperadmin);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findUserById(client, id);
      if (!before) throw new NotFoundError('User not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('User belongs to a different tenant');
      }

      // Same dependent-check + hierarchy validation we use in updateUser.
      // If the existing metadata is missing agent_id / branch_id but the
      // new role demands them, the admin must use the full edit form.
      if (body.role !== before.role) {
        if (before.role === 'agent') {
          const dep = await client.query<{ c: number }>(
            `SELECT COUNT(*)::int AS c
               FROM users
              WHERE tenant_id = $1
                AND role IN ('branch','sales')
                AND metadata->>'agent_id' = $2`,
            [before.tenant_id, id]
          );
          if ((dep.rows[0]?.c ?? 0) > 0) {
            throw new BadRequestError(
              'Cannot change this agent\u2019s role while branches or sales accounts are still assigned to it.',
              { field: 'role' }
            );
          }
        }
        if (before.role === 'branch') {
          const dep = await client.query<{ c: number }>(
            `SELECT COUNT(*)::int AS c
               FROM users
              WHERE tenant_id = $1
                AND role = 'sales'
                AND metadata->>'branch_id' = $2`,
            [before.tenant_id, id]
          );
          if ((dep.rows[0]?.c ?? 0) > 0) {
            throw new BadRequestError(
              'Cannot change this branch\u2019s role while sales accounts are still assigned to it.',
              { field: 'role' }
            );
          }
        }
      }
      if (body.role === 'branch' || body.role === 'sales') {
        await validateShopHierarchy(
          client,
          before.tenant_id,
          body.role,
          (before.metadata ?? {}) as Record<string, unknown>
        );
      }

      const after = await repo.updateUser(client, id, { role: body.role });
      if (!after) throw new NotFoundError('User not found');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.user.assign_role',
      resource: 'user',
      resourceId: id,
      payload: {
        before: { role: result.before.role },
        after: { role: result.after.role },
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}
