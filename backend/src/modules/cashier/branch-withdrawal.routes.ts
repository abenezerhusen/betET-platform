/**
 * Cashier branch-withdrawal module — Section 16.
 *
 * Routes (mounted under `/api/cashier/withdrawal`):
 *
 *   GET  /pending?code=XXXXXX        — look up a pending branch withdrawal
 *   POST /:id/process                — confirm payout, mark code processed
 *
 * The companion user-side endpoints live under
 * `/api/user/me/branch-withdrawal/*` (see user/branch-withdrawal.routes.ts);
 * together they implement the flow described in Section 16:
 *
 *   1. Player requests withdrawal on the user panel, receives a single-
 *      use code.
 *   2. Player brings the code to any branch.
 *   3. Cashier looks up the code, sees the player + amount, confirms,
 *      hands over the cash.
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

interface WithdrawalCodeRow {
  id: string;
  tenant_id: string;
  user_id: string;
  code: string;
  amount: string;
  currency: string;
  status: string;
  cashier_id: string | null;
  branch_id: string | null;
  processed_at: Date | null;
  expires_at: Date;
  created_at: Date;
  metadata: Record<string, unknown>;
  user_phone: string | null;
  user_email: string | null;
  user_full_name: string | null;
}

const CODE_COLS = `
  bwc.id, bwc.tenant_id, bwc.user_id, bwc.code,
  bwc.amount::text AS amount,
  bwc.currency, bwc.status,
  bwc.cashier_id, bwc.branch_id,
  bwc.processed_at, bwc.expires_at, bwc.created_at, bwc.metadata,
  u.phone AS user_phone,
  u.email AS user_email,
  COALESCE(u.metadata->>'full_name', u.email, u.phone) AS user_full_name
`;

async function loadCodeByValue(
  client: PoolClient,
  tenantId: string,
  code: string
): Promise<WithdrawalCodeRow | null> {
  // The unique partial index guarantees at most one pending row per
  // (tenant, code); the LIMIT is a defensive backstop.
  const r = await client.query<WithdrawalCodeRow>(
    `SELECT ${CODE_COLS}
       FROM branch_withdrawal_codes bwc
       JOIN users u ON u.id = bwc.user_id
      WHERE bwc.tenant_id = $1
        AND bwc.code = $2
      ORDER BY (bwc.status = 'pending') DESC, bwc.created_at DESC
      LIMIT 1`,
    [tenantId, code.trim().toUpperCase()]
  );
  return r.rows[0] ?? null;
}

/* ----------------------------------------------------------------------- */
/* GET /pending?code=XXXXXX                                                */
/* ----------------------------------------------------------------------- */

const pendingQuery = z.object({
  code: z.string().trim().min(4).max(32),
});

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/withdrawal/pending',
  summary: 'Look up a pending branch withdrawal by code',
  tags: ['Cashier Withdrawal'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Pending withdrawal found' },
    '404': { description: 'Code not recognised' },
  },
});

