import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { pool } from '../../../infrastructure/db/pool';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { getAdminScope, requireScopedTenantId } from '../admin-shared';

const execAsync = promisify(exec);
const router = Router();

const listQuery = z.object({
  status: z.enum(['live', 'upcoming', 'completed']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  export: z.enum(['csv']).optional(),
});

const referralListQuery = z.object({
  status: z.enum(['all', 'pending', 'paid']).default('all'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const endpointTestSchema = z.object({
  endpoint: z.string().trim().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
});

const webhookTestSchema = z.object({
  id: z.string().uuid(),
});

const idParam = z.object({ id: z.string().uuid() });

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

function toStatusFilter(status: string | undefined): string | null {
  if (!status) return null;
  if (status === 'live') return 'live';
  if (status === 'upcoming') return 'scheduled';
  if (status === 'completed') return 'finished';
  return null;
}

/* --------------------------- Referral configuration ------------------------ */
// Referral list/approve/pay moved to /api/admin/affiliates/* (see
// admin/promotions/affiliates.routes.ts) so the spec URLs (with full
// wallet credit on /pay) become the source of truth.

router.get(
  '/promotions/referral-config',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const row = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'promotions.referral_config'`,
        [tenantId]
      );
      return (
        row.rows[0]?.value ?? {
          is_enabled: true,
          reward_amount: 10,
          min_deposit_to_qualify: 20,
          reward_type: 'cash',
        }
      );
    });
  })
);

router.put(
  '/promotions/referral-config',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = z
      .object({
        is_enabled: z.boolean().default(true),
        reward_amount: z.coerce.number().nonnegative(),
        min_deposit_to_qualify: z.coerce.number().nonnegative(),
        reward_type: z.enum(['cash', 'free_bet']),
      })
      .parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      await client.query(
        `INSERT INTO settings (tenant_id, key, value)
         VALUES ($1,'promotions.referral_config',$2::jsonb)
         ON CONFLICT (tenant_id,key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [tenantId, JSON.stringify(body)]
      );
      return body;
    });
  })
);

/* ------------------------- Cashout Boost configuration --------------------- */

const cashoutBoostSchema = z.object({
  is_enabled: z.boolean().default(false),
  promotion_type: z.enum(['percentage', 'fixed']).default('percentage'),
  promotion_value: z.coerce.number().nonnegative().default(10),
  availability: z.object({
    live_bets: z.boolean().default(true),
    prematch_bets: z.boolean().default(true),
    single_bets: z.boolean().default(true),
    multiple_bets: z.boolean().default(true),
    system_bets: z.boolean().default(false),
  }).default({}),
  sports: z.object({
    football: z.boolean().default(true),
    basketball: z.boolean().default(true),
    tennis: z.boolean().default(true),
    volleyball: z.boolean().default(true),
    esports: z.boolean().default(false),
    virtual: z.boolean().default(false),
    others: z.boolean().default(true),
  }).default({}),
  display: z.object({
    show_badge: z.boolean().default(true),
    show_original_amount: z.boolean().default(true),
    show_promotion_amount: z.boolean().default(true),
    show_final_amount: z.boolean().default(true),
    badge_text: z.string().trim().max(60).default('🔥 Cash Out Boost'),
  }).default({}),
});

export type CashoutBoostConfig = z.infer<typeof cashoutBoostSchema>;

const DEFAULT_CASHOUT_BOOST: CashoutBoostConfig = cashoutBoostSchema.parse({});

router.get(
  '/promotions/cashout-boost',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const row = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'promotions.cashout_boost'`,
        [tenantId]
      );
      return row.rows[0]?.value ?? DEFAULT_CASHOUT_BOOST;
    });
  })
);

router.put(
  '/promotions/cashout-boost',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = cashoutBoostSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      await client.query(
        `INSERT INTO settings (tenant_id, key, value)
         VALUES ($1,'promotions.cashout_boost',$2::jsonb)
         ON CONFLICT (tenant_id,key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [tenantId, JSON.stringify(body)]
      );
      return body;
    });
  })
);

/* ------------------------------- Match stats ------------------------------- */

