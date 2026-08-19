/**
 * Agent Dashboard — additive, agent-scoped shop KPIs.
 *
 * GET /api/admin/agent-dashboard
 *   ?from=<ISO>&to=<ISO>&branch_id=<uuid>&sales_id=<uuid>&agent_id=<uuid>
 *
 * Returns the business KPIs a shop operator needs for a period:
 *   - cashier_deposit  : total cash DEPOSITS taken by cashiers (players top-up)
 *   - withdrawal       : total cash WITHDRAWALS paid out by cashiers
 *   - shop_stake       : total stake of offline tickets sold in scope
 *   - paid_out         : total winnings paid on offline tickets in scope
 *   - net_profit       : shop_stake - paid_out (betting margin)
 *   - won_tickets      : count of won offline tickets
 *   - lost_tickets     : count of lost offline tickets
 *
 * Scoping (production-safe):
 *   - When the caller is an `agent`, the data is ALWAYS restricted to their
 *     own sub-tree (their branches + sales staff), regardless of any query
 *     parameter. An agent can never see another agent's numbers.
 *   - Super admins / full admins may optionally pass `agent_id` to view a
 *     single agent, otherwise the figures aggregate every shop in the tenant.
 *
 * This module is strictly additive: it only READS existing tables
 * (`sportsbook_bets`, `cashier_transactions`, `users`) using the same
 * seller/branch → agent resolution the Payable & Offline-Cash reports use,
 * so the numbers reconcile with those reports. It never mutates anything.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ForbiddenError, NotFoundError } from '../../../http/errors/http-error';
import {
  getAdminScope,
  phoneSearchPattern,
  phoneDigitsSql,
} from '../admin-shared';

/* ========================================================================== */
/* DTO                                                                        */
/* ========================================================================== */

const dashboardQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branch_id: z.string().uuid().optional(),
  sales_id: z.string().uuid().optional(),
  /** Super-admin / full-admin only; ignored for agent callers. */
  agent_id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().optional(),
});

type DashboardQuery = z.infer<typeof dashboardQuery>;

/** Resolve from/to with a sensible default (today, local-to-request ISO). */
function resolveRange(input: { from?: Date; to?: Date }): { from: Date; to: Date } {
  const to = input.to ?? new Date();
  // Default window = last 24h so an operator sees "today" out of the box.
  const from = input.from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from, to };
}

interface DashboardTotals {
  cashier_deposit: string;
  withdrawal: string;
  shop_stake: string;
  paid_out: string;
  net_profit: string;
  won_tickets: number;
  lost_tickets: number;
  pending_tickets: number;
  total_tickets: number;
}

interface Option {
  id: string;
  label: string;
}

/* ========================================================================== */
/* Service                                                                    */
/* ========================================================================== */

