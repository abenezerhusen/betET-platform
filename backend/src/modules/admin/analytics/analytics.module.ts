/**
 * Section 10 — Monitoring (Analytics sub-tree)
 *
 *   GET /api/admin/analytics/performance
 *     Performance Analytics page. Aggregates from `performance_metrics`
 *     into the shape the admin UI expects:
 *
 *       {
 *         summary: { p50, p95, p99, avg, request_count, error_count },
 *         peak_hours: [{ hour: 0..23, request_count }],
 *         slowest_endpoints: [{ name, method, p95_ms, request_count }],
 *         database_query_time: { p50, p95 } | null,
 *         items: PerformanceMetricRow[]    // raw rows
 *       }
 *
 *     We always include `items` (legacy compat with the existing
 *     PerformanceAnalytics.tsx page which already maps row-by-row), and
 *     we add the new spec-aligned aggregates on top so the page can show
 *     the higher-level analytics described in Section 10.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import {
  listMetrics,
  listMetricsQuerySchema,
} from '../monitoring/monitoring.module';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { getAdminScope } from '../admin-shared';

const performanceQuery = z.object({
  kind: z.enum(['route', 'job', 'webhook', 'provider']).optional(),
  name: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  top: z.coerce.number().int().positive().max(50).default(10),
});

async function performanceOverview(req: Request) {
  const scope = getAdminScope(req);
  const q = performanceQuery.parse(req.query);

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

      const summary = await client.query<{
        p50_ms: number | null;
        p95_ms: number | null;
        p99_ms: number | null;
        avg_ms: number | null;
        request_count: string;
        error_count: string;
      }>(
        `SELECT AVG(p50_ms)::int AS p50_ms,
                AVG(p95_ms)::int AS p95_ms,
                AVG(p99_ms)::int AS p99_ms,
                AVG(avg_ms)::int AS avg_ms,
                COALESCE(SUM(request_count), 0)::text AS request_count,
                COALESCE(SUM(error_count), 0)::text   AS error_count
           FROM performance_metrics ${where}`,
        values
      );

      const peakHours = await client.query<{
        hour: number;
        request_count: string;
      }>(
        `SELECT EXTRACT(HOUR FROM period_start)::int AS hour,
                COALESCE(SUM(request_count), 0)::text AS request_count
           FROM performance_metrics ${where}
          GROUP BY 1
          ORDER BY 2 DESC NULLS LAST
          LIMIT 24`,
        values
      );

      const slowestEndpoints = await client.query(
        `SELECT name, method, kind,
                MAX(p95_ms) AS p95_ms,
                COALESCE(SUM(request_count), 0)::text AS request_count
           FROM performance_metrics
           ${where || 'WHERE TRUE'} AND kind = 'route'
          GROUP BY name, method, kind
          ORDER BY MAX(p95_ms) DESC NULLS LAST
          LIMIT $${i++}`,
        [...values, q.top]
      );

      const dbQuery = await client.query<{
        p50_ms: number | null;
        p95_ms: number | null;
      }>(
        `SELECT AVG(p50_ms)::int AS p50_ms,
                AVG(p95_ms)::int AS p95_ms
           FROM performance_metrics
           ${where || 'WHERE TRUE'}
            AND (name ILIKE 'db.%' OR name ILIKE 'pg.%' OR kind = 'job')`,
        values
      );

      // Re-use the existing listMetrics handler for the items list so the
      // current admin page (which maps row-by-row) keeps working.
      const items = await listMetrics(
        req,
        listMetricsQuerySchema.parse({
          kind: q.kind,
          name: q.name,
          from: q.from?.toISOString(),
          to: q.to?.toISOString(),
          page: 1,
          limit: 200,
        })
      );

      return {
        summary: summary.rows[0] ?? null,
        peak_hours: peakHours.rows,
        slowest_endpoints: slowestEndpoints.rows,
        database_query_time: dbQuery.rows[0] ?? null,
        items: items.items,
      };
    }
  );
}

const router = Router();

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.get('/performance', wrap(performanceOverview));

export default router;
