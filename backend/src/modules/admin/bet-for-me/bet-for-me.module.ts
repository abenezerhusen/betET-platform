/**
 * Admin "Bet For Me" module — Section 4 of the spec.
 *
 *   GET  /api/admin/bet-for-me/commissions   list commission rates per bet type
 *   PUT  /api/admin/bet-for-me/commissions   bulk-replace commission rates
 *   GET  /api/admin/bet-for-me/transactions  list commission payments collected
 *   GET  /api/admin/bet-for-me/topups        list agent wallet top-ups
 *
 * Storage:
 *   - Commission rates live as a single tenant-setting row keyed
 *     `bet_for_me.commissions` (jsonb {by_bet_type: {single: 5, combo: 7, ...},
 *     default: 5}). This avoids a dedicated table for what is effectively
 *     a small configuration document.
 *
 *   - Commission payments are recorded as `transactions` rows with
 *     `metadata.kind = 'bet_for_me_commission'`. They are emitted by the
 *     cashier panel / bet-placement flow when a bet is placed via the
 *     `bet_for_me` channel.
 *
 *   - Top-ups are `transactions` with `metadata.kind = 'bet_for_me_topup'`.
 *
 * The endpoints are read-mostly; placing a bet through the bet_for_me
 * channel is what creates these rows.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { tryAudit } from '../../audit/audit.service';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';
import {
  findSetting,
  upsertSetting,
} from '../settings/settings.repository';

/* ========================================================================== */
/* Constants                                                                  */
/* ========================================================================== */

const COMMISSION_KEY = 'bet_for_me.commissions';

const DEFAULT_COMMISSIONS = {
  default: 5,
  by_bet_type: {
    single: 3,
    combo: 5,
    system: 7,
    jackpot: 10,
  },
} as const;

/* ========================================================================== */
/* DTOs                                                                       */
/* ========================================================================== */

const commissionEntrySchema = z.object({
  bet_type: z.enum(['single', 'combo', 'system', 'jackpot']),
  rate: z.number().min(0).max(100),
});

const updateCommissionsSchema = z.object({
  default: z.number().min(0).max(100).optional(),
  rates: z.array(commissionEntrySchema).default([]),
});

const txQuery = z.object({
  user_id: z.string().uuid().optional(),
  cashier_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'completed', 'failed', 'reversed']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

type TxQuery = z.infer<typeof txQuery>;

/* ========================================================================== */
/* Service                                                                    */
/* ========================================================================== */

async function listCommissions(req: Request) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const setting = await findSetting(client, tenantId, COMMISSION_KEY);
      const value =
        (setting?.value as
          | {
              default?: number;
              by_bet_type?: Record<string, number>;
            }
          | null
          | undefined) ?? DEFAULT_COMMISSIONS;

      const byType = {
        ...(DEFAULT_COMMISSIONS.by_bet_type as Record<string, number>),
        ...(value.by_bet_type ?? {}),
      };
      const items = Object.entries(byType).map(([bet_type, rate]) => ({
        bet_type,
        rate: Number(rate ?? 0),
        default: Number(value.default ?? DEFAULT_COMMISSIONS.default),
        updated_at: setting?.updated_at ?? null,
        updated_by: setting?.updated_by ?? null,
      }));
      return {
        items,
        default: Number(value.default ?? DEFAULT_COMMISSIONS.default),
        updated_at: setting?.updated_at ?? null,
        updated_by: setting?.updated_by ?? null,
      };
    }
  );
}

async function updateCommissions(
  req: Request,
  body: z.infer<typeof updateCommissionsSchema>
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await findSetting(client, tenantId, COMMISSION_KEY);
      const prev =
        (existing?.value as {
          default?: number;
          by_bet_type?: Record<string, number>;
        } | null | undefined) ?? DEFAULT_COMMISSIONS;
      const byType = { ...(prev.by_bet_type ?? {}) };
      for (const entry of body.rates) {
        byType[entry.bet_type] = entry.rate;
      }
      const next = {
        default: body.default ?? prev.default ?? DEFAULT_COMMISSIONS.default,
        by_bet_type: byType,
      };
      await upsertSetting(client, {
        tenantId,
        key: COMMISSION_KEY,
        value: next,
        description: 'Bet For Me commission rates by bet type',
        category: 'bet_for_me',
        updatedBy: scope.actorId,
      });

      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.bet_for_me.commissions.update',
          resource: 'settings',
          resourceId: COMMISSION_KEY,
          payload: { before: prev, after: next },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );

      return next;
    }
  );
}

/**
 * Generic transactions reader for the Bet-For-Me page tabs. The `kind`
 * argument selects which `metadata.kind` flag to filter on.
 */
async function listTransactions(req: Request, q: TxQuery, kind: string) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const filters: string[] = [`(t.metadata->>'kind') = $1`];
      const values: unknown[] = [kind];
      let i = 2;
      if (scope.tenantId) {
        filters.push(`t.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.user_id) {
        filters.push(`t.user_id = $${i++}`);
        values.push(q.user_id);
      }
      if (q.cashier_id) {
        filters.push(`(t.metadata->>'cashier_id')::uuid = $${i++}`);
        values.push(q.cashier_id);
      }
      if (q.status) {
        filters.push(`t.status = $${i++}`);
        values.push(q.status);
      }
      if (q.from) {
        filters.push(`t.created_at >= $${i++}`);
        values.push(q.from);
      }
      if (q.to) {
        filters.push(`t.created_at <= $${i++}`);
        values.push(q.to);
      }
      if (q.search) {
        filters.push(
          `(u.phone ILIKE $${i} OR u.email ILIKE $${i} OR t.reference ILIKE $${i})`
        );
        values.push(`%${q.search}%`);
        i++;
      }

      const where = `WHERE ${filters.join(' AND ')}`;

      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           ${where}`,
        values
      );

      const rows = await client.query(
        `SELECT t.id, t.tenant_id, t.user_id, t.wallet_id, t.type, t.amount,
                t.before_balance, t.after_balance, t.currency, t.reference,
                t.status, t.metadata, t.created_at,
                u.email AS user_email, u.phone AS user_phone,
                COALESCE(u.metadata->>'full_name', u.email, u.phone) AS user_name,
                c.email AS cashier_email,
                COALESCE(c.metadata->>'full_name', c.metadata->>'name', c.email)
                  AS cashier_name
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           LEFT JOIN users c ON c.id = NULLIF(t.metadata->>'cashier_id','')::uuid
           ${where}
         ORDER BY t.created_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );

      const summary = await client.query<{ total_amount: string; count: string }>(
        `SELECT COALESCE(SUM(t.amount), 0)::text AS total_amount,
                COUNT(*)::text AS count
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           ${where}`,
        values
      );

      return {
        items: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
        summary: summary.rows[0] ?? null,
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

router.get('/commissions', wrap((req) => listCommissions(req)));
router.put(
  '/commissions',
  wrap((req) => updateCommissions(req, updateCommissionsSchema.parse(req.body)))
);
router.get(
  '/transactions',
  wrap((req) => listTransactions(req, txQuery.parse(req.query), 'bet_for_me_commission'))
);
router.get(
  '/topups',
  wrap((req) => listTransactions(req, txQuery.parse(req.query), 'bet_for_me_topup'))
);

export default router;
