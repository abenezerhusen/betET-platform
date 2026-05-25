import type { PoolClient } from 'pg';

/* ------------------------------------------------------------------------- */
/* Types                                                                     */
/* ------------------------------------------------------------------------- */

export interface UserSummaryRow {
  id: string;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  kyc_status: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  last_login_at: Date | null;
}

export interface WalletRow {
  id: string;
  tenant_id: string;
  user_id: string;
  currency: string;
  balance: string;
  bonus_balance: string;
  locked_balance: string;
  status: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface TransactionRow {
  id: string;
  tenant_id: string;
  wallet_id: string;
  user_id: string | null;
  type: string;
  amount: string;
  before_balance: string;
  after_balance: string;
  currency: string;
  reference: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface CashierTransactionRow {
  id: string;
  tenant_id: string;
  cashier_id: string;
  user_id: string | null;
  shift_id: string | null;
  branch_id: string | null;
  type: string;
  amount: string;
  currency: string;
  status: string;
  reference: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  completed_at: Date | null;
}

export interface ShiftRow {
  id: string;
  tenant_id: string;
  cashier_id: string;
  branch_id: string | null;
  status: string;
  opening_balance: string;
  closing_balance: string | null;
  expected_balance: string | null;
  variance: string | null;
  total_deposits: string;
  total_withdrawals: string;
  deposit_count: number;
  withdrawal_count: number;
  currency: string;
  opened_at: Date;
  closed_at: Date | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const SELECT_USER = `
  id, tenant_id, email, phone, role, status, kyc_status, metadata,
  created_at, last_login_at
`;

const SELECT_WALLET = `
  id, tenant_id, user_id, currency, balance, bonus_balance, locked_balance,
  status, version, created_at, updated_at
`;

const SELECT_TX = `
  id, tenant_id, wallet_id, user_id, type, amount,
  before_balance, after_balance, currency, reference,
  status, metadata, created_at
`;

const SELECT_CASHIER_TX = `
  id, tenant_id, cashier_id, user_id, shift_id, branch_id, type, amount,
  currency, status, reference, notes, metadata, created_at, completed_at
`;

const SELECT_SHIFT = `
  id, tenant_id, cashier_id, branch_id, status, opening_balance,
  closing_balance, expected_balance, variance, total_deposits,
  total_withdrawals, deposit_count, withdrawal_count, currency,
  opened_at, closed_at, notes, metadata, created_at, updated_at
`;

/* ------------------------------------------------------------------------- */
/* Settings                                                                  */
/* ------------------------------------------------------------------------- */

/** Returns the parsed jsonb value for `key` in this tenant, or null. */
export async function getSettingValue<T = unknown>(
  client: PoolClient,
  tenantId: string,
  key: string
): Promise<T | null> {
  const r = await client.query<{ value: T }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, key]
  );
  return r.rows[0]?.value ?? null;
}

interface PaymentLimits {
  min_deposit?: number;
  max_deposit?: number;
  min_withdrawal?: number;
  max_withdrawal?: number;
}
interface GeneralSettings {
  currency?: string;
}

export async function getPaymentLimits(
  client: PoolClient,
  tenantId: string
): Promise<Required<PaymentLimits>> {
  const v = (await getSettingValue<PaymentLimits>(client, tenantId, 'payment')) ?? {};
  return {
    min_deposit: v.min_deposit ?? 0,
    max_deposit: v.max_deposit ?? Number.POSITIVE_INFINITY,
    min_withdrawal: v.min_withdrawal ?? 0,
    max_withdrawal: v.max_withdrawal ?? Number.POSITIVE_INFINITY,
  };
}

export async function getDefaultCurrency(
  client: PoolClient,
  tenantId: string
): Promise<string> {
  const v = await getSettingValue<GeneralSettings>(client, tenantId, 'general');
  return v?.currency ?? 'ETB';
}

/* ------------------------------------------------------------------------- */
/* Users                                                                     */
/* ------------------------------------------------------------------------- */

export async function findUserById(
  client: PoolClient,
  id: string
): Promise<UserSummaryRow | null> {
  const r = await client.query<UserSummaryRow>(
    `SELECT ${SELECT_USER} FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function searchUsers(
  client: PoolClient,
  tenantId: string,
  params: {
    query: string | null;
    phone: string | null;
    email: string | null;
    userId: string | null;
    limit: number;
  }
): Promise<UserSummaryRow[]> {
  const filters: string[] = [`tenant_id = $1`];
  const values: unknown[] = [tenantId];
  let i = 2;

  if (params.userId && UUID_RE.test(params.userId)) {
    filters.push(`id = $${i++}::uuid`);
    values.push(params.userId);
  }
  if (params.phone) {
    filters.push(`phone = $${i++}`);
    values.push(params.phone);
  }
  if (params.email) {
    filters.push(`email = $${i++}::citext`);
    values.push(params.email);
  }
  if (params.query) {
    const q = params.query;
    if (UUID_RE.test(q)) {
      filters.push(`id = $${i++}::uuid`);
      values.push(q);
    } else {
      filters.push(
        `(phone ILIKE $${i} OR email::text ILIKE $${i} OR (metadata->>'username') ILIKE $${i})`
      );
      values.push(`%${q}%`);
      i++;
    }
  }

  const where = `WHERE ${filters.join(' AND ')}`;
  const r = await client.query<UserSummaryRow>(
    `SELECT ${SELECT_USER}
       FROM users
       ${where}
      ORDER BY created_at DESC
      LIMIT $${i++}`,
    [...values, params.limit]
  );
  return r.rows;
}

export async function setUserKyc(
  client: PoolClient,
  id: string,
  kycStatus: string
): Promise<UserSummaryRow | null> {
  const r = await client.query<UserSummaryRow>(
    `UPDATE users
        SET kyc_status = $2, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_USER}`,
    [id, kycStatus]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Wallets                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Acquire a row lock on the user's wallet for the given currency. Returns
 * null if the wallet does not exist (typical for first withdrawal attempt
 * on a brand-new user).
 */
export async function findWalletForUpdate(
  client: PoolClient,
  tenantId: string,
  userId: string,
  currency: string
): Promise<WalletRow | null> {
  const r = await client.query<WalletRow>(
    `SELECT ${SELECT_WALLET}
       FROM wallets
      WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
      FOR UPDATE`,
    [tenantId, userId, currency]
  );
  return r.rows[0] ?? null;
}

/**
 * For deposits: ensure the wallet row exists (idempotent), then take a row
 * lock and return it. The INSERT … ON CONFLICT DO NOTHING is safe under
 * concurrent calls because the unique index (tenant_id, user_id, currency)
 * prevents duplicates.
 */
export async function ensureWalletForUpdate(
  client: PoolClient,
  tenantId: string,
  userId: string,
  currency: string
): Promise<WalletRow> {
  await client.query(
    `INSERT INTO wallets (tenant_id, user_id, currency, balance)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT ON CONSTRAINT wallets_user_currency_unique DO NOTHING`,
    [tenantId, userId, currency]
  );
  const wallet = await findWalletForUpdate(client, tenantId, userId, currency);
  if (!wallet) {
    // Should not happen — the INSERT above guarantees existence.
    throw new Error('failed to acquire wallet row');
  }
  return wallet;
}

/** Caller MUST already hold a row lock on the wallet (FOR UPDATE). */
export async function applyWalletCredit(
  client: PoolClient,
  walletId: string,
  amount: string
): Promise<WalletRow> {
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET balance    = balance + $2::numeric,
            version    = version + 1,
            updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_WALLET}`,
    [walletId, amount]
  );
  return r.rows[0];
}

