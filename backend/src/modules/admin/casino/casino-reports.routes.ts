/**
 * Casino reports with provider/source separation.
 *
 *   GET /api/admin/casino/reports/sources      → filter options (Home + providers)
 *   GET /api/admin/casino/reports/summary      → totals + per-provider revenue share
 *   GET /api/admin/casino/reports/users        → per user / day
 *   GET /api/admin/casino/reports/games        → per game / day (with source + provider)
 *   GET /api/admin/casino/reports/user-game    → per user / game / day
 *   GET /api/admin/casino/reports/user-detail  → per bet (paginated)
 *
 * Source separation is done at the DATABASE level by unioning the three
 * casino activity surfaces with a `source_type` discriminator:
 *
 *   internal → game_bets (first-party engine: aviator, jetx, keno, slots)
 *              + bets/games (runtime catalog games we operate ourselves)
 *   external → transactions of type external_game_bet / external_game_win
 *              recorded by the provider webhook (POST /hooks/:provider),
 *              joined to external_game_providers for provider identity.
 *
 * Revenue share is NEVER assumed: it comes from the per-provider
 * `revenue_share_percent` configured by the admin (0 until set).
 *
 * Sportsbook bets are intentionally NOT part of these casino reports.
 *
 * Mounted inside the casino module, so every route inherits the existing
 * `casino.view` permission enforcement.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  getAdminScope,
  phoneSearchPattern,
  phoneDigitsSql,
} from '../admin-shared';

const router = Router();

/** Day bucketing for report rows. The platform operates in Ethiopia (ETB,
 *  Telebirr); day boundaries follow East Africa Time, matching the local
 *  dates admins select in the panel. */
const REPORT_TZ = 'Africa/Addis_Ababa';

const reportQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** all | internal | external — 'external' optionally narrowed by provider_id. */
  source: z.enum(['all', 'internal', 'external']).default('all'),
  provider_id: z.string().uuid().optional(),
  /** Game-name substring (matched per-source in SQL). */
  game: z.string().trim().min(1).max(160).optional(),
  /** Player phone — matched format-tolerantly like the rest of the admin. */
  phone: z.string().trim().min(1).max(32).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

type ReportQuery = z.infer<typeof reportQuery>;

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

/* --------------------------------------------------------------------------
 * Unified activity CTE builder.
 *
 * Produces `activity(user_id, game_name, source_type, provider_id,
 * provider_name, stake, payout, status, placed_at, bet_id)` with all
 * requested filters already applied per branch, plus the parameter array.
 * ------------------------------------------------------------------------ */
