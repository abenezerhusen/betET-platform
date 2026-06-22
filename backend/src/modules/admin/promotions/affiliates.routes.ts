/**
 * /api/admin/affiliates — spec-aligned affiliate management.
 *
 * In addition to the CRUD already exposed at `/api/admin/promotions/affiliates`
 * this surface adds:
 *
 *   - GET    /api/admin/affiliates                  (list with referral counts)
 *   - GET    /api/admin/affiliates/payments         (commission payouts ledger)
 *   - GET    /api/admin/affiliates/commission-config (per-product commission rates)
 *   - PUT    /api/admin/affiliates/commission-config
 *   - GET    /api/admin/affiliates/referrals        (alias to ops referrals)
 *   - POST   /api/admin/affiliates/referrals/:id/approve
 *   - POST   /api/admin/affiliates/referrals/:id/pay
 *   - POST   /api/admin/affiliates/:id/payout       (process commission)
 *
 * The actual affiliate row mutations (create/update/delete) continue to live
 * under `/api/admin/promotions/affiliates` to avoid duplicating write logic.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  ConflictError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
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

const listAffiliatesQuery = z.object({
  status: z.enum(['active', 'paused', 'terminated']).optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const createAffiliateSchema = z.object({
  user_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(2).max(40),
  plan: z.enum(['revenue_share', 'cpa', 'hybrid']).default('revenue_share'),
  commission_pct: z.number().min(0).max(100).default(25),
  cpa_amount: z.number().nonnegative().default(0),
  status: z.enum(['active', 'paused', 'terminated']).default('active'),
});

const payoutSchema = z.object({
  amount: z.number().positive(),
  method: z.string().trim().min(1).max(64).default('wallet'),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

const referralsListQuery = z.object({
  status: z.enum(['all', 'pending', 'paid']).default('all'),
  referrer_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const commissionConfigSchema = z.object({
  sportsbook: z
    .object({
      revenue_share_pct: z.number().min(0).max(100).default(25),
      cpa_amount: z.number().nonnegative().default(0),
      hold_days: z.number().int().nonnegative().default(30),
    })
    .default({}),
  casino: z
    .object({
      revenue_share_pct: z.number().min(0).max(100).default(30),
      cpa_amount: z.number().nonnegative().default(0),
      hold_days: z.number().int().nonnegative().default(30),
    })
    .default({}),
  payments_list: z
    .array(
      z.object({
        type: z.enum(['revenue_share', 'cpa', 'hybrid']).default('revenue_share'),
        product: z.enum(['sportsbook', 'casino']).default('sportsbook'),
        rate: z.number().min(0).default(0),
        threshold: z.number().nonnegative().default(0),
        hold_days: z.number().int().nonnegative().default(0),
        active: z.boolean().default(true),
      })
    )
    .optional(),
});

const paymentsListQuery = z.object({
  status: z.enum(['pending', 'paid', 'all']).default('all'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const COMMISSION_CONFIG_KEY = 'promotions.commission_config';

const DEFAULT_COMMISSION_CONFIG = {
  sportsbook: { revenue_share_pct: 25, cpa_amount: 0, hold_days: 30 },
  casino: { revenue_share_pct: 30, cpa_amount: 0, hold_days: 30 },
  payments_list: [],
};

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

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
/* Affiliates list (spec format)                                          */
/* ---------------------------------------------------------------------- */

router.get(
  '/',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const q = listAffiliatesQuery.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const filters: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (scope.tenantId) {
          filters.push(`a.tenant_id = $${i++}`);
          values.push(scope.tenantId);
        }
        if (q.status) {
          filters.push(`a.status = $${i++}`);
          values.push(q.status);
        }
        if (q.search) {
          filters.push(`(a.name ILIKE $${i} OR a.code ILIKE $${i})`);
          values.push(`%${q.search}%`);
          i++;
        }
        const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
        const total = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM affiliates a ${where}`,
          values
        );
        const rows = await client.query(
          `SELECT a.id,
                  a.tenant_id,
                  a.user_id,
                  a.name,
                  a.code,
                  COALESCE(u.phone, '') AS phone,
                  a.plan,
                  a.commission_pct,
                  a.cpa_amount::text,
                  a.status,
                  a.earnings_total::text,
                  a.created_at,
                  a.updated_at,
                  (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = a.user_id)::int AS total_referrals,
                  (SELECT COUNT(*) FROM referrals r
                     WHERE r.referrer_id = a.user_id AND r.status = 'rewarded')::int AS active_users,
                  COALESCE(
                    (SELECT SUM(stake)::numeric FROM bets b WHERE b.user_id IN (
                       SELECT referred_id FROM referrals WHERE referrer_id = a.user_id
                    )), 0
                  )::text AS revenue_generated,
                  (SELECT COUNT(*) FROM affiliate_clicks WHERE affiliate_id = a.id)::int AS clicks_count
             FROM affiliates a
             LEFT JOIN users u ON u.id = a.user_id
             ${where}
             ORDER BY a.created_at DESC
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
  })
);

