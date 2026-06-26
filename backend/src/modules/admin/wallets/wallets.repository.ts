import type { PoolClient } from 'pg';

export interface WalletRow {
  id: string;
  tenant_id: string;
  user_id: string;
  currency: string;
  balance: string;
  bonus_balance: string;
  locked_balance: string;
  withdrawable_balance: string;
  payable_balance: string;
  status: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface WalletWithUserRow extends WalletRow {
  user_email: string | null;
  user_phone: string | null;
  user_status: string;
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

const SELECT_WALLET = `
  id, tenant_id, user_id, currency, balance, bonus_balance, locked_balance,
  withdrawable_balance, payable_balance, status, version, created_at, updated_at
`;

// Same columns but table-aliased for queries that JOIN with users (avoids
// "column reference is ambiguous" errors on id, status, etc.).
const SELECT_WALLET_W = `
  w.id, w.tenant_id, w.user_id, w.currency, w.balance, w.bonus_balance,
  w.locked_balance, w.withdrawable_balance, w.payable_balance,
  w.status, w.version, w.created_at, w.updated_at
`;

export async function listWallets(
  client: PoolClient,
  scopeTenantId: string | null,
  params: {
    userId: string | null;
    currency: string | null;
    status: string | null;
    minBalance: number | null;
    maxBalance: number | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: WalletWithUserRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (scopeTenantId) {
    filters.push(`w.tenant_id = $${i++}`);
    values.push(scopeTenantId);
  }
  if (params.userId) {
    filters.push(`w.user_id = $${i++}`);
    values.push(params.userId);
  }
  if (params.currency) {
    filters.push(`w.currency = $${i++}`);
    values.push(params.currency);
  }
  if (params.status) {
    filters.push(`w.status = $${i++}`);
    values.push(params.status);
  }
  if (params.minBalance !== null) {
    filters.push(`w.balance >= $${i++}::numeric`);
    values.push(params.minBalance);
  }
  if (params.maxBalance !== null) {
    filters.push(`w.balance <= $${i++}::numeric`);
    values.push(params.maxBalance);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM wallets w ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<WalletWithUserRow>(
    `SELECT ${SELECT_WALLET_W},
            u.email::text AS user_email,
            u.phone       AS user_phone,
            u.status      AS user_status
       FROM wallets w
       LEFT JOIN users u ON u.id = w.user_id
       ${where}
      ORDER BY w.updated_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

export async function findWalletByIdForUpdate(
  client: PoolClient,
  id: string
): Promise<WalletRow | null> {
  const r = await client.query<WalletRow>(
    `SELECT ${SELECT_WALLET}
       FROM wallets
      WHERE id = $1
      FOR UPDATE`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function findWalletById(
  client: PoolClient,
  id: string
): Promise<WalletRow | null> {
  const r = await client.query<WalletRow>(
    `SELECT ${SELECT_WALLET} FROM wallets WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

/** Which balance bucket a credit/debit targets. */
export type WalletBucket = 'deductable' | 'withdrawable' | 'payable';

const BUCKET_COLUMN: Record<WalletBucket, string> = {
  deductable: 'balance',
  withdrawable: 'withdrawable_balance',
  payable: 'payable_balance',
};

/** Credit a specific bucket by `amount`. Caller MUST hold a row lock. */
export async function creditWalletBalance(
  client: PoolClient,
  id: string,
  amount: string,
  bucket: WalletBucket = 'deductable'
): Promise<WalletRow> {
  const col = BUCKET_COLUMN[bucket];
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET ${col}      = ${col} + $2::numeric,
            version     = version + 1,
            updated_at  = now()
      WHERE id = $1
      RETURNING ${SELECT_WALLET}`,
    [id, amount]
  );
  return r.rows[0];
}

/**
 * Debit a specific bucket by `amount`. Atomic: the WHERE clause checks the
 * target bucket >= amount. Returns null when insufficient balance.
 * Caller MUST already hold a row lock on the wallet.
 */
export async function debitWalletBalance(
  client: PoolClient,
  id: string,
  amount: string,
  bucket: WalletBucket = 'deductable'
): Promise<WalletRow | null> {
  const col = BUCKET_COLUMN[bucket];
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET ${col}      = ${col} - $2::numeric,
            version     = version + 1,
            updated_at  = now()
      WHERE id = $1
        AND ${col} >= $2::numeric
      RETURNING ${SELECT_WALLET}`,
    [id, amount]
  );
  return r.rows[0] ?? null;
}

/**
 * Move funds from one bucket to another within the same wallet
 * (e.g. payable -> withdrawable when a bet settles). Atomic.
 */
export async function moveWalletBucket(
  client: PoolClient,
  id: string,
  amount: string,
  from: WalletBucket,
  to: WalletBucket
): Promise<WalletRow | null> {
  const fromCol = BUCKET_COLUMN[from];
  const toCol = BUCKET_COLUMN[to];
  if (from === to) {
    return findWalletByIdForUpdate(client, id);
  }
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET ${fromCol} = ${fromCol} - $2::numeric,
            ${toCol}   = ${toCol}   + $2::numeric,
            version    = version + 1,
            updated_at = now()
      WHERE id = $1
        AND ${fromCol} >= $2::numeric
      RETURNING ${SELECT_WALLET}`,
    [id, amount]
  );
  return r.rows[0] ?? null;
}

/**
 * Upsert: create a wallet for the user if one does not already exist (idempotent).
 * Returns the wallet row (pre-existing or newly created).
 */
export async function ensureWallet(
  client: PoolClient,
  tenantId: string,
  userId: string,
  currency: string = 'ETB'
): Promise<WalletRow> {
  // Try to create; silently skip if already exists.
  await client.query(
    `INSERT INTO wallets (tenant_id, user_id, currency, balance)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT ON CONSTRAINT wallets_user_currency_unique DO NOTHING`,
    [tenantId, userId, currency]
  );
  const r = await client.query<WalletRow>(
    `SELECT ${SELECT_WALLET} FROM wallets
      WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
      LIMIT 1`,
    [tenantId, userId, currency]
  );
  return r.rows[0];
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
    reference: string | null;
    metadata: Record<string, unknown>;
    status?: string;
  }
): Promise<TransactionRow> {
  const r = await client.query<TransactionRow>(
    `INSERT INTO transactions
       (tenant_id, wallet_id, user_id, type, amount, before_balance, after_balance,
        currency, reference, metadata, status)
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9, $10::jsonb, $11)
     RETURNING id, tenant_id, wallet_id, user_id, type, amount,
               before_balance, after_balance, currency, reference,
               status, metadata, created_at`,
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