async function agentDashboard(req: Request, query: DashboardQuery) {
  const scope = getAdminScope(req);

  const tenantId = scope.isSuperadmin
    ? (query.tenant_id ?? scope.tenantId ?? null)
    : scope.tenantId;

  // Agent callers are hard-locked to their own record. Everyone else may
  // optionally focus a single agent via ?agent_id (else all shops).
  const isAgent = !scope.isSuperadmin && scope.actorRole === 'agent';
  const agentId = isAgent ? scope.actorId : (query.agent_id ?? null);

  const { from, to } = resolveRange(query);

  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      /* ---------------------------------------------------------------- */
      /* 1) Offline ticket KPIs (stake / payout / net / won / lost)        */
      /* ---------------------------------------------------------------- */
      const betParams: unknown[] = [tenantId, from, to];
      let bi = 4;
      let agentClause = '';
      if (agentId) {
        agentClause = `AND agent_id = $${bi++}::uuid`;
        betParams.push(agentId);
      }
      let branchClause = '';
      if (query.branch_id) {
        branchClause = `AND branch_id = $${bi++}::uuid`;
        betParams.push(query.branch_id);
      }
      let salesClause = '';
      if (query.sales_id) {
        salesClause = `AND cashier_id = $${bi++}::uuid`;
        betParams.push(query.sales_id);
      }

      const betsSql = `
        WITH branches AS (
          SELECT u.id                                      AS branch_id,
                 u.metadata->>'branch_id'                  AS branch_code,
                 NULLIF(u.metadata->>'agent_id','')::uuid  AS agent_id
            FROM users u
           WHERE u.role = 'branch'
             AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
        ),
        sellers AS (
          SELECT u.id                                      AS seller_id,
                 u.metadata->>'branch_id'                  AS branch_link,
                 NULLIF(u.metadata->>'agent_id','')::uuid  AS agent_id
            FROM users u
           WHERE ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
        ),
        bets_base AS (
          SELECT b.id,
                 COALESCE(b.sold_by_cashier_id, b.cashier_id) AS cashier_id,
                 b.sold_branch_id                             AS direct_branch_id,
                 b.stake,
                 COALESCE(b.actual_payout, 0)                 AS payout,
                 b.status
            FROM sportsbook_bets b
           WHERE b.channel = 'offline'
             AND b.sold_at IS NOT NULL
             AND b.placed_at >= $2 AND b.placed_at <= $3
             AND ($1::uuid IS NULL OR b.tenant_id = $1::uuid)
        ),
        bets_resolved AS (
          SELECT bb.id,
                 bb.cashier_id,
                 bb.stake,
                 bb.payout,
                 bb.status,
                 COALESCE(bb.direct_branch_id, lbr.branch_id)     AS branch_id,
                 COALESCE(s.agent_id, dbr.agent_id, lbr.agent_id) AS agent_id
            FROM bets_base bb
            LEFT JOIN sellers  s   ON s.seller_id = bb.cashier_id
            LEFT JOIN branches dbr ON dbr.branch_id = bb.direct_branch_id
            LEFT JOIN branches lbr ON bb.direct_branch_id IS NULL
                                  AND (lbr.branch_id::text = s.branch_link
                                       OR (lbr.branch_code IS NOT NULL
                                           AND lbr.branch_code = s.branch_link))
        )
        SELECT
          COALESCE(SUM(stake), 0)::text                             AS shop_stake,
          COALESCE(SUM(payout), 0)::text                            AS paid_out,
          COALESCE(SUM(stake) - SUM(payout), 0)::text               AS net_profit,
          COUNT(*) FILTER (WHERE status = 'won')::int               AS won_tickets,
          COUNT(*) FILTER (WHERE status = 'lost')::int              AS lost_tickets,
          COUNT(*) FILTER (WHERE status IN ('pending','open'))::int AS pending_tickets,
          COUNT(*)::int                                             AS total_tickets
          FROM bets_resolved
         WHERE TRUE
           ${agentClause}
           ${branchClause}
           ${salesClause}
      `;

      /* ---------------------------------------------------------------- */
      /* 2) Cashier cash KPIs (deposit / withdrawal)                       */
      /* ---------------------------------------------------------------- */
      // $1 tenant, $2 from, $3 to, $4 agentId (nullable), then optional
      // branch/sales filters.
      const ctParams: unknown[] = [tenantId, from, to, agentId];
      let ci = 5;
      let ctBranchClause = '';
      if (query.branch_id) {
        ctBranchClause = `AND ct.branch_id = $${ci++}::uuid`;
        ctParams.push(query.branch_id);
      }
      let ctSalesClause = '';
      if (query.sales_id) {
        ctSalesClause = `AND ct.cashier_id = $${ci++}::uuid`;
        ctParams.push(query.sales_id);
      }

      const cashSql = `
        WITH agent_branches AS (
          SELECT u.id
            FROM users u
           WHERE u.role = 'branch'
             AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
             AND ($4::uuid IS NULL
                  OR NULLIF(u.metadata->>'agent_id','')::uuid = $4::uuid)
        ),
        agent_sellers AS (
          SELECT u.id
            FROM users u
           WHERE ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
             AND ($4::uuid IS NULL
                  OR NULLIF(u.metadata->>'agent_id','')::uuid = $4::uuid)
        )
        SELECT
          COALESCE(SUM(ct.amount) FILTER (
            WHERE ct.type = 'deposit'    AND ct.status = 'completed'), 0)::text AS cashier_deposit,
          COALESCE(SUM(ct.amount) FILTER (
            WHERE ct.type = 'withdrawal' AND ct.status = 'completed'), 0)::text AS withdrawal
          FROM cashier_transactions ct
         WHERE ($1::uuid IS NULL OR ct.tenant_id = $1::uuid)
           AND ct.created_at >= $2 AND ct.created_at <= $3
           AND ($4::uuid IS NULL
                OR ct.branch_id IN (SELECT id FROM agent_branches)
                OR ct.cashier_id IN (SELECT id FROM agent_sellers))
           ${ctBranchClause}
           ${ctSalesClause}
      `;

      /* ---------------------------------------------------------------- */
      /* 3) Filter option lists (this agent's branches + sales staff)      */
      /* ---------------------------------------------------------------- */
      const optionParams: unknown[] = [tenantId, agentId];
      const branchOptSql = `
        SELECT u.id,
               COALESCE(NULLIF(u.metadata->>'branch_id',''),
                        NULLIF(u.metadata->>'full_name',''),
                        u.email::text, u.phone, u.id::text) AS label
          FROM users u
         WHERE u.role = 'branch'
           AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
           AND ($2::uuid IS NULL
                OR NULLIF(u.metadata->>'agent_id','')::uuid = $2::uuid)
         ORDER BY label`;
      const salesOptSql = `
        SELECT u.id,
               COALESCE(NULLIF(u.metadata->>'full_name',''),
                        NULLIF(u.metadata->>'username',''),
                        u.email::text, u.phone, u.id::text) AS label
          FROM users u
         WHERE u.role = 'sales'
           AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
           AND ($2::uuid IS NULL
                OR NULLIF(u.metadata->>'agent_id','')::uuid = $2::uuid)
         ORDER BY label`;

      const [betsRes, cashRes, branchRes, salesRes] = await Promise.all([
        client.query(betsSql, betParams),
        client.query(cashSql, ctParams),
        client.query<Option>(branchOptSql, optionParams),
        client.query<Option>(salesOptSql, optionParams),
      ]);

      const b = betsRes.rows[0] ?? {};
      const c = cashRes.rows[0] ?? {};

      const totals: DashboardTotals = {
        cashier_deposit: String(c.cashier_deposit ?? '0'),
        withdrawal: String(c.withdrawal ?? '0'),
        shop_stake: String(b.shop_stake ?? '0'),
        paid_out: String(b.paid_out ?? '0'),
        net_profit: String(b.net_profit ?? '0'),
        won_tickets: Number(b.won_tickets ?? 0),
        lost_tickets: Number(b.lost_tickets ?? 0),
        pending_tickets: Number(b.pending_tickets ?? 0),
        total_tickets: Number(b.total_tickets ?? 0),
      };

      return {
        tenant_id: tenantId,
        agent_id: agentId,
        scoped_to_self: isAgent,
        range: { from: from.toISOString(), to: to.toISOString() },
        filter: {
          branch_id: query.branch_id ?? null,
          sales_id: query.sales_id ?? null,
        },
        totals,
        branches: branchRes.rows,
        sales: salesRes.rows,
      };
    }
  );
}