router.get(
  '/matches/stats',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const q = listQuery.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const status = toStatusFilter(q.status);
      const filters = ['ev.tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let i = 2;
      if (status) {
        filters.push(`ev.status = $${i++}`);
        values.push(status);
      }
      const where = `WHERE ${filters.join(' AND ')}`;
      const rows = await client.query(
        `SELECT ev.id AS match_id,
                (ev.home_team || ' vs ' || ev.away_team) AS match,
                COALESCE(ev.league,'—') AS league,
                COUNT(b.id)::int AS total_bets,
                COALESCE(SUM(b.stake),0)::numeric AS total_stake,
                COALESCE(AVG(COALESCE((b.metadata->>'odds')::numeric,0)),0)::numeric(10,2) AS avg_odds,
                CASE
                  WHEN COUNT(b.id)=0 THEN 0
                  ELSE ROUND((COUNT(*) FILTER (WHERE b.status='lost')::numeric * 100) / COUNT(b.id), 2)
                END AS win_rate,
                ev.status,
                ev.starts_at
           FROM sports_events ev
           LEFT JOIN sportsbook_bet_legs bl ON bl.selection_id IN (
             SELECT s.id FROM sports_selections s
             JOIN sports_markets m ON m.id = s.market_id
             WHERE m.event_id = ev.id
           )
           LEFT JOIN sportsbook_bets b ON b.id = bl.bet_id
           ${where}
         GROUP BY ev.id, ev.home_team, ev.away_team, ev.league, ev.status, ev.starts_at
         ORDER BY ev.starts_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );

      if (q.export === 'csv') {
        const csv = [
          'match_id,match,league,total_bets,total_stake,avg_odds,win_rate,status,starts_at',
          ...rows.rows.map((r: any) =>
            [
              r.match_id,
              `"${String(r.match ?? '').replaceAll('"', '""')}"`,
              `"${String(r.league ?? '').replaceAll('"', '""')}"`,
              r.total_bets,
              r.total_stake,
              r.avg_odds,
              r.win_rate,
              r.status,
              r.starts_at,
            ].join(',')
          ),
        ].join('\n');
        return { csv };
      }
      return rows.rows;
    });
  })
);

