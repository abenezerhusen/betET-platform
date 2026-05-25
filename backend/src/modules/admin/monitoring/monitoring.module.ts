import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { NotFoundError } from '../../../http/errors/http-error';
import { logger } from '../../../infrastructure/logger';
import { tryAudit } from '../../audit/audit.service';
import {
  emitSystemAlert,
  emitToAdmins,
  emitToTenant,
  emitToUser,
} from '../../../realtime/socket';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

/* DTOs --------------------------------------------------------------------- */

const idParam = z.object({ id: z.string().uuid() });

const listErrorsQuery = z.object({
  level: z.enum(['debug', 'info', 'warning', 'error', 'fatal']).optional(),
  source: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  resolved: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

const recordErrorSchema = z.object({
  level: z.enum(['debug', 'info', 'warning', 'error', 'fatal']).default('error'),
  source: z.string().trim().min(1).max(120).default('frontend'),
  code: z.string().trim().max(80).optional(),
  message: z.string().trim().min(1).max(8000),
  stack: z.string().optional(),
  context: z.record(z.unknown()).default({}),
  user_id: z.string().uuid().optional(),
  request_id: z.string().trim().max(120).optional(),
});

const listMetricsQuery = z.object({
  kind: z.enum(['route', 'job', 'webhook', 'provider']).optional(),
  name: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const recordMetricSchema = z.object({
  kind: z.enum(['route', 'job', 'webhook', 'provider']).default('route'),
  name: z.string().trim().min(1).max(160),
  method: z.string().trim().max(10).optional(),
  request_count: z.number().nonnegative().default(0),
  error_count: z.number().nonnegative().default(0),
  p50_ms: z.number().int().nonnegative().optional(),
  p95_ms: z.number().int().nonnegative().optional(),
  p99_ms: z.number().int().nonnegative().optional(),
  avg_ms: z.number().int().nonnegative().optional(),
  period_start: z.coerce.date(),
  period_end: z.coerce.date(),
});

const listNotificationsQuery = z.object({
  status: z.enum(['queued', 'sent', 'cancelled', 'failed']).optional(),
  level: z.enum(['info', 'success', 'warning', 'error', 'critical']).optional(),
  target_role: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const createNotificationSchema = z.object({
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(4000),
  level: z.enum(['info', 'success', 'warning', 'error', 'critical']).default('info'),
  target_role: z.string().trim().min(1).max(80).default('tenant_admin'),
  target_user_id: z.string().uuid().optional(),
  scheduled_at: z.coerce.date().optional(),
  link_url: z.string().trim().url().optional(),
  metadata: z.record(z.unknown()).default({}),
  send_now: z.boolean().default(true),
});

/* Service ------------------------------------------------------------------ */

export const listErrorsQuerySchema = listErrorsQuery;
export const listMetricsQuerySchema = listMetricsQuery;
export const listNotificationsQuerySchema = listNotificationsQuery;

export async function listErrorLogs(req: Request, q: z.infer<typeof listErrorsQuery>) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`(tenant_id = $${i++} OR tenant_id IS NULL)`);
        values.push(scope.tenantId);
      }
      if (q.level) {
        filters.push(`level = $${i++}`);
        values.push(q.level);
      }
      if (q.source) {
        filters.push(`source = $${i++}`);
        values.push(q.source);
      }
      if (q.search) {
        filters.push(`(message ILIKE $${i} OR code ILIKE $${i})`);
        values.push(`%${q.search}%`);
        i++;
      }
      if (q.resolved !== undefined) {
        filters.push(q.resolved ? `resolved_at IS NOT NULL` : `resolved_at IS NULL`);
      }
      if (q.from) {
        filters.push(`occurred_at >= $${i++}`);
        values.push(q.from);
      }
      if (q.to) {
        filters.push(`occurred_at <= $${i++}`);
        values.push(q.to);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM error_logs ${where}`,
        values
      );
      const rows = await client.query(
        `SELECT id, tenant_id, request_id, level, source, code, message, stack,
                context, user_id, occurred_at, resolved_at, resolved_by
           FROM error_logs ${where}
           ORDER BY occurred_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      return {
        items: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
      };
    }
  );
}

async function recordError(req: Request, body: z.infer<typeof recordErrorSchema>) {
  const scope = getAdminScope(req);
  const tenantId = scope.tenantId;
  return withTenantClient(
    { tenantId, bypassRls: tenantId ? scope.bypassRls : true },
    async (client) => {
      const r = await client.query(
        `INSERT INTO error_logs (
           tenant_id, request_id, level, source, code, message, stack, context, user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         RETURNING id, tenant_id, level, source, code, message, occurred_at`,
        [
          tenantId,
          body.request_id ?? null,
          body.level,
          body.source,
          body.code ?? null,
          body.message,
          body.stack ?? null,
          JSON.stringify(body.context),
          body.user_id ?? null,
        ]
      );
      // For high-severity errors, push a system alert to admins.
      if (tenantId && (body.level === 'error' || body.level === 'fatal')) {
        emitSystemAlert(tenantId, {
          level: body.level === 'fatal' ? 'critical' : 'error',
          code: body.code ?? body.source,
          message: body.message,
        });
      }
      logger.warn(
        { errorId: r.rows[0].id, source: body.source, code: body.code, level: body.level },
        'error_log recorded'
      );
      return r.rows[0];
    }
  );
}

async function resolveError(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE error_logs SET resolved_at = now(), resolved_by = $1
           WHERE id = $2
           RETURNING id, resolved_at, resolved_by`,
        [scope.actorId, id]
      );
      if (!r.rows[0]) throw new NotFoundError('Error not found');
      return r.rows[0];
    }
  );
}

export async function listMetrics(req: Request, q: z.infer<typeof listMetricsQuery>) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`(tenant_id = $${i++} OR tenant_id IS NULL)`);
        values.push(scope.tenantId);
      }
      if (q.kind) {
        filters.push(`kind = $${i++}`);
        values.push(q.kind);
      }
      if (q.name) {
        filters.push(`name = $${i++}`);
        values.push(q.name);
      }
      if (q.from) {
        filters.push(`period_start >= $${i++}`);
        values.push(q.from);
      }
      if (q.to) {
        filters.push(`period_end <= $${i++}`);
        values.push(q.to);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const rows = await client.query(
        `SELECT id, tenant_id, kind, name, method, request_count, error_count,
                p50_ms, p95_ms, p99_ms, avg_ms, period_start, period_end, created_at
           FROM performance_metrics ${where}
           ORDER BY period_start DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      return { items: rows.rows };
    }
  );
}