router.post(
  '/',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = createAffiliateSchema.parse(req.body);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        try {
          const r = await client.query(
            `INSERT INTO affiliates (
               tenant_id, user_id, name, code, plan, commission_pct, cpa_amount, status
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id, tenant_id, user_id, name, code, plan, commission_pct,
                       cpa_amount::text, status, earnings_total::text, created_at,
                       updated_at`,
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
  })
);

/* ---------------------------------------------------------------------- */
/* Affiliate payments                                                     */
/* ---------------------------------------------------------------------- */

router.get(
  '/payments',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const q = paymentsListQuery.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        // Paid: transactions of type 'commission' that are completed.
        // Pending: affiliates with positive earnings_total balance (not yet paid out).
        const filters: string[] = [`t.type = 'commission'`];
        const values: unknown[] = [];
        let i = 1;
        if (scope.tenantId) {
          filters.push(`t.tenant_id = $${i++}`);
          values.push(scope.tenantId);
        }
        const where = `WHERE ${filters.join(' AND ')}`;

        const paid = await client.query(
          `SELECT t.id,
                  t.tenant_id,
                  t.user_id,
                  t.amount::text,
                  t.currency,
                  t.status,
                  t.created_at,
                  t.metadata,
                  COALESCE(u.phone, u.email, t.user_id::text) AS affiliate,
                  (t.metadata->>'note') AS note,
                  (t.metadata->>'reference') AS reference,
                  (t.metadata->>'method') AS method,
                  (t.metadata->>'affiliate_id') AS affiliate_id
             FROM transactions t
             LEFT JOIN users u ON u.id = t.user_id
             ${where}
             ORDER BY t.created_at DESC
             LIMIT $${i++} OFFSET $${i++}`,
          [...values, q.limit, offset]
        );

        const paidItems = paid.rows.map((row: any) => ({
          id: row.id,
          affiliate: row.affiliate,
          affiliate_id: row.affiliate_id ?? null,
          amount: Number(row.amount ?? 0),
          method: row.method ?? 'wallet',
          status: 'paid',
          reference: row.reference ?? '',
          date: row.created_at,
          note: row.note ?? '',
          currency: row.currency,
        }));

        let pendingItems: unknown[] = [];
        if (q.status !== 'paid') {
          const pf: string[] = [`earnings_total::numeric > 0`];
          const pv: unknown[] = [];
          let pi = 1;
          if (scope.tenantId) {
            pf.push(`a.tenant_id = $${pi++}`);
            pv.push(scope.tenantId);
          }
          const pendingRows = await client.query(
            `SELECT a.id AS affiliate_id,
                    a.name,
                    a.code,
                    a.earnings_total::text AS amount,
                    a.user_id
               FROM affiliates a
              WHERE ${pf.join(' AND ')}
              ORDER BY a.earnings_total::numeric DESC
              LIMIT 200`,
            pv
          );
          pendingItems = pendingRows.rows.map((r: any) => ({
            id: `pending-${r.affiliate_id}`,
            affiliate: r.name,
            affiliate_id: r.affiliate_id,
            amount: Number(r.amount ?? 0),
            method: 'wallet',
            status: 'pending',
            reference: '',
            date: null,
            note: 'Outstanding commission balance',
            currency: 'ETB',
          }));
        }

        const items =
          q.status === 'paid'
            ? paidItems
            : q.status === 'pending'
              ? pendingItems
              : [...pendingItems, ...paidItems];

        return { items, page: q.page, limit: q.limit };
      }
    );
  })
);

/* ---------------------------------------------------------------------- */
/* Commission config                                                      */
/* ---------------------------------------------------------------------- */

router.get(
  '/commission-config',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const row = await client.query<{ value: Record<string, unknown> }>(
          `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2`,
          [tenantId, COMMISSION_CONFIG_KEY]
        );
        return row.rows[0]?.value ?? DEFAULT_COMMISSION_CONFIG;
      }
    );
  })
);

router.put(
  '/commission-config',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = commissionConfigSchema.parse(req.body);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        await client.query(
          `INSERT INTO settings (tenant_id, key, value)
             VALUES ($1,$2,$3::jsonb)
           ON CONFLICT (tenant_id, key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = now()`,
          [tenantId, COMMISSION_CONFIG_KEY, JSON.stringify(body)]
        );
        void tryAudit(
          {
            tenantId,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.affiliate.commission_config.update',
            resource: 'settings',
            resourceId: COMMISSION_CONFIG_KEY,
            payload: { value: body },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );
        return body;
      }
    );
  })
);

/* ---------------------------------------------------------------------- */
/* Affiliate referrals (spec uses /api/admin/affiliates/referrals)         */
/* ---------------------------------------------------------------------- */

