import type { PoolClient } from 'pg';
import type { DashboardTab } from './dashboard.dto';

/**
 * Database-shaped numbers come back as strings (numeric(20,4)). We keep the
 * string representation for currency totals so JS number precision never
 * silently corrupts a balance, and convert counts to native numbers.
 */
export interface DashboardStats {
  total_bets: number;
  total_stakes: string;
  paid_bets: number;
  cancelled_tickets: number;
  online_bets: number;
  won_bets: number;
  total_deposits: string;
  total_withdrawals: string;
  active_branches: number;
  active_users: number;
  deposit_bonus: string;
  loyalty_bonus: string;
  referral_bonus: string;
  free_bet_bonus: string;
  total_revenue: string;
  total_payouts: string;
}

export interface DashboardBranchRow {
  branch_id: string | null;
  branch_name: string | null;
  branch_code: string | null;
  stats: DashboardStats;
}

interface BaseFilters {
  tenantId: string | null;
  from: Date;
  to: Date;
  tab: DashboardTab;
}

/**
 * Source/channel filter snippets. The spec exposes three sources:
 *  - online   : bets placed by end users via the User Panel (any product, no cashier)
 *  - offline  : bets placed in branch through the Cashier Panel (sportsbook_bets.channel='offline')
 *  - summary / detailed : everything across both sources
 *
 * Casino / virtuals / crash games live in the unified `bets` table and are
 * always treated as `online`. Sportsbook bets carry an explicit `channel`.
 */
function unifiedBetsTabFilter(tab: DashboardTab): string {
  // Casino / unified bets are *online by definition* (no cashier creates them).
  // Hide them from the "offline" tab and include them everywhere else.
  return tab === 'offline' ? `false` : `true`;
}

function sportsbookTabFilter(tab: DashboardTab): string {
  if (tab === 'offline') return `b.channel = 'offline'`;
  if (tab === 'online') return `b.channel IN ('online','bet_for_me')`;
  return `true`;
}

function transactionsTabFilter(tab: DashboardTab): string {
  // Cashier deposits / withdrawals only on the offline tab; user-driven flows
  // (deposit, withdrawal, p2p_*) on the online tab; all on summary/detailed.
  if (tab === 'offline') {
    return `t.type IN ('cashier_deposit','cashier_withdrawal')`;
  }
  if (tab === 'online') {
    return `t.type IN ('deposit','withdrawal','p2p_deposit','p2p_withdrawal')`;
  }
  return `t.type IN (
    'deposit','withdrawal','cashier_deposit','cashier_withdrawal',
    'p2p_deposit','p2p_withdrawal'
  )`;
}

/**
 * Aggregates every dashboard KPI in a single round-trip using six CTEs:
 *   - bets_unified   → unified bets table (casino, crash, embedded games)
 *   - bets_sb        → sportsbook bets (sports / jackpots; can be offline)
 *   - bets_combined  → UNION ALL of the above, normalised to the dashboard shape
 *   - tx             → wallet transactions (deposits / withdrawals)
 *   - bonuses        → bonus_assignments × bonus_rules awarded in window
 *   - branches       → users with role='branch' and status='active'
 */