router.get('/pending', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = pendingQuery.parse(req.query);
    const scope = getCashierScope(req);

    const out = await withTenantClient(
      { tenantId: scope.tenantId },
      async (client) => {
        // Opportunistic auto-expire: any rows past their expires_at that
        // are still 'pending' get nudged to 'expired' so the cashier
        // sees a clean error instead of being able to process them.
        await client.query(
          `UPDATE branch_withdrawal_codes
              SET status = 'expired'
            WHERE tenant_id = $1
              AND status = 'pending'
              AND expires_at < now()`,
          [scope.tenantId]
        );

        const row = await loadCodeByValue(client, scope.tenantId, code);
        if (!row) throw new NotFoundError('No withdrawal code matches.');

        if (row.status !== 'pending') {
          // Surface the terminal state instead of pretending we found nothing.
          return {
            id: row.id,
            code: row.code,
            status: row.status,
            amount: Number(row.amount),
            currency: row.currency,
            user_phone: row.user_phone,
            user_full_name: row.user_full_name,
            expires_at: row.expires_at.toISOString(),
            processed_at: row.processed_at?.toISOString() ?? null,
          };
        }

        return {
          id: row.id,
          code: row.code,
          status: row.status,
          amount: Number(row.amount),
          currency: row.currency,
          user_id: row.user_id,
          user_phone: row.user_phone,
          user_email: row.user_email,
          user_full_name: row.user_full_name,
          expires_at: row.expires_at.toISOString(),
          created_at: row.created_at.toISOString(),
        };
      }
    );

    res.json(out);
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------------------------------------------- */
/* POST /:id/process                                                       */
/* ----------------------------------------------------------------------- */

const processParam = z.object({
  id: z.string().uuid(),
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/withdrawal/{id}/process',
  summary: 'Cashier processes (pays out) a pending branch withdrawal',
  tags: ['Cashier Withdrawal'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Processed' },
    '409': { description: 'Already processed / expired' },
  },
});

router.post('/:id/process', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = processParam.parse(req.params);
    const scope = getCashierScope(req);

    const out = await withTenantClient(
      { tenantId: scope.tenantId },
      async (client) => {
        await client.query('BEGIN');
        try {
          // Lock the code row + the user's wallet.
          const lockRes = await client.query<WithdrawalCodeRow>(
            `SELECT ${CODE_COLS}
               FROM branch_withdrawal_codes bwc
               JOIN users u ON u.id = bwc.user_id
              WHERE bwc.tenant_id = $1
                AND bwc.id = $2
              FOR UPDATE OF bwc`,
            [scope.tenantId, id]
          );
          const code = lockRes.rows[0];
          if (!code) throw new NotFoundError('Withdrawal not found');

          if (code.status === 'processed') {
            throw new ConflictError('This withdrawal code has already been processed.', {
              reason: 'already_processed',
            });
          }
          if (code.status !== 'pending') {
            throw new BadRequestError(
              `Withdrawal cannot be processed (status: ${code.status}).`,
              { reason: code.status }
            );
          }
          if (code.expires_at < new Date()) {
            await client.query(
              `UPDATE branch_withdrawal_codes SET status = 'expired' WHERE id = $1`,
              [code.id]
            );
            throw new BadRequestError('This withdrawal code has expired.', {
              reason: 'expired',
            });
          }

          // Resolve cashier branch.
          const meta = await client.query<{
            metadata: Record<string, unknown>;
          }>(
            `SELECT metadata FROM users WHERE id = $1`,
            [scope.cashierId]
          );
          const branchId =
            (meta.rows[0]?.metadata?.['branch_id'] as string | undefined) ??
            null;

          // Locked-balance flow: the user-side endpoint already moved
          // the amount from `balance` into `locked_balance` when they
          // generated the code. Now we move it out of locked_balance.
          const wallet = await client.query<{
            id: string;
            locked_balance: string;
            balance: string;
          }>(
            `SELECT id, locked_balance::text, balance::text
               FROM wallets
              WHERE user_id = $1 AND currency = $2
              ORDER BY created_at ASC
              FOR UPDATE
              LIMIT 1`,
            [code.user_id, code.currency]
          );
          if (!wallet.rows[0]) {
            throw new ConflictError(
              'No wallet found for this user/currency.',
              { reason: 'no_wallet' }
            );
          }
          const w = wallet.rows[0];
          const amount = Number(code.amount);
          const lockedBefore = Number(w.locked_balance);
          if (lockedBefore < amount) {
            // The user's locked balance has been tampered with — refuse
            // to pay and surface a clean error.
            throw new ConflictError(
              'Locked balance is insufficient to cover this withdrawal.',
              {
                reason: 'locked_balance_mismatch',
                locked: lockedBefore,
                amount,
              }
            );
          }
          const lockedAfter = lockedBefore - amount;
          await client.query(
            `UPDATE wallets SET locked_balance = $1, updated_at = now() WHERE id = $2`,
            [lockedAfter.toFixed(4), w.id]
          );

          // Wallet transaction (debit from locked balance → external cash).
          await client.query(
            `INSERT INTO transactions
               (tenant_id, user_id, wallet_id, type, currency, amount,
                before_balance, after_balance, status, reference, metadata)
             VALUES ($1,$2,$3,'withdrawal',$4,$5,$6,$7,'completed',$8,$9::jsonb)`,
            [
              scope.tenantId,
              code.user_id,
              w.id,
              code.currency,
              amount,
              w.balance,
              w.balance,
              `branch_withdrawal:${code.id}`,
              JSON.stringify({
                code: code.code,
                processed_by_cashier_id: scope.cashierId,
                processed_by_branch_id: branchId,
              }),
            ]
          );

          // Cashier transaction (the branch-side ledger).
          await client.query(
            `INSERT INTO cashier_transactions
               (tenant_id, cashier_id, user_id, branch_id, type, amount,
                currency, status, reference, metadata, completed_at)
             VALUES ($1,$2,$3,$4,'withdrawal',$5,$6,'completed',$7,$8::jsonb, now())`,
            [
              scope.tenantId,
              scope.cashierId,
              code.user_id,
              branchId,
              amount.toFixed(2),
              code.currency,
              `branch_withdrawal:${code.id}`,
              JSON.stringify({
                withdrawal_code_id: code.id,
                code: code.code,
              }),
            ]
          );

          // Mark code processed; re-load with the user join for the response.
          await client.query(
            `UPDATE branch_withdrawal_codes
                SET status = 'processed',
                    cashier_id = $2,
                    branch_id = $3,
                    processed_at = now()
              WHERE id = $1`,
            [code.id, scope.cashierId, branchId]
          );
          const refreshed = await client.query<WithdrawalCodeRow>(
            `SELECT ${CODE_COLS}
               FROM branch_withdrawal_codes bwc
               JOIN users u ON u.id = bwc.user_id
              WHERE bwc.id = $1`,
            [code.id]
          );

          await client.query('COMMIT');
          const updated = refreshed.rows[0];
          return {
            id: updated?.id ?? code.id,
            code: updated?.code ?? code.code,
            status: 'processed',
            amount,
            currency: code.currency,
            user_id: code.user_id,
            user_phone: code.user_phone,
            user_full_name: code.user_full_name,
            processed_at:
              updated?.processed_at?.toISOString() ?? new Date().toISOString(),
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
        action: 'cashier.branch_withdrawal.process',
        resource: 'branch_withdrawal_codes',
        resourceId: out.id,
        payload: { code: out.code, amount: out.amount },
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
});

export default router;
