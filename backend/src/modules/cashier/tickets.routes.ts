/**
 * Cashier tickets module — Section 16.
 *
 * Routes (all mounted under `/api/cashier/tickets`):
 *
 *   GET    /:ticketId                     lookup ticket (sell preview / lookup)
 *   GET    /:ticketId/check-payout        evaluate payout eligibility
 *   POST   /:ticketId/sell                mark the ticket sold by this cashier
 *                                          (called when the cashier prints
 *                                           the receipt for Flow A / Flow B)
 *   POST   /:ticketId/payout              pay a winning ticket
 *   POST   /:ticketId/cancel              cancel a pending ticket, refund stake
 *   GET    /                              list today's tickets for this cashier
 *
 * Ticket identifier:
 *   The frontend accepts either the human-readable `ticket_code`
 *   (TKT-YYMMDD-XXXXXXXX, surfaced on the printed receipt) or the raw
 *   UUID. Both are resolved against the `bets` table.
 *
 * Status mapping (DB → spec):
 *   pending / accepted             → "pending"
 *   won (no paid_at)               → "won"
 *   partial_won (no paid_at)       → "won"
 *   cashed_out (no paid_at)        → "cashback"
 *   lost                           → "lost"
 *   void / cancelled               → "void"
 *   any state + paid_at IS NOT NULL → "already_paid"
 *   any unpaid state + now > expires_at → "expired"
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
import { loadGeneralConfig } from '../admin/settings/general-config';
import {
  computeTicketExpiresAt,
  getTicketExpiryDays,
} from '../admin/settings/business-settings';
import { getCashierScope, getIp, getUa } from './cashier-shared';
import * as swagger from '../../swagger/registry';

const router = Router();

/* ----------------------------------------------------------------------- */
/* Shared types and helpers                                                */
/* ----------------------------------------------------------------------- */

interface BetRow {
  id: string;
  tenant_id: string;
  user_id: string;
  ticket_code: string;
  stake: string;
  potential_win: string;
  payout: string | null;
  cashback_amount: string;
  currency: string;
  status: string;
  placed_at: Date;
  settled_at: Date | null;
  sold_at: Date | null;
  sold_by_cashier_id: string | null;
  sold_branch_id: string | null;
  paid_at: Date | null;
  paid_by_cashier_id: string | null;
  paid_branch_id: string | null;
  cancelled_at: Date | null;
  metadata: Record<string, unknown>;
  result: Record<string, unknown> | null;
  user_phone: string | null;
  user_email: string | null;
}

const BET_COLS = `
  b.id, b.tenant_id, b.user_id, b.ticket_code,
  b.stake::text          AS stake,
  b.potential_win::text  AS potential_win,
  b.payout::text         AS payout,
  b.cashback_amount::text AS cashback_amount,
  b.currency, b.status,
  b.placed_at, b.settled_at,
  b.sold_at, b.sold_by_cashier_id, b.sold_branch_id,
  b.paid_at, b.paid_by_cashier_id, b.paid_branch_id,
  b.cancelled_at, b.metadata, b.result,
  u.phone AS user_phone, u.email AS user_email
`;

/**
 * Resolve a ticket by ticket_code OR by raw UUID. `bets` carries both
 * the auto-generated `ticket_code` and the canonical `id`; cashiers
 * may scan/type either, so we try both.
 */
async function loadTicket(
  client: PoolClient,
  tenantId: string,
  identifier: string
): Promise<BetRow | null> {
  const trimmed = identifier.trim();
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed
    );
  if (isUuid) {
    const r = await client.query<BetRow>(
      `SELECT ${BET_COLS}
         FROM bets b
         LEFT JOIN users u ON u.id = b.user_id
        WHERE b.tenant_id = $1 AND b.id = $2
        LIMIT 1`,
      [tenantId, trimmed]
    );
    if (r.rows[0]) return r.rows[0];
  }
  const r2 = await client.query<BetRow>(
    `SELECT ${BET_COLS}
       FROM bets b
       LEFT JOIN users u ON u.id = b.user_id
      WHERE b.tenant_id = $1 AND b.ticket_code = $2
      LIMIT 1`,
    [tenantId, trimmed.toUpperCase()]
  );
  return r2.rows[0] ?? null;
}

