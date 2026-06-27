/**
 * Admin Bets module — Section 4 of the platform spec.
 *
 * Three pages share the same backend surface:
 *
 *   GET  /api/admin/bets?type=online        → User-Panel placed bets
 *   GET  /api/admin/bets?type=offline       → Cashier-Panel sold tickets
 *   GET  /api/admin/bets?type=bet_for_me    → "Bet For Me" agent-placed bets
 *   GET  /api/admin/bets/:id                → slip detail (legs, hashes,
 *                                              wallet activity)
 *   POST /api/admin/bets/:id/cancel         → refund pending bet
 *
 * The `type` query parameter is the spec naming; internally that value maps
 * onto the existing `channel` discriminator on the `sportsbook_bets` table
 * and the parallel `bets` table (which holds online casino / virtuals).
 *
 * Cancel rules:
 *   - Only `pending` bets can be cancelled.
 *   - Cancel refunds the stake to the user's wallet (idempotent transaction
 *     row keyed by `bet_id`).
 *   - Audited and notified through the realtime layer so any open user
 *     panels see their balance update immediately.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { emitToAdmins, emitToUser } from '../../../realtime/socket';
import { resetUserStreak } from '../streaks/streaks.module';
import { ensureWalletForUpdate } from '../../game/game.repository';
import {
  creditWalletBalance,
  insertWalletTransaction,
} from '../wallets/wallets.repository';
import {
  getAdminScope,
  getIp,
  getUa,
} from '../admin-shared';

/* ========================================================================== */
/* DTOs                                                                       */
/* ========================================================================== */

const idParam = z.object({ id: z.string().uuid() });

/** Spec uses "type" instead of "channel" — accept both for back-compat. */
const TYPE_TO_CHANNEL = {
  online: 'online',
  offline: 'offline',
  bet_for_me: 'bet_for_me',
} as const;

