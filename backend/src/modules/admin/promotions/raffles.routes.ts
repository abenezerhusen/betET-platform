/**
 * /api/admin/raffles — spec-aligned raffle management.
 *
 * Maps the BetET spec's raffle vocabulary (`Active`, `Pending`, `Completed`,
 * `Cancelled`, `min_deposit_to_qualify`, `draw_mode`, `notify_winners`,
 * `prizes`) onto the existing `promo_raffles` + `raffle_tickets` tables.
 *
 * The legacy router at `/api/admin/promotions/raffles` (low-level
 * `draft|open|drawn|cancelled` vocabulary) is preserved for backwards
 * compatibility with the admin-panel-main bundle that still ships those
 * paths. New panels and the public surface should use this module.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { emitToTenant, emitToUser, Events } from '../../../realtime/socket';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

const router = Router();

/* ---------------------------------------------------------------------- */
/* DTOs                                                                   */
/* ---------------------------------------------------------------------- */

const idParam = z.object({ id: z.string().uuid() });

const specStatusEnum = z.enum(['Active', 'Pending', 'Completed', 'Cancelled']);
const drawModeEnum = z.enum(['auto', 'manual']);

const listQuery = z.object({
  status: specStatusEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
  min_deposit: z.number().nonnegative().default(0),
  prize_pool: z.number().nonnegative().default(0),
  currency: z.string().trim().min(1).max(8).default('ETB'),
  max_tickets: z.number().int().positive().optional(),
  draw_mode: drawModeEnum.default('auto'),
  notify_winners: z.boolean().default(true),
  prizes: z
    .array(
      z.object({
        rank: z.number().int().positive(),
        name: z.string().trim().min(1),
        amount: z.number().nonnegative().default(0),
      })
    )
    .optional(),
  image_url: z.string().trim().max(500).optional(),
  terms: z.string().trim().max(4000).optional(),
  status: specStatusEnum.default('Pending'),
});

const updateSchema = createSchema.partial();

const statusSchema = z.object({ status: specStatusEnum });

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

/**
 * Translate the spec status names ("Active"/"Pending"/"Completed"/"Cancelled")
 * to the underlying `promo_raffles.status` check constraint values
 * ("open"/"draft"/"drawn"/"cancelled"). This lets the table-level constraint
 * stay stable while the API speaks spec language.
 */