/* ========================================================================== */
/* Ticket list (agent-scoped) — same columns as the Offline Bets page         */
/* ========================================================================== */

const ticketsQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branch_id: z.string().uuid().optional(),
  sales_id: z.string().uuid().optional(),
  status: z
    .enum(['pending', 'won', 'lost', 'void', 'cashout', 'partial', 'cancelled'])
    .optional(),
  search: z.string().trim().min(1).max(120).optional(),
  agent_id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

type TicketsQuery = z.infer<typeof ticketsQuery>;

/** Shared scope resolution: agents are hard-locked to their own record. */
function resolveScope(
  req: Request,
  q: { agent_id?: string; tenant_id?: string }
) {
  const scope = getAdminScope(req);
  const tenantId = scope.isSuperadmin
    ? (q.tenant_id ?? scope.tenantId ?? null)
    : scope.tenantId;
  const isAgent = !scope.isSuperadmin && scope.actorRole === 'agent';
  const agentId = isAgent ? scope.actorId : (q.agent_id ?? null);
  return { scope, tenantId, isAgent, agentId };
}

/**
 * CTEs that resolve, for each OFFLINE sportsbook ticket, its effective
 * branch + owning agent — the exact same seller/branch → agent resolution
 * used by the KPI query and the Payable / Offline-Cash reports. `$1` is the
 * tenant filter. The caller supplies the row filter on `scoped` (by id or by
 * date range) so this block is reused for both list and detail.
 */
