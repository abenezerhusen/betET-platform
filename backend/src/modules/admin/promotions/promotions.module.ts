import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ConflictError, NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { emitToTenant } from '../../../realtime/socket';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

/* DTOs --------------------------------------------------------------------- */

const idParam = z.object({ id: z.string().uuid() });
const codeParam = z.object({ code: z.string().trim().min(2).max(40) });

/* Raffles ------------------------------------------------------------------ */
const raffleListQuery = z.object({
  status: z.enum(['draft', 'open', 'drawn', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const raffleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  ticket_price: z.number().nonnegative().default(0),
  currency: z.string().trim().min(1).max(8).default('ETB'),
  prize_pool: z.number().nonnegative().default(0),
  max_tickets: z.number().int().positive().optional(),
  draw_at: z.coerce.date().optional(),
  status: z.enum(['draft', 'open', 'drawn', 'cancelled']).default('draft'),
  rules: z.record(z.unknown()).default({}),
});

const updateRaffleSchema = raffleSchema.partial();

const ticketSchema = z.object({
  user_id: z.string().uuid(),
  ticket_number: z.string().trim().min(1).max(40).optional(),
});

/* Referrals ---------------------------------------------------------------- */
const referralCodeSchema = z.object({
  user_id: z.string().uuid(),
  code: z.string().trim().min(2).max(40).optional(),
  max_uses: z.number().int().positive().optional(),
  is_active: z.boolean().default(true),
});

const referralListQuery = z.object({
  status: z.enum(['pending', 'rewarded', 'expired', 'cancelled']).optional(),
  referrer_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

/* Affiliates --------------------------------------------------------------- */
const affiliateListQuery = z.object({
  status: z.enum(['active', 'paused', 'terminated']).optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const affiliateSchema = z.object({
  user_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(2).max(40),
  plan: z.enum(['revenue_share', 'cpa', 'hybrid']).default('revenue_share'),
  commission_pct: z.number().min(0).max(100).default(25),
  cpa_amount: z.number().nonnegative().default(0),
  status: z.enum(['active', 'paused', 'terminated']).default('active'),
});

const updateAffiliateSchema = affiliateSchema.partial();

const affiliatePayoutSchema = z.object({
  amount: z.number().positive(),
  note: z.string().trim().max(500).optional(),
});

const recordClickSchema = z.object({
  ip: z.string().optional(),
  user_agent: z.string().optional(),
  referrer: z.string().optional(),
});

/* Service: Raffles --------------------------------------------------------- */

async function listRaffles(req: Request, q: z.infer<typeof raffleListQuery>) {
  const scope = getAdminScope(req);
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
        values.push(q.status);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM promo_raffles ${where}`,
        values
      );
      const rows = await client.query(
        `SELECT id, tenant_id, name, description, ticket_price, currency, prize_pool,
                max_tickets, draw_at, status, winning_ticket_id, rules, created_by,
                created_at, updated_at,
                (SELECT COUNT(*) FROM raffle_tickets WHERE raffle_id = promo_raffles.id)::int AS tickets_count
           FROM promo_raffles ${where}
           ORDER BY created_at DESC
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

async function createRaffle(req: Request, body: z.infer<typeof raffleSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `INSERT INTO promo_raffles (
           tenant_id, name, description, ticket_price, currency, prize_pool,
           max_tickets, draw_at, status, rules, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
         RETURNING id, tenant_id, name, description, ticket_price, currency,
                   prize_pool, max_tickets, draw_at, status, winning_ticket_id,
                   rules, created_by, created_at, updated_at`,
        [
          tenantId,
          body.name,
          body.description ?? null,
          body.ticket_price,
          body.currency,
          body.prize_pool,
          body.max_tickets ?? null,
          body.draw_at ?? null,
          body.status,
          JSON.stringify(body.rules),
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
          payload: { after: row },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return row;
    }
  );
}

async function updateRaffle(req: Request, id: string, body: z.infer<typeof updateRaffleSchema>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const cast: Record<string, string> = { rules: '::jsonb' };
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        sets.push(`${k} = $${i++}${cast[k] ?? ''}`);
        values.push(k === 'rules' ? JSON.stringify(v) : v);
      }
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE promo_raffles SET ${sets.join(', ')} WHERE id = $${i}
         RETURNING id, tenant_id, name, description, ticket_price, currency,
                   prize_pool, max_tickets, draw_at, status, winning_ticket_id,
                   rules, created_by, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Raffle not found');
      return r.rows[0];
    }
  );
}

async function deleteRaffle(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM promo_raffles WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Raffle not found');
      return { ok: true };
    }
  );
}

async function listTickets(req: Request, raffleId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT t.id, t.raffle_id, t.user_id, t.ticket_number, t.purchased_at,
                u.email AS user_email, u.phone AS user_phone
                , CASE
                    WHEN pr.winning_ticket_id = t.id THEN 'Winner'
                    WHEN pr.status = 'drawn' THEN 'Lost'
                    ELSE 'Pending'
                  END AS status
                , CASE
                    WHEN pr.winning_ticket_id = t.id THEN pr.prize_pool::text
                    ELSE '0'
                  END AS prize
           FROM raffle_tickets t
           JOIN promo_raffles pr ON pr.id = t.raffle_id
           LEFT JOIN users u ON u.id = t.user_id
           WHERE t.raffle_id = $1
           ORDER BY t.purchased_at`,
        [raffleId]
      );
      return { items: r.rows };
    }
  );
}

async function addTicket(req: Request, raffleId: string, body: z.infer<typeof ticketSchema>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const raffle = await client.query<{ tenant_id: string; status: string }>(
        `SELECT tenant_id, status FROM promo_raffles WHERE id = $1`,
        [raffleId]
      );
      if (!raffle.rows[0]) throw new NotFoundError('Raffle not found');
      const tenantId = raffle.rows[0].tenant_id;
      const ticketNumber =
        body.ticket_number ??
        crypto.randomBytes(4).readUInt32BE(0).toString().padStart(10, '0');
      try {
        const r = await client.query(
          `INSERT INTO raffle_tickets (tenant_id, raffle_id, user_id, ticket_number)
           VALUES ($1,$2,$3,$4)
           RETURNING id, raffle_id, user_id, ticket_number, purchased_at`,
          [tenantId, raffleId, body.user_id, ticketNumber]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Ticket number already used');
        }
        throw err;
      }
    }
  );
}

async function drawRaffle(req: Request, raffleId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const raffle = await client.query<{ tenant_id: string; status: string }>(
        `SELECT tenant_id, status FROM promo_raffles WHERE id = $1 FOR UPDATE`,
        [raffleId]
      );
      if (!raffle.rows[0]) throw new NotFoundError('Raffle not found');
      if (raffle.rows[0].status === 'drawn') {
        throw new ConflictError('Raffle already drawn');
      }
      const tickets = await client.query<{ id: string }>(
        `SELECT id FROM raffle_tickets WHERE raffle_id = $1`,
        [raffleId]
      );
      if (tickets.rows.length === 0) {
        throw new ConflictError('No tickets sold');
      }
      const winnerIdx = crypto.randomInt(0, tickets.rows.length);
      const winnerId = tickets.rows[winnerIdx].id;
      const r = await client.query(
        `UPDATE promo_raffles SET status = 'drawn', winning_ticket_id = $1
           WHERE id = $2
           RETURNING id, tenant_id, status, winning_ticket_id`,
        [winnerId, raffleId]
      );
      void tryAudit(
        {
          tenantId: r.rows[0].tenant_id,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.raffle.draw',
          resource: 'promo_raffles',
          resourceId: raffleId,
          payload: { winning_ticket_id: winnerId },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      emitToTenant(r.rows[0].tenant_id, 'RAFFLE_DRAWN', {
        raffle_id: raffleId,
        winning_ticket_id: winnerId,
      });
      return r.rows[0];
    }
  );
}

/* Service: Referrals ------------------------------------------------------- */

async function listReferralCodes(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT rc.id, rc.tenant_id, rc.user_id, rc.code, rc.uses, rc.max_uses,
                rc.is_active, rc.created_at, rc.updated_at,
                u.email AS user_email, u.phone AS user_phone
           FROM referral_codes rc
           LEFT JOIN users u ON u.id = rc.user_id
           ${scope.tenantId ? 'WHERE rc.tenant_id = $1' : ''}
           ORDER BY rc.created_at DESC`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function createReferralCode(req: Request, body: z.infer<typeof referralCodeSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const code = body.code ?? crypto.randomBytes(4).toString('hex').toUpperCase();
      try {
        const r = await client.query(
          `INSERT INTO referral_codes (tenant_id, user_id, code, max_uses, is_active)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id, tenant_id, user_id, code, uses, max_uses, is_active,
                     created_at, updated_at`,
          [tenantId, body.user_id, code, body.max_uses ?? null, body.is_active]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Referral code already exists');
        }
        throw err;
      }
    }
  );
}

