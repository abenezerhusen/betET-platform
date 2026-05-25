import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { getAdminScope } from '../admin-shared';

/* DTOs --------------------------------------------------------------------- */

const dateRange = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const offlineCashQuery = dateRange.extend({
  cashier_id: z.string().uuid().optional(),
});

const onlineCashQuery = dateRange.extend({});

const payableQuery = dateRange.extend({
  status: z
    .enum(['pending', 'processing', 'completed', 'rejected', 'cancelled', 'failed'])
    .optional(),
});

/* Service ------------------------------------------------------------------ */

async function offlineCashReport(req: Request, q: z.infer<typeof offlineCashQuery>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const filters: string[] = [`b.channel = 'offline'`];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`b.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.cashier_id) {
        filters.push(`b.cashier_id = $${i++}`);
        values.push(q.cashier_id);
      }
      if (q.from) {
        filters.push(`b.placed_at >= $${i++}`);
        values.push(q.from);
      }
      if (q.to) {
        filters.push(`b.placed_at <= $${i++}`);
        values.push(q.to);
      }
      const where = `WHERE ${filters.join(' AND ')}`;

      const summaryRes = await client.query<{
        total_bets: string;
        total_stake: string;
        total_payout: string;
        won_bets: string;
        lost_bets: string;
        pending_bets: string;
      }>(
        `SELECT
            COUNT(*)::text AS total_bets,
            COALESCE(SUM(b.stake), 0)::text AS total_stake,
            COALESCE(SUM(b.actual_payout), 0)::text AS total_payout,
            COUNT(*) FILTER (WHERE b.status = 'won')::text AS won_bets,
            COUNT(*) FILTER (WHERE b.status = 'lost')::text AS lost_bets,
            COUNT(*) FILTER (WHERE b.status = 'pending')::text AS pending_bets
           FROM sportsbook_bets b
           ${where}`,
        values
      );

      const byCashierRes = await client.query(
        `SELECT b.cashier_id,
                u.email AS cashier_email,
                u.phone AS cashier_phone,
                COUNT(*)::int AS bets_count,
                COALESCE(SUM(b.stake), 0)::numeric AS total_stake,
                COALESCE(SUM(b.actual_payout), 0)::numeric AS total_payout,
                COALESCE(SUM(b.stake) - SUM(COALESCE(b.actual_payout, 0)), 0)::numeric AS gross_margin
           FROM sportsbook_bets b
           LEFT JOIN users u ON u.id = b.cashier_id
           ${where}
           GROUP BY b.cashier_id, u.email, u.phone
           ORDER BY total_stake DESC`,
        values
      );

      return {
        summary: summaryRes.rows[0] ?? null,
        by_cashier: byCashierRes.rows,
        params: { from: q.from ?? null, to: q.to ?? null, cashier_id: q.cashier_id ?? null },
      };
    }
  );
}

async function onlineCashReport(req: Request, q: z.infer<typeof onlineCashQuery>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const filters: string[] = [`b.channel = 'online'`];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`b.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.from) {
        filters.push(`b.placed_at >= $${i++}`);
        values.push(q.from);
      }
      if (q.to) {
        filters.push(`b.placed_at <= $${i++}`);
        values.push(q.to);
      }
      const where = `WHERE ${filters.join(' AND ')}`;

      const summaryRes = await client.query(
        `SELECT
            COUNT(*)::int AS total_bets,
            COUNT(DISTINCT b.user_id)::int AS unique_users,
            COALESCE(SUM(b.stake), 0)::numeric AS total_stake,
            COALESCE(SUM(b.actual_payout), 0)::numeric AS total_payout,
            COUNT(*) FILTER (WHERE b.status = 'won')::int AS won_bets,
            COUNT(*) FILTER (WHERE b.status = 'lost')::int AS lost_bets,
            COUNT(*) FILTER (WHERE b.status = 'pending')::int AS pending_bets
           FROM sportsbook_bets b
           ${where}`,
        values
      );

      const byDayRes = await client.query(
        `SELECT date_trunc('day', b.placed_at) AS day,
                COUNT(*)::int AS bets_count,
                COALESCE(SUM(b.stake), 0)::numeric AS total_stake,
                COALESCE(SUM(b.actual_payout), 0)::numeric AS total_payout
           FROM sportsbook_bets b
           ${where}
           GROUP BY 1
           ORDER BY 1 DESC
           LIMIT 90`,
        values
      );

      // Deposits/withdrawals via wallet transactions table for cash-in / cash-out.
      const txFilters: string[] = [];
      const txValues: unknown[] = [];
      let j = 1;
      if (scope.tenantId) {
        txFilters.push(`tenant_id = $${j++}`);
        txValues.push(scope.tenantId);
      }
      if (q.from) {
        txFilters.push(`created_at >= $${j++}`);
        txValues.push(q.from);
      }
      if (q.to) {
        txFilters.push(`created_at <= $${j++}`);
        txValues.push(q.to);
      }
      const txWhere = txFilters.length ? `WHERE ${txFilters.join(' AND ')}` : '';

      const flowsRes = await client.query(
        `SELECT
            COALESCE(SUM(amount) FILTER (WHERE type IN ('deposit','p2p_deposit') AND status = 'completed'), 0)::numeric AS deposits,
            COALESCE(SUM(amount) FILTER (WHERE type IN ('withdrawal','p2p_withdrawal') AND status = 'completed'), 0)::numeric AS withdrawals
           FROM transactions ${txWhere}`,
        txValues
      );

      return {
        summary: summaryRes.rows[0] ?? null,
        by_day: byDayRes.rows,
        flows: flowsRes.rows[0] ?? null,
      };
    }
  );
}