function buildActivitySql(
  q: ReportQuery,
  tenantId: string | null
): { cte: string; values: unknown[] } {
  const values: unknown[] = [];
  const p = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };

  // Shared filter params (registered once, reused across branches).
  const tenantP = tenantId ? p(tenantId) : null;
  const fromP = q.from ? p(q.from) : null;
  const toP = q.to ? p(q.to) : null;
  const gameP = q.game ? p(`%${q.game}%`) : null;

  const branches: string[] = [];
  const includeInternal =
    (q.source === 'all' || q.source === 'internal') && !q.provider_id;
  const includeExternal = q.source === 'all' || q.source === 'external';

  if (includeInternal) {
    // First-party engine games (aviator, jetx, fast-keno, multi-hot-5, …).
    const w: string[] = [];
    if (tenantP) w.push(`gb.tenant_id = ${tenantP}`);
    if (fromP) w.push(`gb.created_at >= ${fromP}`);
    if (toP) w.push(`gb.created_at <= ${toP}`);
    if (gameP) w.push(`COALESCE(ig.name, gb.game_id) ILIKE ${gameP}`);
    branches.push(`
      SELECT gb.user_id,
             COALESCE(ig.name, gb.game_id) AS game_name,
             'internal'::text AS source_type,
             NULL::uuid AS provider_id,
             'Home / Internal'::text AS provider_name,
             gb.amount::numeric AS stake,
             COALESCE(gb.payout, 0)::numeric AS payout,
             gb.status::text AS status,
             gb.created_at AS placed_at,
             gb.id::text AS bet_id
        FROM game_bets gb
        LEFT JOIN internal_games ig ON ig.id = gb.game_id
        ${w.length ? `WHERE ${w.join(' AND ')}` : ''}`);

    // Runtime catalog games we operate ourselves (games/bets).
    const w2: string[] = [];
    if (tenantP) w2.push(`b.tenant_id = ${tenantP}`);
    if (fromP) w2.push(`b.placed_at >= ${fromP}`);
    if (toP) w2.push(`b.placed_at <= ${toP}`);
    if (gameP) w2.push(`g.name ILIKE ${gameP}`);
    branches.push(`
      SELECT b.user_id,
             g.name AS game_name,
             'internal'::text AS source_type,
             NULL::uuid AS provider_id,
             'Home / Internal'::text AS provider_name,
             b.stake::numeric AS stake,
             COALESCE(b.payout, 0)::numeric AS payout,
             b.status::text AS status,
             b.placed_at AS placed_at,
             b.id::text AS bet_id
        FROM bets b
        JOIN games g ON g.id = b.game_id
        ${w2.length ? `WHERE ${w2.join(' AND ')}` : ''}`);
  }

  if (includeExternal) {
    // External provider activity recorded by the webhook. Bets are stored
    // as negative amounts, wins positive; rolled-back rows are excluded.
    const w: string[] = [
      `t.type IN ('external_game_bet','external_game_win')`,
      `t.status = 'completed'`,
    ];
    if (tenantP) w.push(`t.tenant_id = ${tenantP}`);
    if (fromP) w.push(`t.created_at >= ${fromP}`);
    if (toP) w.push(`t.created_at <= ${toP}`);
    if (gameP)
      w.push(
        `COALESCE(epgg.name, NULLIF(t.metadata->>'game_id',''), 'External Game') ILIKE ${gameP}`
      );
    if (q.provider_id) w.push(`ep.id = ${p(q.provider_id)}`);
    branches.push(`
      SELECT t.user_id,
             COALESCE(epgg.name, NULLIF(t.metadata->>'game_id',''), 'External Game') AS game_name,
             'external'::text AS source_type,
             ep.id AS provider_id,
             ep.name AS provider_name,
             CASE WHEN t.type = 'external_game_bet' THEN ABS(t.amount)::numeric ELSE 0 END AS stake,
             CASE WHEN t.type = 'external_game_win' THEN t.amount::numeric ELSE 0 END AS payout,
             t.status::text AS status,
             t.created_at AS placed_at,
             t.reference AS bet_id
        FROM transactions t
        JOIN external_game_providers ep
          ON (t.metadata->>'provider_id') = ep.id::text
          OR ((t.metadata->>'provider_id') IS NULL AND t.metadata->>'provider' = ep.name)
        LEFT JOIN external_game_provider_games epgg
          ON epgg.provider_id = ep.id AND epgg.game_id = t.metadata->>'game_id'
        WHERE ${w.join(' AND ')}`);
  }

  // A source filter can legitimately produce zero branches only when
  // provider_id is combined with source=internal; return an empty set.
  const cte = branches.length
    ? branches.join('\n      UNION ALL\n')
    : `SELECT NULL::uuid AS user_id, ''::text AS game_name, ''::text AS source_type,
              NULL::uuid AS provider_id, ''::text AS provider_name,
              0::numeric AS stake, 0::numeric AS payout, ''::text AS status,
              now() AS placed_at, ''::text AS bet_id
        WHERE false`;

  return { cte, values };
}

/** Optional player-phone predicate on the joined users table. */
function phoneWhere(
  q: ReportQuery,
  values: unknown[]
): string {
  if (!q.phone) return '';
  const pattern = phoneSearchPattern(q.phone);
  values.push(`%${q.phone}%`);
  const rawIdx = values.length;
  if (!pattern) return ` AND u.phone ILIKE $${rawIdx}`;
  values.push(pattern);
  return ` AND (u.phone ILIKE $${rawIdx} OR ${phoneDigitsSql('u.phone', values.length)})`;
}