async function recordMetric(req: Request, body: z.infer<typeof recordMetricSchema>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `INSERT INTO performance_metrics (
           tenant_id, kind, name, method, request_count, error_count,
           p50_ms, p95_ms, p99_ms, avg_ms, period_start, period_end
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, tenant_id, kind, name, method, request_count, error_count,
                   p50_ms, p95_ms, p99_ms, avg_ms, period_start, period_end, created_at`,
        [
          scope.tenantId,
          body.kind,
          body.name,
          body.method ?? null,
          body.request_count,
          body.error_count,
          body.p50_ms ?? null,
          body.p95_ms ?? null,
          body.p99_ms ?? null,
          body.avg_ms ?? null,
          body.period_start,
          body.period_end,
        ]
      );
      return r.rows[0];
    }
  );
}

/* System notifications ----------------------------------------------------- */

export async function listNotifications(
  req: Request,
  q: z.infer<typeof listNotificationsQuery>
) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.status) {
        filters.push(`status = $${i++}`);
        values.push(q.status);
      }
      if (q.level) {
        filters.push(`level = $${i++}`);
        values.push(q.level);
      }
      if (q.target_role) {
        filters.push(`target_role = $${i++}`);
        values.push(q.target_role);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM system_notifications n ${where}`,
        values
      );
      // We join system_notification_reads to expose `read_by_me`/`read_at`
      // per the calling admin. Reads-table is bypassRls-safe (no
      // tenant_id) so the LEFT JOIN doesn't interact with RLS.
      const readUserParam = i++;
      values.push(scope.actorId);
      const rows = await client.query(
        `SELECT n.id, n.tenant_id, n.title, n.message, n.level, n.target_role,
                n.target_user_id, n.scheduled_at, n.sent_at, n.read_count,
                n.link_url, n.metadata, n.status, n.created_by,
                n.created_at, n.updated_at,
                (r.notification_id IS NOT NULL) AS read_by_me,
                r.read_at AS read_at
           FROM system_notifications n
           LEFT JOIN system_notification_reads r
             ON r.notification_id = n.id AND r.user_id = $${readUserParam}
           ${where}
           ORDER BY n.created_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      return {
        items: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
      };
    }
  );
}

