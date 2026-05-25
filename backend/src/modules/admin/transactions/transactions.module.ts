/**
 * Admin transactions module — Section 5 of the platform spec.
 *
 * Single, role-protected entry point for the three "transaction explorer"
 * pages the admin panel renders:
 *
 *   GET /api/admin/transactions?type=online    online deposits / withdrawals
 *                                              (P2P + payment-gateway flows)
 *   GET /api/admin/transactions?type=branch    cash transactions handled by
 *                                              cashiers at physical branches
 *   GET /api/admin/transactions?type=wallet    internal wallet movements —
 *                                              bonus credits, admin
 *                                              adjustments, referral payments,
 *                                              wallet-to-wallet transfers
 *
 * The `/branch`, `/online` and `/wallet` legacy paths are preserved as
 * thin aliases of the dispatcher so existing client builds keep working.
 *
 * Every row is read-only here; CRUD on these flows lives in their
 * respective cashier / Telebirr / wallets modules.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { BadRequestError } from '../../../http/errors/http-error';
import { getAdminScope } from '../admin-shared';

/* ========================================================================== */
/* DTOs                                                                       */
/* ========================================================================== */

const dateRange = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const branchQuery = dateRange.extend({
  branch_id: z.string().uuid().optional(),
  cashier_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  type: z
    .enum([
      'deposit',
      'withdrawal',
      'ticket_sell',
      'ticket_payout',
      'ticket_cancel',
      'jackpot_payout',
      'jackpot_sell',
      'adjustment',
    ])
    .optional(),
  status: z
    .enum(['pending', 'approved', 'rejected', 'completed', 'cancelled', 'failed'])
    .optional(),
  phone: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().min(1).max(64).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  min_amount: z.coerce.number().nonnegative().optional(),
  max_amount: z.coerce.number().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const onlineQuery = dateRange.extend({
  type: z.enum(['deposit', 'withdrawal']).optional(),
  status: z
    .enum(['pending', 'completed', 'failed', 'reversed', 'cancelled'])
    .optional(),
  phone: z.string().trim().min(1).max(64).optional(),
  bank: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().min(1).max(64).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  min_amount: z.coerce.number().nonnegative().optional(),
  max_amount: z.coerce.number().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const walletQuery = dateRange.extend({
  user_id: z.string().uuid().optional(),
  phone: z.string().trim().min(1).max(64).optional(),
  /** Filter to a specific reason / wallet-movement category (matches
      `type` and falls back to `metadata.reason` for human labels). */
  reason: z.string().trim().min(1).max(64).optional(),
  /** Convenience filter — 'credit' (positive amount) or 'debit'. */
  direction: z.enum(['credit', 'debit']).optional(),
  /** Backwards-compat: still allow filtering by sender / receiver phone for
      wallet-to-wallet transfer rows. */
  sender_phone: z.string().trim().min(1).max(64).optional(),
  receiver_phone: z.string().trim().min(1).max(64).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  min_amount: z.coerce.number().nonnegative().optional(),
  max_amount: z.coerce.number().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Set of `transactions.type` values that the Wallet page surfaces. The
 * spec calls these "internal wallet movements": bonus credit/debit, admin
 * adjustments, referral / commission payouts and wagering rollovers, plus
 * user-to-user transfers (which are also internal wallet operations).
 */
const WALLET_TX_TYPES = [
  'bonus_credit',
  'bonus_debit',
  'adjustment',
  'commission',
  'transfer_in',
  'transfer_out',
  'rollback',
  'bet_refund',
] as const;

/* ========================================================================== */
/* Service                                                                    */
/* ========================================================================== */

async function listBranchTransactions(
  req: Request,
  query: z.infer<typeof branchQuery>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`ct.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (query.branch_id) {
        filters.push(`ct.branch_id = $${i++}`);
        values.push(query.branch_id);
      }
      if (query.cashier_id) {
        filters.push(`ct.cashier_id = $${i++}`);
        values.push(query.cashier_id);
      }
      if (query.user_id) {
        filters.push(`ct.user_id = $${i++}`);
        values.push(query.user_id);
      }
      if (query.type) {
        filters.push(`ct.type = $${i++}`);
        values.push(query.type);
      }
      if (query.status) {
        filters.push(`ct.status = $${i++}`);
        values.push(query.status);
      }
      if (query.phone) {
        filters.push(
          `(u.phone ILIKE $${i} OR u.email ILIKE $${i} OR ct.metadata->>'phone' ILIKE $${i})`
        );
        values.push(`%${query.phone}%`);
        i++;
      }
      if (query.reason) {
        filters.push(`(ct.metadata->>'reason') ILIKE $${i++}`);
        values.push(`%${query.reason}%`);
      }
      if (query.search) {
        filters.push(
          `(ct.reference ILIKE $${i} OR ct.notes ILIKE $${i} OR u.phone ILIKE $${i} OR u.email ILIKE $${i})`
        );
        values.push(`%${query.search}%`);
        i++;
      }
      if (query.min_amount !== undefined) {
        filters.push(`ct.amount >= $${i++}`);
        values.push(query.min_amount);
      }
      if (query.max_amount !== undefined) {
        filters.push(`ct.amount <= $${i++}`);
        values.push(query.max_amount);
      }
      if (query.from) {
        filters.push(`ct.created_at >= $${i++}`);
        values.push(query.from);
      }
      if (query.to) {
        filters.push(`ct.created_at <= $${i++}`);
        values.push(query.to);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const totalRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM cashier_transactions ct
           LEFT JOIN users u ON u.id = ct.user_id
           ${where}`,
        values
      );

      const itemsRes = await client.query(
        `SELECT ct.id, ct.tenant_id, ct.cashier_id, ct.user_id, ct.branch_id,
                ct.type, ct.amount::numeric AS amount, ct.currency, ct.status,
                ct.reference, ct.notes, ct.metadata, ct.created_at,
                ct.completed_at,
                COALESCE((ct.metadata->>'fee')::numeric, 0)              AS fee,
                ct.metadata->>'reason'                                   AS reason,
                ct.metadata->>'bank'                                     AS bank,
                ct.metadata->>'provider'                                 AS provider,
                ct.metadata->>'nonce'                                    AS nonce,
                ct.metadata->>'session_id'                               AS session_id,
                ct.metadata->>'comment'                                  AS comment,
                u.email   AS user_email,
                u.phone   AS user_phone,
                COALESCE(u.metadata->>'full_name', u.metadata->>'name', u.email, u.phone) AS user_name,
                c.email   AS cashier_email,
                COALESCE(c.metadata->>'full_name', c.metadata->>'name', c.email, c.phone) AS cashier_name,
                br.email  AS branch_email,
                COALESCE(br.metadata->>'name', br.email)                 AS branch_name
           FROM cashier_transactions ct
           LEFT JOIN users u   ON u.id = ct.user_id
           LEFT JOIN users c   ON c.id = ct.cashier_id
           LEFT JOIN users br  ON br.id = ct.branch_id AND br.role = 'branch'
           ${where}
           ORDER BY ct.created_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, query.limit, query.offset]
      );

      const sumRes = await client.query<{
        deposits: string;
        withdrawals: string;
        payouts: string;
        count: string;
      }>(
        `SELECT
            COALESCE(SUM(ct.amount) FILTER (WHERE ct.type = 'deposit'    AND ct.status = 'completed'), 0)::text AS deposits,
            COALESCE(SUM(ct.amount) FILTER (WHERE ct.type = 'withdrawal' AND ct.status = 'completed'), 0)::text AS withdrawals,
            COALESCE(SUM(ct.amount) FILTER (WHERE ct.type IN ('ticket_payout','jackpot_payout') AND ct.status = 'completed'), 0)::text AS payouts,
            COUNT(*)::text AS count
           FROM cashier_transactions ct
           LEFT JOIN users u ON u.id = ct.user_id
           ${where}`,
        values
      );

      return {
        items: itemsRes.rows,
        total: Number(totalRes.rows[0]?.count ?? 0),
        limit: query.limit,
        offset: query.offset,
        summary: sumRes.rows[0] ?? null,
      };
    }
  );
}

async function listOnlineTransactions(
  req: Request,
  query: z.infer<typeof onlineQuery>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      // The "online transactions" admin page is the wallet ledger filtered to
      // online flows — deposits / withdrawals + p2p variants. Cashier-
      // originated rows live in cashier_transactions and never leak in here.
      const filters: string[] = [
        `t.type IN ('deposit','withdrawal','p2p_deposit','p2p_withdrawal')`,
      ];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`t.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (query.type === 'deposit') {
        filters.push(`t.type IN ('deposit','p2p_deposit')`);
      } else if (query.type === 'withdrawal') {
        filters.push(`t.type IN ('withdrawal','p2p_withdrawal')`);
      }
      if (query.status) {
        filters.push(`t.status = $${i++}`);
        values.push(query.status);
      }
      if (query.phone) {
        filters.push(`(u.phone ILIKE $${i} OR u.email ILIKE $${i})`);
        values.push(`%${query.phone}%`);
        i++;
      }
      if (query.bank) {
        filters.push(
          `(t.metadata->>'bank' ILIKE $${i} OR t.metadata->>'provider' ILIKE $${i})`
        );
        values.push(`%${query.bank}%`);
        i++;
      }
      if (query.reason) {
        filters.push(`t.metadata->>'reason' ILIKE $${i++}`);
        values.push(`%${query.reason}%`);
      }
      if (query.search) {
        filters.push(
          `(t.reference ILIKE $${i} OR (t.metadata->>'comment') ILIKE $${i} OR u.phone ILIKE $${i} OR u.email ILIKE $${i})`
        );
        values.push(`%${query.search}%`);
        i++;
      }
      if (query.min_amount !== undefined) {
        filters.push(`ABS(t.amount) >= $${i++}`);
        values.push(query.min_amount);
      }
      if (query.max_amount !== undefined) {
        filters.push(`ABS(t.amount) <= $${i++}`);
        values.push(query.max_amount);
      }
      if (query.from) {
        filters.push(`t.created_at >= $${i++}`);
        values.push(query.from);
      }
      if (query.to) {
        filters.push(`t.created_at <= $${i++}`);
        values.push(query.to);
      }
      const where = `WHERE ${filters.join(' AND ')}`;

      const totalRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           ${where}`,
        values
      );

      const itemsRes = await client.query(
        `SELECT t.id, t.tenant_id, t.wallet_id, t.user_id, t.type,
                t.amount::numeric                            AS amount,
                ABS(t.amount)::numeric                       AS abs_amount,
                t.before_balance::numeric                    AS before_balance,
                t.after_balance::numeric                     AS after_balance,
                t.currency, t.reference, t.status, t.metadata, t.created_at,
                COALESCE((t.metadata->>'fee')::numeric, 0)   AS fee,
                t.metadata->>'reason'                        AS reason,
                t.metadata->>'bank'                          AS bank,
                t.metadata->>'provider'                      AS provider,
                t.metadata->>'nonce'                         AS nonce,
                t.metadata->>'session_id'                    AS session_id,
                t.metadata->>'comment'                       AS comment,
                CASE
                  WHEN t.type IN ('deposit','p2p_deposit')         THEN 'Deposit'
                  WHEN t.type IN ('withdrawal','p2p_withdrawal')   THEN 'Withdrawal'
                  ELSE INITCAP(REPLACE(t.type, '_', ' '))
                END                                          AS direction_label,
                u.email AS user_email,
                u.phone AS user_phone,
                COALESCE(u.metadata->>'full_name', u.metadata->>'name', u.email, u.phone) AS user_name
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           ${where}
           ORDER BY t.created_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, query.limit, query.offset]
      );

      const summaryRes = await client.query<{
        deposits: string;
        withdrawals: string;
        deposit_count: string;
        withdrawal_count: string;
      }>(
        `SELECT
            COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type IN ('deposit','p2p_deposit')       AND t.status = 'completed'), 0)::text AS deposits,
            COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type IN ('withdrawal','p2p_withdrawal') AND t.status = 'completed'), 0)::text AS withdrawals,
            COUNT(*) FILTER (WHERE t.type IN ('deposit','p2p_deposit'))::text       AS deposit_count,
            COUNT(*) FILTER (WHERE t.type IN ('withdrawal','p2p_withdrawal'))::text AS withdrawal_count
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           ${where}`,
        values
      );

      return {
        items: itemsRes.rows,
        total: Number(totalRes.rows[0]?.count ?? 0),
        limit: query.limit,
        offset: query.offset,
        summary: summaryRes.rows[0] ?? null,
      };
    }
  );
}

async function listWalletTransactions(
  req: Request,
  query: z.infer<typeof walletQuery>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      // Show every "internal" wallet movement — bonuses, adjustments,
      // commissions, transfers between users, refunds and rollbacks. The
      // online deposit / withdrawal flow is intentionally excluded so the
      // pages don't double-list the same row.
      const filters: string[] = [`t.type = ANY($1::text[])`];
      const values: unknown[] = [WALLET_TX_TYPES as unknown as string[]];
      let i = 2;

      if (scope.tenantId) {
        filters.push(`t.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (query.user_id) {
        filters.push(`t.user_id = $${i++}`);
        values.push(query.user_id);
      }
      if (query.phone) {
        filters.push(`(u.phone ILIKE $${i} OR u.email ILIKE $${i})`);
        values.push(`%${query.phone}%`);
        i++;
      }
      if (query.reason) {
        filters.push(
          `(t.type = $${i} OR t.metadata->>'reason' ILIKE $${i + 1})`
        );
        values.push(query.reason);
        values.push(`%${query.reason}%`);
        i += 2;
      }
      if (query.direction === 'credit') {
        filters.push(`t.amount > 0`);
      } else if (query.direction === 'debit') {
        filters.push(`t.amount < 0`);
      }
      if (query.sender_phone) {
        // Match transfer_out rows whose owner phone fits.
        filters.push(
          `(t.type = 'transfer_out' AND (u.phone ILIKE $${i} OR u.email ILIKE $${i}))`
        );
        values.push(`%${query.sender_phone}%`);
        i++;
      }
      if (query.receiver_phone) {
        filters.push(
          `(t.type = 'transfer_in' AND (u.phone ILIKE $${i} OR u.email ILIKE $${i}))`
        );
        values.push(`%${query.receiver_phone}%`);
        i++;
      }
      if (query.search) {
        filters.push(
          `(t.reference ILIKE $${i} OR (t.metadata->>'comment') ILIKE $${i} OR u.phone ILIKE $${i} OR u.email ILIKE $${i})`
        );
        values.push(`%${query.search}%`);
        i++;
      }
      if (query.min_amount !== undefined) {
        filters.push(`ABS(t.amount) >= $${i++}`);
        values.push(query.min_amount);
      }
      if (query.max_amount !== undefined) {
        filters.push(`ABS(t.amount) <= $${i++}`);
        values.push(query.max_amount);
      }
      if (query.from) {
        filters.push(`t.created_at >= $${i++}`);
        values.push(query.from);
      }
      if (query.to) {
        filters.push(`t.created_at <= $${i++}`);
        values.push(query.to);
      }
      const where = `WHERE ${filters.join(' AND ')}`;

      const totalRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           ${where}`,
        values
      );

      const itemsRes = await client.query(
        `SELECT t.id, t.tenant_id, t.wallet_id, t.user_id, t.type,
                t.amount::numeric                            AS amount,
                ABS(t.amount)::numeric                       AS abs_amount,
                CASE WHEN t.amount >= 0 THEN 'Credit' ELSE 'Debit' END AS direction,
                t.before_balance::numeric                    AS before_balance,
                t.after_balance::numeric                     AS after_balance,
                t.currency, t.reference, t.status, t.metadata, t.created_at,
                COALESCE(t.metadata->>'reason',
                         CASE t.type
                           WHEN 'bonus_credit' THEN 'Bonus credit'
                           WHEN 'bonus_debit'  THEN 'Bonus conversion'
                           WHEN 'adjustment'   THEN 'Admin adjustment'
                           WHEN 'commission'   THEN 'Commission'
                           WHEN 'transfer_in'  THEN 'Wallet transfer (in)'
                           WHEN 'transfer_out' THEN 'Wallet transfer (out)'
                           WHEN 'rollback'     THEN 'Rollback'
                           WHEN 'bet_refund'   THEN 'Bet refund'
                           ELSE INITCAP(REPLACE(t.type, '_', ' '))
                         END)                                AS reason,
                t.metadata->>'comment'                       AS comment,
                t.metadata->>'transfer_id'                   AS transfer_id,
                t.metadata->>'admin_action'                  AS admin_action,
                u.email                                      AS user_email,
                u.phone                                      AS user_phone,
                COALESCE(u.metadata->>'full_name', u.metadata->>'name', u.email, u.phone)
                                                             AS user_name,
                COALESCE(t.metadata->>'counterparty_phone',
                         t.metadata->>'sender_phone',
                         t.metadata->>'receiver_phone')      AS counterparty_phone,
                COALESCE(t.metadata->>'counterparty_name',
                         t.metadata->>'sender_name',
                         t.metadata->>'receiver_name')       AS counterparty_name
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           ${where}
           ORDER BY t.created_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, query.limit, query.offset]
      );

      const summaryRes = await client.query<{
        credits: string;
        debits: string;
        bonus_total: string;
        adjustment_total: string;
        count: string;
      }>(
        `SELECT
            COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text                                  AS credits,
            COALESCE(SUM(-t.amount) FILTER (WHERE t.amount < 0), 0)::text                                 AS debits,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type IN ('bonus_credit','bonus_debit')), 0)::text      AS bonus_total,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'adjustment'), 0)::text                         AS adjustment_total,
            COUNT(*)::text                                                                                AS count
           FROM transactions t
           LEFT JOIN users u ON u.id = t.user_id
           ${where}`,
        values
      );

      return {
        items: itemsRes.rows,
        total: Number(totalRes.rows[0]?.count ?? 0),
        limit: query.limit,
        offset: query.offset,
        summary: summaryRes.rows[0] ?? null,
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

/**
 * Section 5 unified entry point. Accepts a `?type=online|branch|wallet`
 * query parameter and parses the rest of the query against the matching
 * Zod schema so each tab gets exactly the filters it understands.
 */
router.get(
  '/',
  wrap(async (req) => {
    const t = String(req.query.type ?? 'online').toLowerCase();
    if (t === 'online') {
      return listOnlineTransactions(req, onlineQuery.parse(req.query));
    }
    if (t === 'branch' || t === 'offline') {
      return listBranchTransactions(req, branchQuery.parse(req.query));
    }
    if (t === 'wallet') {
      return listWalletTransactions(req, walletQuery.parse(req.query));
    }
    throw new BadRequestError(
      `Unknown transactions type "${t}" — expected one of: online, branch, wallet.`
    );
  })
);

/* Legacy aliases kept for backwards compatibility with older bundles. */
router.get(
  '/branch',
  wrap((req) => listBranchTransactions(req, branchQuery.parse(req.query)))
);
router.get(
  '/online',
  wrap((req) => listOnlineTransactions(req, onlineQuery.parse(req.query)))
);
router.get(
  '/wallet',
  wrap((req) => listWalletTransactions(req, walletQuery.parse(req.query)))
);

export default router;