router.get(
  '/referrals',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const q = referralsListQuery.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const filters: string[] = ['r.tenant_id = $1'];
        const values: unknown[] = [tenantId];
        let i = 2;
        if (q.status === 'pending') {
          filters.push(`r.status = $${i++}`);
          values.push('pending');
        } else if (q.status === 'paid') {
          filters.push(`r.status = $${i++}`);
          values.push('rewarded');
        }
        if (q.referrer_id) {
          filters.push(`r.referrer_id = $${i++}`);
          values.push(q.referrer_id);
        }
        const where = `WHERE ${filters.join(' AND ')}`;
        const total = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM referrals r ${where}`,
          values
        );
        const rows = await client.query(
          `SELECT r.id,
                  r.referrer_id,
                  r.referred_id,
                  r.code,
                  r.bonus_amount::text,
                  r.status,
                  r.rewarded_at,
                  r.created_at,
                  COALESCE(ref.email, ref.phone, r.referrer_id::text) AS referrer,
                  COALESCE(red.email, red.phone, r.referred_id::text) AS referred_user,
                  red.phone AS referred_phone,
                  r.created_at AS date_joined,
                  (
                    SELECT COALESCE(SUM(amount), 0)::numeric
                      FROM transactions
                     WHERE user_id = r.referred_id
                       AND type IN ('deposit', 'telebirr_deposit')
                       AND status = 'completed'
                  )::text AS deposit_made,
                  (r.status IN ('pending','rewarded')) AS qualified,
                  CASE WHEN r.status = 'rewarded' THEN 'paid' ELSE 'pending' END AS bonus_status,
                  COALESCE(r.bonus_amount, 0)::text AS reward
             FROM referrals r
             LEFT JOIN users ref ON ref.id = r.referrer_id
             LEFT JOIN users red ON red.id = r.referred_id
             ${where}
           ORDER BY r.created_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
          [...values, q.limit, offset]
        );
        return {
          data: rows.rows,
          total: Number(total.rows[0]?.count ?? 0),
          page: q.page,
          limit: q.limit,
        };
      }
    );
  })
);

router.post(
  '/referrals/:id/approve',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const r = await client.query(
          `UPDATE referrals
              SET status = 'pending', updated_at = now()
            WHERE id = $1 AND tenant_id = $2
            RETURNING id, status`,
          [id, tenantId]
        );
        return r.rows[0] ?? { id, status: 'pending' };
      }
    );
  })
);

router.post(
  '/referrals/:id/pay',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        // Mark referral as rewarded and credit the referrer's wallet with
        // bonus_amount. Atomic so a partial credit can't leak through.
        const r = await client.query<{
          id: string;
          referrer_id: string;
          bonus_amount: string;
        }>(
          `UPDATE referrals
              SET status = 'rewarded', rewarded_at = now(), updated_at = now()
            WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
            RETURNING id, referrer_id, bonus_amount::text`,
          [id, tenantId]
        );
        const referral = r.rows[0];
        if (!referral) {
          throw new NotFoundError('Referral not found or already processed');
        }

        const amount = Number(referral.bonus_amount ?? 0);
        if (amount > 0) {
          const wallet = await client.query<{
            id: string;
            currency: string;
            balance: string;
          }>(
            `SELECT id, currency, balance::text
               FROM wallets
              WHERE tenant_id = $1 AND user_id = $2
              ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
            [tenantId, referral.referrer_id]
          );
          if (wallet.rows[0]) {
            const before = Number(wallet.rows[0].balance);
            await client.query(
              `UPDATE wallets SET balance = balance + $1::numeric WHERE id = $2`,
              [amount, wallet.rows[0].id]
            );
            await client.query(
              `INSERT INTO transactions
                 (tenant_id, wallet_id, user_id, type, amount, before_balance, after_balance, currency, status, metadata)
               VALUES ($1,$2,$3,'bonus_credit',$4::numeric,$5::numeric,$6::numeric,$7,'completed',$8::jsonb)`,
              [
                tenantId,
                wallet.rows[0].id,
                referral.referrer_id,
                amount,
                before,
                before + amount,
                wallet.rows[0].currency,
                JSON.stringify({
                  source: 'referral_payout',
                  referral_id: id,
                  kind: 'referral_reward',
                }),
              ]
            );
          }
        }

        void tryAudit(
          {
            tenantId,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.referral.pay',
            resource: 'referrals',
            resourceId: id,
            payload: { referral_id: id, amount },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );

        return {
          id: referral.id,
          status: 'rewarded',
          referrer_id: referral.referrer_id,
          amount,
        };
      }
    );
  })
);

/* ---------------------------------------------------------------------- */
/* Affiliate payout                                                       */
/* ---------------------------------------------------------------------- */

router.post(
  '/:id/payout',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParam.parse(req.params);
    const body = payoutSchema.parse(req.body);
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
        await client.query(
          `UPDATE affiliates SET earnings_total = $1::numeric WHERE id = $2`,
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
                  method: body.method,
                  reference: body.reference ?? null,
                  note: body.note ?? null,
                }),
              ]
            );
          }
        }

        void tryAudit(
          {
            tenantId: affiliate.tenant_id,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.affiliate.payout',
            resource: 'affiliates',
            resourceId: id,
            payload: {
              amount: body.amount,
              method: body.method,
              reference: body.reference ?? null,
            },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );

        return {
          affiliate_id: id,
          amount_paid: body.amount,
          remaining_earnings: after,
          method: body.method,
          reference: body.reference ?? null,
        };
      }
    );
  })
);

export default router;