const TICKET_CTES = `
  WITH branches AS (
    SELECT u.id                                      AS branch_id,
           u.metadata->>'branch_id'                  AS branch_code,
           NULLIF(u.metadata->>'agent_id','')::uuid  AS agent_id,
           COALESCE(NULLIF(u.metadata->>'name',''),
                    NULLIF(u.metadata->>'branch_name',''),
                    u.email::text, u.phone)          AS branch_name
      FROM users u
     WHERE u.role = 'branch'
       AND ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
  ),
  sellers AS (
    SELECT u.id                                      AS seller_id,
           u.metadata->>'branch_id'                  AS branch_link,
           NULLIF(u.metadata->>'agent_id','')::uuid  AS agent_id
      FROM users u
     WHERE ($1::uuid IS NULL OR u.tenant_id = $1::uuid)
  )
`;

async function listAgentTickets(req: Request, query: TicketsQuery) {
  const { scope, tenantId, agentId } = resolveScope(req, query);
  const { from, to } = resolveRange(query);

  // A ticket-code / phone search must find the ticket regardless of the
  // date picker. The picker defaults to "today", so without this a valid
  // SBK / TKT / coupon lookup for a ticket sold on an earlier day would
  // return nothing. When a search term is present we widen the ticket-list
  // window to all history (agent/branch/status scoping still applies). The
  // KPI cards are computed by a separate query and stay date-scoped.
  const searching = Boolean(query.search);
  const effFrom = searching ? new Date('1970-01-01T00:00:00.000Z') : from;
  const effTo = searching ? new Date('2999-12-31T23:59:59.999Z') : to;

  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const params: unknown[] = [tenantId, effFrom, effTo];
      let idx = 4;
      let agentClause = '';
      if (agentId) {
        agentClause = `AND sc.eff_agent_id = $${idx++}::uuid`;
        params.push(agentId);
      }
      let branchClause = '';
      if (query.branch_id) {
        branchClause = `AND sc.eff_branch_id = $${idx++}::uuid`;
        params.push(query.branch_id);
      }
      let salesClause = '';
      if (query.sales_id) {
        salesClause = `AND sc.eff_cashier_id = $${idx++}::uuid`;
        params.push(query.sales_id);
      }
      let statusClause = '';
      if (query.status) {
        statusClause = `AND sc.status = $${idx++}`;
        params.push(query.status);
      }
      let searchClause = '';
      if (query.search) {
        const digitsPattern = phoneSearchPattern(query.search);
        const phonePart = digitsPattern
          ? ` OR ${phoneDigitsSql('u.phone', idx + 1)}`
          : '';
        searchClause = `AND (sc.id::text ILIKE $${idx} OR sc.ticket_code ILIKE $${idx}
          OR sc.coupon_code ILIKE $${idx} OR sc.printed_ticket_code ILIKE $${idx}
          OR u.phone ILIKE $${idx}${phonePart})`;
        params.push(`%${query.search}%`);
        idx++;
        if (digitsPattern) {
          params.push(digitsPattern);
          idx++;
        }
      }
      const limIdx = idx++;
      params.push(query.limit);
      const offIdx = idx++;
      params.push(query.offset);

      const sql = `
        ${TICKET_CTES},
        scoped AS (
          SELECT b.id, b.user_id, b.cashier_id, b.sold_by_cashier_id,
                 b.stake, b.actual_payout, b.status::text AS status, b.currency,
                 b.ticket_code, b.printed_ticket_code, b.coupon_code,
                 b.sold_at, b.settled_at, b.placed_at, b.paid_at, b.metadata,
                 b.bet_for_user_phone,
                 COALESCE(b.sold_by_cashier_id, b.cashier_id)  AS eff_cashier_id,
                 COALESCE(b.sold_branch_id, lbr.branch_id)     AS eff_branch_id,
                 COALESCE(dbr.branch_name, lbr.branch_name)    AS eff_branch_name,
                 COALESCE(s.agent_id, dbr.agent_id, lbr.agent_id) AS eff_agent_id
            FROM sportsbook_bets b
            LEFT JOIN sellers  s   ON s.seller_id = COALESCE(b.sold_by_cashier_id, b.cashier_id)
            LEFT JOIN branches dbr ON dbr.branch_id = b.sold_branch_id
            LEFT JOIN branches lbr ON b.sold_branch_id IS NULL
                                  AND (lbr.branch_id::text = s.branch_link
                                       OR (lbr.branch_code IS NOT NULL
                                           AND lbr.branch_code = s.branch_link))
           WHERE b.channel = 'offline'
             AND b.placed_at >= $2 AND b.placed_at <= $3
             AND ($1::uuid IS NULL OR b.tenant_id = $1::uuid)
        )
        SELECT sc.id,
               sc.stake::text                         AS stake,
               sc.actual_payout::text                 AS actual_payout,
               sc.status,
               sc.currency,
               sc.ticket_code, sc.printed_ticket_code, sc.coupon_code,
               sc.sold_at, sc.settled_at, sc.placed_at,
               sc.metadata,
               sc.bet_for_user_phone,
               sc.eff_branch_id                       AS branch_id,
               sc.eff_branch_name                     AS branch_name,
               COALESCE(u.phone, bfu.phone)           AS user_phone,
               -- Cashier-kiosk slips are stored under the shared walk-in
               -- placeholder user, but the customer's phone (when the
               -- cashier entered it) lives in bet_for_user_phone. When that
               -- phone belongs to a REGISTERED user, surface their real
               -- name instead of "Walk-in Player". True anonymous slips
               -- (no phone / no matching user) keep the placeholder name.
               CASE
                 WHEN u.email = 'walkin@playcore.local' AND bfu.full_name IS NOT NULL
                   THEN bfu.full_name
                 ELSE COALESCE(u.metadata->>'full_name', u.email::text, u.phone)
               END                                    AS user_name,
               c.email                                AS cashier_email,
               COALESCE(c.metadata->>'full_name', c.metadata->>'name', c.email::text) AS cashier_name,
               scu.email                              AS sold_by_cashier_email,
               COALESCE(scu.metadata->>'full_name', scu.metadata->>'name', scu.email::text) AS sold_by_cashier_name,
               COUNT(*) OVER()::int                   AS total_count
          FROM scoped sc
          LEFT JOIN users u   ON u.id = sc.user_id
          LEFT JOIN users c   ON c.id = sc.cashier_id
          LEFT JOIN users scu ON scu.id = sc.sold_by_cashier_id
          -- Significant subscriber digits of bet_for_user_phone (strip
          -- non-digits, the 251 country code and the trunk 0) so +2519…,
          -- 2519… and 09… all resolve to the same registered user.
          LEFT JOIN LATERAL (
            SELECT CASE
                     WHEN d.digits LIKE '251%' AND length(d.digits) >= 12 THEN substr(d.digits, 4)
                     WHEN d.digits LIKE '0%' THEN substr(d.digits, 2)
                     ELSE d.digits
                   END AS sig
              FROM (SELECT regexp_replace(COALESCE(sc.bet_for_user_phone, ''), '\\D', '', 'g') AS digits) d
          ) bp ON TRUE
          LEFT JOIN LATERAL (
            SELECT bu.phone,
                   COALESCE(NULLIF(bu.metadata->>'full_name',''), bu.email::text, bu.phone) AS full_name
              FROM users bu
             WHERE length(bp.sig) >= 5
               AND ($1::uuid IS NULL OR bu.tenant_id = $1::uuid)
               AND bu.role = 'user'
               AND regexp_replace(COALESCE(bu.phone, ''), '\\D', '', 'g') LIKE '%' || bp.sig
             LIMIT 1
          ) bfu ON TRUE
         WHERE TRUE
           ${agentClause}
           ${branchClause}
           ${salesClause}
           ${statusClause}
           ${searchClause}
         ORDER BY sc.placed_at DESC
         LIMIT $${limIdx} OFFSET $${offIdx}
      `;

      const res = await client.query(sql, params);
      const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
      const items = res.rows.map((row) => {
        const { total_count, ...rest } = row as Record<string, unknown>;
        void total_count;
        return rest;
      });
      return { items, total, limit: query.limit, offset: query.offset };
    }
  );
}

