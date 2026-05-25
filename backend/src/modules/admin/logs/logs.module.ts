/**
 * Section 10 — Monitoring (Logs sub-tree)
 *
 *  Spec-aligned routes mounted at /api/admin/logs:
 *
 *    GET /api/admin/logs/activity  — User Activity Logs
 *      Player / cashier / anonymous events. Sourced from audit_logs
 *      filtered by actor_type IN ('user','cashier','sales','anonymous').
 *      Columns: User, Action, IP Address, Device (user_agent), Timestamp.
 *
 *    GET /api/admin/logs/audit     — Audit Trail (admin/system only)
 *      Filtered by actor_type IN ('admin','superadmin','system','tenant_admin').
 *      Shows: Admin User, Action, Affected Resource, Old/New Value,
 *      IP, Timestamp. The table itself is enforced as immutable by the
 *      audit_logs_block_modification trigger (see migration
 *      20260525160001_create_system_notification_reads_and_lock_audit_logs).
 *
 *    GET /api/admin/logs/errors    — Error Tracking
 *      Thin alias over the listErrorLogs handler used by
 *      /api/admin/monitoring/errors. Same query schema.
 *
 *  Both /activity and /audit are read-only thin wrappers over the shared
 *  audit_logs table. We intentionally do not provide PATCH/DELETE on
 *  these routes so that the spec requirement
 *  "Cannot be deleted or modified — immutable log" is enforced both at
 *  the API surface AND at the database surface.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ForbiddenError } from '../../../http/errors/http-error';
import { getAdminScope } from '../admin-shared';
import {
  listErrorLogs,
  listErrorsQuerySchema,
} from '../monitoring/monitoring.module';

/* DTOs --------------------------------------------------------------------- */

const sharedLogsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  actor_id: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(255).optional(),
  action_prefix: z.string().trim().min(1).max(255).optional(),
  resource: z.string().trim().min(1).max(255).optional(),
  resource_id: z.string().trim().min(1).max(255).optional(),
  status: z.enum(['success', 'failure', 'warning', 'info']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(255).optional(),
});

type SharedLogsQuery = z.infer<typeof sharedLogsQuery>;

/* Actor-type partitioning -------------------------------------------------- */

const USER_ACTOR_TYPES = ['user', 'cashier', 'sales', 'anonymous'] as const;
const ADMIN_ACTOR_TYPES = ['admin', 'superadmin', 'tenant_admin', 'system'] as const;

/* Service ------------------------------------------------------------------ */

async function listLogsByActorType(
  req: Request,
  query: SharedLogsQuery,
  actorTypes: readonly string[]
) {
  const scope = getAdminScope(req);

  // Tenant filter: tenant_admin is pinned, superadmin honours ?tenant_id.
  let effectiveTenantId: string | null;
  if (!scope.isSuperadmin) {
    if (query.tenant_id && query.tenant_id !== scope.tenantId) {
      throw new ForbiddenError('Cannot view logs of other tenants');
    }
    effectiveTenantId = scope.tenantId;
  } else {
    effectiveTenantId = query.tenant_id ?? scope.tenantId ?? null;
  }

  const offset = (query.page - 1) * query.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      // Build the actor_type filter as a positional IN(...) we can append
      // to the shared listAuditLogs WHERE. Because listAuditLogs has its
      // own filter builder we just pre-filter by inserting a fake
      // "actionPrefix" path is not enough — we'd need a separate query.
      //
      // For simplicity we run a dedicated SQL that mirrors listAuditLogs
      // but pins actor_type IN (...).
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      filters.push(`actor_type = ANY($${i++}::text[])`);
      values.push(actorTypes as readonly string[]);

      if (effectiveTenantId) {
        filters.push(`tenant_id = $${i++}`);
        values.push(effectiveTenantId);
      }
      if (query.actor_id) {
        filters.push(`actor_id = $${i++}`);
        values.push(query.actor_id);
      }
      if (query.user_id) {
        filters.push(`actor_id = $${i++}`);
        values.push(query.user_id);
      }
      if (query.action) {
        filters.push(`action = $${i++}`);
        values.push(query.action);
      }
      if (query.action_prefix) {
        filters.push(`action LIKE $${i++}`);
        values.push(`${query.action_prefix}%`);
      }
      if (query.resource) {
        filters.push(`resource = $${i++}`);
        values.push(query.resource);
      }
      if (query.resource_id) {
        filters.push(`resource_id = $${i++}`);
        values.push(query.resource_id);
      }
      if (query.status) {
        filters.push(`status = $${i++}`);
        values.push(query.status);
      }
      if (query.from) {
        filters.push(`created_at >= $${i++}`);
        values.push(query.from);
      }
      if (query.to) {
        filters.push(`created_at <= $${i++}`);
        values.push(query.to);
      }
      if (query.search) {
        filters.push(
          `(action ILIKE $${i} OR resource ILIKE $${i} OR resource_id ILIKE $${i})`
        );
        values.push(`%${query.search}%`);
        i++;
      }

      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const totalRes = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM audit_logs ${where}`,
        values
      );
      const total = totalRes.rows[0]?.count ?? 0;

      const rows = await client.query(
        `SELECT id, tenant_id, actor_id, actor_type, action, resource,
                resource_id, payload, host(ip) AS ip, user_agent, status,
                created_at,
                created_at AS occurred_at
           FROM audit_logs
           ${where}
          ORDER BY created_at DESC
          LIMIT $${i++} OFFSET $${i++}`,
        [...values, query.limit, offset]
      );

      return { rows: rows.rows, total };
    }
  );

  return {
    items: data.rows,
    total: data.total,
    page: query.page,
    limit: query.limit,
    pages: Math.max(1, Math.ceil(data.total / query.limit)),
  };
}

/* Routes ------------------------------------------------------------------- */

const router = Router();

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.get(
  '/activity',
  wrap((req) =>
    listLogsByActorType(req, sharedLogsQuery.parse(req.query), USER_ACTOR_TYPES)
  )
);

router.get(
  '/audit',
  wrap((req) =>
    listLogsByActorType(req, sharedLogsQuery.parse(req.query), ADMIN_ACTOR_TYPES)
  )
);

// Section 10 spec — /errors is a 1:1 alias of /monitoring/errors.
router.get(
  '/errors',
  wrap((req) => listErrorLogs(req, listErrorsQuerySchema.parse(req.query)))
);

/**
 * Resource immutability guard: explicitly reject mutation HTTP verbs on
 * the audit endpoint so callers see a friendly 405 rather than a 404.
 * The database-level trigger makes the underlying table immutable too.
 */
router.all('/audit', (req, res, next) => {
  if (req.method === 'GET') return next();
  res.set('Allow', 'GET');
  res.status(405).json({
    error: 'method_not_allowed',
    message: 'Audit trail is immutable — only GET is supported.',
  });
});

export default router;