/**
 * Atomic debit: WHERE balance >= amount ensures non-negative result without
 * an app-level race. Returns null when insufficient balance.
 * Caller MUST already hold a row lock on the wallet.
 */
export async function applyWalletDebit(
  client: PoolClient,
  walletId: string,
  amount: string
): Promise<WalletRow | null> {
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET balance    = balance - $2::numeric,
            version    = version + 1,
            updated_at = now()
      WHERE id = $1
        AND balance >= $2::numeric
      RETURNING ${SELECT_WALLET}`,
    [walletId, amount]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Transactions (wallet ledger)                                              */
/* ------------------------------------------------------------------------- */

export async function findTransactionByReference(
  client: PoolClient,
  tenantId: string,
  reference: string
): Promise<TransactionRow | null> {
  const r = await client.query<TransactionRow>(
    `SELECT ${SELECT_TX}
       FROM transactions
      WHERE tenant_id = $1 AND reference = $2
      LIMIT 1`,
    [tenantId, reference]
  );
  return r.rows[0] ?? null;
}

export async function insertWalletTransaction(
  client: PoolClient,
  params: {
    tenantId: string;
    walletId: string;
    userId: string;
    type: string;
    amount: string;
    beforeBalance: string;
    afterBalance: string;
    currency: string;
    reference: string;
    metadata: Record<string, unknown>;
    status?: string;
  }
): Promise<TransactionRow> {
  const r = await client.query<TransactionRow>(
    `INSERT INTO transactions
       (tenant_id, wallet_id, user_id, type, amount, before_balance,
        after_balance, currency, reference, metadata, status)
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric,
             $8, $9, $10::jsonb, $11)
     RETURNING ${SELECT_TX}`,
    [
      params.tenantId,
      params.walletId,
      params.userId,
      params.type,
      params.amount,
      params.beforeBalance,
      params.afterBalance,
      params.currency,
      params.reference,
      JSON.stringify(params.metadata),
      params.status ?? 'completed',
    ]
  );
  return r.rows[0];
}

export async function listTransactionsForUser(
  client: PoolClient,
  tenantId: string,
  userId: string,
  params: { limit: number; offset: number }
): Promise<{ rows: TransactionRow[]; total: number }> {
  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM transactions
      WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId]
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<TransactionRow>(
    `SELECT ${SELECT_TX}
       FROM transactions
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [tenantId, userId, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

/* ------------------------------------------------------------------------- */
/* Cashier transactions                                                      */
/* ------------------------------------------------------------------------- */

export async function findCashierTxByReference(
  client: PoolClient,
  tenantId: string,
  reference: string
): Promise<CashierTransactionRow | null> {
  const r = await client.query<CashierTransactionRow>(
    `SELECT ${SELECT_CASHIER_TX}
       FROM cashier_transactions
      WHERE tenant_id = $1 AND reference = $2
      LIMIT 1`,
    [tenantId, reference]
  );
  return r.rows[0] ?? null;
}

export async function insertCashierTransaction(
  client: PoolClient,
  params: {
    tenantId: string;
    cashierId: string;
    userId: string;
    shiftId: string | null;
    branchId: string | null;
    type: 'deposit' | 'withdrawal';
    amount: string;
    currency: string;
    reference: string;
    notes: string | null;
    metadata: Record<string, unknown>;
  }
): Promise<CashierTransactionRow> {
  const r = await client.query<CashierTransactionRow>(
    `INSERT INTO cashier_transactions
       (tenant_id, cashier_id, user_id, shift_id, branch_id, type, amount,
        currency, status, reference, notes, metadata, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, 'completed',
             $9, $10, $11::jsonb, now())
     RETURNING ${SELECT_CASHIER_TX}`,
    [
      params.tenantId,
      params.cashierId,
      params.userId,
      params.shiftId,
      params.branchId,
      params.type,
      params.amount,
      params.currency,
      params.reference,
      params.notes,
      JSON.stringify(params.metadata),
    ]
  );
  return r.rows[0];
}

export interface CashierTxWithUser extends CashierTransactionRow {
  user_email: string | null;
  user_phone: string | null;
  user_username: string | null;
  user_full_name: string | null;
}

export async function listCashierTransactionsForCashier(
  client: PoolClient,
  tenantId: string,
  cashierId: string,
  params: {
    type: string | null;
    status: string | null;
    shiftId: string | null;
    from: Date | null;
    to: Date | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: CashierTxWithUser[]; total: number }> {
  const filters: string[] = [`ct.tenant_id = $1`, `ct.cashier_id = $2`];
  const values: unknown[] = [tenantId, cashierId];
  let i = 3;

  if (params.type) {
    filters.push(`ct.type = $${i++}`);
    values.push(params.type);
  }
  if (params.status) {
    filters.push(`ct.status = $${i++}`);
    values.push(params.status);
  }
  if (params.shiftId) {
    filters.push(`ct.shift_id = $${i++}`);
    values.push(params.shiftId);
  }
  if (params.from) {
    filters.push(`ct.created_at >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    filters.push(`ct.created_at <= $${i++}`);
    values.push(params.to);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM cashier_transactions ct ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<CashierTxWithUser>(
    `SELECT ct.id, ct.tenant_id, ct.cashier_id, ct.user_id, ct.shift_id,
            ct.branch_id, ct.type, ct.amount, ct.currency, ct.status,
            ct.reference, ct.notes, ct.metadata, ct.created_at, ct.completed_at,
            u.email::text AS user_email,
            u.phone        AS user_phone,
            NULLIF(u.metadata->>'username','') AS user_username,
            NULLIF(u.metadata->>'full_name','') AS user_full_name
       FROM cashier_transactions ct
       LEFT JOIN users u ON u.id = ct.user_id
       ${where}
      ORDER BY ct.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

export async function findCashierTransactionById(
  client: PoolClient,
  tenantId: string,
  cashierId: string,
  id: string
): Promise<CashierTxWithUser | null> {
  const r = await client.query<CashierTxWithUser>(
    `SELECT ct.id, ct.tenant_id, ct.cashier_id, ct.user_id, ct.shift_id,
            ct.branch_id, ct.type, ct.amount, ct.currency, ct.status,
            ct.reference, ct.notes, ct.metadata, ct.created_at, ct.completed_at,
            u.email::text AS user_email,
            u.phone        AS user_phone,
            NULLIF(u.metadata->>'username','') AS user_username,
            NULLIF(u.metadata->>'full_name','') AS user_full_name
       FROM cashier_transactions ct
       LEFT JOIN users u ON u.id = ct.user_id
      WHERE ct.tenant_id = $1
        AND ct.cashier_id = $2
        AND ct.id = $3
      LIMIT 1`,
    [tenantId, cashierId, id]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Shifts                                                                    */
/* ------------------------------------------------------------------------- */

export async function findOpenShiftForCashier(
  client: PoolClient,
  tenantId: string,
  cashierId: string
): Promise<ShiftRow | null> {
  const r = await client.query<ShiftRow>(
    `SELECT ${SELECT_SHIFT}
       FROM cashier_shifts
      WHERE tenant_id = $1 AND cashier_id = $2 AND status = 'open'
      LIMIT 1`,
    [tenantId, cashierId]
  );
  return r.rows[0] ?? null;
}

export async function findShiftById(
  client: PoolClient,
  id: string
): Promise<ShiftRow | null> {
  const r = await client.query<ShiftRow>(
    `SELECT ${SELECT_SHIFT} FROM cashier_shifts WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function insertShift(
  client: PoolClient,
  params: {
    tenantId: string;
    cashierId: string;
    branchId: string | null;
    openingBalance: string;
    currency: string;
    notes: string | null;
    metadata: Record<string, unknown>;
  }
): Promise<ShiftRow> {
  const r = await client.query<ShiftRow>(
    `INSERT INTO cashier_shifts
       (tenant_id, cashier_id, branch_id, opening_balance, currency,
        notes, metadata)
     VALUES ($1, $2, $3, $4::numeric, $5, $6, $7::jsonb)
     RETURNING ${SELECT_SHIFT}`,
    [
      params.tenantId,
      params.cashierId,
      params.branchId,
      params.openingBalance,
      params.currency,
      params.notes,
      JSON.stringify(params.metadata),
    ]
  );
  return r.rows[0];
}

export interface ShiftAggregates {
  total_deposits: string;
  total_withdrawals: string;
  deposit_count: number;
  withdrawal_count: number;
}

export async function aggregateShift(
  client: PoolClient,
  shiftId: string
): Promise<ShiftAggregates> {
  const r = await client.query<ShiftAggregates>(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0)    AS total_deposits,
            COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0) AS total_withdrawals,
            COUNT(*) FILTER (WHERE type = 'deposit')::int    AS deposit_count,
            COUNT(*) FILTER (WHERE type = 'withdrawal')::int AS withdrawal_count
       FROM cashier_transactions
      WHERE shift_id = $1 AND status = 'completed'`,
    [shiftId]
  );
  return r.rows[0];
}

export async function closeShift(
  client: PoolClient,
  params: {
    id: string;
    closingBalance: string;
    expectedBalance: string;
    variance: string;
    totalDeposits: string;
    totalWithdrawals: string;
    depositCount: number;
    withdrawalCount: number;
    notes: string | null;
  }
): Promise<ShiftRow | null> {
  const r = await client.query<ShiftRow>(
    `UPDATE cashier_shifts
        SET status            = 'closed',
            closing_balance   = $2::numeric,
            expected_balance  = $3::numeric,
            variance          = $4::numeric,
            total_deposits    = $5::numeric,
            total_withdrawals = $6::numeric,
            deposit_count     = $7,
            withdrawal_count  = $8,
            closed_at         = now(),
            notes             = COALESCE($9, notes),
            updated_at        = now()
      WHERE id = $1 AND status = 'open'
      RETURNING ${SELECT_SHIFT}`,
    [
      params.id,
      params.closingBalance,
      params.expectedBalance,
      params.variance,
      params.totalDeposits,
      params.totalWithdrawals,
      params.depositCount,
      params.withdrawalCount,
      params.notes,
    ]
  );
  return r.rows[0] ?? null;
}
