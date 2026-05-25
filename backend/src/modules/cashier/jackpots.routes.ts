/**
 * Cashier jackpot module — Section 16.
 *
 * Routes (mounted under `/api/cashier/jackpots`):
 *
 *   GET  /active            — list jackpots currently on sale at the branch
 *   GET  /today             — tickets this cashier sold today
 *   POST /:id/sell          — sell a jackpot entry ticket
 *
 * A jackpot is a `tournaments` row (`kind = 'jackpot'`) — see the admin
 * module for the full data model. A jackpot ticket is a `sportsbook_bets`
 * row with `bet_type = 'jackpot'`, `channel = 'offline'`, and the
 * cashier / branch attribution columns populated.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { getCashierScope, getIp, getUa } from './cashier-shared';
import * as swagger from '../../swagger/registry';

const router = Router();

interface JackpotRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: string;
  starts_at: Date | null;
  ends_at: Date | null;
  entry_fee: string;
  prize_pool: string;
  currency: string;
  max_entries: number | null;
  rules: Record<string, unknown>;
  created_at: Date;
}

const JACKPOT_COLS = `
  id, tenant_id, name, description, status, starts_at, ends_at,
  entry_fee::text AS entry_fee,
  prize_pool::text AS prize_pool,
  currency, max_entries, rules, created_at
`;

async function loadActiveJackpots(client: PoolClient, tenantId: string) {
  const r = await client.query<JackpotRow & { tickets_sold: string }>(
    `SELECT ${JACKPOT_COLS},
            (SELECT COUNT(*)::text FROM sportsbook_bets sb
              WHERE sb.jackpot_id = tournaments.id) AS tickets_sold
       FROM tournaments
      WHERE tenant_id = $1
        AND kind = 'jackpot'
        AND status IN ('scheduled', 'running')
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at > now())
      ORDER BY COALESCE(ends_at, starts_at, created_at) ASC`,
    [tenantId]
  );
  return r.rows;
}

/* ----------------------------------------------------------------------- */
/* GET /active                                                             */
/* ----------------------------------------------------------------------- */

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/jackpots/active',
  summary: 'Active jackpots a cashier can sell tickets for',
  tags: ['Cashier Jackpots'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Active jackpots' } },
});

