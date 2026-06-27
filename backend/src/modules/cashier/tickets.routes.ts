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
 *   The frontend accepts ANY of the following codes, in any case:
 *     - `printed_ticket_code` (TKT-{BRANCH}-{YYYYMMDD}-{SEQ}, on receipts)
 *     - `ticket_code`          (TKT-XXXXXXXX, auto-generated)
 *     - `coupon_code`          (SBK-XXXXXXXX, shown to user-panel bettors
 *                               for sportsbook slips)
 *     - the raw bet UUID
 *   The lookup spans BOTH the internal-game `bets` table and the
 *   sportsbook `sportsbook_bets` table so a user can place a multi-leg
 *   slip on the user panel ("Launch Fixtures" from the cashier kiosk)
 *   and the cashier can sell / pay / cancel it by pasting the code.
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
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { loadGeneralConfig } from '../admin/settings/general-config';
import {
  computeTicketExpiresAt,
  getTicketExpiryDays,
} from '../admin/settings/business-settings';
import { getCashierScope, getIp, getUa } from './cashier-shared';
import { requirePermission } from '../../middleware/require-permission';
import { emitWalletUpdated } from '../../realtime/socket';
import * as swagger from '../../swagger/registry';

const router = Router();

/* ----------------------------------------------------------------------- */
/* Shared types and helpers                                                */
/* ----------------------------------------------------------------------- */

/**
 * Tagged source so downstream UPDATE statements know which table to
 * touch. `bets` holds internal-game/casino tickets, `sportsbook_bets`
 * holds user-panel + cashier-kiosk multi-leg sports slips.
 */
type TicketSource = 'bets' | 'sportsbook_bets';