async function payableReport(req: Request, q: z.infer<typeof payableQuery>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`r.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.status) {
        filters.push(`r.status = $${i++}`);
        values.push(q.status);
      }
      if (q.from) {
        filters.push(`r.created_at >= $${i++}`);
        values.push(q.from);
      }
      if (q.to) {
        filters.push(`r.created_at <= $${i++}`);
        values.push(q.to);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const aggRes = await client.query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE r.status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE r.status = 'processing')::int AS processing,
            COUNT(*) FILTER (WHERE r.status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE r.status = 'rejected')::int AS rejected,
            COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'pending'), 0)::numeric AS pending_amount,
            COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'completed'), 0)::numeric AS completed_amount
           FROM telebirr_withdrawal_requests r ${where}`,
        values
      );

      const itemsRes = await client.query(
        `SELECT r.id, r.user_id, r.amount, r.currency, r.telebirr_number,
                r.account_name, r.status, r.requested_at, r.completed_at,
                u.email AS user_email, u.phone AS user_phone,
                c.email AS cashier_email
           FROM telebirr_withdrawal_requests r
           LEFT JOIN users u ON u.id = r.user_id
           LEFT JOIN users c ON c.id = r.cashier_id
           ${where}
         ORDER BY r.created_at DESC
         LIMIT 200`,
        values
      );

      // Sportsbook bets payable = won bets that haven't paid out yet (actual_payout NULL).
      const sportsBookFilters: string[] = [
        `b.status = 'won'`,
        `(b.actual_payout IS NULL OR b.actual_payout = 0)`,
      ];
      const sbValues: unknown[] = [];
      let k = 1;
      if (scope.tenantId) {
        sportsBookFilters.push(`b.tenant_id = $${k++}`);
        sbValues.push(scope.tenantId);
      }
      const sbWhere = `WHERE ${sportsBookFilters.join(' AND ')}`;
      const sbRes = await client.query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM(b.potential_payout), 0)::numeric AS amount
           FROM sportsbook_bets b ${sbWhere}`,
        sbValues
      );

      return {
        withdrawals: {
          summary: aggRes.rows[0] ?? null,
          items: itemsRes.rows,
        },
        unsettled_won_bets: sbRes.rows[0] ?? null,
        params: { from: q.from ?? null, to: q.to ?? null, status: q.status ?? null },
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

router.get('/offline-cash', wrap((req) => offlineCashReport(req, offlineCashQuery.parse(req.query))));
router.get('/online-cash', wrap((req) => onlineCashReport(req, onlineCashQuery.parse(req.query))));
router.get('/payable', wrap((req) => payableReport(req, payableQuery.parse(req.query))));

export default router;