type PayoutStatus =
  | 'pending'
  | 'won'
  | 'cashback'
  | 'lost'
  | 'void'
  | 'expired'
  | 'already_paid';

interface PayoutEvaluation {
  status: PayoutStatus;
  payout_amount: number;
  stake: number;
  cashback_amount: number;
  issued_at: string;
  expires_at: string;
  expired: boolean;
  expiry_days: number;
  /**
   * Raw db status preserved for clients that want to display extra
   * context (e.g. "partial_won" → still a win, just a partial payout).
   */
  raw_status: string;
}

function num(v: string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Apply the spec's payout state machine to a raw bet row.
 *
 * Note: `expires_at` is computed from the **placement** time + the
 * current value of `ticket_expiry_days`. The spec calls out that
 * already-issued tickets retain their original expiry; the placement
 * time never changes, and admins who change the setting only affect
 * *new* tickets going forward — which matches this calculation.
 */
function evaluatePayout(bet: BetRow, expiryDays: number): PayoutEvaluation {
  const placedAt = bet.placed_at;
  const expiresAt = computeTicketExpiresAt(placedAt, expiryDays);
  const stake = num(bet.stake);
  const cashback = num(bet.cashback_amount);
  const rawStatus = bet.status;
  const isPaid = !!bet.paid_at;

  // Already paid – take precedence over everything else (idempotent
  // safety net for the double-payout case).
  if (isPaid) {
    return {
      status: 'already_paid',
      payout_amount: num(bet.payout),
      stake,
      cashback_amount: cashback,
      issued_at: placedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      expired: Date.now() > expiresAt.getTime(),
      expiry_days: expiryDays,
      raw_status: rawStatus,
    };
  }

  const lossStates = new Set(['lost']);
  const voidStates = new Set(['void', 'cancelled']);
  const winStates = new Set(['won', 'partial_won']);
  const cashbackStates = new Set(['cashed_out']);

  let status: PayoutStatus;
  let payout = 0;

  if (winStates.has(rawStatus)) {
    status = 'won';
    payout = num(bet.payout) || num(bet.potential_win);
  } else if (cashbackStates.has(rawStatus)) {
    status = 'cashback';
    payout = num(bet.payout) || cashback || stake; // sensible fallback
  } else if (lossStates.has(rawStatus)) {
    status = 'lost';
  } else if (voidStates.has(rawStatus)) {
    status = 'void';
    payout = stake; // void refunds the stake
  } else {
    // pending / accepted
    status = 'pending';
  }

  // Expiry check is only meaningful for outcomes that would otherwise
  // produce a payout. A lost or void ticket reaching its expiry is
  // still informational only.
  const now = new Date();
  const expired = now > expiresAt;
  if (expired && (status === 'won' || status === 'cashback')) {
    status = 'expired';
    payout = 0;
  }

  return {
    status,
    payout_amount: payout,
    stake,
    cashback_amount: cashback,
    issued_at: placedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    expired,
    expiry_days: expiryDays,
    raw_status: rawStatus,
  };
}

/**
 * Map a BetRow into the shape the cashier panel renders.
 *
 * Includes selections (when available in `metadata.selections` /
 * `result.selections`), the calculated payout window and the lifecycle
 * audit (sold_by/paid_by). Heavy on optional fields because user-panel
 * sport bets, casino bets and jackpot tickets all funnel through the
 * same `bets` table.
 */
function presentTicket(bet: BetRow, evaluation: PayoutEvaluation) {
  const meta = bet.metadata ?? {};
  const result = bet.result ?? {};
  return {
    ticket_id: bet.ticket_code,
    bet_id: bet.id,
    user_id: bet.user_id,
    user_phone: bet.user_phone,
    user_email: bet.user_email,
    stake: num(bet.stake),
    potential_win: num(bet.potential_win),
    currency: bet.currency,
    status: evaluation.status,
    raw_status: evaluation.raw_status,
    payout_amount: evaluation.payout_amount,
    cashback_amount: evaluation.cashback_amount,
    issued_at: evaluation.issued_at,
    expires_at: evaluation.expires_at,
    expired: evaluation.expired,
    expiry_days: evaluation.expiry_days,
    sold_at: bet.sold_at?.toISOString() ?? null,
    sold_by_cashier_id: bet.sold_by_cashier_id,
    sold_branch_id: bet.sold_branch_id,
    paid_at: bet.paid_at?.toISOString() ?? null,
    paid_by_cashier_id: bet.paid_by_cashier_id,
    paid_branch_id: bet.paid_branch_id,
    selections:
      (Array.isArray((meta as { selections?: unknown }).selections) &&
        ((meta as { selections: unknown[] }).selections as unknown[])) ||
      (Array.isArray((result as { selections?: unknown }).selections) &&
        ((result as { selections: unknown[] }).selections as unknown[])) ||
      [],
    metadata: meta,
    placed_at: bet.placed_at.toISOString(),
  };
}

/* ----------------------------------------------------------------------- */
/* Routes                                                                  */
/* ----------------------------------------------------------------------- */

const paramSchema = z.object({
  ticketId: z.string().trim().min(8).max(128),
});

const listQuerySchema = z.object({
  date: z.enum(['today', 'yesterday']).optional(),
  mine: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  status: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/tickets/{ticketId}',
  summary: 'Look up a ticket by code or UUID',
  tags: ['Cashier Tickets'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Ticket preview' }, '404': { description: 'Not found' } },
});

router.get(
  '/:ticketId/check-payout',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketId } = paramSchema.parse(req.params);
      const scope = getCashierScope(req);
      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          const bet = await loadTicket(client, scope.tenantId, ticketId);
          if (!bet) throw new NotFoundError('Ticket not found');
          const expiryDays = await getTicketExpiryDays(
            client,
            scope.tenantId
          );
          const evaluation = evaluatePayout(bet, expiryDays);
          return {
            ticket_id: bet.ticket_code,
            bet_id: bet.id,
            status: evaluation.status,
            payout_amount: evaluation.payout_amount,
            cashback_amount: evaluation.cashback_amount,
            stake: evaluation.stake,
            issued_at: evaluation.issued_at,
            expires_at: evaluation.expires_at,
            expired: evaluation.expired,
            expiry_days: evaluation.expiry_days,
            raw_status: evaluation.raw_status,
            currency: bet.currency,
            paid_at: bet.paid_at?.toISOString() ?? null,
          };
        }
      );
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:ticketId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketId } = paramSchema.parse(req.params);
      const scope = getCashierScope(req);
      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          const bet = await loadTicket(client, scope.tenantId, ticketId);
          if (!bet) throw new NotFoundError('Ticket not found');
          const expiryDays = await getTicketExpiryDays(client, scope.tenantId);
          const evaluation = evaluatePayout(bet, expiryDays);
          return presentTicket(bet, evaluation);
        }
      );
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/tickets/{ticketId}/sell',
  summary: 'Mark a ticket sold by this cashier (Flow A/B print)',
  tags: ['Cashier Tickets'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Ticket marked sold' } },
});

