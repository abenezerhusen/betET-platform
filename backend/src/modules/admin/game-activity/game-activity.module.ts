/**
 * Admin internal-game activity explorer.
 *
 *   GET /api/admin/game-activity    every bet placed on the four internal
 *                                   games (Aviator, JetX, Fast Keno,
 *                                   Multi Hot 5) read from `game_bets`,
 *                                   joined to the player who placed it and the
 *                                   round it belongs to.
 *
 * The wallet-ledger Transactions page already surfaces the money movement of
 * each game (the `bet_stake` / `bet_win` rows). This explorer is the
 * per-round counterpart: it lets an admin monitor each individual bet, its
 * stake, the outcome (won / cashed out / lost), the cash-out multiplier and
 * the net win/loss — all tied back to the player account.
 *
 * Read-only. Bets are written by the game routes + worker loops; nothing here
 * mutates them.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { getAdminScope } from '../admin-shared';

const querySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    game_id: z.enum(['aviator', 'jetx', 'fast-keno', 'multi-hot-5']).optional(),
    /** Raw bet status from the table. */
    status: z.enum(['active', 'cashed_out', 'lost', 'won']).optional(),
    /** Convenience outcome filter: win (cashed_out/won), loss, or pending. */
    result: z.enum(['win', 'loss', 'pending']).optional(),
    user_id: z.string().uuid().optional(),
    phone: z.string().trim().min(1).max(64).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    min_amount: z.coerce.number().nonnegative().optional(),
    max_amount: z.coerce.number().nonnegative().optional(),
    limit: z.coerce.number().int().positive().max(500).default(100),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strip();

async function listGameBets(req: Request, query: z.infer<typeof querySchema>) {
  const scope = getAdminScope(req);
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
      if (query.game_id) {
        filters.push(`b.game_id = $${i++}`);
        values.push(query.game_id);
      }
      if (query.status) {
        filters.push(`b.status = $${i++}`);
        values.push(query.status);
      }
      if (query.result === 'win') {
        filters.push(`(b.status IN ('cashed_out','won') AND b.payout > 0)`);
      } else if (query.result === 'loss') {
        filters.push(`b.status = 'lost'`);
      } else if (query.result === 'pending') {
        filters.push(`b.status = 'active'`);
      }
      if (query.user_id) {
        filters.push(`b.user_id = $${i++}`);
        values.push(query.user_id);
      }
      if (query.phone) {
        filters.push(`(u.phone ILIKE $${i} OR u.email ILIKE $${i})`);
        values.push(`%${query.phone}%`);
        i++;
      }
      if (query.search) {
        filters.push(
          `(u.phone ILIKE $${i} OR u.email ILIKE $${i} OR COALESCE(u.metadata->>'full_name', u.metadata->>'name') ILIKE $${i} OR b.id::text ILIKE $${i})`
        );
        values.push(`%${query.search}%`);
        i++;
      }
      if (query.min_amount !== undefined) {
        filters.push(`b.amount >= $${i++}`);
        values.push(query.min_amount);
      }
      if (query.max_amount !== undefined) {
        filters.push(`b.amount <= $${i++}`);
        values.push(query.max_amount);
      }
      if (query.from) {
        filters.push(`b.created_at >= $${i++}`);
        values.push(query.from);
      }
      if (query.to) {
        filters.push(`b.created_at <= $${i++}`);
        values.push(query.to);
      }

      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const totalRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM game_bets b
           LEFT JOIN users u ON u.id = b.user_id
           ${where}`,
        values
      );

      const itemsRes = await client.query(
        `SELECT b.id, b.tenant_id, b.round_id, b.user_id, b.game_id,
                b.amount::numeric                                   AS amount,
                b.payout::numeric                                   AS payout,
                (b.payout - b.amount)::numeric                      AS net,
                b.multiplier_at_cashout::numeric                    AS multiplier,
                b.auto_cashout::numeric                             AS auto_cashout,
                b.selected_numbers,
                b.lines,
                b.status,
                CASE
                  WHEN b.status IN ('cashed_out','won') AND b.payout > 0 THEN 'win'
                  WHEN b.status = 'lost'                                  THEN 'loss'
                  ELSE 'pending'
                END                                                 AS result,
                b.metadata,
                b.created_at,
                b.updated_at,
                gr.crash_point::numeric                             AS crash_point,
                gr.server_seed_hash                                 AS server_seed_hash,
                u.email                                             AS user_email,
                u.phone                                             AS user_phone,
                COALESCE(u.metadata->>'full_name', u.metadata->>'name', u.email, u.phone)
                                                                    AS user_name
           FROM game_bets b
           LEFT JOIN users u        ON u.id = b.user_id
           LEFT JOIN game_rounds gr ON gr.id = b.round_id
           ${where}
           ORDER BY b.created_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, query.limit, query.offset]
      );

      const summaryRes = await client.query<{
        total_bets: string;
        total_staked: string;
        total_payout: string;
        ggr: string;
        win_count: string;
        loss_count: string;
        pending_count: string;
        player_count: string;
      }>(
        `SELECT
            COUNT(*)::text                                                                       AS total_bets,
            COALESCE(SUM(b.amount), 0)::text                                                     AS total_staked,
            COALESCE(SUM(b.payout), 0)::text                                                     AS total_payout,
            COALESCE(SUM(b.amount - b.payout), 0)::text                                          AS ggr,
            COUNT(*) FILTER (WHERE b.status IN ('cashed_out','won') AND b.payout > 0)::text      AS win_count,
            COUNT(*) FILTER (WHERE b.status = 'lost')::text                                      AS loss_count,
            COUNT(*) FILTER (WHERE b.status = 'active')::text                                    AS pending_count,
            COUNT(DISTINCT b.user_id)::text                                                      AS player_count
           FROM game_bets b
           LEFT JOIN users u ON u.id = b.user_id
           ${where}`,
        values
      );

      return {
        items: itemsRes.rows,
        total: Number(totalRes.rows[0]?.count ?? 0),
        limit: query.limit,
        offset: query.offset,
        summary: summaryRes.rows[0] ?? null,
      };
    }
  );
}

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

router.get(
  '/',
  wrap((req) => listGameBets(req, querySchema.parse(req.query)))
);

export default router;
