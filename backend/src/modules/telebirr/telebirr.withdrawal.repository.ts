import type { PoolClient } from 'pg';

export interface TelebirrWithdrawalRow {
  id: string;
  tenant_id: string;
  user_id: string;
  cashier_id: string | null;
  amount: string;
  currency: string;
  telebirr_number: string;
  account_name: string;
  telebirr_ref: string | null;
  status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'rejected'
    | 'cancelled'
    | 'failed';
  debit_transaction_id: string | null;
  reversal_transaction_id: string | null;
  notes: string | null;
  requested_at: Date;
  processed_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_WITHDRAWAL = `
  id, tenant_id, user_id, cashier_id, amount, currency, telebirr_number,
  account_name, telebirr_ref, status, debit_transaction_id,
  reversal_transaction_id, notes, requested_at, processed_at,
  completed_at, created_at, updated_at
`;

export async function findUserOpenWithdrawal(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<TelebirrWithdrawalRow | null> {
  const r = await client.query<TelebirrWithdrawalRow>(
    `SELECT ${SELECT_WITHDRAWAL}
       FROM telebirr_withdrawal_requests
      WHERE tenant_id = $1 AND user_id = $2
        AND status IN ('pending','processing')
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, userId]
  );
  return r.rows[0] ?? null;
}

export async function findWithdrawalById(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<TelebirrWithdrawalRow | null> {
  const r = await client.query<TelebirrWithdrawalRow>(
    `SELECT ${SELECT_WITHDRAWAL}
       FROM telebirr_withdrawal_requests
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

/** Used by the Telebirr provider when it only knows the request id. */
export async function findWithdrawalByIdAcrossTenants(
  client: PoolClient,
  id: string
): Promise<TelebirrWithdrawalRow | null> {
  const r = await client.query<TelebirrWithdrawalRow>(
    `SELECT ${SELECT_WITHDRAWAL}
       FROM telebirr_withdrawal_requests
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export interface InsertWithdrawalParams {
  tenantId: string;
  userId: string;
  amount: string;
  currency: string;
  telebirrNumber: string;
  accountName: string;
  debitTransactionId: string | null;
}

export async function insertWithdrawal(
  client: PoolClient,
  params: InsertWithdrawalParams
): Promise<TelebirrWithdrawalRow> {
  const r = await client.query<TelebirrWithdrawalRow>(
    `INSERT INTO telebirr_withdrawal_requests
       (tenant_id, user_id, amount, currency, telebirr_number,
        account_name, debit_transaction_id, status)
     VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, 'pending')
     RETURNING ${SELECT_WITHDRAWAL}`,
    [
      params.tenantId,
      params.userId,
      params.amount,
      params.currency,
      params.telebirrNumber,
      params.accountName,
      params.debitTransactionId,
    ]
  );
  return r.rows[0];
}

export async function claimWithdrawalForCashier(
  client: PoolClient,
  tenantId: string,
  id: string,
  cashierId: string
): Promise<TelebirrWithdrawalRow | null> {
  // pending → processing AND attach cashier_id; only succeeds when
  // status was 'pending' so two cashiers can't double-claim.
  const r = await client.query<TelebirrWithdrawalRow>(
    `UPDATE telebirr_withdrawal_requests
        SET status = 'processing',
            cashier_id = $3,
            processed_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'pending'
      RETURNING ${SELECT_WITHDRAWAL}`,
    [tenantId, id, cashierId]
  );
  return r.rows[0] ?? null;
}

export async function markWithdrawalCompleted(
  client: PoolClient,
  tenantId: string,
  id: string,
  cashierId: string,
  telebirrRef: string,
  notes: string | null
): Promise<TelebirrWithdrawalRow | null> {
  // Allow completion only by the cashier currently holding the
  // request. status must be 'processing'.
  const r = await client.query<TelebirrWithdrawalRow>(
    `UPDATE telebirr_withdrawal_requests
        SET status = 'completed',
            telebirr_ref = $4,
            notes = COALESCE($5, notes),
            completed_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND cashier_id = $3
        AND status = 'processing'
      RETURNING ${SELECT_WITHDRAWAL}`,
    [tenantId, id, cashierId, telebirrRef, notes]
  );
  return r.rows[0] ?? null;
}

export async function markWithdrawalReversed(
  client: PoolClient,
  tenantId: string,
  id: string,
  newStatus: 'rejected' | 'cancelled' | 'failed',
  reversalTxId: string | null,
  notes: string | null
): Promise<TelebirrWithdrawalRow | null> {
  // Used by both user-cancel (status='pending' only) and
  // cashier-reject/admin-cancel (status IN ('pending','processing')).
  // The caller passes the desired terminal state.
  const r = await client.query<TelebirrWithdrawalRow>(
    `UPDATE telebirr_withdrawal_requests
        SET status = $3,
            reversal_transaction_id = $4,
            notes = COALESCE($5, notes),
            completed_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND status IN ('pending','processing')
      RETURNING ${SELECT_WITHDRAWAL}`,
    [tenantId, id, newStatus, reversalTxId, notes]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Listing                                                                   */
/* ------------------------------------------------------------------------- */

export interface ListWithdrawalsParams {
  tenantId: string;
  userId: string | null;
  status: TelebirrWithdrawalRow['status'] | null;
  cashierId: string | null;
  from: Date | null;
  to: Date | null;
  search: string | null;
  limit: number;
  offset: number;
}

export interface WithdrawalWithJoins extends TelebirrWithdrawalRow {
  user_email: string | null;
  user_phone: string | null;
  cashier_email: string | null;
}

export async function listWithdrawals(
  client: PoolClient,
  params: ListWithdrawalsParams
): Promise<{ rows: WithdrawalWithJoins[]; total: number }> {
  const filters: string[] = ['w.tenant_id = $1'];
  const values: unknown[] = [params.tenantId];
  let i = 2;
  if (params.userId) {
    filters.push(`w.user_id = $${i++}`);
    values.push(params.userId);
  }
  if (params.status) {
    filters.push(`w.status = $${i++}`);
    values.push(params.status);
  }
  if (params.cashierId) {
    filters.push(`w.cashier_id = $${i++}`);
    values.push(params.cashierId);
  }
  if (params.from) {
    filters.push(`w.created_at >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    filters.push(`w.created_at <= $${i++}`);
    values.push(params.to);
  }
  if (params.search) {
    filters.push(
      `(w.telebirr_number ILIKE $${i} OR w.account_name ILIKE $${i} OR w.telebirr_ref ILIKE $${i})`
    );
    values.push(`%${params.search}%`);
    i++;
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM telebirr_withdrawal_requests w ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const rows = await client.query<WithdrawalWithJoins>(
    `SELECT ${SELECT_WITHDRAWAL
      .split(',')
      .map((c) => `w.${c.trim()}`)
      .join(', ')},
            u.email::text   AS user_email,
            u.phone         AS user_phone,
            c.email::text   AS cashier_email
       FROM telebirr_withdrawal_requests w
       LEFT JOIN users u ON u.id = w.user_id
       LEFT JOIN users c ON c.id = w.cashier_id
       ${where}
      ORDER BY w.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: rows.rows, total };
}
