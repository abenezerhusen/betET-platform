import type { PoolClient } from 'pg';

export type Granularity = 'day' | 'week' | 'month';

interface BaseFilters {
  tenantId: string | null;
  from: Date;
  to: Date;
}

export interface RevenueRow {
  period: Date;
  bet_count: number;
  total_stake: string;
  total_payout: string;
  ggr: string;
}

export interface RevenueSummary {
  bet_count: number;
  total_stake: string;
  total_payout: string;
  ggr: string;
}

export async function revenueByPeriod(
  client: PoolClient,
  filters: BaseFilters & { granularity: Granularity }
): Promise<{ summary: RevenueSummary; series: RevenueRow[] }> {
  const where: string[] = [
    `b.placed_at >= $2`,
    `b.placed_at <= $3`,
    `b.status IN ('won','lost','settled','void','cashed_out')`,
  ];
  const params: unknown[] = [
    filters.tenantId,
    filters.from,
    filters.to,
    filters.granularity,
  ];
  const tenantClause = `($1::uuid IS NULL OR b.tenant_id = $1::uuid)`;
  where.push(tenantClause);
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const series = await client.query<RevenueRow>(
    `SELECT date_trunc($4, b.placed_at) AS period,
            COUNT(*)::int                AS bet_count,
            COALESCE(SUM(b.stake), 0)    AS total_stake,
            COALESCE(SUM(b.payout), 0)   AS total_payout,
            COALESCE(SUM(b.stake - COALESCE(b.payout, 0)), 0) AS ggr
       FROM bets b
       ${whereSql}
      GROUP BY 1
      ORDER BY 1`,
    params
  );

  const summary = await client.query<RevenueSummary>(
    `SELECT COUNT(*)::int                AS bet_count,
            COALESCE(SUM(b.stake), 0)    AS total_stake,
            COALESCE(SUM(b.payout), 0)   AS total_payout,
            COALESCE(SUM(b.stake - COALESCE(b.payout, 0)), 0) AS ggr
       FROM bets b
       ${whereSql}`,
    params
  );

  return { summary: summary.rows[0], series: series.rows };
}

export interface BetsSummary {
  total_bets: number;
  settled_bets: number;
  won_count: number;
  lost_count: number;
  void_count: number;
  pending_count: number;
  total_stake: string;
  total_payout: string;
  avg_stake: string;
  win_rate: number;
  margin: number;
}

export interface BetsSeriesRow {
  period: Date;
  total_bets: number;
  total_stake: string;
  total_payout: string;
  ggr: string;
}

export async function betsAggregates(
  client: PoolClient,
  filters: BaseFilters & { granularity: Granularity }
): Promise<{ summary: BetsSummary; series: BetsSeriesRow[] }> {
  const params: unknown[] = [
    filters.tenantId,
    filters.from,
    filters.to,
    filters.granularity,
  ];
  const tenantClause = `($1::uuid IS NULL OR b.tenant_id = $1::uuid)`;
  const whereSql = `WHERE b.placed_at >= $2 AND b.placed_at <= $3 AND ${tenantClause}`;

  const summaryRes = await client.query<BetsSummary>(
    `WITH base AS (
       SELECT b.*
         FROM bets b
         ${whereSql}
     )
     SELECT COUNT(*)::int AS total_bets,
            COUNT(*) FILTER (
              WHERE status IN ('won','lost','settled','void','cashed_out')
            )::int AS settled_bets,
            COUNT(*) FILTER (WHERE status = 'won')::int  AS won_count,
            COUNT(*) FILTER (WHERE status = 'lost')::int AS lost_count,
            COUNT(*) FILTER (WHERE status = 'void')::int AS void_count,
            COUNT(*) FILTER (WHERE status IN ('pending','open'))::int AS pending_count,
            COALESCE(SUM(stake), 0)  AS total_stake,
            COALESCE(SUM(payout), 0) AS total_payout,
            COALESCE(AVG(stake), 0)  AS avg_stake,
            CASE
              WHEN COUNT(*) FILTER (WHERE status IN ('won','lost')) = 0 THEN 0
              ELSE COUNT(*) FILTER (WHERE status = 'won')::numeric
                   / COUNT(*) FILTER (WHERE status IN ('won','lost'))::numeric
            END AS win_rate,
            CASE
              WHEN COALESCE(SUM(stake), 0) = 0 THEN 0
              ELSE COALESCE(SUM(stake - COALESCE(payout, 0)), 0)::numeric
                   / SUM(stake)::numeric
            END AS margin
       FROM base`,
    params
  );

  const series = await client.query<BetsSeriesRow>(
    `SELECT date_trunc($4, b.placed_at) AS period,
            COUNT(*)::int                AS total_bets,
            COALESCE(SUM(b.stake), 0)    AS total_stake,
            COALESCE(SUM(b.payout), 0)   AS total_payout,
            COALESCE(SUM(b.stake - COALESCE(b.payout, 0)), 0) AS ggr
       FROM bets b
       ${whereSql}
      GROUP BY 1
      ORDER BY 1`,
    params
  );

  return { summary: summaryRes.rows[0], series: series.rows };
}