export async function getDashboardStats(
  client: PoolClient,
  filters: BaseFilters
): Promise<DashboardStats> {
  const params: unknown[] = [filters.tenantId, filters.from, filters.to];
  const tenantClause = (alias: string) =>
    `($1::uuid IS NULL OR ${alias}.tenant_id = $1::uuid)`;

  const sql = `
    WITH bets_unified AS (
      SELECT b.id,
             b.user_id,
             b.stake,
             b.payout,
             b.status,
             b.placed_at,
             b.settled_at,
             FALSE AS is_offline
        FROM bets b
       WHERE b.placed_at >= $2 AND b.placed_at <= $3
         AND ${tenantClause('b')}
         AND ${unifiedBetsTabFilter(filters.tab)}
    ),
    bets_sb AS (
      SELECT b.id,
             b.user_id,
             b.stake,
             b.actual_payout AS payout,
             CASE WHEN b.status = 'cashout' THEN 'cashed_out'
                  WHEN b.status = 'partial' THEN 'partial_won'
                  ELSE b.status END AS status,
             b.placed_at,
             b.settled_at,
             (b.channel = 'offline') AS is_offline
        FROM sportsbook_bets b
       WHERE b.placed_at >= $2 AND b.placed_at <= $3
         AND ${tenantClause('b')}
         AND ${sportsbookTabFilter(filters.tab)}
    ),
    bets_combined AS (
      SELECT * FROM bets_unified
      UNION ALL
      SELECT * FROM bets_sb
    ),
    tx AS (
      SELECT t.type, t.amount, t.status, t.created_at
        FROM transactions t
       WHERE t.created_at >= $2 AND t.created_at <= $3
         AND ${tenantClause('t')}
         AND t.status = 'completed'
         AND ${transactionsTabFilter(filters.tab)}
    ),
    bonuses AS (
      SELECT r.type AS rule_type, a.awarded_amount
        FROM bonus_assignments a
        JOIN bonus_rules r ON r.id = a.bonus_rule_id
       WHERE a.awarded_at >= $2 AND a.awarded_at <= $3
         AND ${tenantClause('a')}
         AND ${tenantClause('r')}
    ),
    bet_stats AS (
      SELECT COUNT(*)::int                                                  AS total_bets,
             COALESCE(SUM(stake), 0)::text                                  AS total_stakes,
             COUNT(*) FILTER (
               WHERE status = 'won'
                 AND COALESCE(payout, 0) > 0
             )::int                                                         AS paid_bets,
             COUNT(*) FILTER (
               WHERE status IN ('cancelled','void')
             )::int                                                         AS cancelled_tickets,
             COUNT(*) FILTER (WHERE NOT is_offline)::int                    AS online_bets,
             COUNT(*) FILTER (WHERE status = 'won')::int                    AS won_bets,
             COUNT(DISTINCT user_id)::int                                   AS active_users,
             COALESCE(SUM(payout) FILTER (
               WHERE settled_at IS NOT NULL
                 AND settled_at >= $2 AND settled_at <= $3
             ), 0)::text                                                    AS total_payouts
        FROM bets_combined
    ),
    tx_stats AS (
      SELECT COALESCE(SUM(amount) FILTER (
               WHERE type IN ('deposit','cashier_deposit','p2p_deposit')
             ), 0)::text                                                    AS total_deposits,
             COALESCE(SUM(ABS(amount)) FILTER (
               WHERE type IN ('withdrawal','cashier_withdrawal','p2p_withdrawal')
             ), 0)::text                                                    AS total_withdrawals
        FROM tx
    ),
    bonus_stats AS (
      SELECT COALESCE(SUM(awarded_amount) FILTER (WHERE rule_type = 'deposit'),  0)::text
               AS deposit_bonus,
             COALESCE(SUM(awarded_amount) FILTER (WHERE rule_type = 'loyalty'),  0)::text
               AS loyalty_bonus,
             COALESCE(SUM(awarded_amount) FILTER (WHERE rule_type = 'referral'), 0)::text
               AS referral_bonus,
             COALESCE(SUM(awarded_amount) FILTER (WHERE rule_type = 'free_bet'), 0)::text
               AS free_bet_bonus
        FROM bonuses
    ),
    branch_stats AS (
      SELECT COUNT(*)::int AS active_branches
        FROM users u
       WHERE u.role = 'branch'
         AND u.status = 'active'
         AND ${tenantClause('u')}
    )
    SELECT bs.total_bets,
           bs.total_stakes,
           bs.paid_bets,
           bs.cancelled_tickets,
           bs.online_bets,
           bs.won_bets,
           ts.total_deposits,
           ts.total_withdrawals,
           brs.active_branches,
           bs.active_users,
           bos.deposit_bonus,
           bos.loyalty_bonus,
           bos.referral_bonus,
           bos.free_bet_bonus,
           (bs.total_stakes::numeric - bs.total_payouts::numeric)::text AS total_revenue,
           bs.total_payouts
      FROM bet_stats bs
      CROSS JOIN tx_stats ts
      CROSS JOIN bonus_stats bos
      CROSS JOIN branch_stats brs
  `;

  const r = await client.query<DashboardStats>(sql, params);
  return (
    r.rows[0] ?? {
      total_bets: 0,
      total_stakes: '0',
      paid_bets: 0,
      cancelled_tickets: 0,
      online_bets: 0,
      won_bets: 0,
      total_deposits: '0',
      total_withdrawals: '0',
      active_branches: 0,
      active_users: 0,
      deposit_bonus: '0',
      loyalty_bonus: '0',
      referral_bonus: '0',
      free_bet_bonus: '0',
      total_revenue: '0',
      total_payouts: '0',
    }
  );
}