const USER_NAME_SQL = `COALESCE(NULLIF(u.metadata->>'full_name',''), u.email, u.phone, 'Unknown')`;

/* --------------------------------------------------------------------------
 * GET /sources — options for the Game Source filter.
 * ------------------------------------------------------------------------ */
router.get(
  '/sources',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<{
          id: string;
          name: string;
          status: string;
          revenue_share_percent: string;
        }>(
          `SELECT id, name, status, revenue_share_percent::text
             FROM external_game_providers
             ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
             ORDER BY name`,
          scope.tenantId ? [scope.tenantId] : []
        );
        return {
          sources: [
            { value: 'all', label: 'All' },
            { value: 'internal', label: 'Home / Internal' },
            ...r.rows.map((p) => ({
              value: `provider:${p.id}`,
              label: p.name,
              provider_id: p.id,
              status: p.status,
              revenue_share_percent: Number(p.revenue_share_percent),
            })),
          ],
        };
      }
    );
  })
);

/* --------------------------------------------------------------------------
 * GET /summary
 * ------------------------------------------------------------------------ */
router.get(
  '/summary',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const q = reportQuery.parse(req.query);
    const { cte, values } = buildActivitySql(q, scope.tenantId);
    const userFilter = phoneWhere(q, values);

    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const totals = await client.query<{
          source_type: string;
          bet_count: string;
          payout_count: string;
          total_stake: string;
          total_payout: string;
          ggr: string;
          players: string;
          rollback_count: string;
          rollback_amount: string;
        }>(
          `WITH activity AS (${cte})
           SELECT a.source_type,
                  COUNT(*) FILTER (WHERE a.stake > 0)::text AS bet_count,
                  COUNT(*) FILTER (WHERE a.payout > 0)::text AS payout_count,
                  COALESCE(SUM(a.stake), 0)::text AS total_stake,
                  COALESCE(SUM(a.payout), 0)::text AS total_payout,
                  COALESCE(SUM(a.stake - a.payout), 0)::text AS ggr,
                  COUNT(DISTINCT a.user_id)::text AS players,
                  COUNT(*) FILTER (WHERE a.status IN ('void','cancelled'))::text AS rollback_count,
                  COALESCE(SUM(a.stake) FILTER (WHERE a.status IN ('void','cancelled')), 0)::text AS rollback_amount
             FROM activity a
             LEFT JOIN users u ON u.id = a.user_id
            WHERE true${userFilter}
            GROUP BY a.source_type`,
          values
        );

        // Per-provider breakdown with the configured revenue share.
        const providers = await client.query<{
          provider_id: string;
          provider_name: string;
          revenue_share_percent: string;
          bet_count: string;
          players: string;
          total_stake: string;
          total_payout: string;
          ggr: string;
          provider_share: string;
          our_share: string;
        }>(
          `WITH activity AS (${cte})
           SELECT a.provider_id,
                  a.provider_name,
                  ep.revenue_share_percent::text,
                  COUNT(*) FILTER (WHERE a.stake > 0)::text AS bet_count,
                  COUNT(DISTINCT a.user_id)::text AS players,
                  COALESCE(SUM(a.stake), 0)::text AS total_stake,
                  COALESCE(SUM(a.payout), 0)::text AS total_payout,
                  COALESCE(SUM(a.stake - a.payout), 0)::text AS ggr,
                  ROUND(COALESCE(SUM(a.stake - a.payout), 0) * ep.revenue_share_percent / 100.0, 2)::text AS provider_share,
                  ROUND(COALESCE(SUM(a.stake - a.payout), 0) * (100 - ep.revenue_share_percent) / 100.0, 2)::text AS our_share
             FROM activity a
             JOIN external_game_providers ep ON ep.id = a.provider_id
             LEFT JOIN users u ON u.id = a.user_id
            WHERE a.source_type = 'external'${userFilter}
            GROUP BY a.provider_id, a.provider_name, ep.revenue_share_percent
            ORDER BY a.provider_name`,
          values
        );

        const zero = {
          bet_count: 0,
          payout_count: 0,
          total_stake: 0,
          total_payout: 0,
          ggr: 0,
          players: 0,
          rollback_count: 0,
          rollback_amount: 0,
        };
        const bySource: Record<string, typeof zero> = {};
        for (const row of totals.rows) {
          bySource[row.source_type] = {
            bet_count: Number(row.bet_count),
            payout_count: Number(row.payout_count),
            total_stake: Number(row.total_stake),
            total_payout: Number(row.total_payout),
            ggr: Number(row.ggr),
            players: Number(row.players),
            rollback_count: Number(row.rollback_count),
            rollback_amount: Number(row.rollback_amount),
          };
        }
        const internal = bySource['internal'] ?? { ...zero };
        const external = bySource['external'] ?? { ...zero };
        const combined = {
          bet_count: internal.bet_count + external.bet_count,
          payout_count: internal.payout_count + external.payout_count,
          total_stake: internal.total_stake + external.total_stake,
          total_payout: internal.total_payout + external.total_payout,
          ggr: internal.ggr + external.ggr,
          // players may overlap across sources; combined players is a max
          // lower bound — the UI shows per-source counts for accuracy.
          players: Math.max(internal.players, external.players),
          rollback_count: internal.rollback_count + external.rollback_count,
          rollback_amount: internal.rollback_amount + external.rollback_amount,
        };

        const providerRows = providers.rows.map((r) => ({
          provider_id: r.provider_id,
          provider_name: r.provider_name,
          revenue_share_percent: Number(r.revenue_share_percent),
          bet_count: Number(r.bet_count),
          players: Number(r.players),
          total_stake: Number(r.total_stake),
          total_payout: Number(r.total_payout),
          ggr: Number(r.ggr),
          provider_share: Number(r.provider_share),
          our_share: Number(r.our_share),
        }));

        return {
          totals: combined,
          internal,
          external: {
            ...external,
            provider_share_total: providerRows.reduce((s, r) => s + r.provider_share, 0),
            our_share_total: providerRows.reduce((s, r) => s + r.our_share, 0),
          },
          providers: providerRows,
        };
      }
    );
  })
);