export interface UsersSummary {
  total_users: number;
  new_users: number;
  active_users: number;
  churned_users: number;
}

export interface UsersSeriesRow {
  period: Date;
  new_users: number;
  active_users: number;
}

/**
 * Active = at least 1 bet inside the window.
 * Churned = total users who placed at least one bet ever, minus those active in window.
 */
export async function userMetrics(
  client: PoolClient,
  filters: BaseFilters & { granularity: Granularity }
): Promise<{ summary: UsersSummary; series: UsersSeriesRow[] }> {
  const params: unknown[] = [
    filters.tenantId,
    filters.from,
    filters.to,
    filters.granularity,
  ];

  const tenantUsers = `($1::uuid IS NULL OR u.tenant_id = $1::uuid)`;
  const tenantBets = `($1::uuid IS NULL OR b.tenant_id = $1::uuid)`;

  const summary = await client.query<UsersSummary>(
    `WITH active AS (
       SELECT DISTINCT b.user_id
         FROM bets b
        WHERE b.placed_at >= $2 AND b.placed_at <= $3 AND ${tenantBets}
     ),
     all_bettors AS (
       SELECT DISTINCT b.user_id FROM bets b WHERE ${tenantBets}
     )
     SELECT (SELECT COUNT(*)::int FROM users u WHERE ${tenantUsers}) AS total_users,
            (SELECT COUNT(*)::int FROM users u
              WHERE ${tenantUsers}
                AND u.created_at >= $2 AND u.created_at <= $3) AS new_users,
            (SELECT COUNT(*)::int FROM active) AS active_users,
            (SELECT COUNT(*)::int FROM all_bettors b
              WHERE b.user_id NOT IN (SELECT user_id FROM active)) AS churned_users`,
    params
  );

  const series = await client.query<UsersSeriesRow>(
    `WITH new_per AS (
       SELECT date_trunc($4, u.created_at) AS period, COUNT(*)::int AS n
         FROM users u
        WHERE ${tenantUsers}
          AND u.created_at >= $2 AND u.created_at <= $3
        GROUP BY 1
     ),
     active_per AS (
       SELECT date_trunc($4, b.placed_at) AS period, COUNT(DISTINCT b.user_id)::int AS n
         FROM bets b
        WHERE ${tenantBets}
          AND b.placed_at >= $2 AND b.placed_at <= $3
        GROUP BY 1
     )
     SELECT COALESCE(np.period, ap.period)        AS period,
            COALESCE(np.n, 0)                     AS new_users,
            COALESCE(ap.n, 0)                     AS active_users
       FROM new_per np
       FULL OUTER JOIN active_per ap ON ap.period = np.period
      ORDER BY period`,
    params
  );

  return { summary: summary.rows[0], series: series.rows };
}

export interface TransactionTypeRow {
  type: string;
  count: number;
  total: string;
}

export interface TransactionsSummary {
  total_count: number;
  deposits_total: string;
  deposits_count: number;
  withdrawals_total: string;
  withdrawals_count: number;
  bets_total: string;
  payouts_total: string;
  bonus_total: string;
  adjustments_total: string;
  net_flow: string;
}

export interface TransactionsSeriesRow {
  period: Date;
  deposits: string;
  withdrawals: string;
  bets: string;
  payouts: string;
}

