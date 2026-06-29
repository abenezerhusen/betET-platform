/**
 * Public + authenticated jackpot endpoints for the user panel.
 *
 *   GET  /api/jackpots                list active/scheduled jackpots (no auth)
 *   GET  /api/jackpots/:id            single jackpot detail (no auth)
 *   POST /api/jackpots/:id/enter      authenticated user enters a jackpot
 *                                     (debits wallet, creates sportsbook_bet)
 *
 * A "jackpot" is a `tournaments` row with `kind = 'jackpot'`.
 * Settlement is done by the admin via the Admin Super Jackpots page.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../http/errors/http-error';
import { authenticateToken } from '../../middleware/authenticate';
import { assertSiteAvailable } from '../../middleware/maintenance-mode';
import { getUserScope } from '../user/user-shared';
import { tryAudit } from '../audit/audit.service';
import { emitWalletUpdated } from '../../realtime/socket';

const router = Router();

function requireTenantId(req: Request): string {
  const tenantId = req.tenant?.id ?? null;
  if (!tenantId) throw new BadRequestError('Tenant context required');
  return tenantId;
}

const COLS = `
  id, tenant_id, name, description, kind, status, starts_at, ends_at,
  entry_fee, prize_pool, currency, max_entries, rules, leaderboard,
  created_at, updated_at
`;

const enterSchema = z.object({
  quantity: z.coerce.number().int().positive().max(50).default(1),
  currency: z.string().trim().min(1).max(8).default('ETB'),
});

/* -------------------------------------------------------------------------- */
/* GET /api/jackpots  — public list of sellable jackpots                     */
/* -------------------------------------------------------------------------- */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = requireTenantId(req);
    const result = await withTenantClient(
      { tenantId, readOnly: true },
      async (client) => {
        const rows = await client.query(
          `SELECT ${COLS},
                  (SELECT COUNT(*)::int FROM sportsbook_bets sb
                    WHERE sb.jackpot_id = t.id) AS tickets_sold
             FROM tournaments t
            WHERE t.kind = 'jackpot'
              AND t.status IN ('scheduled', 'running')
              AND t.tenant_id = $1
              AND (t.ends_at IS NULL OR t.ends_at > now())
            ORDER BY t.starts_at ASC NULLS LAST, t.created_at DESC`,
          [tenantId]
        );
        return rows.rows;
      }
    );
    res.json({ items: result });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* GET /api/jackpots/:id  — public single jackpot detail                      */
/* -------------------------------------------------------------------------- */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = requireTenantId(req);
    const id = z.string().uuid().parse(req.params.id);

    const result = await withTenantClient(
      { tenantId, readOnly: true },
      async (client) => {
        const r = await client.query(
          `SELECT ${COLS},
                  (SELECT COUNT(*)::int FROM sportsbook_bets sb
                    WHERE sb.jackpot_id = t.id) AS tickets_sold
             FROM tournaments t
            WHERE t.id = $1 AND t.kind = 'jackpot' AND t.tenant_id = $2`,
          [id, tenantId]
        );
        return r.rows[0] ?? null;
      }
    );

    if (!result) throw new NotFoundError('Jackpot not found');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* POST /api/jackpots/:id/enter  — authenticated user enters a jackpot        */