function toDbStatus(s: z.infer<typeof specStatusEnum>): string {
  switch (s) {
    case 'Active':
      return 'open';
    case 'Pending':
      return 'draft';
    case 'Completed':
      return 'drawn';
    case 'Cancelled':
      return 'cancelled';
  }
}
function fromDbStatus(s: string): z.infer<typeof specStatusEnum> {
  switch (s) {
    case 'open':
      return 'Active';
    case 'drawn':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

interface DbRaffleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  ticket_price: string;
  currency: string;
  prize_pool: string;
  max_tickets: number | null;
  draw_at: Date | null;
  status: string;
  winning_ticket_id: string | null;
  rules: Record<string, unknown>;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  tickets_count?: number;
}

function project(row: DbRaffleRow): Record<string, unknown> {
  const rules = (row.rules ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    description: row.description ?? '',
    start_date: (rules.start_date as string | undefined) ?? null,
    end_date:
      (rules.end_date as string | undefined) ??
      (row.draw_at ? row.draw_at.toISOString() : null),
    min_deposit: Number(rules.min_deposit ?? 0),
    prize_pool: Number(row.prize_pool ?? 0),
    currency: row.currency,
    max_tickets: row.max_tickets,
    draw_mode: (rules.draw_mode as string | undefined) ?? 'auto',
    notify_winners: rules.notify_winners !== false,
    prizes: rules.prizes ?? [],
    image_url: rules.image_url ?? null,
    terms: rules.terms ?? null,
    status: fromDbStatus(row.status),
    winning_ticket_id: row.winning_ticket_id,
    tickets_count: row.tickets_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildRules(
  input: Partial<z.infer<typeof createSchema>>,
  current: Record<string, unknown> = {}
): Record<string, unknown> {
  const next = { ...current } as Record<string, unknown>;
  if (input.start_date !== undefined)
    next.start_date =
      input.start_date instanceof Date
        ? input.start_date.toISOString()
        : input.start_date;
  if (input.end_date !== undefined)
    next.end_date =
      input.end_date instanceof Date
        ? input.end_date.toISOString()
        : input.end_date;
  if (input.min_deposit !== undefined) next.min_deposit = input.min_deposit;
  if (input.draw_mode !== undefined) next.draw_mode = input.draw_mode;
  if (input.notify_winners !== undefined)
    next.notify_winners = input.notify_winners;
  if (input.prizes !== undefined) next.prizes = input.prizes;
  if (input.image_url !== undefined) next.image_url = input.image_url;
  if (input.terms !== undefined) next.terms = input.terms;
  return next;
}

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };
const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

/* ---------------------------------------------------------------------- */
/* Routes                                                                 */
/* ---------------------------------------------------------------------- */

router.get(
  '/',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const q = listQuery.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const filters: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (scope.tenantId) {
          filters.push(`tenant_id = $${i++}`);
          values.push(scope.tenantId);
        }
        if (q.status) {
          filters.push(`status = $${i++}`);
          values.push(toDbStatus(q.status));
        }
        const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
        const total = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM promo_raffles ${where}`,
          values
        );
        const rows = await client.query<DbRaffleRow>(
          `SELECT id, tenant_id, name, description, ticket_price::text, currency,
                  prize_pool::text, max_tickets, draw_at, status, winning_ticket_id,
                  rules, created_by, created_at, updated_at,
                  (SELECT COUNT(*) FROM raffle_tickets WHERE raffle_id = promo_raffles.id)::int AS tickets_count
             FROM promo_raffles ${where}
             ORDER BY created_at DESC
             LIMIT $${i++} OFFSET $${i++}`,
          [...values, q.limit, offset]
        );
        return {
          items: rows.rows.map(project),
          total: Number(total.rows[0]?.count ?? 0),
          page: q.page,
          limit: q.limit,
        };
      }
    );
  })
);

router.post(
  '/',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = createSchema.parse(req.body);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const rules = buildRules(body);
        const r = await client.query<DbRaffleRow>(
          `INSERT INTO promo_raffles (
             tenant_id, name, description, ticket_price, currency, prize_pool,
             max_tickets, draw_at, status, rules, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
           RETURNING id, tenant_id, name, description, ticket_price::text,
                     currency, prize_pool::text, max_tickets, draw_at, status,
                     winning_ticket_id, rules, created_by, created_at, updated_at`,
          [
            tenantId,
            body.name,
            body.description ?? null,
            0,
            body.currency,
            body.prize_pool,
            body.max_tickets ?? null,
            body.end_date ?? null,
            toDbStatus(body.status),
            JSON.stringify(rules),
            scope.actorId,
          ]
        );
        const row = r.rows[0];
        void tryAudit(
          {
            tenantId,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.raffle.create',
            resource: 'promo_raffles',
            resourceId: row.id,
            payload: { after: project(row) },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );
        return project(row);
      }
    );
  })
);

router.get(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<DbRaffleRow>(
          `SELECT id, tenant_id, name, description, ticket_price::text, currency,
                  prize_pool::text, max_tickets, draw_at, status, winning_ticket_id,
                  rules, created_by, created_at, updated_at,
                  (SELECT COUNT(*) FROM raffle_tickets WHERE raffle_id = promo_raffles.id)::int AS tickets_count
             FROM promo_raffles WHERE id = $1`,
          [id]
        );
        if (!r.rows[0]) throw new NotFoundError('Raffle not found');
        return project(r.rows[0]);
      }
    );
  })
);

router.put(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const cur = await client.query<DbRaffleRow>(
          `SELECT id, tenant_id, name, description, ticket_price::text, currency,
                  prize_pool::text, max_tickets, draw_at, status, winning_ticket_id,
                  rules, created_by, created_at, updated_at
             FROM promo_raffles WHERE id = $1`,
          [id]
        );
        const existing = cur.rows[0];
        if (!existing) throw new NotFoundError('Raffle not found');

        const sets: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (body.name !== undefined) {
          sets.push(`name = $${i++}`);
          values.push(body.name);
        }
        if (body.description !== undefined) {
          sets.push(`description = $${i++}`);
          values.push(body.description);
        }
        if (body.currency !== undefined) {
          sets.push(`currency = $${i++}`);
          values.push(body.currency);
        }
        if (body.prize_pool !== undefined) {
          sets.push(`prize_pool = $${i++}::numeric`);
          values.push(body.prize_pool);
        }
        if (body.max_tickets !== undefined) {
          sets.push(`max_tickets = $${i++}`);
          values.push(body.max_tickets);
        }
        if (body.end_date !== undefined) {
          sets.push(`draw_at = $${i++}`);
          values.push(body.end_date);
        }
        if (body.status !== undefined) {
          sets.push(`status = $${i++}`);
          values.push(toDbStatus(body.status));
        }
        const newRules = buildRules(body, existing.rules ?? {});
        if (Object.keys(newRules).length !== Object.keys(existing.rules ?? {}).length || JSON.stringify(newRules) !== JSON.stringify(existing.rules ?? {})) {
          sets.push(`rules = $${i++}::jsonb`);
          values.push(JSON.stringify(newRules));
        }
        if (sets.length === 0) {
          return project(existing);
        }
        values.push(id);
        const r = await client.query<DbRaffleRow>(
          `UPDATE promo_raffles SET ${sets.join(', ')} WHERE id = $${i}
             RETURNING id, tenant_id, name, description, ticket_price::text,
                       currency, prize_pool::text, max_tickets, draw_at, status,
                       winning_ticket_id, rules, created_by, created_at, updated_at`,
          values
        );
        return project(r.rows[0]);
      }
    );
  })
);

router.patch(
  '/:id/status',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    const body = statusSchema.parse(req.body);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query<DbRaffleRow>(
          `UPDATE promo_raffles
              SET status = $1
            WHERE id = $2
            RETURNING id, tenant_id, name, description, ticket_price::text,
                      currency, prize_pool::text, max_tickets, draw_at, status,
                      winning_ticket_id, rules, created_by, created_at, updated_at`,
          [toDbStatus(body.status), id]
        );
        if (!r.rows[0]) throw new NotFoundError('Raffle not found');
        void tryAudit(
          {
            tenantId: r.rows[0].tenant_id,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.raffle.status',
            resource: 'promo_raffles',
            resourceId: id,
            payload: { status: body.status },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );
        return project(r.rows[0]);
      }
    );
  })
);

router.delete(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `DELETE FROM promo_raffles WHERE id = $1 RETURNING id`,
          [id]
        );
        if (!r.rows[0]) throw new NotFoundError('Raffle not found');
        return { ok: true };
      }
    );
  })
);

router.get(
  '/:id/tickets',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `SELECT t.id, t.raffle_id, t.user_id, t.ticket_number, t.purchased_at,
                  u.email AS user_email, u.phone AS user_phone,
                  CASE
                    WHEN pr.winning_ticket_id = t.id THEN 'Winner'
                    WHEN pr.status = 'drawn' THEN 'Lost'
                    ELSE 'Pending'
                  END AS status,
                  CASE
                    WHEN pr.winning_ticket_id = t.id THEN pr.prize_pool::text
                    ELSE '0'
                  END AS prize
             FROM raffle_tickets t
             JOIN promo_raffles pr ON pr.id = t.raffle_id
             LEFT JOIN users u ON u.id = t.user_id
            WHERE t.raffle_id = $1
            ORDER BY t.purchased_at`,
          [id]
        );
        return { items: r.rows };
      }
    );
  })
);

router.get(
  '/:id/winners',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `SELECT t.id AS ticket_id, t.ticket_number, t.user_id, t.purchased_at,
                  u.email AS user_email, u.phone AS user_phone,
                  pr.prize_pool::text AS prize,
                  pr.currency,
                  pr.name AS raffle_name,
                  pr.updated_at AS drawn_at
             FROM promo_raffles pr
             JOIN raffle_tickets t ON t.id = pr.winning_ticket_id
             LEFT JOIN users u ON u.id = t.user_id
            WHERE pr.id = $1`,
          [id]
        );
        return { items: r.rows };
      }
    );
  })
);

router.post(
  '/:id/draw',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const raffle = await client.query<{
          tenant_id: string;
          status: string;
          rules: Record<string, unknown>;
          name: string;
          prize_pool: string;
          currency: string;
        }>(
          `SELECT tenant_id, status, rules, name, prize_pool::text, currency
             FROM promo_raffles WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!raffle.rows[0]) throw new NotFoundError('Raffle not found');
        if (raffle.rows[0].status === 'drawn') {
          throw new ConflictError('Raffle already drawn');
        }
        const tickets = await client.query<{
          id: string;
          user_id: string;
          ticket_number: string;
        }>(
          `SELECT id, user_id, ticket_number FROM raffle_tickets WHERE raffle_id = $1`,
          [id]
        );
        if (tickets.rows.length === 0) {
          throw new ConflictError('No tickets sold');
        }
        const winnerIdx = crypto.randomInt(0, tickets.rows.length);
        const winner = tickets.rows[winnerIdx];
        const upd = await client.query<DbRaffleRow>(
          `UPDATE promo_raffles SET status = 'drawn', winning_ticket_id = $1
             WHERE id = $2
             RETURNING id, tenant_id, name, description, ticket_price::text,
                       currency, prize_pool::text, max_tickets, draw_at, status,
                       winning_ticket_id, rules, created_by, created_at, updated_at`,
          [winner.id, id]
        );

        const tenantId = upd.rows[0].tenant_id;
        const rules = (upd.rows[0].rules ?? {}) as Record<string, unknown>;
        const notify = rules.notify_winners !== false;

        void tryAudit(
          {
            tenantId,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.raffle.draw',
            resource: 'promo_raffles',
            resourceId: id,
            payload: {
              winning_ticket_id: winner.id,
              winner_user_id: winner.user_id,
            },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );

        emitToTenant(tenantId, 'RAFFLE_DRAWN', {
          raffle_id: id,
          winning_ticket_id: winner.id,
          winner_user_id: winner.user_id,
        });

        if (notify) {
          emitToUser(tenantId, winner.user_id, Events.BONUS_CLAIMED, {
            type: 'raffle_winner',
            raffle_id: id,
            raffle_name: raffle.rows[0].name,
            ticket_number: winner.ticket_number,
            prize: raffle.rows[0].prize_pool,
            currency: raffle.rows[0].currency,
          });
        }

        return project(upd.rows[0]);
      }
    );
  })
);