export async function transactionsAggregates(
  client: PoolClient,
  filters: BaseFilters & { granularity: Granularity }
): Promise<{
  summary: TransactionsSummary;
  byType: TransactionTypeRow[];
  series: TransactionsSeriesRow[];
}> {
  const params: unknown[] = [
    filters.tenantId,
    filters.from,
    filters.to,
    filters.granularity,
  ];
  const tenantClause = `($1::uuid IS NULL OR t.tenant_id = $1::uuid)`;
  const whereSql = `WHERE t.created_at >= $2 AND t.created_at <= $3
                       AND t.status = 'completed' AND ${tenantClause}`;

  const byType = await client.query<TransactionTypeRow>(
    `SELECT t.type::text AS type,
            COUNT(*)::int AS count,
            COALESCE(SUM(t.amount), 0) AS total
       FROM transactions t
       ${whereSql}
      GROUP BY t.type
      ORDER BY t.type`,
    params
  );

  const summaryRes = await client.query<TransactionsSummary>(
    `SELECT COUNT(*)::int AS total_count,
            COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0)        AS deposits_total,
            COUNT(*) FILTER (WHERE type = 'deposit')::int                   AS deposits_count,
            COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0)     AS withdrawals_total,
            COUNT(*) FILTER (WHERE type = 'withdrawal')::int                AS withdrawals_count,
            COALESCE(SUM(amount) FILTER (WHERE type = 'bet'), 0)            AS bets_total,
            COALESCE(SUM(amount) FILTER (WHERE type = 'payout'), 0)         AS payouts_total,
            COALESCE(SUM(amount) FILTER (WHERE type IN ('bonus_credit','bonus_debit')), 0)
              AS bonus_total,
            COALESCE(SUM(amount) FILTER (WHERE type = 'adjustment'), 0)     AS adjustments_total,
            COALESCE(SUM(amount), 0)                                        AS net_flow
       FROM transactions t
       ${whereSql}`,
    params
  );

  const series = await client.query<TransactionsSeriesRow>(
    `SELECT date_trunc($4, t.created_at) AS period,
            COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0)    AS deposits,
            COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0) AS withdrawals,
            COALESCE(SUM(amount) FILTER (WHERE type = 'bet'), 0)        AS bets,
            COALESCE(SUM(amount) FILTER (WHERE type = 'payout'), 0)     AS payouts
       FROM transactions t
       ${whereSql}
      GROUP BY 1
      ORDER BY 1`,
    params
  );

  return {
    summary: summaryRes.rows[0],
    byType: byType.rows,
    series: series.rows,
  };
}

/* ====================================================================== */
/* Section 6 — Online Cash Report                                          */
/* ====================================================================== */

export interface OnlineCashSummary {
  total_stakes: string;
  total_payouts: string;
  net_revenue: string;
  bets_placed: number;
  paid_bets: number;
  bonus_cost: string;
}

export interface OnlineCashByDayRow {
  day: string;
  bets: number;
  stakes: string;
  payouts: string;
  net: string;
}

export interface OnlineCashBySportRow {
  sport: string | null;
  bets: number;
  stakes: string;
  payouts: string;
  net: string;
}

export async function onlineCashReport(
  client: PoolClient,
  filters: BaseFilters & { sport?: string }
): Promise<{
  summary: OnlineCashSummary;
  by_day: OnlineCashByDayRow[];
  by_sport: OnlineCashBySportRow[];
}> {
  // Two channels feed online betting:
  //   - sportsbook_bets where channel='online' (sports-related, has sport tag)
  //   - bets table for casino/virtuals (no sport)
  const params: unknown[] = [filters.tenantId, filters.from, filters.to];
  const sportClause = filters.sport ? `AND e.sport = $4` : '';
  if (filters.sport) params.push(filters.sport);

  const sql = `
    WITH sb AS (
      SELECT b.id,
             b.stake,
             COALESCE(b.actual_payout, 0)                  AS payout,
             b.status,
             b.placed_at,
             /* leg-level sport when available, else NULL */
             (
               SELECT MIN(e.sport)
                 FROM sportsbook_bet_legs l
                 JOIN sports_selections s ON s.id = l.selection_id
                 JOIN sports_markets   m ON m.id = s.market_id
                 JOIN sports_events    e ON e.id = m.event_id
                WHERE l.bet_id = b.id
             )                                             AS sport
        FROM sportsbook_bets b
       WHERE b.channel = 'online'
         AND b.placed_at >= $2 AND b.placed_at <= $3
         AND ($1::uuid IS NULL OR b.tenant_id = $1::uuid)
    ),
    sb_filtered AS (
      SELECT * FROM sb
       WHERE ${filters.sport ? `sport = $4` : 'TRUE'}
    ),
    casino AS (
      SELECT b.id,
             b.stake,
             COALESCE(b.payout, 0)                          AS payout,
             b.status,
             b.placed_at,
             NULL::text                                    AS sport
        FROM bets b
       WHERE b.placed_at >= $2 AND b.placed_at <= $3
         AND ($1::uuid IS NULL OR b.tenant_id = $1::uuid)
    ),
    /* casino bets only included when sport filter is empty */
    online AS (
      SELECT * FROM sb_filtered
      ${filters.sport ? '' : 'UNION ALL SELECT * FROM casino'}
    ),
    bonuses AS (
      SELECT COALESCE(SUM(a.awarded_amount), 0)::numeric AS total
        FROM bonus_assignments a
       WHERE a.awarded_at >= $2 AND a.awarded_at <= $3
         AND ($1::uuid IS NULL OR a.tenant_id = $1::uuid)
    )
    SELECT
      json_build_object(
        'total_stakes',  COALESCE(SUM(o.stake), 0),
        'total_payouts', COALESCE(SUM(o.payout), 0),
        'net_revenue',   COALESCE(SUM(o.stake) - SUM(o.payout), 0),
        'bets_placed',   COUNT(*)::int,
        'paid_bets',     COUNT(*) FILTER (
                            WHERE o.status = 'won' AND o.payout > 0
                          )::int,
        'bonus_cost',    (SELECT total FROM bonuses)
      ) AS summary,
      (SELECT COALESCE(json_agg(rows ORDER BY day DESC), '[]'::json)
         FROM (
           SELECT to_char(date_trunc('day', placed_at), 'YYYY-MM-DD') AS day,
                  COUNT(*)::int                                       AS bets,
                  COALESCE(SUM(stake), 0)::numeric                    AS stakes,
                  COALESCE(SUM(payout), 0)::numeric                   AS payouts,
                  COALESCE(SUM(stake) - SUM(payout), 0)::numeric      AS net
             FROM online
            GROUP BY date_trunc('day', placed_at)
         ) rows
      ) AS by_day,
      (SELECT COALESCE(json_agg(rows ORDER BY stakes DESC), '[]'::json)
         FROM (
           SELECT COALESCE(sport, 'casino')                            AS sport,
                  COUNT(*)::int                                        AS bets,
                  COALESCE(SUM(stake), 0)::numeric                     AS stakes,
                  COALESCE(SUM(payout), 0)::numeric                    AS payouts,
                  COALESCE(SUM(stake) - SUM(payout), 0)::numeric       AS net
             FROM online
            GROUP BY 1
         ) rows
      ) AS by_sport
    FROM online o
    ${sportClause}
  `;

  const result = await client.query(sql, params);
  const row = result.rows[0] ?? {};
  return {
    summary: row.summary ?? {
      total_stakes: '0',
      total_payouts: '0',
      net_revenue: '0',
      bets_placed: 0,
      paid_bets: 0,
      bonus_cost: '0',
    },
    by_day: row.by_day ?? [],
    by_sport: row.by_sport ?? [],
  };
}