/**
 * Per-branch breakdown for the Detailed tab.
 *
 * Branch resolution: a "branch" is a `users` row with role='branch'. Cashiers
 * link to their branch via `metadata->>'branch_id'` (either the branch user's
 * UUID or its short branch_code stored on the branch user's metadata).
 *
 * For each branch we re-aggregate the same KPIs as the summary, but only for
 * sportsbook bets / cashier transactions belonging to that branch's cashiers.
 * Online-only metrics (deposit_bonus, online_bets) are returned as 0 in the
 * per-branch breakdown — those don't belong to a single branch.
 */
export async function getDashboardByBranch(
  client: PoolClient,
  filters: BaseFilters
): Promise<DashboardBranchRow[]> {
  const params: unknown[] = [filters.tenantId, filters.from, filters.to];
  const tenantClause = (alias: string) =>
    `($1::uuid IS NULL OR ${alias}.tenant_id = $1::uuid)`;

  const sql = `
    WITH branches AS (
      SELECT u.id                                            AS branch_id,
             COALESCE(NULLIF(u.metadata->>'branch_name',''),
                      NULLIF(u.metadata->>'full_name',''),
                      u.email::text,
                      u.phone)                              AS branch_name,
             u.metadata->>'branch_id'                       AS branch_code
        FROM users u
       WHERE u.role = 'branch'
         AND u.status = 'active'
         AND ${tenantClause('u')}
    ),
    cashier_branch AS (
      SELECT u.id AS cashier_id,
             u.metadata->>'branch_id' AS branch_link
        FROM users u
       WHERE u.role IN ('cashier','sales')
         AND ${tenantClause('u')}
    ),
    /* link each cashier to a single branch row (UUID match preferred over code) */
    cashier_to_branch AS (
      SELECT cb.cashier_id, br.branch_id, br.branch_name, br.branch_code
        FROM cashier_branch cb
        JOIN branches br
          ON br.branch_id::text = cb.branch_link
          OR (br.branch_code IS NOT NULL AND br.branch_code = cb.branch_link)
    ),
    branch_bets AS (
      SELECT ctb.branch_id,
             ctb.branch_name,
             ctb.branch_code,
             b.stake,
             b.actual_payout AS payout,
             CASE WHEN b.status = 'cashout' THEN 'cashed_out'
                  WHEN b.status = 'partial' THEN 'partial_won'
                  ELSE b.status END AS status,
             b.user_id,
             b.placed_at,
             b.settled_at
        FROM sportsbook_bets b
        JOIN cashier_to_branch ctb ON ctb.cashier_id = b.cashier_id
       WHERE b.placed_at >= $2 AND b.placed_at <= $3
         AND ${tenantClause('b')}
         AND ${sportsbookTabFilter(filters.tab)}
    ),
    branch_bet_stats AS (
      SELECT branch_id,
             MAX(branch_name)                                              AS branch_name,
             MAX(branch_code)                                              AS branch_code,
             COUNT(*)::int                                                 AS total_bets,
             COALESCE(SUM(stake), 0)::text                                 AS total_stakes,
             COUNT(*) FILTER (
               WHERE status = 'won' AND COALESCE(payout, 0) > 0
             )::int                                                        AS paid_bets,
             COUNT(*) FILTER (WHERE status IN ('cancelled','void'))::int   AS cancelled_tickets,
             0::int                                                        AS online_bets,
             COUNT(*) FILTER (WHERE status = 'won')::int                   AS won_bets,
             COUNT(DISTINCT user_id)::int                                  AS active_users,
             COALESCE(SUM(payout) FILTER (
               WHERE settled_at IS NOT NULL
                 AND settled_at >= $2 AND settled_at <= $3
             ), 0)::text                                                   AS total_payouts
        FROM branch_bets
       GROUP BY branch_id
    ),
    branch_tx AS (
      SELECT ctb.branch_id,
             COALESCE(SUM(t.amount) FILTER (
               WHERE t.type IN ('deposit','cashier_deposit','p2p_deposit')
             ), 0)::text                                                    AS total_deposits,
             COALESCE(SUM(ABS(t.amount)) FILTER (
               WHERE t.type IN ('withdrawal','cashier_withdrawal','p2p_withdrawal')
             ), 0)::text                                                    AS total_withdrawals
        FROM transactions t
        JOIN cashier_to_branch ctb ON ctb.cashier_id = t.user_id
       WHERE t.created_at >= $2 AND t.created_at <= $3
         AND ${tenantClause('t')}
         AND t.status = 'completed'
         AND ${transactionsTabFilter(filters.tab)}
       GROUP BY ctb.branch_id
    )
    SELECT br.branch_id,
           br.branch_name,
           br.branch_code,
           COALESCE(bbs.total_bets, 0)                  AS total_bets,
           COALESCE(bbs.total_stakes, '0')              AS total_stakes,
           COALESCE(bbs.paid_bets, 0)                   AS paid_bets,
           COALESCE(bbs.cancelled_tickets, 0)           AS cancelled_tickets,
           COALESCE(bbs.online_bets, 0)                 AS online_bets,
           COALESCE(bbs.won_bets, 0)                    AS won_bets,
           COALESCE(bt.total_deposits, '0')             AS total_deposits,
           COALESCE(bt.total_withdrawals, '0')          AS total_withdrawals,
           1                                            AS active_branches,
           COALESCE(bbs.active_users, 0)                AS active_users,
           '0'                                          AS deposit_bonus,
           '0'                                          AS loyalty_bonus,
           '0'                                          AS referral_bonus,
           '0'                                          AS free_bet_bonus,
           (COALESCE(bbs.total_stakes, '0')::numeric -
            COALESCE(bbs.total_payouts, '0')::numeric)::text AS total_revenue,
           COALESCE(bbs.total_payouts, '0')             AS total_payouts
      FROM branches br
      LEFT JOIN branch_bet_stats bbs ON bbs.branch_id = br.branch_id
      LEFT JOIN branch_tx        bt  ON bt.branch_id  = br.branch_id
     ORDER BY total_stakes::numeric DESC, br.branch_name
  `;

  type Row = DashboardStats & {
    branch_id: string | null;
    branch_name: string | null;
    branch_code: string | null;
  };

  const r = await client.query<Row>(sql, params);
  return r.rows.map((row) => ({
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    branch_code: row.branch_code,
    stats: {
      total_bets: row.total_bets,
      total_stakes: row.total_stakes,
      paid_bets: row.paid_bets,
      cancelled_tickets: row.cancelled_tickets,
      online_bets: row.online_bets,
      won_bets: row.won_bets,
      total_deposits: row.total_deposits,
      total_withdrawals: row.total_withdrawals,
      active_branches: row.active_branches,
      active_users: row.active_users,
      deposit_bonus: row.deposit_bonus,
      loyalty_bonus: row.loyalty_bonus,
      referral_bonus: row.referral_bonus,
      free_bet_bonus: row.free_bet_bonus,
      total_revenue: row.total_revenue,
      total_payouts: row.total_payouts,
    },
  }));
}