router.get('/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getCashierScope(req);
    const rows = await withTenantClient(
      { tenantId: scope.tenantId, readOnly: true },
      async (client) => loadActiveJackpots(client, scope.tenantId)
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------------------------------------------- */
/* GET /today — this cashier's sold jackpot tickets today                  */
/* ----------------------------------------------------------------------- */

const todayQuery = z.object({
  mine: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/jackpots/today',
  summary: 'Jackpot tickets sold by this cashier today',
  tags: ['Cashier Jackpots'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: "Today's jackpot tickets" } },
});

router.get('/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = todayQuery.parse(req.query);
    const scope = getCashierScope(req);
    const rows = await withTenantClient(
      { tenantId: scope.tenantId, readOnly: true },
      async (client) => {
        const filters: string[] = [
          'sb.tenant_id = $1',
          "sb.bet_type = 'jackpot'",
          "sb.placed_at >= date_trunc('day', now())",
        ];
        const values: unknown[] = [scope.tenantId];
        let i = 2;
        if (q.mine !== false) {
          filters.push(`sb.cashier_id = $${i++}`);
          values.push(scope.cashierId);
        }
        const where = `WHERE ${filters.join(' AND ')}`;
        const list = await client.query(
          `SELECT sb.id, sb.tenant_id, sb.user_id, sb.cashier_id,
                  sb.channel::text AS channel,
                  sb.stake::text AS stake,
                  sb.currency,
                  sb.potential_payout::text AS potential_payout,
                  sb.status, sb.jackpot_id,
                  sb.placed_at, sb.settled_at,
                  sb.ticket_code,
                  sb.metadata,
                  t.name AS jackpot_name
             FROM sportsbook_bets sb
             LEFT JOIN tournaments t ON t.id = sb.jackpot_id
             ${where}
             ORDER BY sb.placed_at DESC
             LIMIT 200`,
          values
        );
        return list.rows;
      }
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------------------------------------------- */
/* POST /:id/sell                                                          */
/* ----------------------------------------------------------------------- */

const sellSchema = z.object({
  /** Optional override of the entry fee (must match jackpot.entry_fee). */
  stake: z.union([z.string(), z.number()]).optional(),
  /** Phone of the player the cashier is buying on behalf of. */
  player_phone: z.string().trim().min(6).max(32).optional(),
  /** Numeric quantity of tickets (e.g. cashier sells 3 entries). */
  quantity: z.coerce.number().int().min(1).max(50).default(1),
  /** Optional selections / pick metadata to attach to the ticket. */
  selections: z.array(z.record(z.unknown())).optional(),
});

const idParam = z.object({
  id: z.string().uuid(),
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/jackpots/{id}/sell',
  summary: 'Sell one or more jackpot entry tickets',
  tags: ['Cashier Jackpots'],
  security: [{ bearerAuth: [] }],
  responses: {
    '201': { description: 'Jackpot ticket(s) created' },
    '404': { description: 'Jackpot not found / not active' },
  },
});

router.post('/:id/sell', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getCashierScope(req);
    const { id } = idParam.parse(req.params);
    const body = sellSchema.parse(req.body ?? {});

    const out = await withTenantClient(
      { tenantId: scope.tenantId },
      async (client) => {
        await client.query('BEGIN');
        try {
          // Lock the jackpot row so concurrent sells can't oversell.
          const j = await client.query<JackpotRow>(
            `SELECT ${JACKPOT_COLS} FROM tournaments
              WHERE id = $1 AND tenant_id = $2 AND kind = 'jackpot'
              FOR UPDATE`,
            [id, scope.tenantId]
          );
          const jackpot = j.rows[0];
          if (!jackpot) throw new NotFoundError('Jackpot not found');
          if (!['scheduled', 'running'].includes(jackpot.status)) {
            throw new BadRequestError(
              `Jackpot is not on sale (status: ${jackpot.status})`,
              { reason: 'jackpot_inactive' }
            );
          }
          if (jackpot.starts_at && jackpot.starts_at > new Date()) {
            throw new BadRequestError('Jackpot has not started yet', {
              reason: 'jackpot_not_started',
            });
          }
          if (jackpot.ends_at && jackpot.ends_at <= new Date()) {
            throw new BadRequestError('Jackpot sales are closed', {
              reason: 'jackpot_ended',
            });
          }

          // Enforce max_entries.
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

          // Resolve cashier's branch_id for attribution.
          const meta = await client.query<{
            metadata: Record<string, unknown>;
          }>(
            `SELECT metadata FROM users WHERE id = $1`,
            [scope.cashierId]
          );
          const branchId =
            (meta.rows[0]?.metadata?.['branch_id'] as string | undefined) ??
            null;

          // The "user" of the bet row: when the cashier sells to a
          // walk-in we attribute to the cashier themselves so the
          // bet has a valid FK; the actual phone the ticket was sold
          // to is recorded in `bet_for_user_phone`.
          const stake = body.stake
            ? Number(body.stake)
            : Number(jackpot.entry_fee);
          if (!Number.isFinite(stake) || stake < 0) {
            throw new BadRequestError('Stake must be a non-negative number', {
              reason: 'invalid_stake',
            });
          }
          const totalStake = stake * body.quantity;

          // Insert one row per requested quantity so each is its own
          // printable ticket. Cap at 50 by the schema.
          const created: Array<{
            id: string;
            ticket_code: string;
            stake: string;
            currency: string;
          }> = [];
          for (let n = 0; n < body.quantity; n++) {
            const row = await client.query<{
              id: string;
              ticket_code: string;
              stake: string;
              currency: string;
            }>(
              `INSERT INTO sportsbook_bets
                 (tenant_id, user_id, channel, bet_type, cashier_id,
                  bet_for_user_phone, stake, currency, potential_payout,
                  jackpot_id, metadata, sold_at, sold_by_cashier_id,
                  sold_branch_id)
               VALUES ($1, $2, 'offline', 'jackpot', $2, $3,
                       $4, $5, 0, $6, $7::jsonb,
                       now(), $2, $8)
               RETURNING id, ticket_code, stake::text AS stake, currency`,
              [
                scope.tenantId,
                scope.cashierId,
                body.player_phone ?? null,
                stake.toFixed(2),
                jackpot.currency,
                id,
                JSON.stringify({
                  jackpot_name: jackpot.name,
                  selections: body.selections ?? [],
                  player_phone: body.player_phone ?? null,
                  receipt_n: n + 1,
                  receipt_of: body.quantity,
                }),
                branchId,
              ]
            );
            created.push(row.rows[0]);
          }

          // Record the cashier-side transaction (one row total for the sale).
          await client.query(
            `INSERT INTO cashier_transactions
               (tenant_id, cashier_id, user_id, branch_id, type, amount,
                currency, status, reference, metadata, completed_at)
             VALUES ($1,$2,$2,$3,'jackpot_sell',$4,$5,'completed',$6,$7::jsonb, now())`,
            [
              scope.tenantId,
              scope.cashierId,
              branchId,
              totalStake.toFixed(2),
              jackpot.currency,
              `jackpot_sell:${id}:${created[0]?.id ?? 'na'}`,
              JSON.stringify({
                jackpot_id: id,
                jackpot_name: jackpot.name,
                quantity: body.quantity,
                player_phone: body.player_phone ?? null,
                ticket_ids: created.map((c) => c.id),
              }),
            ]
          );

          await client.query('COMMIT');
          return {
            jackpot_id: id,
            jackpot_name: jackpot.name,
            currency: jackpot.currency,
            quantity: body.quantity,
            total_stake: totalStake,
            tickets: created,
          };
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    );

    await tryAudit(
      {
        tenantId: scope.tenantId,
        actorId: scope.cashierId,
        actorType: 'cashier',
        action: 'cashier.jackpot.sell',
        resource: 'jackpot',
        resourceId: out.jackpot_id,
        payload: {
          quantity: out.quantity,
          total_stake: out.total_stake,
          ticket_ids: out.tickets.map((t) => t.id),
        },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );

    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
