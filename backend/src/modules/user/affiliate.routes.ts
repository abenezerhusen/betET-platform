/**
 * User-facing affiliate self-service module.
 *
 * An affiliate (agent) logs into the same user-panel surface and can only ever
 * see and act on **their own** affiliate record — never anyone else's. The
 * matching Admin / Super Admin surface (which sees every affiliate) lives at
 * `/api/admin/affiliates/*`.
 *
 *   GET    /api/user/me/affiliate                 — my profile + stats + balance
 *   PUT    /api/user/me/affiliate/payout-account  — register bank / Telebirr
 *   GET    /api/user/me/affiliate/referrals       — my referred users
 *   GET    /api/user/me/affiliate/withdrawals     — my withdrawal history
 *   POST   /api/user/me/affiliate/withdrawals     — request a withdrawal
 *
 * Payout model: commission is tracked on `affiliates.earnings_total`. A
 * withdrawal request reserves part of that balance (pending/approved requests
 * are held back); the actual money is transferred manually by an admin to the
 * registered bank/Telebirr account, and `earnings_total` is only reduced when
 * the request is marked Paid. Nothing is credited to the wallet automatically.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import * as swagger from '../../swagger/registry';

const router = Router();

function getUserScope(req: Request): { tenantId: string; userId: string } {
  if (!req.user) throw new ForbiddenError('Authentication required');
  if (req.user.role !== 'user' && req.user.role !== 'affiliate') {
    throw new ForbiddenError('End-user role required');
  }
  return { tenantId: req.user.tenantId, userId: req.user.id };
}

interface AffiliateRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  name: string;
  code: string;
  plan: string;
  commission_pct: string;
  cpa_amount: string;
  status: string;
  earnings_total: string;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  telebirr_number: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Resolve the affiliate record linked to the authenticated user (or null). */