async function listReferrals(req: Request, q: z.infer<typeof referralListQuery>) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
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
      if (q.referrer_id) {
        filters.push(`r.referrer_id = $${i++}`);
        values.push(q.referrer_id);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM referrals r ${where}`,
        values
      );
      const rows = await client.query(
        `SELECT r.id, r.tenant_id, r.referrer_id, r.referred_id, r.code,
                r.bonus_amount, r.status, r.rewarded_at, r.created_at, r.updated_at,
                ru.email AS referrer_email, ru.phone AS referrer_phone,
                rd.email AS referred_email, rd.phone AS referred_phone
           FROM referrals r
           LEFT JOIN users ru ON ru.id = r.referrer_id
           LEFT JOIN users rd ON rd.id = r.referred_id
           ${where}
         ORDER BY r.created_at DESC
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

async function rewardReferral(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE referrals SET status = 'rewarded', rewarded_at = now()
           WHERE id = $1 AND status = 'pending'
           RETURNING id, tenant_id, status, rewarded_at`,
        [id]
      );
      if (!r.rows[0]) throw new NotFoundError('Referral not found or not pending');
      return r.rows[0];
    }
  );
}

/* Service: Affiliates ----------------------------------------------------- */

async function listAffiliates(req: Request, q: z.infer<typeof affiliateListQuery>) {
  const scope = getAdminScope(req);
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
        values.push(q.status);
      }
      if (q.search) {
        filters.push(`(name ILIKE $${i} OR code ILIKE $${i})`);
        values.push(`%${q.search}%`);
        i++;
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM affiliates ${where}`,
        values
      );
      const rows = await client.query(
        `SELECT id, tenant_id, user_id, name, code, plan, commission_pct, cpa_amount,
                status, earnings_total, created_at, updated_at,
                (SELECT COUNT(*) FROM affiliate_clicks WHERE affiliate_id = affiliates.id)::int AS clicks_count
           FROM affiliates ${where}
           ORDER BY created_at DESC
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

async function createAffiliate(req: Request, body: z.infer<typeof affiliateSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      try {
        const r = await client.query(
          `INSERT INTO affiliates (
             tenant_id, user_id, name, code, plan, commission_pct, cpa_amount, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, tenant_id, user_id, name, code, plan, commission_pct,
                     cpa_amount, status, earnings_total, created_at, updated_at`,
          [
            tenantId,
            body.user_id ?? null,
            body.name,
            body.code,
            body.plan,
            body.commission_pct,
            body.cpa_amount,
            body.status,
          ]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Affiliate code already exists');
        }
        throw err;
      }
    }
  );
}

async function updateAffiliate(
  req: Request,
  id: string,
  body: z.infer<typeof updateAffiliateSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        sets.push(`${k} = $${i++}`);
        values.push(v);
      }
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE affiliates SET ${sets.join(', ')} WHERE id = $${i}
         RETURNING id, tenant_id, user_id, name, code, plan, commission_pct,
                   cpa_amount, status, earnings_total, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Affiliate not found');
      return r.rows[0];
    }
  );
}

async function deleteAffiliate(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM affiliates WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Affiliate not found');
      return { ok: true };
    }
  );
}

async function getAffiliateStats(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const affiliate = await client.query(
        `SELECT id, tenant_id, user_id, name, code, plan, commission_pct, cpa_amount,
                status, earnings_total::text, created_at, updated_at
           FROM affiliates
          WHERE id = $1`,
        [id]
      );
      if (!affiliate.rows[0]) throw new NotFoundError('Affiliate not found');

      const clicks = await client.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c
           FROM affiliate_clicks
          WHERE affiliate_id = $1`,
        [id]
      );

      const referrals = await client.query(
        `SELECT r.id, r.referrer_id, r.referred_id, r.code, r.bonus_amount::text,
                r.status, r.rewarded_at, r.created_at,
                u.email AS referred_email, u.phone AS referred_phone
           FROM referrals r
           LEFT JOIN users u ON u.id = r.referred_id
          WHERE r.referrer_id = COALESCE((SELECT user_id FROM affiliates WHERE id = $1), '00000000-0000-0000-0000-000000000000'::uuid)
          ORDER BY r.created_at DESC
          LIMIT 200`,
        [id]
      );

      return {
        affiliate: affiliate.rows[0],
        stats: {
          clicks: clicks.rows[0]?.c ?? 0,
          referrals: referrals.rows.length,
          rewarded_referrals: referrals.rows.filter((r) => r.status === 'rewarded')
            .length,
        },
        referrals: referrals.rows,
      };
    }
  );
}

