/**
 * User-facing branch-withdrawal module — Section 16 companion.
 *
 *   POST   /api/user/me/branch-withdrawal       — request a new code
 *   GET    /api/user/me/branch-withdrawal       — list my codes
 *   DELETE /api/user/me/branch-withdrawal/:id   — cancel a pending code
 *
 * Locked-balance model:
 *   On code creation we move the requested amount from `wallets.balance`
 *   into `wallets.locked_balance`. The cashier-side process route then
 *   debits the locked amount when the cash is handed over. If the user
 *   cancels (or the code expires naturally), the locked balance is
 *   returned to the regular balance.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import crypto from 'crypto';
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
import { emitWalletUpdated } from '../../realtime/socket';
import { assertWithdrawalAllowed } from '../../services/deposit-wagering.service';
import * as swagger from '../../swagger/registry';

const router = Router();

const CODE_TTL_HOURS = 72; // 3 days — matches default cashier expiry semantics
const CODE_LENGTH = 8;
// Alphabet without the visually ambiguous 0/O/1/I/L glyphs so a player
// reading the code off-screen onto a paper slip is unlikely to typo it.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const out: string[] = [];
  for (let i = 0; i < CODE_LENGTH; i++) {
    const idx = crypto.randomInt(0, CODE_ALPHABET.length);
    out.push(CODE_ALPHABET[idx]!);
  }
  return out.join('');
}

function getUserScope(req: Request): { tenantId: string; userId: string } {
  if (!req.user) throw new ForbiddenError('Authentication required');
  if (req.user.role !== 'user' && req.user.role !== 'affiliate') {
    throw new ForbiddenError('End-user role required');
  }
  return { tenantId: req.user.tenantId, userId: req.user.id };
}

const createSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  currency: z.string().trim().min(2).max(8).default('ETB'),
});

swagger.registerPath({
  method: 'post',
  path: '/api/user/me/branch-withdrawal',
  summary: 'Request a single-use cash-out code redeemable at any branch',
  tags: ['User', 'Withdrawal'],
  security: [{ bearerAuth: [] }],
  responses: {
    '201': { description: 'Code created; amount moved to locked_balance' },
  },
});

router.post(
  '/me/branch-withdrawal',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const body = createSchema.parse(req.body);
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
            // Lock the wallet so concurrent withdrawals can't both reserve.
            const w = await client.query<{
              id: string;
              balance: string;
              locked_balance: string;
            }>(
              `SELECT id, balance::text, locked_balance::text
                 FROM wallets
                WHERE user_id = $1 AND currency = $2
                ORDER BY created_at ASC
                FOR UPDATE
                LIMIT 1`,
              [scope.userId, body.currency]
            );
            if (!w.rows[0]) {
              throw new ConflictError('No wallet found for this currency.', {
                reason: 'no_wallet',
              });
            }
            const balance = Number(w.rows[0].balance);
            if (balance < body.amount) {
              throw new BadRequestError('Insufficient balance.', {
                reason: 'insufficient_balance',
                available: balance,
              });
            }
            // Deposit wagering rule — deposited funds must be turned
            // over before a cash-out code can reserve them.
            await assertWithdrawalAllowed(
              client,
              w.rows[0].id,
              balance,
              body.amount
            );
            const newBalance = balance - body.amount;
            const newLocked = Number(w.rows[0].locked_balance) + body.amount;
            await client.query(
              `UPDATE wallets
                  SET balance = $1,
                      locked_balance = $2,
                      updated_at = now()
                WHERE id = $3`,
              [
                newBalance.toFixed(4),
                newLocked.toFixed(4),
                w.rows[0].id,
              ]
            );

            // Generate a unique code (retry on the unlikely collision
            // since the partial unique index covers only `pending`).
            let code = '';
            for (let attempt = 0; attempt < 5; attempt++) {
              code = generateCode();
              const dupe = await client.query<{ count: string }>(
                `SELECT COUNT(*)::text AS count
                   FROM branch_withdrawal_codes
                  WHERE tenant_id = $1 AND code = $2 AND status = 'pending'`,
                [scope.tenantId, code]
              );
              if (Number(dupe.rows[0]?.count ?? 0) === 0) break;
              code = '';
            }
            if (!code) {
              throw new ConflictError(
                'Could not generate a unique code; please retry.',
                { reason: 'code_collision' }
              );
            }

            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + CODE_TTL_HOURS);

            const insRes = await client.query<{
              id: string;
              code: string;
              amount: string;
              currency: string;
              expires_at: Date;
              created_at: Date;
            }>(
              `INSERT INTO branch_withdrawal_codes
                 (tenant_id, user_id, code, amount, currency, expires_at,
                  metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
               RETURNING id, code, amount::text AS amount, currency,
                         expires_at, created_at`,
              [
                scope.tenantId,
                scope.userId,
                code,
                body.amount.toFixed(4),
                body.currency,
                expiresAt,
                JSON.stringify({
                  source: 'user_panel',
                  ttl_hours: CODE_TTL_HOURS,
                }),
              ]
            );

            await client.query('COMMIT');
            return insRes.rows[0];
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
          action: 'user.branch_withdrawal.create',
          resource: 'branch_withdrawal_codes',
          resourceId: out.id,
          payload: { amount: out.amount, code: out.code },
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          status: 'success',
        },
        { bypassRls: true }
      );

      // Reserving the funds reduces available balance immediately — push it.
      emitWalletUpdated(scope.tenantId, scope.userId, {
        reason: 'branch_withdrawal_reserved',
        wallet: null,
        amount: Number(out.amount),
        currency: out.currency,
        withdrawal_code: out.code,
      });

      res.status(201).json({
        id: out.id,
        code: out.code,
        amount: Number(out.amount),
        currency: out.currency,
        status: 'pending',
        expires_at: out.expires_at.toISOString(),
        created_at: out.created_at.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

swagger.registerPath({
  method: 'get',
  path: '/api/user/me/branch-withdrawal',
  summary: 'List my branch withdrawal codes',
  tags: ['User', 'Withdrawal'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'My codes' } },
});

const listQuery = z.object({
  status: z.enum(['pending', 'processed', 'expired', 'cancelled']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

router.get(
  '/me/branch-withdrawal',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const q = listQuery.parse(req.query);
      // NOT read-only: sweepExpired() below performs UPDATE/INSERT to roll
      // expired locked balances back, which Postgres rejects inside a
      // READ ONLY transaction (this was causing the list endpoint to 500 and
      // the user's generated code to never appear).
      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          // Sweep expired rows up before we list.
          await sweepExpired(client, scope.tenantId);
          const filters = ['tenant_id = $1', 'user_id = $2'];
          const values: unknown[] = [scope.tenantId, scope.userId];
          let i = 3;
          if (q.status) {
            filters.push(`status = $${i++}`);
            values.push(q.status);
          }
          const r = await client.query<{
            id: string;
            code: string;
            amount: string;
            currency: string;
            status: string;
            expires_at: Date;
            processed_at: Date | null;
            created_at: Date;
          }>(
            `SELECT id, code, amount::text AS amount, currency, status,
                    expires_at, processed_at, created_at
               FROM branch_withdrawal_codes
              WHERE ${filters.join(' AND ')}
              ORDER BY created_at DESC
              LIMIT $${i}`,
            [...values, q.limit]
          );
          return r.rows.map((row) => ({
            ...row,
            amount: Number(row.amount),
            expires_at: row.expires_at.toISOString(),
            processed_at: row.processed_at?.toISOString() ?? null,
            created_at: row.created_at.toISOString(),
          }));
        }
      );
      res.json({ items: out });
    } catch (err) {
      next(err);
    }
  }
);

async function sweepExpired(client: PoolClient, tenantId: string) {
  // Move pending rows past their expiry into 'expired', and roll the
  // locked balance back into available balance for those rows.
  const expired = await client.query<{
    id: string;
    user_id: string;
    amount: string;
    currency: string;
  }>(
    `UPDATE branch_withdrawal_codes
        SET status = 'expired'
      WHERE tenant_id = $1
        AND status = 'pending'
        AND expires_at < now()
      RETURNING id, user_id, amount::text AS amount, currency`,
    [tenantId]
  );
  for (const r of expired.rows) {
    await unlockBalance(client, {
      tenantId,
      userId: r.user_id,
      amount: Number(r.amount),
      currency: r.currency,
      reference: `branch_withdrawal_expired:${r.id}`,
      reason: 'expired',
    });
  }
}

async function unlockBalance(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    amount: number;
    currency: string;
    reference: string;
    reason: 'expired' | 'cancelled';
  }
) {
  const wallet = await client.query<{
    id: string;
    balance: string;
    locked_balance: string;
  }>(
    `SELECT id, balance::text, locked_balance::text
       FROM wallets
      WHERE user_id = $1 AND currency = $2
      ORDER BY created_at ASC
      FOR UPDATE
      LIMIT 1`,
    [params.userId, params.currency]
  );
  if (!wallet.rows[0]) return;
  const locked = Number(wallet.rows[0].locked_balance);
  const balance = Number(wallet.rows[0].balance);
  const refund = Math.min(locked, params.amount);
  if (refund <= 0) return;
  const newLocked = locked - refund;
  const newBalance = balance + refund;
  await client.query(
    `UPDATE wallets
        SET balance = $1, locked_balance = $2, updated_at = now()
      WHERE id = $3`,
    [newBalance.toFixed(4), newLocked.toFixed(4), wallet.rows[0].id]
  );
  await client.query(
    `INSERT INTO transactions
       (tenant_id, user_id, wallet_id, type, currency, amount,
        before_balance, after_balance, status, reference, metadata)
     VALUES ($1,$2,$3,'bet_refund',$4,$5,$6,$7,'completed',$8,$9::jsonb)`,
    [
      params.tenantId,
      params.userId,
      wallet.rows[0].id,
      params.currency,
      refund,
      balance.toFixed(4),
      newBalance.toFixed(4),
      params.reference,
      JSON.stringify({ reason: params.reason }),
    ]
  );
}

const idParam = z.object({ id: z.string().uuid() });

swagger.registerPath({
  method: 'delete',
  path: '/api/user/me/branch-withdrawal/{id}',
  summary: 'Cancel a pending branch withdrawal code',
  tags: ['User', 'Withdrawal'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Cancelled; locked balance refunded' } },
});

router.delete(
  '/me/branch-withdrawal/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const { id } = idParam.parse(req.params);
      const out = await withTenantClient(
        { tenantId: scope.tenantId },
        async (client) => {
          await client.query('BEGIN');
          try {
            const r = await client.query<{
              id: string;
              user_id: string;
              status: string;
              amount: string;
              currency: string;
            }>(
              `SELECT id, user_id, status, amount::text AS amount, currency
                 FROM branch_withdrawal_codes
                WHERE tenant_id = $1 AND id = $2
                FOR UPDATE`,
              [scope.tenantId, id]
            );
            const row = r.rows[0];
            if (!row) throw new NotFoundError('Withdrawal not found');
            if (row.user_id !== scope.userId) {
              throw new ForbiddenError('Not your withdrawal');
            }
            if (row.status !== 'pending') {
              throw new ConflictError(
                `Cannot cancel a ${row.status} withdrawal.`,
                { reason: row.status }
              );
            }
            await client.query(
              `UPDATE branch_withdrawal_codes
                  SET status = 'cancelled'
                WHERE id = $1`,
              [id]
            );
            await unlockBalance(client, {
              tenantId: scope.tenantId,
              userId: scope.userId,
              amount: Number(row.amount),
              currency: row.currency,
              reference: `branch_withdrawal_cancel:${id}`,
              reason: 'cancelled',
            });
            await client.query('COMMIT');
            return {
              id,
              status: 'cancelled',
              amount: Number(row.amount),
              currency: row.currency,
            };
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          }
        }
      );

      // Cancelling returns the locked funds to available balance — push it.
      emitWalletUpdated(scope.tenantId, scope.userId, {
        reason: 'branch_withdrawal_cancelled',
        wallet: null,
        amount: out.amount,
        currency: out.currency,
      });

      res.json({ id: out.id, status: out.status });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
