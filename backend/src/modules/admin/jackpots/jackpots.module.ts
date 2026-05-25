/**
 * Admin Super Jackpots module — Section 4.
 *
 *   GET    /api/admin/jackpots                  list jackpots
 *   POST   /api/admin/jackpots                  create jackpot
 *   GET    /api/admin/jackpots/:id              detail
 *   PATCH  /api/admin/jackpots/:id              update
 *   DELETE /api/admin/jackpots/:id              delete (only when no tickets)
 *   GET    /api/admin/jackpots/:id/tickets?type=online|offline
 *   PATCH  /api/admin/jackpots/:id/settle       finalize winners and pay out
 *
 * A "jackpot" is stored as a row in `tournaments` with `kind = 'jackpot'`.
 * Selected matches and the winning rules live in `rules` (jsonb):
 *
 *   rules = {
 *     event_ids: ["uuid", ...],         // required, matches included
 *     selection_ids: { event_id: selection_id, ... }  // expected outcome
 *     prize_tiers: [{ matches: 10, prize: 1_000_000, shared: true }, ...]
 *     description: string,
 *   }
 *
 * Tickets are recorded in `sportsbook_bets` with `bet_type = 'jackpot'`
 * and `jackpot_id = tournaments.id`. Settlement looks at each ticket's
 * legs and counts how many of them resolved as `won`. Tickets with the
 * highest match count that meet a tier threshold split the prize pool
 * for that tier.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { emitToAdmins, emitToTenant, emitToUser } from '../../../realtime/socket';
import { ensureWalletForUpdate } from '../../game/game.repository';
import {
  creditWalletBalance,
  insertWalletTransaction,
} from '../wallets/wallets.repository';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

/* ========================================================================== */
/* DTOs                                                                       */
/* ========================================================================== */

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  status: z
    .enum(['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'])
    .optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const prizeTierSchema = z.object({
  matches: z.number().int().positive(),
  prize: z.number().nonnegative(),
  shared: z.boolean().default(true),
  label: z.string().trim().max(80).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  entry_fee: z.number().nonnegative().default(0),
  prize_pool: z.number().nonnegative().default(0),
  currency: z.string().trim().min(1).max(8).default('ETB'),
  max_entries: z.number().int().positive().optional(),
  /** Activation date — when the jackpot is publicly available. */
  starts_at: z.coerce.date().optional(),
  /** Cut-off (after which no new tickets can be sold). */
  ends_at: z.coerce.date().optional(),
  status: z
    .enum(['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'])
    .default('scheduled'),
  /** Sports event UUIDs included in the jackpot. */
  event_ids: z.array(z.string().uuid()).min(1),
  /** Optional explicit prize tiers; default = single tier (all events match). */
  prize_tiers: z.array(prizeTierSchema).optional(),
  /** Optional admin notes / banner / extra metadata. */
  metadata: z.record(z.unknown()).default({}),
});

const updateSchema = createSchema.partial().extend({
  event_ids: z.array(z.string().uuid()).min(1).optional(),
});