const listBetsQuery = z.object({
  type: z
    .union([
      z.enum(['online', 'offline', 'bet_for_me']),
      z.string().transform((v) => v.toLowerCase()),
    ])
    .optional(),
  channel: z.enum(['online', 'offline', 'bet_for_me']).optional(),
  bet_type: z.enum(['single', 'combo', 'system', 'jackpot']).optional(),
  status: z
    .enum(['pending', 'won', 'lost', 'void', 'cashout', 'partial', 'cancelled'])
    .optional(),
  user_id: z.string().uuid().optional(),
  cashier_id: z.string().uuid().optional(),
  branch_id: z.string().uuid().optional(),
  jackpot_id: z.string().uuid().optional(),
  phone: z.string().trim().min(1).max(64).optional(),
  payment_type: z.string().trim().min(1).max(64).optional(),
  paid: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

type ListBetsQuery = z.infer<typeof listBetsQuery>;

const cancelBetSchema = z.object({
  reason: z.string().trim().min(1).max(500).default('Admin panel cancellation'),
});

/* ========================================================================== */
/* Repository / Service                                                       */
/* ========================================================================== */

/**
 * Resolve the `channel` value to query for. The frontend always sends
 * `type`; older callers may still pass `channel` directly.
 */
function resolveChannel(q: ListBetsQuery): 'online' | 'offline' | 'bet_for_me' | null {
  if (q.channel) return q.channel;
  if (!q.type) return null;
  const mapped = (TYPE_TO_CHANNEL as Record<string, 'online' | 'offline' | 'bet_for_me'>)[q.type];
  return mapped ?? null;
}

/**
 * Combined list query reading from both `sportsbook_bets` (multi-leg sports
 * bets, including offline cashier slips and bet_for_me) and the legacy
 * `bets` table (single-row casino / virtuals plays). Result is the same
 * row shape the admin panel already understands.
 */
async function listBets(req: Request, q: ListBetsQuery) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  const channel = resolveChannel(q);

  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if (scope.tenantId) {
        filters.push(`b.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (channel) {
        filters.push(`b.channel = $${i++}`);
        values.push(channel);
      }
      if (q.bet_type) {
        filters.push(`b.bet_type = $${i++}`);
        values.push(q.bet_type);
      }
      if (q.status) {
        filters.push(`b.status = $${i++}`);
        values.push(q.status);
      }
      if (q.user_id) {
        filters.push(`b.user_id = $${i++}`);
        values.push(q.user_id);
      }
      if (q.cashier_id) {
        filters.push(`b.cashier_id = $${i++}`);
        values.push(q.cashier_id);
      }
      if (q.branch_id) {
        filters.push(`b.branch_id = $${i++}`);
        values.push(q.branch_id);
      }
      if (q.jackpot_id) {
        filters.push(`b.jackpot_id = $${i++}`);
        values.push(q.jackpot_id);
      }
      if (q.phone) {
        filters.push(
          `(u.phone ILIKE $${i} OR b.bet_for_user_phone ILIKE $${i})`
        );
        values.push(`%${q.phone}%`);
        i++;
      }
      if (q.payment_type) {
        filters.push(`(b.metadata->>'payment_type') = $${i++}`);
        values.push(q.payment_type);
      }
      if (q.paid !== undefined) {
        if (q.paid) {
          filters.push(`(b.actual_payout IS NOT NULL AND b.actual_payout > 0)`);
        } else {
          filters.push(`(b.actual_payout IS NULL OR b.actual_payout = 0)`);
        }
      }
      if (q.from) {
        filters.push(`b.placed_at >= $${i++}`);
        values.push(q.from);
      }
      if (q.to) {
        filters.push(`b.placed_at <= $${i++}`);
        values.push(q.to);
      }
      if (q.search) {
        // Match any code the cashier / admin might know — UUID prefix,
        // SBK-XXXXXXXX coupon, TKT-XXXXXXXX raw ticket code, or the
        // printed receipt code (TKT-{BRANCH}-{YYYYMMDD}-{SEQ}). Also
        // match user phone / email so single-search box keeps working.
        filters.push(`(
          b.id::text ILIKE $${i}
          OR b.ticket_code ILIKE $${i}
          OR b.coupon_code ILIKE $${i}
          OR b.printed_ticket_code ILIKE $${i}
          OR u.phone ILIKE $${i}
          OR u.email::text ILIKE $${i}
        )`);
        values.push(`%${q.search}%`);
        i++;
      }

      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const allBetsCte = `
        WITH all_bets AS (
          SELECT
            sb.id,
            sb.tenant_id,
            sb.user_id,
            sb.cashier_id,
            sb.channel::text                                     AS channel,
            sb.bet_type::text                                    AS bet_type,
            sb.bet_for_user_phone,
            sb.stake::numeric                                    AS stake,
            sb.currency,
            sb.potential_payout::numeric                         AS potential_payout,
            sb.actual_payout::numeric                            AS actual_payout,
            sb.status::text                                      AS status,
            sb.jackpot_id,
            sb.metadata,
            sb.metadata->>'branch_id'                            AS branch_id,
            sb.ticket_code,
            sb.printed_ticket_code,
            sb.coupon_code,
            sb.sold_at,
            sb.sold_by_cashier_id,
            sb.sold_branch_id,
            sb.paid_at,
            sb.placed_at,
            sb.settled_at,
            sb.created_at,
            sb.updated_at,
            'sportsbook'::text                                   AS source
          FROM sportsbook_bets sb
          UNION ALL
          SELECT
            ub.id,
            ub.tenant_id,
            ub.user_id,
            NULL::uuid                                           AS cashier_id,
            'online'::text                                       AS channel,
            COALESCE(NULLIF(ub.metadata->>'bet_type', ''), 'single')::text AS bet_type,
            NULL::text                                           AS bet_for_user_phone,
            ub.stake::numeric                                    AS stake,
            ub.currency,
            ub.potential_win::numeric                            AS potential_payout,
            ub.payout::numeric                                   AS actual_payout,
            ub.status::text                                      AS status,
            NULL::uuid                                           AS jackpot_id,
            ub.metadata,
            ub.metadata->>'branch_id'                            AS branch_id,
            ub.ticket_code,
            ub.printed_ticket_code,
            NULL::text                                           AS coupon_code,
            ub.sold_at,
            ub.sold_by_cashier_id,
            ub.sold_branch_id,
            ub.paid_at,
            ub.placed_at,
            ub.settled_at,
            ub.created_at,
            ub.created_at                                        AS updated_at,
            'bets'::text                                         AS source
          FROM bets ub
        )
      `;

      const totalRes = await client.query<{ count: string }>(
        `${allBetsCte}
         SELECT COUNT(*)::text AS count
           FROM all_bets b
           LEFT JOIN users u ON u.id = b.user_id
           ${where}`,
        values
      );

      const rows = await client.query(
        `${allBetsCte}
         SELECT b.id, b.tenant_id, b.user_id, b.cashier_id, b.channel, b.bet_type,
                b.bet_for_user_phone, b.stake, b.currency, b.potential_payout,
                b.actual_payout, b.status, b.jackpot_id, b.metadata, b.branch_id,
                b.ticket_code, b.printed_ticket_code, b.coupon_code,
                b.sold_at, b.sold_by_cashier_id, b.sold_branch_id, b.paid_at,
                b.placed_at, b.settled_at, b.created_at, b.updated_at, b.source,
                u.email AS user_email, u.phone AS user_phone,
                COALESCE(u.metadata->>'full_name', u.email, u.phone) AS user_name,
                c.email AS cashier_email,
                COALESCE(c.metadata->>'full_name', c.metadata->>'name', c.email) AS cashier_name,
                /* The cashier who actually sold the ticket (sportsbook
                 * keeps the most recent sale on sold_by_cashier_id);
                 * resolves to the same fallback chain as the placer
                 * cashier so admin reports stay consistent. */
                sc.email AS sold_by_cashier_email,
                COALESCE(sc.metadata->>'full_name', sc.metadata->>'name', sc.email) AS sold_by_cashier_name,
                br.metadata->>'name' AS branch_name
           FROM all_bets b
           LEFT JOIN users u  ON u.id  = b.user_id
           LEFT JOIN users c  ON c.id  = b.cashier_id
           LEFT JOIN users sc ON sc.id = b.sold_by_cashier_id
           LEFT JOIN users br ON br.id::text = b.branch_id AND br.role = 'branch'
           ${where}
         ORDER BY b.placed_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );

      const summary = await client.query<{
        total_stake: string;
        total_payout: string;
        won_count: string;
        lost_count: string;
        pending_count: string;
        cancelled_count: string;
      }>(
        `${allBetsCte}
         SELECT
           /* Net Pay / Profit inputs — exclude "booked" offline tickets
              (placed at a cashier but not yet sold/printed). Online and
              internal-game bets are auto-confirmed at placement, so the
              sold_at filter only applies to the offline channel. */
           COALESCE(SUM(b.stake) FILTER (
                      WHERE NOT (b.channel = 'offline' AND b.sold_at IS NULL)
                    ), 0)::text                                                      AS total_stake,
           COALESCE(SUM(b.actual_payout) FILTER (
                      WHERE b.status = 'won'
                        AND NOT (b.channel = 'offline' AND b.sold_at IS NULL)
                    ), 0)::text                                                       AS total_payout,
           COUNT(*) FILTER (WHERE b.status = 'won')::text                              AS won_count,
           COUNT(*) FILTER (WHERE b.status = 'lost')::text                             AS lost_count,
           COUNT(*) FILTER (WHERE b.status = 'pending')::text                          AS pending_count,
           COUNT(*) FILTER (WHERE b.status IN ('cancelled','void'))::text              AS cancelled_count
           FROM all_bets b
           LEFT JOIN users u ON u.id = b.user_id
           ${where}`,
        values
      );

      return {
        items: rows.rows,
        total: Number(totalRes.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
        summary: summary.rows[0] ?? null,
      };
    }
  );
}

async function getBet(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      // sportsbook bet?
      const sb = await client.query(
        `SELECT b.*, u.email AS user_email, u.phone AS user_phone,
                COALESCE(u.metadata->>'full_name', u.email, u.phone) AS user_name,
                c.email AS cashier_email,
                COALESCE(c.metadata->>'full_name', c.metadata->>'name', c.email) AS cashier_name,
                sc.email AS sold_by_cashier_email,
                COALESCE(sc.metadata->>'full_name', sc.metadata->>'name', sc.email) AS sold_by_cashier_name,
                br.metadata->>'name' AS branch_name,
                'sportsbook'::text AS source
           FROM sportsbook_bets b
           LEFT JOIN users u  ON u.id = b.user_id
           LEFT JOIN users c  ON c.id = b.cashier_id
           LEFT JOIN users sc ON sc.id = b.sold_by_cashier_id
           LEFT JOIN users br ON br.id = b.sold_branch_id AND br.role = 'branch'
           WHERE b.id = $1
           LIMIT 1`,
        [id]
      );

      if (sb.rows[0]) {
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
             LEFT JOIN sports_markets m      ON m.id = sel.market_id
             LEFT JOIN sports_events ev      ON ev.id = m.event_id
            WHERE l.bet_id = $1
            ORDER BY l.created_at`,
          [id]
        );
        return { ...sb.rows[0], legs: legs.rows };
      }

      // legacy bets table?
      const userBet = await client.query(
        `SELECT b.id, b.tenant_id, b.user_id,
                NULL::uuid                                              AS cashier_id,
                'online'::text                                          AS channel,
                COALESCE(NULLIF(b.metadata->>'bet_type',''),'single')   AS bet_type,
                NULL::text                                              AS bet_for_user_phone,
                b.stake, b.currency,
                b.potential_win::numeric                                AS potential_payout,
                b.payout::numeric                                       AS actual_payout,
                b.status, NULL::uuid                                    AS jackpot_id,
                b.metadata, b.placed_at, b.settled_at, b.created_at,
                b.created_at                                            AS updated_at,
                b.ticket_code, b.printed_ticket_code,
                NULL::text                                              AS coupon_code,
                b.sold_at, b.sold_by_cashier_id, b.sold_branch_id, b.paid_at,
                u.email AS user_email, u.phone AS user_phone,
                COALESCE(u.metadata->>'full_name', u.email, u.phone)    AS user_name,
                sc.email AS sold_by_cashier_email,
                COALESCE(sc.metadata->>'full_name', sc.metadata->>'name', sc.email) AS sold_by_cashier_name,
                'bets'::text                                            AS source
           FROM bets b
           LEFT JOIN users u  ON u.id = b.user_id
           LEFT JOIN users sc ON sc.id = b.sold_by_cashier_id
           WHERE b.id = $1
           LIMIT 1`,
        [id]
      );
      if (!userBet.rows[0]) throw new NotFoundError('Bet not found');
      return { ...userBet.rows[0], legs: [] };
    }
  );
}

/**
 * Cancel a pending bet and refund its stake.
 *
 * Refund flow:
 *   1. Lock the bet row, ensure it's `pending` (and the underlying match
 *      has not started for sportsbook bets).
 *   2. Lock the user's wallet for the bet's currency, credit the stake,
 *      append an `adjustment` ledger row (idempotent on `reference`).
 *   3. Mark the bet `cancelled` with `settled_at = now()`.
 *
 * Both `sportsbook_bets` and the legacy `bets` table are supported.
 */
async function cancelBet(
  req: Request,
  id: string,
  body: z.infer<typeof cancelBetSchema>
) {
  const scope = getAdminScope(req);

  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      // Try sportsbook first.
      const sbLocked = await client.query<{
        id: string;
        tenant_id: string;
        user_id: string;
        stake: string;
        currency: string;
        status: string;
        channel: string;
      }>(
        `SELECT id, tenant_id, user_id, stake::text AS stake, currency, status, channel::text AS channel
           FROM sportsbook_bets
          WHERE id = $1
          FOR UPDATE`,
        [id]
      );

      let bet:
        | {
            source: 'sportsbook' | 'bets';
            id: string;
            tenantId: string;
            userId: string;
            stake: string;
            currency: string;
            status: string;
          }
        | null = null;

      if (sbLocked.rows[0]) {
        const r = sbLocked.rows[0];
        bet = {
          source: 'sportsbook',
          id: r.id,
          tenantId: r.tenant_id,
          userId: r.user_id,
          stake: r.stake,
          currency: r.currency,
          status: r.status,
        };

        // Spec: cancel only allowed before any leg's match has started.
        const legCount = await client.query<{ started_legs: string }>(
          `SELECT COUNT(*)::text AS started_legs
             FROM sportsbook_bet_legs l
             JOIN sports_selections sel ON sel.id = l.selection_id
             JOIN sports_markets    m   ON m.id  = sel.market_id
             JOIN sports_events     ev  ON ev.id = m.event_id
            WHERE l.bet_id = $1
              AND ev.starts_at <= now()`,
          [id]
        );
        if (Number(legCount.rows[0]?.started_legs ?? 0) > 0) {
          throw new BadRequestError('Cannot cancel — at least one match has already started');
        }
      } else {
        const ubLocked = await client.query<{
          id: string;
          tenant_id: string;
          user_id: string;
          stake: string;
          currency: string;
          status: string;
        }>(
          `SELECT id, tenant_id, user_id, stake::text AS stake, currency, status
             FROM bets
            WHERE id = $1
            FOR UPDATE`,
          [id]
        );
        if (!ubLocked.rows[0]) throw new NotFoundError('Bet not found');
        const r = ubLocked.rows[0];
        bet = {
          source: 'bets',
          id: r.id,
          tenantId: r.tenant_id,
          userId: r.user_id,
          stake: r.stake,
          currency: r.currency,
          status: r.status,
        };
      }

      if (bet.status !== 'pending') {
        throw new BadRequestError(
          `Cannot cancel — bet is already ${bet.status}`,
          { current_status: bet.status }
        );
      }

      // Refund the stake. The wallet update + transaction are inside the
      // same DB transaction as the status change so a failure rolls
      // everything back atomically.
      const wallet = await ensureWalletForUpdate(
        client,
        bet.tenantId,
        bet.userId,
        bet.currency
      );

      const after = await creditWalletBalance(client, wallet.id, bet.stake);

      const tx = await insertWalletTransaction(client, {
        tenantId: bet.tenantId,
        walletId: wallet.id,
        userId: bet.userId,
        type: 'adjustment',
        amount: bet.stake,
        beforeBalance: wallet.balance,
        afterBalance: after.balance,
        currency: bet.currency,
        reference: `bet_cancel:${bet.id}`,
        metadata: {
          admin_action: 'bet_cancel',
          actor_id: scope.actorId,
          actor_role: scope.actorRole,
          bet_id: bet.id,
          source: bet.source,
          reason: body.reason,
        },
      });

      // Update the bet row last.
      const cancelledAt = new Date();
      if (bet.source === 'sportsbook') {
        await client.query(
          `UPDATE sportsbook_bets
              SET status = 'void',
                  actual_payout = 0,
                  settled_at = $2,
                  metadata = COALESCE(metadata, '{}'::jsonb) ||
                             jsonb_build_object(
                               'cancelled_at', $2,
                               'cancelled_by', $3,
                               'cancel_reason', $4,
                               'refund_tx_id', $5
                             )
            WHERE id = $1`,
          [bet.id, cancelledAt, scope.actorId, body.reason, tx.id]
        );
        // Also set legs to void for consistency.
        await client.query(
          `UPDATE sportsbook_bet_legs
              SET status = 'void', settled_at = $2
            WHERE bet_id = $1 AND status = 'pending'`,
          [bet.id, cancelledAt]
        );
      } else {
        await client.query(
          `UPDATE bets
              SET status = 'cancelled',
                  payout = 0,
                  settled_at = $2,
                  metadata = COALESCE(metadata, '{}'::jsonb) ||
                             jsonb_build_object(
                               'cancelled_at', $2,
                               'cancelled_by', $3,
                               'cancel_reason', $4,
                               'refund_tx_id', $5
                             )
            WHERE id = $1`,
          [bet.id, cancelledAt, scope.actorId, body.reason, tx.id]
        );
      }

      void tryAudit(
        {
          tenantId: bet.tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.bet.cancel',
          resource: bet.source === 'sportsbook' ? 'sportsbook_bets' : 'bets',
          resourceId: bet.id,
          payload: {
            stake_refunded: bet.stake,
            wallet_id: wallet.id,
            transaction_id: tx.id,
            reason: body.reason,
          },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );

      emitToUser(bet.tenantId, bet.userId, 'BET_CANCELLED', {
        bet_id: bet.id,
        refund_amount: bet.stake,
        currency: bet.currency,
      });
      emitToAdmins(bet.tenantId, 'BET_CANCELLED', {
        bet_id: bet.id,
        user_id: bet.userId,
      });

      // Spec § Streak Settings: cancel-resets-streak if globally enabled.
      void resetUserStreak({
        tenantId: bet.tenantId,
        userId: bet.userId,
        reason: 'cancel',
      });

      return {
        id: bet.id,
        status: bet.source === 'sportsbook' ? 'void' : 'cancelled',
        refund: {
          amount: bet.stake,
          currency: bet.currency,
          wallet_id: wallet.id,
          transaction_id: tx.id,
        },
      };
    }
  );
}

/* ========================================================================== */
/* Routes                                                                     */
/* ========================================================================== */

const router = Router();

const wrap =
  <T,>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.get('/', wrap((req) => listBets(req, listBetsQuery.parse(req.query))));

router.get(
  '/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return getBet(req, id);
  })
);

router.post(
  '/:id/cancel',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return cancelBet(req, id, cancelBetSchema.parse(req.body ?? {}));
  })
);

export default router;
