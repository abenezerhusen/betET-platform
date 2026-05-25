import type { PoolClient } from 'pg';

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
  status, version, created_at, updated_at
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
    `SELECT ${SELECT_WALLET},
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

/** Credit wallet by `amount`. Caller MUST already hold a row lock on the wallet. */
export async function creditWalletBalance(
  client: PoolClient,
  id: string,
  amount: string
): Promise<WalletRow> {
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET balance    = balance + $2::numeric,
            version    = version + 1,
            updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_WALLET}`,
    [id, amount]
  );
  return r.rows[0];
}

/**
 * Debit wallet by `amount`. Atomic: the WHERE clause checks balance >= amount.
 * Returns null when insufficient balance (or wallet not found).
 * Caller MUST already hold a row lock on the wallet.
 */
export async function debitWalletBalance(
  client: PoolClient,
  id: string,
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
    [id, amount]
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