interface BetRow {
  source: TicketSource;
  id: string;
  tenant_id: string;
  user_id: string;
  ticket_code: string;
  printed_ticket_code: string | null;
  coupon_code: string | null;
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

/** Column list for the internal `bets` table (casino, internal games). */
const BET_COLS_INTERNAL = `
  'bets'::text AS source,
  b.id, b.tenant_id, b.user_id, b.ticket_code, b.printed_ticket_code,
  NULL::text             AS coupon_code,
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
 * Column list for `sportsbook_bets` (multi-leg sports slips). Columns
 * are aliased into the same shape as `bets` so downstream code stays
 * uniform:
 *   - `potential_payout`  → `potential_win`
 *   - `actual_payout`     → `payout`
 *   - no `result` column  → NULL
 *   - additionally exposes `coupon_code` (SBK-XXXXXXXX) since that's
 *     the identifier the user-panel UI surfaces to bettors.
 */
const BET_COLS_SPORTSBOOK = `
  'sportsbook_bets'::text AS source,
  b.id, b.tenant_id, b.user_id, b.ticket_code, b.printed_ticket_code,
  b.coupon_code,
  b.stake::text             AS stake,
  b.potential_payout::text  AS potential_win,
  b.actual_payout::text     AS payout,
  b.cashback_amount::text   AS cashback_amount,
  b.currency, b.status,
  b.placed_at, b.settled_at,
  b.sold_at, b.sold_by_cashier_id, b.sold_branch_id,
  b.paid_at, b.paid_by_cashier_id, b.paid_branch_id,
  b.cancelled_at, b.metadata, NULL::jsonb AS result,
  u.phone AS user_phone, u.email AS user_email
`;

/**
 * Try to match an identifier against any of the human-readable codes
 * we surface to cashiers:
 *   - bare UUID (canonical bet id)
 *   - printed_ticket_code (TKT-{BRANCH}-{YYYYMMDD}-{SEQ})
 *   - ticket_code         (TKT-XXXXXXXX)
 *   - coupon_code         (SBK-XXXXXXXX, sportsbook only)
 *
 * Lookups are tried in both the `bets` and `sportsbook_bets` tables —
 * the user-panel "Launch Fixtures" path inserts into the latter and
 * the cashier MUST be able to find those tickets to sell / pay / void
 * them.
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
      `SELECT ${BET_COLS_INTERNAL}
         FROM bets b
         LEFT JOIN users u ON u.id = b.user_id
        WHERE b.tenant_id = $1 AND b.id = $2
        LIMIT 1`,
      [tenantId, trimmed]
    );
    if (r.rows[0]) return r.rows[0];

    const r2 = await client.query<BetRow>(
      `SELECT ${BET_COLS_SPORTSBOOK}
         FROM sportsbook_bets b
         LEFT JOIN users u ON u.id = b.user_id
        WHERE b.tenant_id = $1 AND b.id = $2
        LIMIT 1`,
      [tenantId, trimmed]
    );
    return r2.rows[0] ?? null;
  }

  // String identifier — normalize case once and try every code column
  // on both tables. printed_ticket_code (the customer receipt code) is
  // preferred when it matches; ticket_code / coupon_code are the
  // fallbacks for tickets that haven't been "sold" through a cashier
  // yet (so no printed code exists).
  const upper = trimmed.toUpperCase();

  const internal = await client.query<BetRow>(
    `SELECT ${BET_COLS_INTERNAL}
       FROM bets b
       LEFT JOIN users u ON u.id = b.user_id
      WHERE b.tenant_id = $1
        AND (
          b.printed_ticket_code = $2
          OR b.ticket_code = $2
        )
      LIMIT 1`,
    [tenantId, upper]
  );
  if (internal.rows[0]) return internal.rows[0];

  const sportsbook = await client.query<BetRow>(
    `SELECT ${BET_COLS_SPORTSBOOK}
       FROM sportsbook_bets b
       LEFT JOIN users u ON u.id = b.user_id
      WHERE b.tenant_id = $1
        AND (
          b.printed_ticket_code = $2
          OR b.ticket_code = $2
          OR b.coupon_code = $2
        )
      LIMIT 1`,
    [tenantId, upper]
  );
  return sportsbook.rows[0] ?? null;
}

/**
 * Cross-branch guard for cashier ticket actions (cancel / payout).
 *
 * The rule: a cashier may only cancel or pay tickets that were sold in
 * their OWN branch. `bet.sold_branch_id` is the authoritative branch
 * stamp set when the ticket was sold through a cashier; if it's missing
 * (e.g. online tickets, legacy slips) we fall back to resolving the
 * branch from `sold_by_cashier_id` (and finally `cashier_id`) via the
 * same `cashier_to_branch` join the reports module uses.
 *
 * Resolution chain for the ticket's branch:
 *   1. bet.sold_branch_id            (UUID of the branch user row)
 *   2. sold_by_cashier_id → users.metadata.branch_id  (matched to branches)
 *   3. cashier_id        → users.metadata.branch_id  (matched to branches)
 *
 * If neither the acting cashier nor the ticket has a resolvable branch,
 * the check is skipped (legacy / unattributed tickets remain actionable
 * to preserve backwards compatibility). When BOTH resolve and differ,
 * we throw `ForbiddenError` with the spec-mandated popup message.
 */
const CROSS_BRANCH_MESSAGE =
  'This ticket belongs to another branch. You are not authorized to cancel or pay this ticket.';

async function assertTicketBranchAccess(
  client: PoolClient,
  cashierId: string,
  bet: BetRow
): Promise<void> {
  // Resolve the acting cashier's branch UUID.
  const cashierMeta = await client.query<{
    metadata: Record<string, unknown>;
  }>(`SELECT metadata FROM users WHERE id = $1`, [cashierId]);
  const cashierBranchRaw =
    (cashierMeta.rows[0]?.metadata?.['branch_id'] as string | undefined) ??
    null;
  // Normalize: branch_id in metadata may be either a UUID or a human
  // branch code like "PC001". Resolve to the canonical branch user UUID
  // via the branches lookup so we can compare apples-to-apples.
  const cashierBranchId = await resolveBranchId(client, cashierBranchRaw);
  if (!cashierBranchId) {
    // Legacy cashier without branch attribution — no branch scope to
    // enforce. Allow the action to preserve backwards compatibility.
    return;
  }

  // Resolve the ticket's branch. Prefer the stamped `sold_branch_id`,
  // then fall back to the selling cashier's branch.
  let ticketBranchId: string | null = bet.sold_branch_id ?? null;
  if (!ticketBranchId && bet.sold_by_cashier_id) {
    const fb = await client.query<{
      metadata: Record<string, unknown>;
    }>(`SELECT metadata FROM users WHERE id = $1`, [bet.sold_by_cashier_id]);
    const fbBranchRaw =
      (fb.rows[0]?.metadata?.['branch_id'] as string | undefined) ??
      null;
    ticketBranchId = await resolveBranchId(client, fbBranchRaw);
  }

  if (!ticketBranchId) {
    // Ticket has no resolvable branch (online bet, legacy slip). No
    // cross-branch violation possible — allow.
    return;
  }

  if (ticketBranchId !== cashierBranchId) {
    throw new ForbiddenError(CROSS_BRANCH_MESSAGE, {
      reason: 'cross_branch',
      ticket_branch_id: ticketBranchId,
      cashier_branch_id: cashierBranchId,
    });
  }
}

/**
 * Resolve a `users.metadata.branch_id` value (which may be a UUID or a
 * human-readable branch code like "PC001") to the canonical branch user
 * UUID. Returns null when the value is empty or no matching branch is
 * found.
 */
async function resolveBranchId(
  client: PoolClient,
  raw: string | null | undefined
): Promise<string | null> {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const r = await client.query<{ id: string }>(
    `SELECT id FROM users
      WHERE role = 'branch'
        AND (id::text = $1 OR metadata->>'branch_id' = $1)
      LIMIT 1`,
    [trimmed]
  );
  return r.rows[0]?.id ?? null;
}

/**
 * Build the spec-format printed ticket code
 * (`TKT-{BRANCH}-{YYYYMMDD}-{SEQ}`) for a cashier sale.
 *
 *   - BRANCH defaults to `users.metadata.branch_id` (the human label
 *     like "PC001"). If absent we fall back to the first 6 chars of the
 *     branch UUID, or the literal "OFFLINE" if no branch is known.
 *   - YYYYMMDD is the sell date in UTC (matches the dedupe key the
 *     dashboard uses for "today's tickets").
 *   - SEQ is the count of tickets already sold by this branch on that
 *     UTC day plus one, zero-padded to four characters.
 */
async function generatePrintedTicketCode(
  client: PoolClient,
  params: {
    tenantId: string;
    branchId: string | null;
    branchLabel: string | null;
    soldAt: Date;
  }
): Promise<string> {
  const datePart = `${params.soldAt.getUTCFullYear()}${String(
    params.soldAt.getUTCMonth() + 1
  ).padStart(2, '0')}${String(params.soldAt.getUTCDate()).padStart(2, '0')}`;

  const branchCode = (
    params.branchLabel?.trim() ||
    params.branchId?.slice(0, 6).toUpperCase() ||
    'OFFLINE'
  )
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 12) || 'OFFLINE';

  // Section 24 Step 10 — the daily sequence is shared across BOTH
  // ticket sources (internal-game `bets` and sportsbook `sportsbook_bets`)
  // because a single branch sells from one queue regardless of stack.
  const countQ = await client.query<{ c: string }>(
    `SELECT (
        SELECT COUNT(*) FROM bets
         WHERE tenant_id = $1
           AND printed_ticket_code IS NOT NULL
           AND ($2::uuid IS NULL OR sold_branch_id = $2::uuid)
           AND ($2::uuid IS NOT NULL OR sold_branch_id IS NULL)
           AND sold_at::date = $3::date
      ) + (
        SELECT COUNT(*) FROM sportsbook_bets
         WHERE tenant_id = $1
           AND printed_ticket_code IS NOT NULL
           AND ($2::uuid IS NULL OR sold_branch_id = $2::uuid)
           AND ($2::uuid IS NOT NULL OR sold_branch_id IS NULL)
           AND sold_at::date = $3::date
      ) AS c`,
    [params.tenantId, params.branchId, params.soldAt.toISOString().slice(0, 10)]
  );
  const next = Number(countQ.rows[0]?.c ?? 0) + 1;
  const seq = String(next).padStart(4, '0');
  return `TKT-${branchCode}-${datePart}-${seq}`;
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
    // The printed receipt code (Section 24) takes precedence when set;
    // online tickets that were never sold via a cashier still surface
    // the auto-generated ticket_code so receipts and UI keep working.
    ticket_id: bet.printed_ticket_code ?? bet.ticket_code,
    ticket_code: bet.ticket_code,
    printed_ticket_code: bet.printed_ticket_code,
    coupon_code: bet.coupon_code,
    source: bet.source,
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
            ticket_id: bet.printed_ticket_code ?? bet.ticket_code,
            ticket_code: bet.ticket_code,
            printed_ticket_code: bet.printed_ticket_code,
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
  requirePermission('sell_tickets'),
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
          const branchMeta = meta.rows[0]?.metadata ?? {};
          const branchIdRaw = (branchMeta?.['branch_id'] as string | undefined) ?? null;
          // Validate UUID — the metadata.branch_id field can hold either
          // a UUID FK (newer admin flow) or a human label like "PC001"
          // (legacy seed data); we only persist the UUID to
          // sold_branch_id and keep the label for the printed code.
          const branchUuid =
            branchIdRaw &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              branchIdRaw
            )
              ? branchIdRaw
              : null;
          const branchLabel =
            (branchMeta?.['branch_label'] as string | undefined) ??
            (branchMeta?.['branch_code'] as string | undefined) ??
            (branchUuid ? null : branchIdRaw);

          // Section 24 Step 10 — generate the printed receipt code
          // (TKT-{BRANCH}-{YYYYMMDD}-{SEQ}) and stamp it onto the bet so
          // future lookups (and reprints) resolve to the same string.
          const now = new Date();
          const printedCode = await generatePrintedTicketCode(client, {
            tenantId: scope.tenantId,
            branchId: branchUuid,
            branchLabel,
            soldAt: now,
          });

          const upd =
            bet.source === 'sportsbook_bets'
              ? await client.query<BetRow>(
                  `UPDATE sportsbook_bets b
                      SET sold_at = $4,
                          sold_by_cashier_id = $2,
                          sold_branch_id = $3,
                          printed_ticket_code = $5
                    FROM users u
                   WHERE u.id = b.user_id
                     AND b.id = $1
                   RETURNING ${BET_COLS_SPORTSBOOK}`,
                  [bet.id, scope.cashierId, branchUuid, now, printedCode]
                )
              : await client.query<BetRow>(
                  `UPDATE bets b
                      SET sold_at = $4,
                          sold_by_cashier_id = $2,
                          sold_branch_id = $3,
                          printed_ticket_code = $5
                    FROM users u
                   WHERE u.id = b.user_id
                     AND b.id = $1
                   RETURNING ${BET_COLS_INTERNAL}`,
                  [bet.id, scope.cashierId, branchUuid, now, printedCode]
                );
          const branchId = branchUuid;
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
  requirePermission('can_payout'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketId } = paramSchema.parse(req.params);
      const scope = getCashierScope(req);

      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          await client.query('BEGIN');
          try {
            // Resolve the ticket first (across both tables) so we can
            // route the FOR UPDATE lock to the correct one. The
            // identifier accepts UUIDs, printed codes, ticket_code and
            // sportsbook coupon_code (SBK-...).
            const preload = await loadTicket(client, scope.tenantId, ticketId);
            if (!preload) throw new NotFoundError('Ticket not found');

            const lockRes =
              preload.source === 'sportsbook_bets'
                ? await client.query<BetRow>(
                    `SELECT ${BET_COLS_SPORTSBOOK}
                       FROM sportsbook_bets b
                       LEFT JOIN users u ON u.id = b.user_id
                      WHERE b.tenant_id = $1 AND b.id = $2
                      FOR UPDATE OF b`,
                    [scope.tenantId, preload.id]
                  )
                : await client.query<BetRow>(
                    `SELECT ${BET_COLS_INTERNAL}
                       FROM bets b
                       LEFT JOIN users u ON u.id = b.user_id
                      WHERE b.tenant_id = $1 AND b.id = $2
                      FOR UPDATE OF b`,
                    [scope.tenantId, preload.id]
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

            // Branch guard — cashiers may only pay out tickets sold in
            // their own branch. Throws ForbiddenError on mismatch.
            await assertTicketBranchAccess(client, scope.cashierId, bet);

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
            // sportsbook_bets stores the paid amount in `actual_payout`
            // rather than `payout`, so the UPDATE target depends on
            // which table the ticket came from.
            const upd =
              bet.source === 'sportsbook_bets'
                ? await client.query<BetRow>(
                    `UPDATE sportsbook_bets b
                        SET paid_at = now(),
                            paid_by_cashier_id = $2,
                            paid_branch_id = $3,
                            actual_payout = COALESCE(actual_payout, $4::numeric)
                      FROM users u
                      WHERE u.id = b.user_id
                        AND b.id = $1
                        AND b.paid_at IS NULL
                      RETURNING ${BET_COLS_SPORTSBOOK}`,
                    [bet.id, scope.cashierId, branchId, evaluation.payout_amount]
                  )
                : await client.query<BetRow>(
                    `UPDATE bets b
                        SET paid_at = now(),
                            paid_by_cashier_id = $2,
                            paid_branch_id = $3,
                            payout = COALESCE(payout, $4::numeric)
                      FROM users u
                      WHERE u.id = b.user_id
                        AND b.id = $1
                        AND b.paid_at IS NULL
                      RETURNING ${BET_COLS_INTERNAL}`,
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

/* ----------------------------------------------------------------------- */
/* Remove a single not-yet-started leg from a pending multi-leg ticket and  */
/* re-price it. Used when the customer changes their mind about one match   */
/* before the slip is paid out. Only legs whose match has not kicked off    */
/* can be dropped; the last remaining leg cannot be removed (cancel the     */
/* whole ticket instead).                                                   */
/* ----------------------------------------------------------------------- */

const removeLegSchema = z.object({
  index: z.coerce.number().int().min(0),
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/tickets/{ticketId}/remove-leg',
  summary: 'Remove a not-yet-started selection from a pending ticket and re-price it',
  tags: ['Cashier Tickets'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Leg removed; ticket re-priced' },
    '400': { description: 'Match started / last leg / not editable' },
  },
});

router.post(
  '/:ticketId/remove-leg',
  requirePermission('sell_tickets'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketId } = paramSchema.parse(req.params);
      const { index } = removeLegSchema.parse(req.body);
      const scope = getCashierScope(req);

      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          await client.query('BEGIN');
          try {
            const preload = await loadTicket(client, scope.tenantId, ticketId);
            if (!preload) throw new NotFoundError('Ticket not found');

            const lockRes =
              preload.source === 'sportsbook_bets'
                ? await client.query<BetRow>(
                    `SELECT ${BET_COLS_SPORTSBOOK}
                       FROM sportsbook_bets b
                       LEFT JOIN users u ON u.id = b.user_id
                      WHERE b.tenant_id = $1 AND b.id = $2
                      FOR UPDATE OF b`,
                    [scope.tenantId, preload.id]
                  )
                : await client.query<BetRow>(
                    `SELECT ${BET_COLS_INTERNAL}
                       FROM bets b
                       LEFT JOIN users u ON u.id = b.user_id
                      WHERE b.tenant_id = $1 AND b.id = $2
                      FOR UPDATE OF b`,
                    [scope.tenantId, preload.id]
                  );
            const bet = lockRes.rows[0];
            if (!bet) throw new NotFoundError('Ticket not found');

            if (bet.paid_at) {
              throw new ConflictError('Cannot edit a paid ticket.', {
                reason: 'already_paid',
              });
            }
            if (bet.status !== 'pending' && bet.status !== 'accepted') {
              throw new BadRequestError(
                `Only pending tickets can be edited (status: ${bet.status}).`,
                { reason: 'not_pending' }
              );
            }

            // Selections live in metadata.selections (sportsbook + cashier
            // kiosk slips) or, for some legacy rows, result.selections.
            const meta = { ...(bet.metadata ?? {}) } as Record<string, unknown>;
            const result = bet.result
              ? ({ ...bet.result } as Record<string, unknown>)
              : null;
            const metaSelections = Array.isArray(meta.selections)
              ? [...(meta.selections as unknown[])]
              : null;
            const resultSelections =
              result && Array.isArray(result.selections)
                ? [...(result.selections as unknown[])]
                : null;
            const selections = metaSelections ?? resultSelections;
            if (!selections) {
              throw new BadRequestError(
                "This ticket's selections cannot be edited.",
                { reason: 'no_editable_selections' }
              );
            }
            if (index >= selections.length) {
              throw new BadRequestError('Selection not found on this ticket.', {
                reason: 'index_out_of_range',
              });
            }
            if (selections.length <= 1) {
              throw new BadRequestError(
                'Cannot remove the only remaining match. Cancel the ticket instead.',
                { reason: 'last_leg' }
              );
            }

            const leg = selections[index] as Record<string, unknown>;
            const startsAtRaw = leg?.starts_at;
            const startsAt = startsAtRaw ? new Date(String(startsAtRaw)) : null;
            if (!startsAt || Number.isNaN(startsAt.getTime())) {
              throw new BadRequestError(
                'Cannot determine this match start time; the leg cannot be removed.',
                { reason: 'no_start_time' }
              );
            }
            if (startsAt.getTime() <= Date.now()) {
              throw new BadRequestError(
                'This match has already started and cannot be removed.',
                { reason: 'match_started' }
              );
            }

            // Drop the leg and re-price from the remaining odds. Stake is
            // unchanged; only the multiplier (and therefore the potential
            // win) shrinks.
            selections.splice(index, 1);
            const totalOdds = selections.reduce<number>((acc, s) => {
              const o = Number((s as Record<string, unknown>).odds ?? 0);
              return acc * (Number.isFinite(o) && o > 0 ? o : 1);
            }, 1);
            const stakeNum = num(bet.stake);
            const newPotential = (stakeNum * totalOdds).toFixed(4);

            if (metaSelections) meta.selections = selections;
            if (resultSelections && result) result.selections = selections;

            if (bet.source === 'sportsbook_bets') {
              await client.query(
                `UPDATE sportsbook_bets
                    SET metadata = $3::jsonb,
                        total_odds = $4,
                        potential_payout = $5,
                        bet_type = CASE WHEN $6 <= 1 THEN 'single' ELSE bet_type END
                  WHERE tenant_id = $1 AND id = $2`,
                [
                  scope.tenantId,
                  bet.id,
                  JSON.stringify(meta),
                  totalOdds.toFixed(4),
                  newPotential,
                  selections.length,
                ]
              );
            } else {
              await client.query(
                `UPDATE bets
                    SET metadata = $3::jsonb,
                        result = $4::jsonb,
                        potential_win = $5
                  WHERE tenant_id = $1 AND id = $2`,
                [
                  scope.tenantId,
                  bet.id,
                  JSON.stringify(meta),
                  result ? JSON.stringify(result) : null,
                  newPotential,
                ]
              );
            }

            const reloaded = await loadTicket(client, scope.tenantId, ticketId);
            const expiryDays = await getTicketExpiryDays(client, scope.tenantId);
            await client.query('COMMIT');
            const finalBet = reloaded ?? bet;
            return {
              ticket: presentTicket(
                finalBet,
                evaluatePayout(finalBet, expiryDays)
              ),
              removed_match: String(leg?.match ?? ''),
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
          action: 'cashier.ticket.remove_leg',
          resource: 'bet',
          resourceId: out.ticket.bet_id,
          payload: {
            ticket_code: out.ticket.ticket_id,
            removed_match: out.removed_match,
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
  method: 'post',
  path: '/api/cashier/tickets/{ticketId}/cancel',
  summary: 'Cancel a pending ticket and refund the stake',
  tags: ['Cashier Tickets'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Cancelled and refunded' } },
});

router.post(
  '/:ticketId/cancel',
  requirePermission('cancel_tickets'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketId } = paramSchema.parse(req.params);
      const scope = getCashierScope(req);

      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          await client.query('BEGIN');
          try {
            // Resolve across both ticket sources, then lock the row in
            // its origin table.
            const preload = await loadTicket(client, scope.tenantId, ticketId);
            if (!preload) throw new NotFoundError('Ticket not found');

            const lockRes =
              preload.source === 'sportsbook_bets'
                ? await client.query<BetRow>(
                    `SELECT ${BET_COLS_SPORTSBOOK}
                       FROM sportsbook_bets b
                       LEFT JOIN users u ON u.id = b.user_id
                      WHERE b.tenant_id = $1 AND b.id = $2
                      FOR UPDATE OF b`,
                    [scope.tenantId, preload.id]
                  )
                : await client.query<BetRow>(
                    `SELECT ${BET_COLS_INTERNAL}
                       FROM bets b
                       LEFT JOIN users u ON u.id = b.user_id
                      WHERE b.tenant_id = $1 AND b.id = $2
                      FOR UPDATE OF b`,
                    [scope.tenantId, preload.id]
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

            // A ticket may only be cancelled while ALL of its matches are
            // still upcoming. The moment any single leg has kicked off the
            // whole ticket is locked from cancellation.
            {
              const cMeta = bet.metadata ?? {};
              const cResult = bet.result ?? {};
              const cSelections =
                (Array.isArray((cMeta as { selections?: unknown }).selections) &&
                  ((cMeta as { selections: unknown[] }).selections as unknown[])) ||
                (Array.isArray((cResult as { selections?: unknown }).selections) &&
                  ((cResult as { selections: unknown[] }).selections as unknown[])) ||
                [];
              const now = Date.now();
              const startedLeg = cSelections.find((s) => {
                const startsRaw = (s as Record<string, unknown>)?.starts_at;
                if (!startsRaw) return false;
                const t = new Date(String(startsRaw)).getTime();
                return !Number.isNaN(t) && t <= now;
              });
              if (startedLeg) {
                const label =
                  (startedLeg as Record<string, unknown>).match ||
                  'a match';
                throw new BadRequestError(
                  `This ticket cannot be cancelled because ${label} has already started. A ticket can only be cancelled while none of its matches have started.`,
                  { reason: 'match_started' }
                );
              }
            }

            // Branch guard — cashiers may only cancel tickets sold in
            // their own branch. Throws ForbiddenError on mismatch.
            await assertTicketBranchAccess(client, scope.cashierId, bet);

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
              // Cancel quotas span both ticket sources because they
              // apply to the cashier, not to the table the ticket
              // happens to live in.
              const todayStats = await client.query<{
                cancelled_count: string;
                cancelled_volume: string;
              }>(
                // `bets` uses status='cancelled', sportsbook_bets uses
                // status='void' for the same lifecycle event, so we
                // match by the cashier+timestamp instead of the
                // status string to keep counts table-agnostic.
                `WITH all_cancels AS (
                   SELECT stake FROM bets
                    WHERE tenant_id = $1
                      AND cancelled_by_cashier_id = $2
                      AND cancelled_at >= date_trunc('day', now())
                   UNION ALL
                   SELECT stake FROM sportsbook_bets
                    WHERE tenant_id = $1
                      AND cancelled_by_cashier_id = $2
                      AND cancelled_at >= date_trunc('day', now())
                 )
                 SELECT
                    COUNT(*)::text                  AS cancelled_count,
                    COALESCE(SUM(stake), 0)::text   AS cancelled_volume
                   FROM all_cancels`,
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

            // Status string differs per table:
            //   `bets`            allows 'cancelled' (internal-game flow)
            //   `sportsbook_bets` only allows 'void'  (sportsbook flow)
            // Both are treated identically by evaluatePayout's
            // voidStates set, so the cashier-side semantics stay
            // consistent — refund the stake, mark settled, lock out
            // further mutations.
            const upd =
              bet.source === 'sportsbook_bets'
                ? await client.query<BetRow>(
                    `UPDATE sportsbook_bets b
                        SET status = 'void',
                            cancelled_at = now(),
                            cancelled_by_cashier_id = $2,
                            settled_at = now()
                      FROM users u
                      WHERE u.id = b.user_id
                        AND b.id = $1
                      RETURNING ${BET_COLS_SPORTSBOOK}`,
                    [bet.id, scope.cashierId]
                  )
                : await client.query<BetRow>(
                    `UPDATE bets b
                        SET status = 'cancelled',
                            cancelled_at = now(),
                            cancelled_by_cashier_id = $2,
                            settled_at = now()
                      FROM users u
                      WHERE u.id = b.user_id
                        AND b.id = $1
                      RETURNING ${BET_COLS_INTERNAL}`,
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

      // Real-time wallet sync — the cancel refunded the stake to the user's
      // wallet, so notify their socket room to refresh the displayed balance.
      if (out.refunded > 0 && out.ticket.user_id) {
        emitWalletUpdated(scope.tenantId, out.ticket.user_id, {
          reason: 'ticket_cancel_refund',
          wallet: null,
          amount: out.refunded,
          currency: out.currency,
          bet_id: out.ticket.bet_id,
        });
      }

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
        // Build a shared filter expression that works against `b.*` for
        // either source table. Param order matters because pg binds by
        // position — we use the exact same parameter array for both
        // halves of the UNION below.
        const filters: string[] = ['b.tenant_id = $1'];
        const values: unknown[] = [scope.tenantId];
        let i = 2;

        if (q.mine) {
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

        // Single UNION ALL across both ticket sources so the cashier
        // sees a unified ledger (internal-game tickets + sportsbook
        // slips). The ordering and pagination apply to the merged set.
        const unionSql = `
          (SELECT ${BET_COLS_INTERNAL}
             FROM bets b
             LEFT JOIN users u ON u.id = b.user_id
             ${where})
          UNION ALL
          (SELECT ${BET_COLS_SPORTSBOOK}
             FROM sportsbook_bets b
             LEFT JOIN users u ON u.id = b.user_id
             ${where})
        `;

        const total = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM (${unionSql}) t`,
          values
        );
        const rows = await client.query<BetRow>(
          `SELECT * FROM (${unionSql}) t
             ORDER BY COALESCE(t.sold_at, t.placed_at) DESC
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