/* --------------------------------------------------------------------------
 * GET /users — per user / day.
 * ------------------------------------------------------------------------ */
router.get(
  '/users',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const q = reportQuery.parse(req.query);
    const { cte, values } = buildActivitySql(q, scope.tenantId);
    const userFilter = phoneWhere(q, values);
    values.push(q.limit, (q.page - 1) * q.limit);

    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `WITH activity AS (${cte})
           SELECT (a.placed_at AT TIME ZONE '${REPORT_TZ}')::date::text AS date,
                  a.user_id,
                  ${USER_NAME_SQL} AS user_name,
                  COALESCE(u.phone, '—') AS phone,
                  COUNT(*) FILTER (WHERE a.stake > 0)::int AS bet_count,
                  COALESCE(SUM(a.stake), 0)::text AS bet_amount,
                  COALESCE(SUM(a.payout), 0)::text AS payout_amount,
                  COALESCE(SUM(a.stake - a.payout), 0)::text AS ggr
             FROM activity a
             LEFT JOIN users u ON u.id = a.user_id
            WHERE true${userFilter}
            GROUP BY 1, a.user_id, u.metadata->>'full_name', u.email, u.phone
            ORDER BY 1 DESC, bet_amount DESC
            LIMIT $${values.length - 1} OFFSET $${values.length}`,
          values
        );
        return { items: r.rows, page: q.page, limit: q.limit };
      }
    );
  })
);

/* --------------------------------------------------------------------------
 * GET /games — per game / day with source + provider identity.
 * ------------------------------------------------------------------------ */