async function getAgentTicket(req: Request, id: string) {
  const { scope, tenantId, agentId } = resolveScope(
    req,
    req.query as { agent_id?: string; tenant_id?: string }
  );

  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const head = await client.query(
        `
        ${TICKET_CTES},
        scoped AS (
          SELECT b.*,
                 COALESCE(dbr.branch_name, lbr.branch_name)       AS eff_branch_name,
                 COALESCE(s.agent_id, dbr.agent_id, lbr.agent_id) AS eff_agent_id
            FROM sportsbook_bets b
            LEFT JOIN sellers  s   ON s.seller_id = COALESCE(b.sold_by_cashier_id, b.cashier_id)
            LEFT JOIN branches dbr ON dbr.branch_id = b.sold_branch_id
            LEFT JOIN branches lbr ON b.sold_branch_id IS NULL
                                  AND (lbr.branch_id::text = s.branch_link
                                       OR (lbr.branch_code IS NOT NULL
                                           AND lbr.branch_code = s.branch_link))
           WHERE b.channel = 'offline'
             AND b.id = $2
             AND ($1::uuid IS NULL OR b.tenant_id = $1::uuid)
        )
        SELECT sc.*,
               COALESCE(c.metadata->>'full_name', c.metadata->>'name', c.email::text) AS cashier_name,
               c.email                                AS cashier_email,
               COALESCE(scu.metadata->>'full_name', scu.metadata->>'name', scu.email::text) AS sold_by_cashier_name,
               scu.email                              AS sold_by_cashier_email,
               sc.eff_branch_name                     AS branch_name
          FROM scoped sc
          LEFT JOIN users c   ON c.id = sc.cashier_id
          LEFT JOIN users scu ON scu.id = sc.sold_by_cashier_id
         LIMIT 1
        `,
        [tenantId, id]
      );

      const bet = head.rows[0];
      if (!bet) throw new NotFoundError('Ticket not found');

      // Ownership guard: an agent can only open tickets inside their own
      // sub-tree. Non-agent callers (superadmin/admin) may open any ticket.
      if (agentId && bet.eff_agent_id !== agentId) {
        throw new ForbiddenError('This ticket does not belong to your shops');
      }

      const legs = await client.query(
        `SELECT l.id, l.bet_id, l.selection_id, l.odds_at_placement, l.status,
                l.settled_at, l.created_at,
                sel.label                            AS selection_label,
                sel.odds_decimal                     AS current_odds,
                sel.result,
                m.market_type, m.label               AS market_label, m.event_id,
                ev.home_team, ev.away_team, ev.sport, ev.league, ev.starts_at
           FROM sportsbook_bet_legs l
           LEFT JOIN sports_selections sel ON sel.id = l.selection_id
           LEFT JOIN sports_markets    m   ON m.id = sel.market_id
           LEFT JOIN sports_events     ev  ON ev.id = m.event_id
          WHERE l.bet_id = $1
          ORDER BY l.created_at`,
        [id]
      );

      return { ...bet, legs: legs.rows };
    }
  );
}

/* ========================================================================== */
/* Routes                                                                     */
/* ========================================================================== */

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = dashboardQuery.parse(req.query);
    const out = await agentDashboard(req, query);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/tickets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = ticketsQuery.parse(req.query);
    const out = await listAgentTickets(req, query);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get(
  '/tickets/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const out = await getAgentTicket(req, id);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