export async function createNotification(
  req: Request,
  body: z.infer<typeof createNotificationSchema>
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const status = body.send_now && !body.scheduled_at ? 'sent' : 'queued';
      const r = await client.query(
        `INSERT INTO system_notifications (
           tenant_id, title, message, level, target_role, target_user_id,
           scheduled_at, link_url, metadata, status, sent_at, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,
                   CASE WHEN $10 = 'sent' THEN now() ELSE NULL END,
                   $11)
         RETURNING id, tenant_id, title, message, level, target_role,
                   target_user_id, scheduled_at, sent_at, read_count, link_url,
                   metadata, status, created_by, created_at, updated_at`,
        [
          tenantId,
          body.title,
          body.message,
          body.level,
          body.target_role,
          body.target_user_id ?? null,
          body.scheduled_at ?? null,
          body.link_url ?? null,
          JSON.stringify(body.metadata),
          status,
          scope.actorId,
        ]
      );
      const row = r.rows[0];
      if (status === 'sent') {
        if (row.target_user_id) {
          emitToUser(tenantId, row.target_user_id, 'SYSTEM_NOTIFICATION', { notification: row });
        } else if (body.target_role === 'all') {
          emitToTenant(tenantId, 'SYSTEM_NOTIFICATION', { notification: row });
        } else {
          emitToAdmins(tenantId, 'SYSTEM_NOTIFICATION', { notification: row });
        }
      }
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.system_notification.create',
          resource: 'system_notifications',
          resourceId: row.id,
          payload: { after: row },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return row;
    }
  );
}

export const createNotificationBodySchema = createNotificationSchema;

export async function cancelNotification(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE system_notifications SET status = 'cancelled'
           WHERE id = $1 AND status = 'queued'
           RETURNING id, status`,
        [id]
      );
      if (!r.rows[0]) throw new NotFoundError('Notification not found or not queued');
      return r.rows[0];
    }
  );
}

/**
 * Per-admin "mark as read" receipt.
 *
 *   PATCH /api/admin/notifications/:id/read
 *
 * Idempotent: marking the same notification read twice is a no-op (the
 * INSERT is ON CONFLICT DO NOTHING). The notification's global
 * read_count is also incremented on the FIRST mark by this user.
 */
export async function markNotificationRead(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: true },
    async (client) => {
      const exists = await client.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM system_notifications WHERE id = $1`,
        [id]
      );
      if (!exists.rows[0]) throw new NotFoundError('Notification not found');
      if (
        !scope.isSuperadmin &&
        exists.rows[0].tenant_id !== scope.tenantId
      ) {
        throw new NotFoundError('Notification not found');
      }

      const inserted = await client.query<{ inserted: boolean }>(
        `INSERT INTO system_notification_reads (notification_id, user_id)
           VALUES ($1, $2)
         ON CONFLICT (notification_id, user_id) DO NOTHING
         RETURNING true AS inserted`,
        [id, scope.actorId]
      );
      const isFirstRead = inserted.rows.length > 0;
      if (isFirstRead) {
        await client.query(
          `UPDATE system_notifications
              SET read_count = read_count + 1,
                  updated_at = now()
            WHERE id = $1`,
          [id]
        );
      }
      const row = await client.query(
        `SELECT n.id, n.tenant_id, n.title, n.level, n.status, n.read_count,
                r.read_at
           FROM system_notifications n
           JOIN system_notification_reads r
             ON r.notification_id = n.id
            AND r.user_id = $2
          WHERE n.id = $1`,
        [id, scope.actorId]
      );
      return {
        ...row.rows[0],
        read_by_me: true,
        first_read: isFirstRead,
      };
    }
  );
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
const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

/* Errors */
router.get('/errors', wrap((req) => listErrorLogs(req, listErrorsQuery.parse(req.query))));
router.post(
  '/errors',
  wrapStatus(201, (req) => recordError(req, recordErrorSchema.parse(req.body)))
);
router.post(
  '/errors/:id/resolve',
  wrap((req) => resolveError(req, idParam.parse(req.params).id))
);

/* Performance metrics */
router.get('/metrics', wrap((req) => listMetrics(req, listMetricsQuery.parse(req.query))));
router.post(
  '/metrics',
  wrapStatus(201, (req) => recordMetric(req, recordMetricSchema.parse(req.body)))
);

/* System notifications */
router.get(
  '/notifications',
  wrap((req) => listNotifications(req, listNotificationsQuery.parse(req.query)))
);
router.post(
  '/notifications',
  wrapStatus(201, (req) => createNotification(req, createNotificationSchema.parse(req.body)))
);
router.post(
  '/notifications/:id/cancel',
  wrap((req) => cancelNotification(req, idParam.parse(req.params).id))
);
// Section 10 spec — per-admin "mark as read".
router.patch(
  '/notifications/:id/read',
  wrap((req) => markNotificationRead(req, idParam.parse(req.params).id))
);

export default router;