router.get(
  '/games',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const q = reportQuery.parse(req.query);
    const { cte, values } = buildActivitySql(q, scope.tenantId);
    const userFilter = phoneWhere(q, values);
    values.push(q.limit, (q.page - 1) * q.limit);

    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `WITH activity AS (${cte})
           SELECT (a.placed_at AT TIME ZONE '${REPORT_TZ}')::date::text AS date,
                  a.game_name,
                  a.source_type,
                  a.provider_name,
                  COUNT(*) FILTER (WHERE a.stake > 0)::int AS bet_count,
                  COUNT(DISTINCT a.user_id)::int AS players,
                  COALESCE(SUM(a.stake), 0)::text AS bet_amount,
                  COALESCE(SUM(a.payout), 0)::text AS payout_amount,
                  COALESCE(SUM(a.stake - a.payout), 0)::text AS ggr
             FROM activity a
             LEFT JOIN users u ON u.id = a.user_id
            WHERE true${userFilter}
            GROUP BY 1, a.game_name, a.source_type, a.provider_name
            ORDER BY 1 DESC, bet_amount DESC
            LIMIT $${values.length - 1} OFFSET $${values.length}`,
          values
        );
        return { items: r.rows, page: q.page, limit: q.limit };
      }
    );
  })
);

/* --------------------------------------------------------------------------
 * GET /user-game — per user / game / day.
 * ------------------------------------------------------------------------ */
router.get(
  '/user-game',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const q = reportQuery.parse(req.query);
    const { cte, values } = buildActivitySql(q, scope.tenantId);
    const userFilter = phoneWhere(q, values);
    values.push(q.limit, (q.page - 1) * q.limit);

    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `WITH activity AS (${cte})
           SELECT (a.placed_at AT TIME ZONE '${REPORT_TZ}')::date::text AS date,
                  a.user_id,
                  ${USER_NAME_SQL} AS user_name,
                  COALESCE(u.phone, '—') AS phone,
                  a.game_name,
                  a.source_type,
                  a.provider_name,
                  COUNT(*) FILTER (WHERE a.stake > 0)::int AS bet_count,
                  COALESCE(SUM(a.stake), 0)::text AS bet_amount,
                  COALESCE(SUM(a.payout), 0)::text AS payout_amount,
                  COALESCE(SUM(a.stake - a.payout), 0)::text AS ggr
             FROM activity a
             LEFT JOIN users u ON u.id = a.user_id
            WHERE true${userFilter}
            GROUP BY 1, a.user_id, u.metadata->>'full_name', u.email, u.phone,
                     a.game_name, a.source_type, a.provider_name
            ORDER BY 1 DESC, bet_amount DESC
            LIMIT $${values.length - 1} OFFSET $${values.length}`,
          values
        );
        return { items: r.rows, page: q.page, limit: q.limit };
      }
    );
  })
);

/* --------------------------------------------------------------------------
 * GET /user-detail — one row per bet/win event, newest first.
 * ------------------------------------------------------------------------ */
router.get(
  '/user-detail',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const q = reportQuery.parse(req.query);
    const { cte, values } = buildActivitySql(q, scope.tenantId);
    const userFilter = phoneWhere(q, values);
    values.push(q.limit, (q.page - 1) * q.limit);

    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `WITH activity AS (${cte})
           SELECT a.placed_at,
                  a.bet_id,
                  ${USER_NAME_SQL} AS user_name,
                  COALESCE(u.phone, '—') AS phone,
                  a.game_name,
                  a.source_type,
                  a.provider_name,
                  a.stake::text AS bet_amount,
                  a.payout::text AS paid_amount,
                  a.status
             FROM activity a
             LEFT JOIN users u ON u.id = a.user_id
            WHERE true${userFilter}
            ORDER BY a.placed_at DESC
            LIMIT $${values.length - 1} OFFSET $${values.length}`,
          values
        );
        return { items: r.rows, page: q.page, limit: q.limit };
      }
    );
  })
);

export default router;