async function processAffiliatePayout(
  req: Request,
  id: string,
  body: z.infer<typeof affiliatePayoutSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const affiliateQ = await client.query<{
        id: string;
        tenant_id: string;
        user_id: string | null;
        earnings_total: string;
        status: string;
      }>(
        `SELECT id, tenant_id, user_id, earnings_total::text, status
           FROM affiliates
          WHERE id = $1
          FOR UPDATE`,
        [id]
      );
      const affiliate = affiliateQ.rows[0];
      if (!affiliate) throw new NotFoundError('Affiliate not found');
      if (affiliate.status !== 'active') {
        throw new ConflictError('Affiliate must be active for payouts');
      }

      const current = Number(affiliate.earnings_total ?? 0);
      if (body.amount > current) {
        throw new ConflictError('Payout amount exceeds affiliate earnings');
      }

      const after = current - body.amount;
      const upd = await client.query(
        `UPDATE affiliates
            SET earnings_total = $1::numeric
          WHERE id = $2
          RETURNING id, tenant_id, user_id, earnings_total::text, status`,
        [after, id]
      );

      if (affiliate.user_id) {
        const walletQ = await client.query<{
          id: string;
          currency: string;
          balance: string;
        }>(
          `SELECT id, currency, balance::text
             FROM wallets
            WHERE tenant_id = $1 AND user_id = $2
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE`,
          [affiliate.tenant_id, affiliate.user_id]
        );
        const wallet = walletQ.rows[0];
        if (wallet) {
          const before = Number(wallet.balance);
          await client.query(
            `UPDATE wallets SET balance = balance + $1::numeric WHERE id = $2`,
            [body.amount, wallet.id]
          );
          await client.query(
            `INSERT INTO transactions
               (tenant_id, wallet_id, user_id, type, amount, before_balance, after_balance, currency, status, metadata)
             VALUES ($1,$2,$3,'commission',$4::numeric,$5::numeric,$6::numeric,$7,'completed',$8::jsonb)`,
            [
              affiliate.tenant_id,
              wallet.id,
              affiliate.user_id,
              body.amount,
              before,
              before + body.amount,
              wallet.currency,
              JSON.stringify({
                source: 'affiliate_payout',
                affiliate_id: id,
                note: body.note ?? null,
              }),
            ]
          );
        }
      }

      return {
        affiliate: upd.rows[0],
        payout_amount: body.amount,
      };
    }
  );
}