router.post(
  '/:ticketId/sell',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketId } = paramSchema.parse(req.params);
      const scope = getCashierScope(req);

      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          const bet = await loadTicket(client, scope.tenantId, ticketId);
          if (!bet) throw new NotFoundError('Ticket not found');
          // Idempotent: if it's already sold (by anyone), surface the existing
          // marking without overwriting.
          if (bet.sold_at && bet.sold_by_cashier_id) {
            const expiryDays = await getTicketExpiryDays(
              client,
              scope.tenantId
            );
            return {
              already_sold: true,
              ticket: presentTicket(
                bet,
                evaluatePayout(bet, expiryDays)
              ),
            };
          }

          // Resolve the cashier's branch_id from users.metadata.
          const meta = await client.query<{ metadata: Record<string, unknown> }>(
            `SELECT metadata FROM users WHERE id = $1`,
            [scope.cashierId]
          );
          const branchId =
            (meta.rows[0]?.metadata?.['branch_id'] as string | undefined) ??
            null;

          const upd = await client.query<BetRow>(
            `UPDATE bets b
                SET sold_at = now(),
                    sold_by_cashier_id = $2,
                    sold_branch_id = $3
              FROM users u
             WHERE u.id = b.user_id
               AND b.id = $1
             RETURNING ${BET_COLS}`,
            [bet.id, scope.cashierId, branchId]
          );
          const expiryDays = await getTicketExpiryDays(client, scope.tenantId);

          // Log a cashier_transactions row so the dashboard counts it.
          // Idempotency is already guaranteed by the `already_sold` early
          // return above; the unique index on (tenant_id, reference) is
          // a defence-in-depth backstop should two requests race past it.
          try {
            await client.query(
              `INSERT INTO cashier_transactions
                 (tenant_id, cashier_id, user_id, branch_id, type, amount,
                  currency, status, reference, metadata, completed_at)
               VALUES ($1,$2,$3,$4,'ticket_sell',$5,$6,'completed',$7,$8::jsonb, now())`,
              [
                scope.tenantId,
                scope.cashierId,
                bet.user_id,
                branchId,
                num(bet.stake),
                bet.currency,
                `ticket_sell:${bet.id}`,
                JSON.stringify({
                  ticket_code: bet.ticket_code,
                  bet_id: bet.id,
                }),
              ]
            );
          } catch (err) {
            const code = (err as { code?: string }).code;
            if (code !== '23505') throw err; // anything except unique-violation
          }

          return {
            already_sold: false,
            ticket: presentTicket(
              upd.rows[0] ?? bet,
              evaluatePayout(upd.rows[0] ?? bet, expiryDays)
            ),
          };
        }
      );

      await tryAudit(
        {
          tenantId: scope.tenantId,
          actorId: scope.cashierId,
          actorType: 'cashier',
          action: 'cashier.ticket.sell',
          resource: 'bet',
          resourceId: out.ticket.bet_id,
          payload: { ticket_code: out.ticket.ticket_id, idempotent: out.already_sold },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );

      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/tickets/{ticketId}/payout',
  summary: 'Pay a winning or cashback ticket',
  tags: ['Cashier Tickets'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Paid out' },
    '409': { description: 'Already paid / not eligible' },
  },
});