const ticketsQuery = z.object({
  type: z.enum(['online', 'offline']).optional(),
  status: z
    .enum(['pending', 'won', 'lost', 'void', 'cashout', 'partial', 'cancelled'])
    .optional(),
  user_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const settleSchema = z.object({
  /** Override the auto-detected total prize pool. */
  prize_pool: z.number().nonnegative().optional(),
  /** Allow operator to dry-run before paying out. */
  dry_run: z.coerce.boolean().default(false),
});

/* ========================================================================== */
/* Repository helpers                                                         */
/* ========================================================================== */

interface JackpotRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  kind: string;
  status: string;
  starts_at: Date | null;
  ends_at: Date | null;
  entry_fee: string;
  prize_pool: string;
  currency: string;
  max_entries: number | null;
  rules: Record<string, unknown>;
  leaderboard: unknown[];
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLS = `
  id, tenant_id, name, description, kind, status, starts_at, ends_at,
  entry_fee, prize_pool, currency, max_entries, rules, leaderboard,
  created_by, created_at, updated_at
`;

async function getJackpot(client: PoolClient, id: string): Promise<JackpotRow | null> {
  const r = await client.query<JackpotRow>(
    `SELECT ${COLS} FROM tournaments WHERE id = $1 AND kind = 'jackpot'`,
    [id]
  );
  return r.rows[0] ?? null;
}

async function ticketCount(client: PoolClient, jackpotId: string) {
  const r = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM sportsbook_bets WHERE jackpot_id = $1`,
    [jackpotId]
  );
  return Number(r.rows[0]?.count ?? 0);
}

/* ========================================================================== */
/* Service                                                                    */
/* ========================================================================== */

async function listJackpots(req: Request, q: z.infer<typeof listQuery>) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const filters: string[] = [`kind = 'jackpot'`];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.status) {
        filters.push(`status = $${i++}`);
        values.push(q.status);
      }
      if (q.search) {
        filters.push(`name ILIKE $${i++}`);
        values.push(`%${q.search}%`);
      }
      const where = `WHERE ${filters.join(' AND ')}`;
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tournaments ${where}`,
        values
      );
      const rows = await client.query<JackpotRow & { tickets_count: string }>(
        `SELECT ${COLS},
                COALESCE(
                  (SELECT COUNT(*) FROM sportsbook_bets sb WHERE sb.jackpot_id = tournaments.id),
                  0
                )::text AS tickets_count
           FROM tournaments
           ${where}
           ORDER BY COALESCE(starts_at, created_at) DESC, created_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      return {
        items: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
      };
    }
  );
}

async function createJackpot(
  req: Request,
  body: z.infer<typeof createSchema>
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      // Make sure the events all exist and belong to this tenant.
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM sports_events WHERE id = ANY($1::uuid[])`,
        [body.event_ids]
      );
      const found = new Set(existing.rows.map((r) => r.id));
      const missing = body.event_ids.filter((id) => !found.has(id));
      if (missing.length) {
        throw new BadRequestError('Some selected events do not exist', { missing });
      }

      const rules = {
        ...(body.metadata ?? {}),
        event_ids: body.event_ids,
        prize_tiers:
          body.prize_tiers ??
          [
            {
              matches: body.event_ids.length,
              prize: body.prize_pool,
              shared: true,
              label: 'Jackpot',
            },
          ],
        description: body.description ?? null,
      };

      const r = await client.query<JackpotRow>(
        `INSERT INTO tournaments (
           tenant_id, name, description, kind, status, starts_at, ends_at,
           entry_fee, prize_pool, currency, max_entries, rules, created_by
         ) VALUES ($1,$2,$3,'jackpot',$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
         RETURNING ${COLS}`,
        [
          tenantId,
          body.name,
          body.description ?? null,
          body.status,
          body.starts_at ?? null,
          body.ends_at ?? null,
          body.entry_fee,
          body.prize_pool,
          body.currency,
          body.max_entries ?? null,
          JSON.stringify(rules),
          scope.actorId,
        ]
      );
      const created = r.rows[0];
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.jackpot.create',
          resource: 'tournaments',
          resourceId: created.id,
          payload: { after: created },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      emitToAdmins(tenantId, 'JACKPOT_CREATED', { jackpot: created });
      emitToTenant(tenantId, 'JACKPOT_CREATED', { id: created.id });
      return created;
    }
  );
}