/* -------------------------------------------------------------------------- */
router.post(
  '/:id/enter',
  authenticateToken(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await assertSiteAvailable(req);
      const scope = getUserScope(req);
      const id = z.string().uuid().parse(req.params.id);
      const body = enterSchema.parse(req.body ?? {});

      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          await client.query('BEGIN');
          try {
            /* 1. Lock the jackpot row */
            const j = await client.query<{
              id: string;
              name: string;
              status: string;
              starts_at: Date | null;
              ends_at: Date | null;
              entry_fee: string;
              prize_pool: string;
              currency: string;
              max_entries: number | null;
              rules: Record<string, unknown>;
            }>(
              `SELECT id, name, status, starts_at, ends_at, entry_fee,
                      prize_pool, currency, max_entries, rules
                 FROM tournaments
                WHERE id = $1 AND tenant_id = $2 AND kind = 'jackpot'
                FOR UPDATE`,
              [id, scope.tenantId]
            );
            const jackpot = j.rows[0];
            if (!jackpot) throw new NotFoundError('Jackpot not found');

            /* 2. Validate availability */
            if (!['scheduled', 'running'].includes(jackpot.status)) {
              throw new BadRequestError(
                `Jackpot is not available (status: ${jackpot.status})`,
                { reason: 'jackpot_inactive' }
              );
            }
            if (jackpot.starts_at && jackpot.starts_at > new Date()) {
              throw new BadRequestError('Jackpot has not started yet', {
                reason: 'jackpot_not_started',
              });
            }
            if (jackpot.ends_at && jackpot.ends_at <= new Date()) {
              throw new BadRequestError('Jackpot entry period is closed', {
                reason: 'jackpot_ended',
              });
            }

            /* 3. Enforce max_entries */
            if (jackpot.max_entries !== null) {
              const sold = await client.query<{ count: string }>(
                `SELECT COUNT(*)::text AS count FROM sportsbook_bets
                  WHERE jackpot_id = $1`,
                [id]
              );
              const soldCount = Number(sold.rows[0]?.count ?? 0);
              if (soldCount + body.quantity > jackpot.max_entries) {
                throw new ConflictError(
                  `Only ${jackpot.max_entries - soldCount} ticket(s) remaining`,
                  { reason: 'max_entries_reached' }
                );
              }
            }

            /* 4. Verify user is active */
            const user = await client.query<{ status: string }>(
              `SELECT status FROM users WHERE id = $1`,
              [scope.userId]
            );
            if (!user.rows[0] || user.rows[0].status !== 'active') {
              throw new BadRequestError('Account is not active');
            }

            /* 5. Debit wallet */
            const currency = jackpot.currency || body.currency;
            const stakePerTicket = Number(jackpot.entry_fee);
            const totalStake = stakePerTicket * body.quantity;

            const walletRow = await client.query<{
              id: string;
              balance: string;
              locked_balance: string;
              status: string;
            }>(
              `SELECT id, balance::text, locked_balance::text, status
                 FROM wallets
                WHERE user_id = $1 AND tenant_id = $2 AND currency = $3
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE`,
              [scope.userId, scope.tenantId, currency]
            );
            const w = walletRow.rows[0];
            if (!w) {
              throw new BadRequestError('No wallet for this currency', {
                currency,
              });
            }
            if (w.status !== 'active') {
              throw new BadRequestError(`Wallet is ${w.status}`, {
                reason: 'wallet_inactive',
              });
            }
            const before = Number(w.balance);
            if (before < totalStake) {
              throw new BadRequestError('Insufficient balance', {
                reason: 'insufficient_balance',
                balance: before,
                required: totalStake,
              });
            }
            const afterBalance = Math.round((before - totalStake) * 100) / 100;
            await client.query(
              `UPDATE wallets
                  SET balance = $1, updated_at = now()
                WHERE id = $2`,
              [afterBalance, w.id]
            );

            /* 6. Insert one sportsbook_bet per requested quantity */
            const eventIds: string[] = Array.isArray(
              (jackpot.rules as { event_ids?: unknown }).event_ids
            )
              ? (jackpot.rules as { event_ids: string[] }).event_ids
              : [];

            const tickets: Array<{
              id: string;
              ticket_code: string;
              coupon_code: string;
            }> = [];

            for (let n = 0; n < body.quantity; n++) {
              const ins = await client.query<{
                id: string;
                ticket_code: string;
                coupon_code: string;
              }>(
                `INSERT INTO sportsbook_bets
                   (tenant_id, user_id, channel, bet_type,
                    stake, currency, potential_payout,
                    jackpot_id, status, metadata)
                 VALUES ($1, $2, 'online', 'jackpot',
                         $3, $4, 0,
                         $5, 'pending', $6::jsonb)
                 RETURNING id, ticket_code, coupon_code`,
                [
                  scope.tenantId,
                  scope.userId,
                  stakePerTicket.toFixed(2),
                  currency,
                  id,
                  JSON.stringify({
                    jackpot_name: jackpot.name,
                    event_ids: eventIds,
                    placed_via: 'user_panel_online',
                    receipt_n: n + 1,
                    receipt_of: body.quantity,
                  }),
                ]
              );
              const ticket = ins.rows[0];
              tickets.push(ticket);

              /* Insert pending bet legs for each event so settlement can
                 tally won_legs correctly once the admin settles. */
              for (const eventId of eventIds) {
                /* Resolve the canonical selection_id for this event from
                   sports_selections (just the first available selection so
                   the leg has a valid FK). Settlement will mark it won/lost
                   during the settle pass. */
                const sel = await client.query<{ id: string }>(
                  `SELECT s.id FROM sports_selections s
                     JOIN sports_markets m ON m.id = s.market_id
                    WHERE m.event_id = $1
                    LIMIT 1`,
                  [eventId]
                );
                if (sel.rows[0]) {
                  await client.query(
                    `INSERT INTO sportsbook_bet_legs
                       (bet_id, selection_id, odds, status)
                     VALUES ($1, $2, 1, 'pending')
                     ON CONFLICT DO NOTHING`,
                    [ticket.id, sel.rows[0].id]
                  );
                }
              }

              /* Record wallet transaction */
              await client.query(
                `INSERT INTO transactions
                   (tenant_id, user_id, wallet_id, type, currency, amount,
                    before_balance, after_balance, status, reference, metadata)
                 VALUES ($1, $2, $3, 'jackpot_entry', $4, $5, $6, $7,
                         'completed', $8, $9::jsonb)`,
                [
                  scope.tenantId,
                  scope.userId,
                  w.id,
                  currency,
                  -stakePerTicket,
                  before - n * stakePerTicket,
                  before - (n + 1) * stakePerTicket,
                  `jackpot_entry:${ticket.id}`,
                  JSON.stringify({
                    jackpot_id: id,
                    jackpot_name: jackpot.name,
                    ticket_id: ticket.id,
                    receipt_n: n + 1,
                    receipt_of: body.quantity,
                  }),
                ]
              );
            }

            await client.query('COMMIT');
            return {
              jackpot_id: id,
              jackpot_name: jackpot.name,
              currency,
              quantity: body.quantity,
              total_stake: totalStake,
              wallet_balance_after: afterBalance,
              tickets,
            };
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          }
        }
      );

      void tryAudit(
        {
          tenantId: scope.tenantId,
          actorId: scope.userId,
          actorType: 'user',
          action: 'user.jackpot.enter',
          resource: 'jackpot',
          resourceId: id,
          payload: {
            quantity: body.quantity,
            total_stake: out.total_stake,
            ticket_ids: out.tickets.map((t) => t.id),
          },
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          status: 'success',
        },
        { bypassRls: true }
      );

      emitWalletUpdated(scope.tenantId, scope.userId, {
        reason: 'jackpot_entry',
        wallet: { balance: out.wallet_balance_after.toString(), currency: out.currency },
      });

      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