/* ====================================================================== */
/* Section 6 — Offline Cash Report                                         */
/* ====================================================================== */

export interface OfflineCashSummary {
  total_stakes: string;
  total_payouts: string;
  net_revenue: string;
  bets_placed: number;
  paid_bets: number;
}

export interface OfflineCashBranchRow {
  branch_id: string | null;
  branch_name: string;
  branch_code: string | null;
  bets: number;
  stakes: string;
  payouts: string;
  net: string;
}

export interface OfflineCashCashierRow {
  branch_id: string | null;
  branch_name: string;
  cashier_id: string;
  cashier_name: string;
  cashier_phone: string | null;
  bets: number;
  stakes: string;
  payouts: string;
  net: string;
}

export async function offlineCashReport(
  client: PoolClient,
  filters: BaseFilters & { branchId?: string; cashierId?: string }
): Promise<{
  summary: OfflineCashSummary;
  by_branch: OfflineCashBranchRow[];
  by_cashier: OfflineCashCashierRow[];
}> {
  const params: unknown[] = [filters.tenantId, filters.from, filters.to];
  let i = 4;
  let branchClause = '';
  if (filters.branchId) {
    branchClause = ` AND ctb.branch_id = $${i++}`;
    params.push(filters.branchId);
  }
  let cashierClause = '';
  if (filters.cashierId) {
    cashierClause = ` AND b.cashier_id = $${i++}`;
    params.push(filters.cashierId);
  }

  const sql = `
    WITH branches AS (
      SELECT u.id  AS branch_id,
             COALESCE(NULLIF(u.metadata->>'branch_name', ''),
                      NULLIF(u.metadata->>'full_name', ''),
                      u.email::text,
                      u.phone)                            AS branch_name,
             u.metadata->>'branch_id'                     AS branch_code
        FROM users u
       WHERE u.role = 'branch'
         AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
    ),
    cashier_branch AS (
      SELECT u.id                                          AS cashier_id,
             COALESCE(NULLIF(u.metadata->>'full_name', ''),
                      u.email::text,
                      u.phone,
                      'Unknown')                          AS cashier_name,
             u.phone                                       AS cashier_phone,
             u.metadata->>'branch_id'                      AS branch_link
        FROM users u
       WHERE u.role IN ('cashier', 'sales')
         AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
    ),
    cashier_to_branch AS (
      SELECT cb.cashier_id, cb.cashier_name, cb.cashier_phone,
             br.branch_id, br.branch_name, br.branch_code
        FROM cashier_branch cb
        LEFT JOIN branches br
          ON br.branch_id::text = cb.branch_link
          OR (br.branch_code IS NOT NULL AND br.branch_code = cb.branch_link)
    ),
    bets_offline AS (
      SELECT b.id,
             b.cashier_id,
             ctb.branch_id,
             ctb.branch_name,
             ctb.branch_code,
             ctb.cashier_name,
             ctb.cashier_phone,
             b.stake,
             COALESCE(b.actual_payout, 0)                  AS payout,
             b.status,
             b.placed_at
        FROM sportsbook_bets b
        LEFT JOIN cashier_to_branch ctb ON ctb.cashier_id = b.cashier_id
       WHERE b.channel = 'offline'
         AND b.placed_at >= $2 AND b.placed_at <= $3
         AND ($1::uuid IS NULL OR b.tenant_id = $1::uuid)
         ${branchClause}
         ${cashierClause}
    )
    SELECT
      json_build_object(
        'total_stakes',  COALESCE(SUM(stake), 0),
        'total_payouts', COALESCE(SUM(payout), 0),
        'net_revenue',   COALESCE(SUM(stake) - SUM(payout), 0),
        'bets_placed',   COUNT(*)::int,
        'paid_bets',     COUNT(*) FILTER (
                            WHERE status = 'won' AND payout > 0
                          )::int
      ) AS summary,
      (SELECT COALESCE(json_agg(rows ORDER BY stakes DESC), '[]'::json)
         FROM (
           SELECT branch_id,
                  MAX(COALESCE(branch_name, '— Unassigned —'))         AS branch_name,
                  MAX(branch_code)                                     AS branch_code,
                  COUNT(*)::int                                        AS bets,
                  COALESCE(SUM(stake), 0)::numeric                     AS stakes,
                  COALESCE(SUM(payout), 0)::numeric                    AS payouts,
                  COALESCE(SUM(stake) - SUM(payout), 0)::numeric       AS net
             FROM bets_offline
            GROUP BY branch_id
         ) rows
      ) AS by_branch,
      (SELECT COALESCE(json_agg(rows ORDER BY stakes DESC), '[]'::json)
         FROM (
           SELECT branch_id,
                  MAX(COALESCE(branch_name, '— Unassigned —'))         AS branch_name,
                  cashier_id,
                  MAX(cashier_name)                                    AS cashier_name,
                  MAX(cashier_phone)                                   AS cashier_phone,
                  COUNT(*)::int                                        AS bets,
                  COALESCE(SUM(stake), 0)::numeric                     AS stakes,
                  COALESCE(SUM(payout), 0)::numeric                    AS payouts,
                  COALESCE(SUM(stake) - SUM(payout), 0)::numeric       AS net
             FROM bets_offline
           WHERE cashier_id IS NOT NULL
           GROUP BY branch_id, cashier_id
         ) rows
      ) AS by_cashier
    FROM bets_offline
  `;

  const result = await client.query(sql, params);
  const row = result.rows[0] ?? {};
  return {
    summary: row.summary ?? {
      total_stakes: '0',
      total_payouts: '0',
      net_revenue: '0',
      bets_placed: 0,
      paid_bets: 0,
    },
    by_branch: row.by_branch ?? [],
    by_cashier: row.by_cashier ?? [],
  };
}