async function recordAffiliateClick(
  affiliateCode: string,
  body: z.infer<typeof recordClickSchema>
) {
  return withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
    const aff = await client.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM affiliates WHERE code = $1 AND status = 'active'`,
      [affiliateCode]
    );
    if (!aff.rows[0]) throw new NotFoundError('Affiliate code not found');
    await client.query(
      `INSERT INTO affiliate_clicks (tenant_id, affiliate_id, ip, user_agent, referrer)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        aff.rows[0].tenant_id,
        aff.rows[0].id,
        body.ip ?? null,
        body.user_agent ?? null,
        body.referrer ?? null,
      ]
    );
    return { ok: true };
  });
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
const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

/* Raffles */
router.get('/raffles', wrap((req) => listRaffles(req, raffleListQuery.parse(req.query))));
router.post(
  '/raffles',
  wrapStatus(201, (req) => createRaffle(req, raffleSchema.parse(req.body)))
);
router.put(
  '/raffles/:id',
  wrap((req) => updateRaffle(req, idParam.parse(req.params).id, updateRaffleSchema.parse(req.body)))
);
router.delete('/raffles/:id', wrap((req) => deleteRaffle(req, idParam.parse(req.params).id)));
router.get(
  '/raffles/:id/tickets',
  wrap((req) => listTickets(req, idParam.parse(req.params).id))
);
router.post(
  '/raffles/:id/tickets',
  wrapStatus(201, (req) =>
    addTicket(req, idParam.parse(req.params).id, ticketSchema.parse(req.body))
  )
);
router.post(
  '/raffles/:id/draw',
  wrap((req) => drawRaffle(req, idParam.parse(req.params).id))
);

/* Referrals */
router.get('/referral-codes', wrap((req) => listReferralCodes(req)));
router.post(
  '/referral-codes',
  wrapStatus(201, (req) => createReferralCode(req, referralCodeSchema.parse(req.body)))
);
router.get('/referrals', wrap((req) => listReferrals(req, referralListQuery.parse(req.query))));
router.post(
  '/referrals/:id/reward',
  wrap((req) => rewardReferral(req, idParam.parse(req.params).id))
);

/* Affiliates */
router.get('/affiliates', wrap((req) => listAffiliates(req, affiliateListQuery.parse(req.query))));
router.post(
  '/affiliates',
  wrapStatus(201, (req) => createAffiliate(req, affiliateSchema.parse(req.body)))
);
router.put(
  '/affiliates/:id',
  wrap((req) => updateAffiliate(req, idParam.parse(req.params).id, updateAffiliateSchema.parse(req.body)))
);
router.get(
  '/affiliates/:id/stats',
  wrap((req) => getAffiliateStats(req, idParam.parse(req.params).id))
);
router.post(
  '/affiliates/:id/payout',
  wrap((req) =>
    processAffiliatePayout(
      req,
      idParam.parse(req.params).id,
      affiliatePayoutSchema.parse(req.body)
    )
  )
);
router.delete('/affiliates/:id', wrap((req) => deleteAffiliate(req, idParam.parse(req.params).id)));
router.post(
  '/affiliates/clicks/:code',
  wrap((req) => recordAffiliateClick(codeParam.parse(req.params).code, recordClickSchema.parse(req.body ?? {})))
);

export default router;