router.post(
  '/:ticketId/payout',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketId } = paramSchema.parse(req.params);
      const scope = getCashierScope(req);

      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          await client.query('BEGIN');
          try {
            // Re-load FOR UPDATE so concurrent payouts don't double-pay.
            const lockRes = await client.query<BetRow>(
              `SELECT ${BET_COLS}
                 FROM bets b
                 LEFT JOIN users u ON u.id = b.user_id
                WHERE b.tenant_id = $1
                  AND (b.id::text = $2 OR b.ticket_code = $3)
                FOR UPDATE OF b`,
              [scope.tenantId, ticketId, ticketId.toUpperCase()]
            );
            const bet = lockRes.rows[0];
            if (!bet) throw new NotFoundError('Ticket not found');

            const expiryDays = await getTicketExpiryDays(
              client,
              scope.tenantId
            );
            const evaluation = evaluatePayout(bet, expiryDays);

            if (evaluation.status === 'already_paid') {
              throw new ConflictError('This ticket has already been paid out.', {
                reason: 'already_paid',
                paid_at: bet.paid_at?.toISOString() ?? null,
              });
            }
            if (
              evaluation.status !== 'won' &&
              evaluation.status !== 'cashback'
            ) {
              throw new BadRequestError(
                `Ticket is not eligible for payout (status: ${evaluation.status}).`,
                { reason: evaluation.status }
              );
            }
            if (evaluation.payout_amount <= 0) {
              throw new BadRequestError('Computed payout is zero.', {
                reason: 'zero_payout',
              });
            }

            // Resolve the cashier's branch_id from users.metadata.
            const meta = await client.query<{
              metadata: Record<string, unknown>;
            }>(
              `SELECT metadata FROM users WHERE id = $1`,
              [scope.cashierId]
            );
            const branchId =
              (meta.rows[0]?.metadata?.['branch_id'] as string | undefined) ??
              null;

            // Mark the ticket paid (idempotent guard at the DB level).
            const upd = await client.query<BetRow>(
              `UPDATE bets b
                  SET paid_at = now(),
                      paid_by_cashier_id = $2,
                      paid_branch_id = $3,
                      payout = COALESCE(payout, $4::numeric)
                FROM users u
                WHERE u.id = b.user_id
                  AND b.id = $1
                  AND b.paid_at IS NULL
                RETURNING ${BET_COLS}`,
              [bet.id, scope.cashierId, branchId, evaluation.payout_amount]
            );
            if (upd.rowCount === 0) {
              throw new ConflictError(
                'Ticket was paid by another session — refresh and retry.',
                { reason: 'race_already_paid' }
              );
            }
            const paid = upd.rows[0];

            // Record the cashier-side transaction. The reference is
            // deterministic per bet so accidental double-clicks short-
            // circuit via the unique index instead of paying twice.
            await client.query(
              `INSERT INTO cashier_transactions
                 (tenant_id, cashier_id, user_id, branch_id, type, amount,
                  currency, status, reference, metadata, completed_at)
               VALUES ($1,$2,$3,$4,'ticket_payout',$5,$6,'completed',$7,$8::jsonb, now())`,
              [
                scope.tenantId,
                scope.cashierId,
                bet.user_id,
                branchId,
                evaluation.payout_amount,
                bet.currency,
                `ticket_payout:${bet.id}`,
                JSON.stringify({
                  ticket_code: bet.ticket_code,
                  bet_id: bet.id,
                  reason: evaluation.status,
                }),
              ]
            );

            await client.query('COMMIT');
            return {
              ticket: presentTicket(paid, {
                ...evaluation,
                status: 'already_paid',
              }),
              paid_amount: evaluation.payout_amount,
              currency: bet.currency,
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
          action: 'cashier.ticket.payout',
          resource: 'bet',
          resourceId: out.ticket.bet_id,
          payload: { amount: out.paid_amount, ticket_code: out.ticket.ticket_id },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );

      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/tickets/{ticketId}/cancel',
  summary: 'Cancel a pending ticket and refund the stake',
  tags: ['Cashier Tickets'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Cancelled and refunded' } },
});