/* ====================================================================== */
/* Section 6 — Payable Report                                              */
/* ====================================================================== */

export interface PayableComputedRow {
  scope: 'daily' | 'agent' | 'branch' | 'sales';
  entity_id: string | null;
  entity_label: string;
  period_date: string;
  total_stakes: string;
  total_payouts: string;
  total_payable: string;
  commission_rate: number | null;
  currency: string;
}

/**
 * Compute the raw payable rows from underlying bets/cashier transactions,
 * before persisted approval status is applied. Returns one row per
 * (scope, entity_id, day) for the date range.
 *
 * Scopes:
 *   daily  — sum across all agent payables for a tenant-day
 *   agent  — agent commission = (offline ticket sales attributed to that
 *            agent's branches/sales) × agent_rate
 *   branch — branch commission = ticket sales at that branch × branch_rate
 *   sales  — sales-staff commission = ticket sales sold by that sales user
 *            × sales_rate
 *
 * Commission rates are taken from `commissions` (per-tenant default) or
 * each entity's `users.metadata.commission_rate` when set.
 */
export async function computePayableRows(
  client: PoolClient,
  filters: BaseFilters & {
    scope: 'daily' | 'agent' | 'branch' | 'sales';
    rates: { agent: number; branch: number; sales: number };
  }
): Promise<PayableComputedRow[]> {
  const params: unknown[] = [
    filters.tenantId,
    filters.from,
    filters.to,
    filters.rates.agent,
    filters.rates.branch,
    filters.rates.sales,
  ];

  const sql = `
    WITH branches AS (
      SELECT u.id                                       AS branch_id,
             COALESCE(NULLIF(u.metadata->>'branch_name',''),
                      NULLIF(u.metadata->>'full_name',''),
                      u.email::text,
                      u.phone)                          AS branch_name,
             u.metadata->>'branch_id'                   AS branch_code,
             COALESCE(
               NULLIF(u.metadata->>'agent_id', '')::uuid,
               NULL
             )                                          AS agent_id,
             COALESCE(NULLIF((u.metadata->>'commission_rate'),'')::numeric, $5) AS rate
        FROM users u
       WHERE u.role = 'branch'
         AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
    ),
    cashiers AS (
      SELECT u.id                                       AS cashier_id,
             u.role                                     AS cashier_role,
             COALESCE(NULLIF(u.metadata->>'full_name',''),
                      u.email::text,
                      u.phone,
                      'Unknown')                       AS cashier_name,
             u.metadata->>'branch_id'                   AS branch_link,
             COALESCE(
               NULLIF(u.metadata->>'agent_id','')::uuid,
               NULL
             )                                          AS agent_id,
             COALESCE(NULLIF((u.metadata->>'commission_rate'),'')::numeric,
                      CASE WHEN u.role = 'sales' THEN $6 ELSE NULL END
             )                                          AS sales_rate
        FROM users u
       WHERE u.role IN ('cashier', 'sales')
         AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
    ),
    cashier_to_branch AS (
      SELECT c.cashier_id, c.cashier_role, c.cashier_name,
             c.sales_rate,
             br.branch_id, br.branch_name, br.agent_id AS branch_agent_id,
             COALESCE(c.agent_id, br.agent_id)        AS resolved_agent_id
        FROM cashiers c
        LEFT JOIN branches br
          ON br.branch_id::text = c.branch_link
          OR (br.branch_code IS NOT NULL AND br.branch_code = c.branch_link)
    ),
    agents AS (
      SELECT u.id                                       AS agent_id,
             COALESCE(NULLIF(u.metadata->>'full_name',''),
                      u.email::text,
                      u.phone,
                      'Agent')                         AS agent_name,
             COALESCE(NULLIF((u.metadata->>'commission_rate'),'')::numeric, $4) AS rate
        FROM users u
       WHERE u.role = 'agent'
         AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
    ),
    bets_offline AS (
      SELECT b.id,
             b.cashier_id,
             b.stake,
             COALESCE(b.actual_payout, 0)               AS payout,
             b.placed_at::date                          AS day,
             ctb.branch_id, ctb.branch_name,
             ctb.cashier_role, ctb.cashier_name,
             ctb.sales_rate,
             ctb.resolved_agent_id                       AS agent_id
        FROM sportsbook_bets b
        LEFT JOIN cashier_to_branch ctb ON ctb.cashier_id = b.cashier_id
       WHERE b.channel = 'offline'
         AND b.placed_at >= $2 AND b.placed_at <= $3
         AND ($1::uuid IS NULL OR b.tenant_id = $1::uuid)
    )
    SELECT * FROM (
      ${
        filters.scope === 'daily'
          ? `
        SELECT 'daily'::text                             AS scope,
               NULL::uuid                                AS entity_id,
               to_char(day, 'YYYY-MM-DD')                AS period_date,
               'Daily Total'::text                       AS entity_label,
               COALESCE(SUM(stake), 0)::numeric          AS total_stakes,
               COALESCE(SUM(payout), 0)::numeric         AS total_payouts,
               COALESCE(
                 SUM(stake) * (
                   COALESCE(MAX(ag.rate), $4) +
                   COALESCE(MAX(br.rate), $5) +
                   COALESCE(AVG(NULLIF(sales_rate, 0)), $6)
                 ) / 100.0,
                 0
               )::numeric                                AS total_payable,
               NULL::numeric                             AS commission_rate
          FROM bets_offline bo
          LEFT JOIN agents ag    ON ag.agent_id = bo.agent_id
          LEFT JOIN branches br  ON br.branch_id = bo.branch_id
         GROUP BY day
      `
          : ''
      }
      ${
        filters.scope === 'agent'
          ? `
        SELECT 'agent'::text                             AS scope,
               bo.agent_id                               AS entity_id,
               to_char(bo.day, 'YYYY-MM-DD')             AS period_date,
               COALESCE(MAX(ag.agent_name), 'Unassigned') AS entity_label,
               COALESCE(SUM(bo.stake), 0)::numeric       AS total_stakes,
               COALESCE(SUM(bo.payout), 0)::numeric      AS total_payouts,
               COALESCE(
                 SUM(bo.stake) * COALESCE(MAX(ag.rate), $4) / 100.0,
                 0
               )::numeric                                AS total_payable,
               COALESCE(MAX(ag.rate), $4)::numeric       AS commission_rate
          FROM bets_offline bo
          LEFT JOIN agents ag ON ag.agent_id = bo.agent_id
         WHERE bo.agent_id IS NOT NULL
         GROUP BY bo.agent_id, bo.day
      `
          : ''
      }
      ${
        filters.scope === 'branch'
          ? `
        SELECT 'branch'::text                            AS scope,
               bo.branch_id                              AS entity_id,
               to_char(bo.day, 'YYYY-MM-DD')             AS period_date,
               COALESCE(MAX(bo.branch_name), 'Unassigned') AS entity_label,
               COALESCE(SUM(bo.stake), 0)::numeric       AS total_stakes,
               COALESCE(SUM(bo.payout), 0)::numeric      AS total_payouts,
               COALESCE(
                 SUM(bo.stake) * COALESCE(MAX(br.rate), $5) / 100.0,
                 0
               )::numeric                                AS total_payable,
               COALESCE(MAX(br.rate), $5)::numeric       AS commission_rate
          FROM bets_offline bo
          LEFT JOIN branches br ON br.branch_id = bo.branch_id
         WHERE bo.branch_id IS NOT NULL
         GROUP BY bo.branch_id, bo.day
      `
          : ''
      }
      ${
        filters.scope === 'sales'
          ? `
        SELECT 'sales'::text                             AS scope,
               bo.cashier_id                             AS entity_id,
               to_char(bo.day, 'YYYY-MM-DD')             AS period_date,
               COALESCE(MAX(bo.cashier_name), 'Sales')   AS entity_label,
               COALESCE(SUM(bo.stake), 0)::numeric       AS total_stakes,
               COALESCE(SUM(bo.payout), 0)::numeric      AS total_payouts,
               COALESCE(
                 SUM(bo.stake) * COALESCE(MAX(bo.sales_rate), $6) / 100.0,
                 0
               )::numeric                                AS total_payable,
               COALESCE(MAX(bo.sales_rate), $6)::numeric AS commission_rate
          FROM bets_offline bo
         WHERE bo.cashier_role = 'sales' AND bo.cashier_id IS NOT NULL
         GROUP BY bo.cashier_id, bo.day
      `
          : ''
      }
    ) result
    ORDER BY period_date DESC, total_payable DESC
  `;

  const result = await client.query<PayableComputedRow>(sql, params);
  return result.rows.map((r) => ({
    ...r,
    total_stakes: String(r.total_stakes),
    total_payouts: String(r.total_payouts),
    total_payable: String(r.total_payable),
    commission_rate:
      r.commission_rate === null ? null : Number(r.commission_rate),
    currency: 'ETB',
  }));
}