async function updateJackpot(
  req: Request,
  id: string,
  patch: z.infer<typeof updateSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await getJackpot(client, id);
      if (!before) throw new NotFoundError('Jackpot not found');

      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      const flatColumns: Array<keyof typeof patch> = [
        'name',
        'description',
        'status',
        'starts_at',
        'ends_at',
        'entry_fee',
        'prize_pool',
        'currency',
        'max_entries',
      ];
      for (const k of flatColumns) {
        if (patch[k] !== undefined) {
          sets.push(`${String(k)} = $${i++}`);
          values.push(patch[k]);
        }
      }

      // Merge rules / event_ids / prize_tiers into the rules jsonb.
      if (
        patch.event_ids !== undefined ||
        patch.prize_tiers !== undefined ||
        patch.metadata !== undefined ||
        patch.description !== undefined
      ) {
        const newRules = {
          ...(before.rules ?? {}),
          ...(patch.metadata ?? {}),
          ...(patch.event_ids ? { event_ids: patch.event_ids } : {}),
          ...(patch.prize_tiers ? { prize_tiers: patch.prize_tiers } : {}),
          ...(patch.description !== undefined
            ? { description: patch.description ?? null }
            : {}),
        };
        sets.push(`rules = $${i++}::jsonb`);
        values.push(JSON.stringify(newRules));
      }

      if (!sets.length) return before;

      values.push(id);
      const r = await client.query<JackpotRow>(
        `UPDATE tournaments SET ${sets.join(', ')}
           WHERE id = $${i} AND kind = 'jackpot'
         RETURNING ${COLS}`,
        values
      );
      const after = r.rows[0];
      void tryAudit(
        {
          tenantId: before.tenant_id,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.jackpot.update',
          resource: 'tournaments',
          resourceId: id,
          payload: { before, after },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      emitToTenant(before.tenant_id, 'JACKPOT_UPDATED', { jackpot: after });
      return after;
    }
  );
}

async function deleteJackpot(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await getJackpot(client, id);
      if (!before) throw new NotFoundError('Jackpot not found');
      const tickets = await ticketCount(client, id);
      if (tickets > 0) {
        throw new ConflictError(
          `Cannot delete jackpot — ${tickets} ticket(s) already sold`
        );
      }
      await client.query(`DELETE FROM tournaments WHERE id = $1`, [id]);
      void tryAudit(
        {
          tenantId: before.tenant_id,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.jackpot.delete',
          resource: 'tournaments',
          resourceId: id,
          payload: { before },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return { ok: true };
    }
  );
}

