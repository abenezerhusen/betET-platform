/**
 * Cashier dashboard — Section 16.
 *
 *   GET /api/cashier/dashboard/stats?from=&to=&mine=true
 *
 * Aggregates the cashier-day stats the panel renders on the home page:
 *   - Tickets sold / total stakes
 *   - Jackpot tickets sold / total stakes
 *   - Tickets paid (winning + cashback) / total paid
 *   - Jackpot tickets paid (admin-settled `won` rows)
 *   - Deposits / Withdrawals
 *   - Grand net (sold - paid)
 *   - "Two-day payable": tickets settled today + yesterday that are
 *      still unpaid (so the manager knows how much cash to keep around)
 *
 * `mine=true` (default) scopes to the requesting cashier. With
 * `mine=false` the query returns aggregates for the whole branch — only
 * useful for cashier-managers, but harmless to expose because cashier
 * accounts can only see their own tenant anyway.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { getCashierScope } from './cashier-shared';
import * as swagger from '../../swagger/registry';

const router = Router();

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  mine: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => (v === undefined ? true : v === true || v === 'true')),
});

function num(v: string | null | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/dashboard/stats',
  summary: 'Cashier dashboard aggregates (sold/paid/deposit/withdraw/net)',
  tags: ['Cashier Dashboard'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Stats' } },
});

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = querySchema.parse(req.query);
    const scope = getCashierScope(req);

    const to = q.to ?? new Date();
    // Default window: today (00:00 → now). Use `from` to widen.
    const defaultFrom = (() => {
      const d = new Date(to.getTime());
      d.setHours(0, 0, 0, 0);
      return d;
    })();
    const from = q.from ?? defaultFrom;

    // Window for the "two day payable" widget: today + yesterday.
    const twoDayFrom = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - 1);
      return d;
    })();

    const out = await withTenantClient(
      { tenantId: scope.tenantId, readOnly: true },
      async (client) => {
        // ---- Tickets sold/paid ----
        // Cashier tickets live in TWO places:
        //   1. `bets`            → internal-game / casino tickets
        //   2. `sportsbook_bets` → multi-leg sports slips (Section 16
        //                          Flow B "Launch Fixtures" tickets are
        //                          stored here when sold by the cashier)
        // The dashboard must aggregate both so the figures match what
        // the cashier actually sold today. We exclude bet_type='jackpot'
        // from the sportsbook side because jackpot tickets are counted
        // separately by the jpStats query below.
        //
        // We always pass 4 args ($1=tenant, $2=from, $3=to, $4=cashier or null)
        // so each SELECT below can branch on `q.mine` in its WHERE filter
        // without having to juggle different parameter slots.
        const betFilters = q.mine
          ? `(b.sold_by_cashier_id = $4 OR b.paid_by_cashier_id = $4)`
          : `TRUE`;
        const sbFilters = q.mine
          ? `(sb.sold_by_cashier_id = $4 OR sb.paid_by_cashier_id = $4 OR sb.cashier_id = $4)`
          : `TRUE`;
        const betArgs: unknown[] = [
          scope.tenantId,
          from,
          to,
          q.mine ? scope.cashierId : null,
        ];

        const ticketStats = await client.query<{
          tickets_sold_count: string;
          tickets_sold_amount: string | null;
          tickets_paid_count: string;
          tickets_paid_amount: string | null;
        }>(
          `WITH unioned AS (
             SELECT b.sold_at, b.paid_at, b.stake, b.payout
               FROM bets b
              WHERE b.tenant_id = $1
                AND ${betFilters}
             UNION ALL
             SELECT sb.sold_at,
                    sb.paid_at,
                    sb.stake,
                    sb.actual_payout AS payout
               FROM sportsbook_bets sb
              WHERE sb.tenant_id = $1
                AND sb.bet_type <> 'jackpot'
                AND ${sbFilters}
           )
           SELECT
             COUNT(*) FILTER (WHERE u.sold_at IS NOT NULL
                              AND u.sold_at BETWEEN $2 AND $3)::text
               AS tickets_sold_count,
             COALESCE(
               SUM(u.stake) FILTER (WHERE u.sold_at IS NOT NULL
                                    AND u.sold_at BETWEEN $2 AND $3),
               0
             )::text AS tickets_sold_amount,
             COUNT(*) FILTER (WHERE u.paid_at IS NOT NULL
                              AND u.paid_at BETWEEN $2 AND $3)::text
               AS tickets_paid_count,
             COALESCE(
               SUM(u.payout) FILTER (WHERE u.paid_at IS NOT NULL
                                     AND u.paid_at BETWEEN $2 AND $3),
               0
             )::text AS tickets_paid_amount
           FROM unioned u`,
          betArgs
        );

        // ---- Jackpot tickets (sportsbook_bets with bet_type=jackpot) ----
        const jpFilters = q.mine
          ? `sb.cashier_id = $4 OR sb.sold_by_cashier_id = $4 OR sb.paid_by_cashier_id = $4`
          : `TRUE`;
        const jpStats = await client.query<{
          jackpot_sold_count: string;
          jackpot_sold_amount: string | null;
          jackpot_paid_count: string;
          jackpot_paid_amount: string | null;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE sb.placed_at BETWEEN $2 AND $3)::text
               AS jackpot_sold_count,
             COALESCE(SUM(sb.stake) FILTER (WHERE sb.placed_at BETWEEN $2 AND $3), 0)::text
               AS jackpot_sold_amount,
             COUNT(*) FILTER (WHERE sb.status = 'won'
                              AND COALESCE(sb.paid_at, sb.settled_at) BETWEEN $2 AND $3)::text
               AS jackpot_paid_count,
             COALESCE(
               SUM(sb.actual_payout) FILTER (WHERE sb.status = 'won'
                                              AND COALESCE(sb.paid_at, sb.settled_at) BETWEEN $2 AND $3),
               0
             )::text AS jackpot_paid_amount
           FROM sportsbook_bets sb
           WHERE sb.tenant_id = $1
             AND sb.bet_type = 'jackpot'
             AND (${jpFilters})`,
          betArgs
        );

        // ---- Deposits and withdrawals (cashier_transactions) ----
        const ctFilters = q.mine ? `ct.cashier_id = $4` : `TRUE`;
        const cashStats = await client.query<{
          deposit_count: string;
          deposit_amount: string | null;
          withdraw_count: string;
          withdraw_amount: string | null;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE ct.type = 'deposit'
                              AND ct.status = 'completed'
                              AND ct.created_at BETWEEN $2 AND $3)::text
               AS deposit_count,
             COALESCE(
               SUM(ct.amount) FILTER (WHERE ct.type = 'deposit'
                                       AND ct.status = 'completed'
                                       AND ct.created_at BETWEEN $2 AND $3),
               0
             )::text AS deposit_amount,
             COUNT(*) FILTER (WHERE ct.type = 'withdrawal'
                              AND ct.status = 'completed'
                              AND ct.created_at BETWEEN $2 AND $3)::text
               AS withdraw_count,
             COALESCE(
               SUM(ct.amount) FILTER (WHERE ct.type = 'withdrawal'
                                       AND ct.status = 'completed'
                                       AND ct.created_at BETWEEN $2 AND $3),
               0
             )::text AS withdraw_amount
           FROM cashier_transactions ct
           WHERE ct.tenant_id = $1
             AND ${ctFilters}`,
          betArgs
        );

        // ---- Two-day payable: settled but unpaid winning tickets ----
        // Same union as ticketStats — payable winnings on either table
        // count toward the cash the cashier needs on hand.
        const twoDayArgs = q.mine
          ? [scope.tenantId, twoDayFrom, scope.cashierId]
          : [scope.tenantId, twoDayFrom];
        const twoDayBetFilter = q.mine
          ? `(b.sold_by_cashier_id = $3 OR b.paid_by_cashier_id = $3)`
          : `TRUE`;
        const twoDaySbFilter = q.mine
          ? `(sb.sold_by_cashier_id = $3 OR sb.paid_by_cashier_id = $3 OR sb.cashier_id = $3)`
          : `TRUE`;
        const twoDay = await client.query<{
          bets_count: string;
          payable_amount: string | null;
        }>(
          `WITH payable AS (
             SELECT b.paid_at, b.status, b.settled_at,
                    COALESCE(b.payout, b.potential_win) AS amount
               FROM bets b
              WHERE b.tenant_id = $1
                AND ${twoDayBetFilter}
             UNION ALL
             SELECT sb.paid_at,
                    -- normalise sportsbook statuses onto the bets vocabulary
                    CASE
                      WHEN sb.status = 'partial' THEN 'partial_won'
                      WHEN sb.status = 'cashout' THEN 'cashed_out'
                      ELSE sb.status
                    END AS status,
                    sb.settled_at,
                    COALESCE(sb.actual_payout, sb.potential_payout) AS amount
               FROM sportsbook_bets sb
              WHERE sb.tenant_id = $1
                AND sb.bet_type <> 'jackpot'
                AND ${twoDaySbFilter}
           )
           SELECT
             COUNT(*) FILTER (
               WHERE p.paid_at IS NULL
                 AND p.status IN ('won', 'partial_won', 'cashed_out')
                 AND p.settled_at >= $2
             )::text AS bets_count,
             COALESCE(
               SUM(p.amount) FILTER (
                 WHERE p.paid_at IS NULL
                   AND p.status IN ('won', 'partial_won', 'cashed_out')
                   AND p.settled_at >= $2
               ),
               0
             )::text AS payable_amount
           FROM payable p`,
          twoDayArgs
        );

        const t = ticketStats.rows[0];
        const j = jpStats.rows[0];
        const c = cashStats.rows[0];
        const p = twoDay.rows[0];

        const ticketsSoldAmount = num(t.tickets_sold_amount);
        const ticketsPaidAmount = num(t.tickets_paid_amount);
        const jackpotSoldAmount = num(j.jackpot_sold_amount);
        const jackpotPaidAmount = num(j.jackpot_paid_amount);
        const depositAmount = num(c.deposit_amount);
        const withdrawAmount = num(c.withdraw_amount);

        const grandNet =
          ticketsSoldAmount +
          jackpotSoldAmount -
          ticketsPaidAmount -
          jackpotPaidAmount;

        return {
          from: from.toISOString(),
          to: to.toISOString(),
          mine: q.mine,
          totals: {
            total_sold_count: Number(t.tickets_sold_count),
            total_sold_amount: ticketsSoldAmount,
            total_jackpots_sold_count: Number(j.jackpot_sold_count),
            total_jackpots_sold_amount: jackpotSoldAmount,
            total_paid_tickets_count: Number(t.tickets_paid_count),
            total_paid_amount: ticketsPaidAmount,
            total_paid_jackpots_count: Number(j.jackpot_paid_count),
            total_paid_jackpots_amount: jackpotPaidAmount,
            total_deposit_count: Number(c.deposit_count),
            total_deposit_amount: depositAmount,
            total_withdraw_count: Number(c.withdraw_count),
            total_withdraw_amount: withdrawAmount,
            grand_net: grandNet,
          },
          two_day_payable: {
            bets_count: Number(p.bets_count),
            payable_amount: num(p.payable_amount),
            since: twoDayFrom.toISOString(),
          },
        };
      }
    );

    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