export interface PayableRecordRow {
  id: string;
  tenant_id: string;
  scope: 'daily' | 'agent' | 'branch' | 'sales';
  entity_id: string | null;
  entity_label: string | null;
  period_date: string;
  total_stakes: string;
  total_payouts: string;
  total_payable: string;
  commission_rate: number | null;
  currency: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const PAYABLE_SELECT = `
  pr.id, pr.tenant_id, pr.scope, pr.entity_id, pr.entity_label,
  to_char(pr.period_date, 'YYYY-MM-DD') AS period_date,
  pr.total_stakes::text   AS total_stakes,
  pr.total_payouts::text  AS total_payouts,
  pr.total_payable::text  AS total_payable,
  pr.commission_rate::numeric AS commission_rate,
  pr.currency, pr.status,
  pr.approved_by, pr.approved_at,
  pr.rejected_by, pr.rejected_at,
  pr.paid_by, pr.paid_at,
  pr.notes,
  pr.created_at, pr.updated_at
`;

/**
 * Upsert a single computed payable row into `payable_records`. Existing
 * rows keep their lifecycle status; only the totals/labels/rate are
 * refreshed (idempotent recompute).
 */
export async function upsertPayableRow(
  client: PoolClient,
  tenantId: string,
  row: PayableComputedRow
): Promise<PayableRecordRow> {
  // Two unique indexes (with WHERE) cover the daily-vs-entity split. We
  // emulate a unified upsert with a SELECT-then-INSERT/UPDATE so we don't
  // depend on partial-index ON CONFLICT support.
  const existing = await client.query<{ id: string }>(
    row.entity_id === null
      ? `SELECT id FROM payable_records
          WHERE tenant_id = $1 AND scope = 'daily' AND period_date = $2::date`
      : `SELECT id FROM payable_records
          WHERE tenant_id = $1 AND scope = $2 AND entity_id = $3 AND period_date = $4::date`,
    row.entity_id === null
      ? [tenantId, row.period_date]
      : [tenantId, row.scope, row.entity_id, row.period_date]
  );

  if (existing.rows[0]) {
    const updated = await client.query<PayableRecordRow>(
      `UPDATE payable_records pr
          SET total_stakes    = $2,
              total_payouts   = $3,
              total_payable   = $4,
              commission_rate = $5,
              entity_label    = COALESCE($6, pr.entity_label)
        WHERE pr.id = $1
        RETURNING ${PAYABLE_SELECT}`,
      [
        existing.rows[0].id,
        row.total_stakes,
        row.total_payouts,
        row.total_payable,
        row.commission_rate,
        row.entity_label,
      ]
    );
    return updated.rows[0];
  }

  const inserted = await client.query<PayableRecordRow>(
    `INSERT INTO payable_records
       (tenant_id, scope, entity_id, entity_label, period_date,
        total_stakes, total_payouts, total_payable, commission_rate,
        currency, status)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, 'pending')
     RETURNING ${PAYABLE_SELECT}`,
    [
      tenantId,
      row.scope,
      row.entity_id,
      row.entity_label,
      row.period_date,
      row.total_stakes,
      row.total_payouts,
      row.total_payable,
      row.commission_rate,
      row.currency,
    ]
  );
  return inserted.rows[0];
}

export async function listPayableRecords(
  client: PoolClient,
  filters: {
    tenantId: string;
    scope: 'daily' | 'agent' | 'branch' | 'sales';
    from: Date;
    to: Date;
    status?: string;
    entityId?: string;
  }
): Promise<PayableRecordRow[]> {
  const params: unknown[] = [
    filters.tenantId,
    filters.scope,
    filters.from,
    filters.to,
  ];
  let i = 5;
  let extra = '';
  if (filters.status) {
    extra += ` AND pr.status = $${i++}`;
    params.push(filters.status);
  }
  if (filters.entityId) {
    extra += ` AND pr.entity_id = $${i++}`;
    params.push(filters.entityId);
  }
  const r = await client.query<PayableRecordRow>(
    `SELECT ${PAYABLE_SELECT}
       FROM payable_records pr
      WHERE pr.tenant_id = $1
        AND pr.scope = $2
        AND pr.period_date >= $3::date
        AND pr.period_date <= $4::date
        ${extra}
      ORDER BY pr.period_date DESC, pr.total_payable DESC`,
    params
  );
  return r.rows;
}

export async function getPayableRecord(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<PayableRecordRow | null> {
  const r = await client.query<PayableRecordRow>(
    `SELECT ${PAYABLE_SELECT}
       FROM payable_records pr
      WHERE pr.tenant_id = $1 AND pr.id = $2`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function updatePayableStatus(
  client: PoolClient,
  params: {
    tenantId: string;
    id: string;
    status: 'approved' | 'rejected' | 'paid';
    actorId: string;
    notes?: string | null;
  }
): Promise<PayableRecordRow | null> {
  const setExprs: string[] = ['status = $3'];
  const values: unknown[] = [params.tenantId, params.id, params.status];
  let i = 4;
  if (params.notes !== undefined) {
    setExprs.push(`notes = $${i++}`);
    values.push(params.notes);
  }
  // Stamp the appropriate actor/timestamp columns based on status.
  if (params.status === 'approved') {
    setExprs.push(`approved_by = $${i++}`);
    values.push(params.actorId);
    setExprs.push(`approved_at = now()`);
    setExprs.push(`rejected_by = NULL`);
    setExprs.push(`rejected_at = NULL`);
  } else if (params.status === 'rejected') {
    setExprs.push(`rejected_by = $${i++}`);
    values.push(params.actorId);
    setExprs.push(`rejected_at = now()`);
  } else if (params.status === 'paid') {
    setExprs.push(`paid_by = $${i++}`);
    values.push(params.actorId);
    setExprs.push(`paid_at = now()`);
  }

  const r = await client.query<PayableRecordRow>(
    `UPDATE payable_records pr
        SET ${setExprs.join(', ')}
      WHERE pr.tenant_id = $1 AND pr.id = $2
      RETURNING ${PAYABLE_SELECT}`,
    values
  );
  return r.rows[0] ?? null;
}