async function listTickets(
  req: Request,
  jackpotId: string,
  q: z.infer<typeof ticketsQuery>
) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const filters: string[] = ['sb.jackpot_id = $1'];
      const values: unknown[] = [jackpotId];
      let i = 2;
      if (scope.tenantId) {
        filters.push(`sb.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.type === 'online') {
        filters.push(`sb.channel = 'online'`);
      } else if (q.type === 'offline') {
        filters.push(`sb.channel = 'offline'`);
      }
      if (q.status) {
        filters.push(`sb.status = $${i++}`);
        values.push(q.status);
      }
      if (q.user_id) {
        filters.push(`sb.user_id = $${i++}`);
        values.push(q.user_id);
      }
      const where = `WHERE ${filters.join(' AND ')}`;

      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM sportsbook_bets sb ${where}`,
        values
      );

      const rows = await client.query(
        `SELECT sb.id, sb.tenant_id, sb.user_id, sb.cashier_id, sb.channel,
                sb.bet_type, sb.bet_for_user_phone, sb.stake, sb.currency,
                sb.potential_payout, sb.actual_payout, sb.status, sb.jackpot_id,
                sb.metadata, sb.placed_at, sb.settled_at, sb.created_at,
                sb.updated_at,
                u.email AS user_email, u.phone AS user_phone,
                COALESCE(u.metadata->>'full_name', u.email, u.phone) AS user_name,
                t.name AS jackpot_name,
                t.currency AS jackpot_currency,
                (SELECT COUNT(*) FROM sportsbook_bet_legs l WHERE l.bet_id = sb.id)::int
                  AS leg_count,
                (SELECT COUNT(*) FROM sportsbook_bet_legs l WHERE l.bet_id = sb.id AND l.status = 'won')::int
                  AS won_legs
           FROM sportsbook_bets sb
           LEFT JOIN users u ON u.id = sb.user_id
           LEFT JOIN tournaments t ON t.id = sb.jackpot_id
           ${where}
         ORDER BY sb.placed_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );

      return {
        items: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
      };
    }
  );
}

/**
 * Settle a jackpot:
 *   1. Lock the jackpot row.
 *   2. Tally each ticket: how many of its legs ended `won`.
 *   3. For each prize tier, find all tickets that match the threshold,
 *      split the tier prize evenly, credit each winner's wallet, and
 *      mark the ticket `won`.
 *   4. All tickets that did not match any tier get `lost` (idempotent —
 *      already-settled tickets are skipped).
 *   5. Mark the jackpot itself as `completed`.
 *
 * Returns a payout summary so the admin UI can show "X winners, paid Y".
 */
async function settleJackpot(
  req: Request,
  id: string,
  body: z.infer<typeof settleSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const lock = await client.query<JackpotRow>(
        `SELECT ${COLS} FROM tournaments WHERE id = $1 AND kind = 'jackpot' FOR UPDATE`,
        [id]
      );
      const j = lock.rows[0];
      if (!j) throw new NotFoundError('Jackpot not found');
      if (j.status === 'completed') {
        throw new ConflictError('Jackpot is already settled');
      }

      const rules = (j.rules ?? {}) as {
        prize_tiers?: Array<{ matches: number; prize: number; shared?: boolean; label?: string }>;
      };
      const totalEvents = Array.isArray((j.rules as { event_ids?: unknown }).event_ids)
        ? (j.rules as { event_ids: string[] }).event_ids.length
        : 0;
      const tiers =
        rules.prize_tiers && rules.prize_tiers.length
          ? rules.prize_tiers
          : [{ matches: totalEvents || 1, prize: Number(j.prize_pool), shared: true }];

      const totalPool = body.prize_pool ?? Number(j.prize_pool);
      const tickets = await client.query<{
        id: string;
        tenant_id: string;
        user_id: string;
        currency: string;
        leg_count: number;
        won_legs: number;
        pending_legs: number;
        status: string;
        actual_payout: string | null;
      }>(
        `SELECT sb.id, sb.tenant_id, sb.user_id, sb.currency,
                (SELECT COUNT(*)::int FROM sportsbook_bet_legs l WHERE l.bet_id = sb.id)        AS leg_count,
                (SELECT COUNT(*)::int FROM sportsbook_bet_legs l WHERE l.bet_id = sb.id AND l.status = 'won')      AS won_legs,
                (SELECT COUNT(*)::int FROM sportsbook_bet_legs l WHERE l.bet_id = sb.id AND l.status = 'pending')  AS pending_legs,
                sb.status, sb.actual_payout::text AS actual_payout
           FROM sportsbook_bets sb
           WHERE sb.jackpot_id = $1
           FOR UPDATE`,
        [id]
      );

      // Group tickets by best matching tier.
      const tiersSorted = [...tiers].sort((a, b) => b.matches - a.matches);
      type Bucket = { tier: typeof tiersSorted[number]; ticketIds: typeof tickets.rows };
      const buckets = new Map<number, Bucket>();
      const losers: typeof tickets.rows = [];

      for (const t of tickets.rows) {
        if (t.status !== 'pending') continue;
        if (t.pending_legs > 0) {
          // legs not all settled — skip and let admin retry later
          continue;
        }
        const matched = tiersSorted.find((tier) => t.won_legs >= tier.matches);
        if (matched) {
          const b = buckets.get(matched.matches) ?? { tier: matched, ticketIds: [] };
          b.ticketIds.push(t);
          buckets.set(matched.matches, b);
        } else {
          losers.push(t);
        }
      }

      const winners: Array<{
        bet_id: string;
        user_id: string;
        prize: string;
        currency: string;
        tier: number;
      }> = [];

      let paidOut = 0;
      const settledAt = new Date();

      for (const [, bucket] of buckets) {
        const totalForTier = bucket.tier.prize;
        const share =
          bucket.tier.shared !== false && bucket.ticketIds.length > 1
            ? totalForTier / bucket.ticketIds.length
            : totalForTier;
        for (const t of bucket.ticketIds) {
          const prize = share.toFixed(2);
          paidOut += Number(prize);
          if (!body.dry_run) {
            const wallet = await ensureWalletForUpdate(
              client,
              t.tenant_id,
              t.user_id,
              t.currency
            );
            const after = await creditWalletBalance(client, wallet.id, prize);
            const tx = await insertWalletTransaction(client, {
              tenantId: t.tenant_id,
              walletId: wallet.id,
              userId: t.user_id,
              type: 'payout',
              amount: prize,
              beforeBalance: wallet.balance,
              afterBalance: after.balance,
              currency: t.currency,
              reference: `jackpot_payout:${t.id}`,
              metadata: {
                jackpot_id: id,
                jackpot_name: j.name,
                tier_matches: bucket.tier.matches,
                bet_id: t.id,
              },
            });

            await client.query(
              `UPDATE sportsbook_bets
                  SET status = 'won',
                      actual_payout = $2::numeric,
                      settled_at = $3,
                      metadata = COALESCE(metadata, '{}'::jsonb) ||
                                 jsonb_build_object(
                                   'jackpot_payout_tx', $4,
                                   'jackpot_tier_matches', $5
                                 )
                WHERE id = $1`,
              [t.id, prize, settledAt, tx.id, bucket.tier.matches]
            );
            emitToUser(t.tenant_id, t.user_id, 'JACKPOT_WON', {
              jackpot_id: id,
              bet_id: t.id,
              amount: prize,
            });
          }
          winners.push({
            bet_id: t.id,
            user_id: t.user_id,
            prize,
            currency: t.currency,
            tier: bucket.tier.matches,
          });
        }
      }

      if (!body.dry_run) {
        // Mark losing tickets.
        for (const t of losers) {
          await client.query(
            `UPDATE sportsbook_bets
                SET status = 'lost', actual_payout = 0, settled_at = $2
              WHERE id = $1`,
            [t.id, settledAt]
          );
        }
        // Mark the jackpot itself complete.
        await client.query(
          `UPDATE tournaments
              SET status = 'completed',
                  rules = COALESCE(rules, '{}'::jsonb) ||
                          jsonb_build_object(
                            'settled_at', $2,
                            'settled_by', $3,
                            'paid_out', $4
                          )
            WHERE id = $1`,
          [id, settledAt, scope.actorId, paidOut]
        );

        void tryAudit(
          {
            tenantId: j.tenant_id,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.jackpot.settle',
            resource: 'tournaments',
            resourceId: id,
            payload: {
              winners_count: winners.length,
              losers_count: losers.length,
              total_paid: paidOut,
            },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );

        emitToTenant(j.tenant_id, 'JACKPOT_SETTLED', {
          id,
          winners_count: winners.length,
          paid_out: paidOut,
        });
      }

      return {
        jackpot_id: id,
        dry_run: body.dry_run,
        winners,
        winners_count: winners.length,
        losers_count: losers.length,
        total_paid: paidOut,
        prize_pool: totalPool,
        settled_at: body.dry_run ? null : settledAt,
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

const wrapStatus =
  <T,>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.get('/', wrap((req) => listJackpots(req, listQuery.parse(req.query))));
router.post(
  '/',
  wrapStatus(201, (req) => createJackpot(req, createSchema.parse(req.body)))
);
router.get(
  '/:id',
  wrap(async (req) => {
    const { id } = idParam.parse(req.params);
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
      async (client) => {
        const j = await getJackpot(client, id);
        if (!j) throw new NotFoundError('Jackpot not found');
        const counts = await client.query<{
          tickets: string;
          online_tickets: string;
          offline_tickets: string;
        }>(
          `SELECT COUNT(*)::text                                       AS tickets,
                  COUNT(*) FILTER (WHERE channel = 'online')::text     AS online_tickets,
                  COUNT(*) FILTER (WHERE channel = 'offline')::text    AS offline_tickets
             FROM sportsbook_bets
            WHERE jackpot_id = $1`,
          [id]
        );
        return { ...j, stats: counts.rows[0] ?? null };
      }
    );
  })
);
router.patch(
  '/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return updateJackpot(req, id, updateSchema.parse(req.body));
  })
);
router.delete(
  '/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return deleteJackpot(req, id);
  })
);

router.get(
  '/:id/tickets',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return listTickets(req, id, ticketsQuery.parse(req.query));
  })
);

router.patch(
  '/:id/settle',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return settleJackpot(req, id, settleSchema.parse(req.body ?? {}));
  })
);

export default router;
