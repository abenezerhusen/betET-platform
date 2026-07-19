import type { PoolClient } from 'pg';

/**
 * SQL for the `gateway_payment_requests` ledger plus a couple of small
 * wallet helpers used only by the gateway withdrawal reserve/refund
 * flow. Kept self-contained so the gateway system never depends on
 * Telebirr / P2P / branch code.
 */

export interface GatewayRequestRow {
  id: string;
  tenant_id: string;
  user_id: string;
  direction: 'deposit' | 'withdrawal';
  provider_slug: string;
  method_name: string;
  amount: string;
  currency: string;
  phone: string;
  status: string;
  reference: string | null;
  provider_ref: string | null;
  debit_transaction_id: string | null;
  reversal_transaction_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `
  id, tenant_id, user_id, direction, provider_slug, method_name,
  amount, currency, phone, status, reference, provider_ref,
  debit_transaction_id, reversal_transaction_id, metadata,
  created_at, updated_at
`;

export interface InsertGatewayRequestParams {
  tenantId: string;
  userId: string;
  direction: 'deposit' | 'withdrawal';
  providerSlug: string;
  methodName: string;
  amount: string;
  currency: string;
  phone: string;
  status: string;
  reference: string | null;
  providerRef?: string | null;
  debitTransactionId?: string | null;
  metadata: Record<string, unknown>;
}

export async function insertGatewayRequest(
  client: PoolClient,
  params: InsertGatewayRequestParams
): Promise<GatewayRequestRow> {
  const r = await client.query<GatewayRequestRow>(
    `INSERT INTO gateway_payment_requests
       (tenant_id, user_id, direction, provider_slug, method_name,
        amount, currency, phone, status, reference, provider_ref,
        debit_transaction_id, metadata)
     VALUES ($1, $2, $3, $4, $5,
             $6::numeric, $7, $8, $9, $10, $11,
             $12, $13::jsonb)
     RETURNING ${SELECT}`,
    [
      params.tenantId,
      params.userId,
      params.direction,
      params.providerSlug,
      params.methodName,
      params.amount,
      params.currency,
      params.phone,
      params.status,
      params.reference,
      params.providerRef ?? null,
      params.debitTransactionId ?? null,
      JSON.stringify(params.metadata),
    ]
  );
  if (!r.rows[0]) throw new Error('insertGatewayRequest produced no row');
  return r.rows[0];
}

export async function findGatewayRequestById(
  client: PoolClient,
  tenantId: string,
  userId: string,
  id: string
): Promise<GatewayRequestRow | null> {
  const r = await client.query<GatewayRequestRow>(
    `SELECT ${SELECT}
       FROM gateway_payment_requests
      WHERE tenant_id = $1 AND user_id = $2 AND id = $3
      LIMIT 1`,
    [tenantId, userId, id]
  );
  return r.rows[0] ?? null;
}

export interface ListGatewayRequestsParams {
  tenantId: string;
  userId: string;
  direction?: 'deposit' | 'withdrawal' | null;
  limit: number;
  offset: number;
}

export async function listGatewayRequests(
  client: PoolClient,
  params: ListGatewayRequestsParams
): Promise<{ rows: GatewayRequestRow[]; total: number }> {
  const filters: string[] = ['tenant_id = $1', 'user_id = $2'];
  const values: unknown[] = [params.tenantId, params.userId];
  let i = 3;
  if (params.direction) {
    filters.push(`direction = $${i++}`);
    values.push(params.direction);
  }
  const where = filters.join(' AND ');

  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM gateway_payment_requests
      WHERE ${where}`,
    values
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);

  const rowsRes = await client.query<GatewayRequestRow>(
    `SELECT ${SELECT}
       FROM gateway_payment_requests
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: rowsRes.rows, total };
}

export async function updateGatewayStatus(
  client: PoolClient,
  tenantId: string,
  id: string,
  patch: {
    status?: string;
    providerRef?: string | null;
    reversalTransactionId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<GatewayRequestRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [tenantId, id];
  let i = 3;
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(patch.status);
  }
  if (patch.providerRef !== undefined) {
    sets.push(`provider_ref = $${i++}`);
    values.push(patch.providerRef);
  }
  if (patch.reversalTransactionId !== undefined) {
    sets.push(`reversal_transaction_id = $${i++}`);
    values.push(patch.reversalTransactionId);
  }
  if (patch.metadata !== undefined) {
    sets.push(`metadata = $${i++}::jsonb`);
    values.push(JSON.stringify(patch.metadata));
  }
  if (sets.length === 0) {
    return findGatewayRequestByIdAnyUser(client, tenantId, id);
  }
  const r = await client.query<GatewayRequestRow>(
    `UPDATE gateway_payment_requests
        SET ${sets.join(', ')}
      WHERE tenant_id = $1 AND id = $2
      RETURNING ${SELECT}`,
    values
  );
  return r.rows[0] ?? null;
}

async function findGatewayRequestByIdAnyUser(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<GatewayRequestRow | null> {
  const r = await client.query<GatewayRequestRow>(
    `SELECT ${SELECT}
       FROM gateway_payment_requests
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

/**
 * Reverse of `lockWalletFunds`: moves reserved funds back from
 * `locked_balance` into `balance`. Guarded so it never underflows the
 * locked bucket.
 */
export async function unlockWalletFunds(
  client: PoolClient,
  walletId: string,
  amount: string
): Promise<{ balance: string; locked_balance: string } | null> {
  const r = await client.query<{ balance: string; locked_balance: string }>(
    `UPDATE wallets
        SET balance        = balance + $2::numeric,
            locked_balance = locked_balance - $2::numeric,
            version        = version + 1,
            updated_at     = now()
      WHERE id = $1
        AND locked_balance >= $2::numeric
      RETURNING balance, locked_balance`,
    [walletId, amount]
  );
  return r.rows[0] ?? null;
}

export async function markTransactionStatus(
  client: PoolClient,
  tenantId: string,
  transactionId: string,
  status: string
): Promise<void> {
  await client.query(
    `UPDATE transactions
        SET status = $3
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, transactionId, status]
  );
}

export async function findUserPhone(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<string | null> {
  const r = await client.query<{ phone: string | null }>(
    `SELECT phone FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, userId]
  );
  return r.rows[0]?.phone ?? null;
}