/* ---------------------------------------------------------------------- */
/* Service: auto-create a ticket when a user makes a qualifying deposit   */
/* ---------------------------------------------------------------------- */

/**
 * Award raffle tickets to a user whose recent deposit qualifies for one or
 * more currently-active raffles. Each (raffle, user) gets at most one
 * ticket. Called from the deposit-confirmation pipeline.
 */
export async function awardRaffleTicketsForDeposit(params: {
  tenantId: string;
  userId: string;
  amount: number;
}): Promise<Array<{ raffle_id: string; ticket_number: string }>> {
  return withTenantClient(
    { tenantId: params.tenantId, bypassRls: true },
    async (client) => {
      const raffles = await client.query<{
        id: string;
        rules: Record<string, unknown>;
        name: string;
      }>(
        `SELECT id, rules, name
           FROM promo_raffles
          WHERE tenant_id = $1
            AND status IN ('open', 'draft')
            AND (
              (rules->>'start_date') IS NULL OR (rules->>'start_date')::timestamptz <= now()
            )
            AND (
              (rules->>'end_date') IS NULL OR (rules->>'end_date')::timestamptz > now()
            )`,
        [params.tenantId]
      );

      const awards: Array<{ raffle_id: string; ticket_number: string }> = [];
      for (const r of raffles.rows) {
        const minDeposit = Number((r.rules ?? {}).min_deposit ?? 0);
        if (params.amount < minDeposit) continue;

        // Skip if user already has a ticket for this raffle.
        const has = await client.query<{ id: string }>(
          `SELECT id FROM raffle_tickets
            WHERE raffle_id = $1 AND user_id = $2 LIMIT 1`,
          [r.id, params.userId]
        );
        if (has.rows[0]) continue;

        // Generate unique ticket number with a retry loop on collisions.
        for (let attempt = 0; attempt < 5; attempt++) {
          const ticketNumber = crypto
            .randomBytes(4)
            .readUInt32BE(0)
            .toString()
            .padStart(10, '0');
          try {
            const ins = await client.query<{ ticket_number: string }>(
              `INSERT INTO raffle_tickets (tenant_id, raffle_id, user_id, ticket_number)
               VALUES ($1,$2,$3,$4)
               RETURNING ticket_number`,
              [params.tenantId, r.id, params.userId, ticketNumber]
            );
            awards.push({
              raffle_id: r.id,
              ticket_number: ins.rows[0].ticket_number,
            });
            break;
          } catch (err) {
            if ((err as { code?: string }).code !== '23505') throw err;
          }
        }
      }
      return awards;
    }
  );
}

export default router;