async function loadAffiliate(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<AffiliateRow | null> {
  const r = await client.query<AffiliateRow>(
    `SELECT id, tenant_id, user_id, name, code, plan,
            commission_pct::text, cpa_amount::text, status,
            earnings_total::text, bank_name, bank_account_name,
            bank_account_number, telebirr_number, created_at, updated_at
       FROM affiliates
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at ASC
      LIMIT 1`,
    [tenantId, userId]
  );
  return r.rows[0] ?? null;
}

/** Sum of amounts still tied up in pending/approved (not-yet-paid) requests. */
async function reservedAmount(
  client: PoolClient,
  affiliateId: string
): Promise<number> {
  const r = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM affiliate_withdrawals
      WHERE affiliate_id = $1 AND status IN ('pending','approved')`,
    [affiliateId]
  );
  return Number(r.rows[0]?.total ?? 0);
}

function payoutAccountFromRow(a: AffiliateRow) {
  return {
    bank_name: a.bank_name ?? '',
    bank_account_name: a.bank_account_name ?? '',
    bank_account_number: a.bank_account_number ?? '',
    telebirr_number: a.telebirr_number ?? '',
  };
}

/* ---------------------------------------------------------------------- */
/* GET /me/affiliate — profile, stats, commission balance                  */
/* ---------------------------------------------------------------------- */

swagger.registerPath({
  method: 'get',
  path: '/api/user/me/affiliate',
  summary: 'My affiliate profile, statistics and commission balance',
  tags: ['User', 'Affiliate'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Affiliate summary (or is_affiliate=false)' } },
});

router.get(
  '/me/affiliate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          const affiliate = await loadAffiliate(client, scope.tenantId, scope.userId);
          if (!affiliate) return { is_affiliate: false as const };

          const stats = await client.query<{
            total_referrals: number;
            active_users: number;
            revenue_generated: string;
            clicks_count: number;
          }>(
            `SELECT
               (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = $1)::int AS total_referrals,
               (SELECT COUNT(*) FROM referrals r
                  WHERE r.referrer_id = $1 AND r.status = 'rewarded')::int AS active_users,
               COALESCE(
                 (SELECT SUM(stake)::numeric FROM bets b WHERE b.user_id IN (
                    SELECT referred_id FROM referrals WHERE referrer_id = $1
                 )), 0
               )::text AS revenue_generated,
               (SELECT COUNT(*) FROM affiliate_clicks WHERE affiliate_id = $2)::int AS clicks_count`,
            [scope.userId, affiliate.id]
          );

          const reserved = await reservedAmount(client, affiliate.id);
          const paidAgg = await client.query<{ total_paid: string }>(
            `SELECT COALESCE(SUM(amount), 0)::text AS total_paid
               FROM affiliate_withdrawals
              WHERE affiliate_id = $1 AND status = 'paid'`,
            [affiliate.id]
          );

          const earnings = Number(affiliate.earnings_total ?? 0);
          const s = stats.rows[0];
          return {
            is_affiliate: true as const,
            affiliate: {
              id: affiliate.id,
              name: affiliate.name,
              code: affiliate.code,
              plan: affiliate.plan,
              commission_pct: Number(affiliate.commission_pct),
              status: affiliate.status,
              currency: 'ETB',
            },
            balance: {
              // Total commission currently held on the affiliate ledger.
              earnings_total: earnings,
              // Held back by open (pending/approved) withdrawal requests.
              reserved,
              // What can still be requested for withdrawal right now.
              available: Math.max(0, earnings - reserved),
              total_paid: Number(paidAgg.rows[0]?.total_paid ?? 0),
            },
            stats: {
              total_referrals: Number(s?.total_referrals ?? 0),
              active_users: Number(s?.active_users ?? 0),
              revenue_generated: Number(s?.revenue_generated ?? 0),
              clicks: Number(s?.clicks_count ?? 0),
            },
            payout_account: payoutAccountFromRow(affiliate),
          };
        }
      );
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

/* ---------------------------------------------------------------------- */
/* PUT /me/affiliate/payout-account — register bank / Telebirr             */
/* ---------------------------------------------------------------------- */

const payoutAccountSchema = z.object({
  bank_name: z.string().trim().max(160).optional(),
  bank_account_name: z.string().trim().max(160).optional(),
  bank_account_number: z.string().trim().max(64).optional(),
  telebirr_number: z.string().trim().max(32).optional(),
});

swagger.registerPath({
  method: 'put',
  path: '/api/user/me/affiliate/payout-account',
  summary: 'Register / update my bank and Telebirr payout accounts',
  tags: ['User', 'Affiliate'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Updated payout account' } },
});

router.put(
  '/me/affiliate/payout-account',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const body = payoutAccountSchema.parse(req.body ?? {});
      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          const affiliate = await loadAffiliate(client, scope.tenantId, scope.userId);
          if (!affiliate) throw new NotFoundError('You are not an affiliate');
          const r = await client.query<AffiliateRow>(
            `UPDATE affiliates
                SET bank_name = COALESCE($1, bank_name),
                    bank_account_name = COALESCE($2, bank_account_name),
                    bank_account_number = COALESCE($3, bank_account_number),
                    telebirr_number = COALESCE($4, telebirr_number),
                    updated_at = now()
              WHERE id = $5
              RETURNING id, tenant_id, user_id, name, code, plan,
                        commission_pct::text, cpa_amount::text, status,
                        earnings_total::text, bank_name, bank_account_name,
                        bank_account_number, telebirr_number, created_at, updated_at`,
            [
              body.bank_name ?? null,
              body.bank_account_name ?? null,
              body.bank_account_number ?? null,
              body.telebirr_number ?? null,
              affiliate.id,
            ]
          );
          return payoutAccountFromRow(r.rows[0]);
        }
      );
      await tryAudit(
        {
          tenantId: scope.tenantId,
          actorId: scope.userId,
          actorType: 'user',
          action: 'user.affiliate.payout_account.update',
          resource: 'affiliates',
          resourceId: scope.userId,
          payload: { after: out },
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          status: 'success',
        },
        { bypassRls: true }
      );
      res.json({ payout_account: out });
    } catch (err) {
      next(err);
    }
  }
);

/* ---------------------------------------------------------------------- */
/* GET /me/affiliate/referrals — my referred users                         */
/* ---------------------------------------------------------------------- */

const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  page: z.coerce.number().int().positive().default(1),
});

router.get(
  '/me/affiliate/referrals',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const q = listQuery.parse(req.query);
      const offset = (q.page - 1) * q.limit;
      const out = await withTenantClient(
        { tenantId: scope.tenantId, readOnly: true },
        async (client) => {
          const rows = await client.query(
            `SELECT r.id,
                    r.code,
                    r.bonus_amount::text AS bonus_amount,
                    r.status,
                    r.rewarded_at,
                    r.created_at,
                    COALESCE(red.phone, red.email, r.referred_id::text) AS referred_user
               FROM referrals r
               LEFT JOIN users red ON red.id = r.referred_id
              WHERE r.tenant_id = $1 AND r.referrer_id = $2
              ORDER BY r.created_at DESC
              LIMIT $3 OFFSET $4`,
            [scope.tenantId, scope.userId, q.limit, offset]
          );
          return rows.rows.map((row: any) => ({
            id: row.id,
            code: row.code,
            referred_user: row.referred_user,
            bonus_amount: Number(row.bonus_amount ?? 0),
            status: row.status,
            rewarded_at: row.rewarded_at,
            created_at: row.created_at,
          }));
        }
      );
      res.json({ items: out });
    } catch (err) {
      next(err);
    }
  }
);

/* ---------------------------------------------------------------------- */
/* GET /me/affiliate/withdrawals — my withdrawal history                   */
/* ---------------------------------------------------------------------- */

router.get(
  '/me/affiliate/withdrawals',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const q = listQuery.parse(req.query);
      const offset = (q.page - 1) * q.limit;
      const out = await withTenantClient(
        { tenantId: scope.tenantId, readOnly: true },
        async (client) => {
          const affiliate = await loadAffiliate(client, scope.tenantId, scope.userId);
          if (!affiliate) return [];
          const rows = await client.query(
            `SELECT id, amount::text AS amount, currency, method, destination,
                    status, reference, admin_note, requested_at, reviewed_at,
                    paid_at, created_at
               FROM affiliate_withdrawals
              WHERE affiliate_id = $1
              ORDER BY created_at DESC
              LIMIT $2 OFFSET $3`,
            [affiliate.id, q.limit, offset]
          );
          return rows.rows.map((row: any) => ({
            id: row.id,
            amount: Number(row.amount ?? 0),
            currency: row.currency,
            method: row.method,
            destination: row.destination,
            status: row.status,
            reference: row.reference,
            admin_note: row.admin_note,
            requested_at: row.requested_at,
            reviewed_at: row.reviewed_at,
            paid_at: row.paid_at,
            created_at: row.created_at,
          }));
        }
      );
      res.json({ items: out });
    } catch (err) {
      next(err);
    }
  }
);

/* ---------------------------------------------------------------------- */
/* POST /me/affiliate/withdrawals — request a withdrawal                   */
/* ---------------------------------------------------------------------- */

const createWithdrawalSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  method: z.enum(['bank', 'telebirr']),
});

swagger.registerPath({
  method: 'post',
  path: '/api/user/me/affiliate/withdrawals',
  summary: 'Request a commission withdrawal (sent to admin for approval)',
  tags: ['User', 'Affiliate'],
  security: [{ bearerAuth: [] }],
  responses: { '201': { description: 'Withdrawal request created (pending)' } },
});

router.post(
  '/me/affiliate/withdrawals',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const body = createWithdrawalSchema.parse(req.body);
      if (!Number.isFinite(body.amount) || body.amount <= 0) {
        throw new BadRequestError('Amount must be a positive number.', {
          reason: 'invalid_amount',
        });
      }

      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          await client.query('BEGIN');
          try {
            // Lock the affiliate row so two concurrent requests can't both
            // reserve the same commission balance.
            const aq = await client.query<AffiliateRow>(
              `SELECT id, tenant_id, user_id, name, code, plan,
                      commission_pct::text, cpa_amount::text, status,
                      earnings_total::text, bank_name, bank_account_name,
                      bank_account_number, telebirr_number, created_at, updated_at
                 FROM affiliates
                WHERE tenant_id = $1 AND user_id = $2
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE`,
              [scope.tenantId, scope.userId]
            );
            const affiliate = aq.rows[0];
            if (!affiliate) throw new NotFoundError('You are not an affiliate');
            if (affiliate.status !== 'active') {
              throw new ConflictError(
                'Your affiliate account is not active.',
                { reason: affiliate.status }
              );
            }

            // Build + validate the payout destination snapshot.
            let destination: Record<string, string>;
            if (body.method === 'bank') {
              if (!affiliate.bank_account_number || !affiliate.bank_name) {
                throw new BadRequestError(
                  'Register your bank account details before requesting a bank withdrawal.',
                  { reason: 'no_bank_account' }
                );
              }
              destination = {
                bank_name: affiliate.bank_name ?? '',
                bank_account_name: affiliate.bank_account_name ?? '',
                bank_account_number: affiliate.bank_account_number ?? '',
              };
            } else {
              if (!affiliate.telebirr_number) {
                throw new BadRequestError(
                  'Register your Telebirr number before requesting a Telebirr withdrawal.',
                  { reason: 'no_telebirr' }
                );
              }
              destination = { telebirr_number: affiliate.telebirr_number };
            }

            const earnings = Number(affiliate.earnings_total ?? 0);
            const reserved = await reservedAmount(client, affiliate.id);
            const available = Math.max(0, earnings - reserved);
            if (body.amount > available) {
              throw new BadRequestError(
                'Requested amount exceeds your available commission balance.',
                { reason: 'insufficient_balance', available }
              );
            }

            const ins = await client.query<{
              id: string;
              amount: string;
              currency: string;
              method: string;
              destination: Record<string, unknown>;
              status: string;
              requested_at: Date;
              created_at: Date;
            }>(
              `INSERT INTO affiliate_withdrawals
                 (tenant_id, affiliate_id, user_id, amount, currency, method,
                  destination, status)
               VALUES ($1,$2,$3,$4,'ETB',$5,$6::jsonb,'pending')
               RETURNING id, amount::text AS amount, currency, method,
                         destination, status, requested_at, created_at`,
              [
                scope.tenantId,
                affiliate.id,
                scope.userId,
                body.amount.toFixed(2),
                body.method,
                JSON.stringify(destination),
              ]
            );
            await client.query('COMMIT');
            return { row: ins.rows[0], available: available - body.amount };
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          }
        }
      );

      await tryAudit(
        {
          tenantId: scope.tenantId,
          actorId: scope.userId,
          actorType: 'user',
          action: 'user.affiliate.withdrawal.request',
          resource: 'affiliate_withdrawals',
          resourceId: out.row.id,
          payload: { amount: out.row.amount, method: out.row.method },
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          status: 'success',
        },
        { bypassRls: true }
      );

      res.status(201).json({
        id: out.row.id,
        amount: Number(out.row.amount),
        currency: out.row.currency,
        method: out.row.method,
        destination: out.row.destination,
        status: out.row.status,
        available_after: out.available,
        requested_at: out.row.requested_at,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