router.post(
  '/:ticketId/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketId } = paramSchema.parse(req.params);
      const scope = getCashierScope(req);

      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          await client.query('BEGIN');
          try {
            const lockRes = await client.query<BetRow>(
              `SELECT ${BET_COLS}
                 FROM bets b
                 LEFT JOIN users u ON u.id = b.user_id
                WHERE b.tenant_id = $1
                  AND (b.id::text = $2 OR b.ticket_code = $3)
                FOR UPDATE OF b`,
              [scope.tenantId, ticketId, ticketId.toUpperCase()]
            );
            const bet = lockRes.rows[0];
            if (!bet) throw new NotFoundError('Ticket not found');
            if (bet.paid_at) {
              throw new ConflictError('Cannot cancel a paid ticket.', {
                reason: 'already_paid',
              });
            }
            if (
              bet.status !== 'pending' &&
              bet.status !== 'accepted'
            ) {
              throw new BadRequestError(
                `Only pending tickets may be cancelled (status: ${bet.status}).`,
                { reason: 'not_pending' }
              );
            }

            // Section 19 — Cashier Config enforcement (cancel window,
            // stake cap, daily count, daily volume).
            const cfg = await loadGeneralConfig(client, scope.tenantId);
            const stakeNum = num(bet.stake);

            if (cfg.cashier_cancel_window_minutes > 0 && bet.placed_at) {
              const placedAt =
                bet.placed_at instanceof Date
                  ? bet.placed_at
                  : new Date(bet.placed_at as unknown as string);
              const elapsedMin =
                (Date.now() - placedAt.getTime()) / (60 * 1000);
              if (elapsedMin > cfg.cashier_cancel_window_minutes) {
                throw new BadRequestError(
                  `Cancel window of ${cfg.cashier_cancel_window_minutes} minutes has elapsed.`,
                  { reason: 'cancel_window_expired' }
                );
              }
            }
            if (
              cfg.cashier_max_stake_cancel > 0 &&
              stakeNum > cfg.cashier_max_stake_cancel
            ) {
              throw new BadRequestError(
                `Ticket stake exceeds the per-ticket cancel limit (${cfg.cashier_max_stake_cancel}).`,
                { reason: 'stake_above_cancel_limit' }
              );
            }
            if (
              cfg.cashier_max_daily_cancel_count > 0 ||
              cfg.cashier_max_daily_cancel_volume > 0
            ) {
              const todayStats = await client.query<{
                cancelled_count: string;
                cancelled_volume: string;
              }>(
                `SELECT
                    COUNT(*)::text                                       AS cancelled_count,
                    COALESCE(SUM(stake), 0)::text                         AS cancelled_volume
                   FROM bets
                  WHERE tenant_id = $1
                    AND cancelled_by_cashier_id = $2
                    AND cancelled_at >= date_trunc('day', now())
                    AND status = 'cancelled'`,
                [scope.tenantId, scope.cashierId]
              );
              const stats = todayStats.rows[0];
              const cancelledCount = Number(stats?.cancelled_count ?? 0);
              const cancelledVolume = Number(stats?.cancelled_volume ?? 0);
              if (
                cfg.cashier_max_daily_cancel_count > 0 &&
                cancelledCount + 1 > cfg.cashier_max_daily_cancel_count
              ) {
                throw new BadRequestError(
                  `Daily cancel count limit (${cfg.cashier_max_daily_cancel_count}) reached.`,
                  { reason: 'cancel_count_exceeded' }
                );
              }
              if (
                cfg.cashier_max_daily_cancel_volume > 0 &&
                cancelledVolume + stakeNum > cfg.cashier_max_daily_cancel_volume
              ) {
                throw new BadRequestError(
                  `Daily cancel volume limit (${cfg.cashier_max_daily_cancel_volume} ETB) reached.`,
                  { reason: 'cancel_volume_exceeded' }
                );
              }
            }

            const meta = await client.query<{
              metadata: Record<string, unknown>;
            }>(
              `SELECT metadata FROM users WHERE id = $1`,
              [scope.cashierId]
            );
            const branchId =
              (meta.rows[0]?.metadata?.['branch_id'] as string | undefined) ??
              null;

            const upd = await client.query<BetRow>(
              `UPDATE bets b
                  SET status = 'cancelled',
                      cancelled_at = now(),
                      cancelled_by_cashier_id = $2,
                      settled_at = now()
                FROM users u
                WHERE u.id = b.user_id
                  AND b.id = $1
                RETURNING ${BET_COLS}`,
              [bet.id, scope.cashierId]
            );

            // Refund the stake to the user's wallet (best-effort: if no
            // wallet exists we still cancel; admin can adjust manually).
            const wallet = await client.query<{
              id: string;
              balance: string;
            }>(
              `SELECT id, balance::text FROM wallets
                WHERE user_id = $1 AND currency = $2
                ORDER BY created_at ASC LIMIT 1`,
              [bet.user_id, bet.currency]
            );
            if (wallet.rows[0]) {
              const before = Number(wallet.rows[0].balance);
              const after = before + num(bet.stake);
              await client.query(
                `UPDATE wallets SET balance = $1, updated_at = now() WHERE id = $2`,
                [after.toFixed(4), wallet.rows[0].id]
              );
              await client.query(
                `INSERT INTO transactions
                   (tenant_id, user_id, wallet_id, type, currency, amount,
                    before_balance, after_balance, status, reference, metadata)
                 VALUES ($1,$2,$3,'bet_refund',$4,$5,$6,$7,'completed',$8,$9::jsonb)`,
                [
                  scope.tenantId,
                  bet.user_id,
                  wallet.rows[0].id,
                  bet.currency,
                  num(bet.stake),
                  before.toFixed(4),
                  after.toFixed(4),
                  `ticket_cancel_refund:${bet.id}`,
                  JSON.stringify({
                    ticket_code: bet.ticket_code,
                    bet_id: bet.id,
                  }),
                ]
              );
            }

            await client.query(
              `INSERT INTO cashier_transactions
                 (tenant_id, cashier_id, user_id, branch_id, type, amount,
                  currency, status, reference, metadata, completed_at)
               VALUES ($1,$2,$3,$4,'ticket_cancel',$5,$6,'completed',$7,$8::jsonb, now())`,
              [
                scope.tenantId,
                scope.cashierId,
                bet.user_id,
                branchId,
                num(bet.stake),
                bet.currency,
                `ticket_cancel:${bet.id}`,
                JSON.stringify({
                  ticket_code: bet.ticket_code,
                  bet_id: bet.id,
                }),
              ]
            );

            await client.query('COMMIT');
            const expiryDays = await getTicketExpiryDays(
              client,
              scope.tenantId
            );
            return {
              ticket: presentTicket(
                upd.rows[0] ?? bet,
                evaluatePayout(upd.rows[0] ?? bet, expiryDays)
              ),
              refunded: num(bet.stake),
              currency: bet.currency,
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
          action: 'cashier.ticket.cancel',
          resource: 'bet',
          resourceId: out.ticket.bet_id,
          payload: {
            ticket_code: out.ticket.ticket_id,
            refunded: out.refunded,
          },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );

      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/tickets',
  summary: "List today's tickets sold by this cashier",
  tags: ['Cashier Tickets'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Tickets list' } },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const scope = getCashierScope(req);
    const out = await withTenantClient(
      { tenantId: scope.tenantId },
      async (client) => {
        const filters: string[] = ['b.tenant_id = $1'];
        const values: unknown[] = [scope.tenantId];
        let i = 2;

        if (q.mine) {
          // Either sold or paid by this cashier appears in their "today" list.
          filters.push(
            `(b.sold_by_cashier_id = $${i} OR b.paid_by_cashier_id = $${i})`
          );
          values.push(scope.cashierId);
          i++;
        }
        if (q.date === 'today') {
          filters.push(
            `(b.sold_at >= date_trunc('day', now()) OR b.placed_at >= date_trunc('day', now()))`
          );
        } else if (q.date === 'yesterday') {
          filters.push(
            `b.placed_at >= date_trunc('day', now()) - interval '1 day' AND b.placed_at < date_trunc('day', now())`
          );
        }
        if (q.status) {
          filters.push(`b.status = $${i++}`);
          values.push(q.status);
        }
        const where = `WHERE ${filters.join(' AND ')}`;

        const total = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM bets b ${where}`,
          values
        );
        const rows = await client.query<BetRow>(
          `SELECT ${BET_COLS}
             FROM bets b
             LEFT JOIN users u ON u.id = b.user_id
             ${where}
             ORDER BY COALESCE(b.sold_at, b.placed_at) DESC
             LIMIT $${i++} OFFSET $${i++}`,
          [...values, q.limit, (q.page - 1) * q.limit]
        );

        const expiryDays = await getTicketExpiryDays(client, scope.tenantId);
        return {
          items: rows.rows.map((bet) =>
            presentTicket(bet, evaluatePayout(bet, expiryDays))
          ),
          total: Number(total.rows[0]?.count ?? 0),
          page: q.page,
          limit: q.limit,
          expiry_days: expiryDays,
        };
      }
    );
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