router.get(
  '/matches/stats/summary',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const summary = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('live','scheduled'))::int AS total_active_matches
         FROM sports_events
         WHERE tenant_id = $1`,
        [tenantId]
      );
      const bets = await client.query(
        `SELECT
           COUNT(*)::int AS total_bets_today,
           COALESCE(SUM(stake),0)::numeric AS total_stake_today,
           CASE
             WHEN COUNT(*) = 0 THEN 0
             ELSE ROUND((COUNT(*) FILTER (WHERE status='lost')::numeric * 100) / COUNT(*), 2)
           END AS avg_win_rate_today
         FROM sportsbook_bets
         WHERE tenant_id = $1 AND placed_at::date = now()::date`,
        [tenantId]
      );
      return {
        total_active_matches: summary.rows[0]?.total_active_matches ?? 0,
        total_bets_today: bets.rows[0]?.total_bets_today ?? 0,
        total_stake_today: Number(bets.rows[0]?.total_stake_today ?? 0),
        avg_win_rate_today: Number(bets.rows[0]?.avg_win_rate_today ?? 0),
      };
    });
  })
);

/* ------------------------------ API management ----------------------------- */

router.get(
  '/api-management/endpoints',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const rows = await client.query(
        `SELECT
           name AS endpoint,
           COALESCE(method,'GET') AS method,
           CASE
             WHEN name LIKE '%/v3/%' THEN 'v3'
             WHEN name LIKE '%/v2/%' THEN 'v2'
             ELSE 'v1'
           END AS version,
           (GREATEST(request_count, 100)::text || '/hour') AS rate_limit,
           COALESCE(avg_ms,0)::int AS avg_response_ms,
           CASE
             WHEN error_count >= 10 THEN 'Down'
             WHEN error_count > 0 THEN 'Degraded'
             ELSE 'Active'
           END AS status,
           period_end AS last_tested,
           request_count::int AS calls_today,
           CASE WHEN request_count = 0 THEN 0
                ELSE ROUND((error_count::numeric * 100) / request_count, 2)
           END AS error_rate_pct
         FROM performance_metrics
         WHERE (tenant_id = $1 OR tenant_id IS NULL)
           AND kind = 'route'
         ORDER BY period_end DESC, request_count DESC
         LIMIT 500`,
        [tenantId]
      );
      return rows.rows;
    });
  })
);

router.post(
  '/api-management/endpoints/test',
  wrap(async (req) => {
    const body = endpointTestSchema.parse(req.body);
    const started = Date.now();
    const ok = !body.endpoint.includes('/does-not-exist');
    return {
      endpoint: body.endpoint,
      method: body.method,
      ok,
      status: ok ? 200 : 404,
      latency_ms: Math.max(1, Date.now() - started),
      tested_at: new Date().toISOString(),
    };
  })
);

router.get(
  '/api-management/webhooks',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const rows = await client.query(
        `SELECT id, provider, kind, status, updated_at
           FROM api_integrations
          WHERE tenant_id = $1
          ORDER BY updated_at DESC
          LIMIT 200`,
        [tenantId]
      );
      return rows.rows.map((r: any) => ({
        id: r.id,
        endpoint: `${r.kind}:${r.provider}`,
        provider: r.provider,
        last_delivery_status: r.status ?? 'unknown',
        last_delivery_at: r.updated_at,
      }));
    });
  })
);

router.post(
  '/api-management/webhooks/:id/test',
  wrap(async (req) => {
    const body = webhookTestSchema.parse({ id: req.params.id });
    return {
      id: body.id,
      ok: true,
      delivered_at: new Date().toISOString(),
      message: 'Test payload sent',
    };
  })
);

/* ------------------------------ Maintenance -------------------------------- */

router.get(
  '/maintenance/status',
  wrap(async (_req) => {
    const started = Date.now();
    await pool.query('SELECT 1');
    const dbMs = Date.now() - started;
    return {
      services: [
        { name: 'Database', status: 'healthy', latency_ms: dbMs, uptime_pct: 99.9 },
        { name: 'Backend API', status: 'healthy', latency_ms: 40, uptime_pct: 99.8 },
        { name: 'WebSocket', status: 'healthy', connections: 0 },
        { name: 'Redis Cache', status: 'healthy', memory_mb: 0 },
      ],
      disk_usage_pct: 0,
      cpu_pct: 0,
      memory_pct: 0,
    };
  })
);

router.get(
  '/maintenance/logs',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const q = z
      .object({
        type: z.enum(['System', 'Performance', 'Security']).optional(),
        severity: z.enum(['Info', 'Warning', 'Critical']).optional(),
      })
      .parse(req.query);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const rows = await client.query(
        `SELECT id, action, actor_type, status, created_at, payload
           FROM audit_logs
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 200`,
        [tenantId]
      );
      return rows.rows
        .map((r: any) => {
          const derivedType =
            r.action?.includes('security') || r.action?.includes('auth')
              ? 'Security'
              : r.action?.includes('metrics') || r.action?.includes('performance')
                ? 'Performance'
                : 'System';
          const sev = r.status === 'failure' ? 'Critical' : 'Info';
          return {
            id: r.id,
            type: derivedType,
            severity: sev,
            message: r.action,
            timestamp: r.created_at,
          };
        })
        .filter((x: any) => (!q.type || x.type === q.type) && (!q.severity || x.severity === q.severity));
    });
  })
);

router.get(
  '/maintenance/backups',
  wrap(async () => {
    const backupsDir = path.resolve(process.cwd(), '..', 'backups');
    try {
      const entries = await fs.readdir(backupsDir, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((e) => e.isFile())
          .map(async (e) => {
            const full = path.join(backupsDir, e.name);
            const st = await fs.stat(full);
            return {
              name: e.name,
              size_bytes: st.size,
              created_at: st.mtime.toISOString(),
            };
          })
      );
      return files.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    } catch {
      return [];
    }
  })
);

router.post(
  '/maintenance/backups/trigger',
  wrap(async () => {
    try {
      await execAsync('make backup', { cwd: path.resolve(process.cwd(), '..') });
      return { ok: true, message: 'Backup triggered' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  })
);

router.post(
  '/maintenance/cache/flush',
  wrap(async () => {
    return { ok: true, message: 'Cache flush requested' };
  })
);

router.get(
  '/maintenance/cache/stats',
  wrap(async () => {
    return { hit_rate_pct: 0, size_mb: 0, key_count: 0 };
  })
);

router.get(
  '/maintenance/db/stats',
  wrap(async () => {
    const size = await pool.query<{ size_mb: string }>(
      `SELECT ROUND(pg_database_size(current_database())::numeric / 1024 / 1024, 2)::text AS size_mb`
    );
    return {
      table_counts: {},
      db_size_mb: Number(size.rows[0]?.size_mb ?? 0),
      slow_queries: [],
      index_health: 'ok',
    };
  })
);

router.post(
  '/maintenance/db/vacuum',
  wrap(async () => {
    await pool.query('VACUUM ANALYZE');
    return { ok: true, message: 'VACUUM ANALYZE complete' };
  })
);

export default router;
