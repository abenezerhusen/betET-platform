import type { PoolClient } from 'pg';

/* ------------------------------------------------------------------------- */
/* Row shapes                                                                */
/* ------------------------------------------------------------------------- */

export interface AgentRow {
  id: string;
  tenant_id: string;
  agent_name: string;
  telebirr_number: string;
  device_id: string;
  device_name: string | null;
  app_version: string | null;
  /**
   * Repurposed for the bcrypt password hash of the agent login (the
   * column was originally specified as a SHA-256 of an opaque bearer
   * token; we use it for the bcrypt of the operator-set password).
   * Will likely be renamed to `password_hash` in a future migration.
   */
  auth_token_hash: string | null;
  last_seen_at: Date | null;
  status: string;
  balance: string;
  assigned_cashier_id: string | null;
  created_at: Date;
}

export interface AgentSessionRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  device_fingerprint: string | null;
  ip_address: string | null;
  logged_in_at: Date;
  last_active_at: Date;
  logged_out_at: Date | null;
}

export interface SmsRawRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  sms_body: string;
  sender_number: string | null;
  received_at: Date | null;
  processed: boolean;
  processed_at: Date | null;
  dedup_hash: string | null;
  created_at: Date;
}

const SELECT_AGENT = `
  id, tenant_id, agent_name, telebirr_number, device_id, device_name,
  app_version, auth_token_hash, last_seen_at, status, balance,
  assigned_cashier_id, created_at
`;

const SELECT_SESSION = `
  id, tenant_id, agent_id, device_fingerprint, host(ip_address) AS ip_address,
  logged_in_at, last_active_at, logged_out_at
`;

const SELECT_SMS_RAW = `
  id, tenant_id, agent_id, sms_body, sender_number, received_at, processed,
  processed_at, dedup_hash, created_at
`;

/* ------------------------------------------------------------------------- */
/* Tenant resolution                                                         */
/* ------------------------------------------------------------------------- */

/**
 * The /api/agent/auth/login endpoint runs BEFORE any tenant context is
 * applied (the device only knows its Telebirr number, not the tenant
 * slug). We look up the agent across all tenants using bypass-RLS, then
 * return the agent + tenant id together so the caller can re-enter
 * `withTenantClient({ tenantId })` for subsequent writes.
 */
export async function findAgentByTelebirrNumberCrossTenant(
  client: PoolClient,
  telebirrNumber: string,
  tenantHint: string | null
): Promise<AgentRow | null> {
  const sql = tenantHint
    ? `SELECT ${SELECT_AGENT}
         FROM telebirr_agents
        WHERE tenant_id = $1
          AND telebirr_number = $2
        ORDER BY (status = 'active') DESC
        LIMIT 1`
    : `SELECT ${SELECT_AGENT}
         FROM telebirr_agents
        WHERE telebirr_number = $1
        ORDER BY (status = 'active') DESC
        LIMIT 1`;
  const values = tenantHint ? [tenantHint, telebirrNumber] : [telebirrNumber];
  const r = await client.query<AgentRow>(sql, values);
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Agents                                                                    */
/* ------------------------------------------------------------------------- */

export async function findAgentById(
  client: PoolClient,
  id: string
): Promise<AgentRow | null> {
  const r = await client.query<AgentRow>(
    `SELECT ${SELECT_AGENT} FROM telebirr_agents WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function updateAgentLoginMeta(
  client: PoolClient,
  id: string,
  params: {
    deviceName: string | null;
    appVersion: string | null;
    lastSeenAt: Date;
  }
): Promise<void> {
  await client.query(
    `UPDATE telebirr_agents
        SET device_name = COALESCE($2, device_name),
            app_version = COALESCE($3, app_version),
            last_seen_at = $4
      WHERE id = $1`,
    [id, params.deviceName, params.appVersion, params.lastSeenAt]
  );
}

export async function bumpAgentLastSeen(
  client: PoolClient,
  id: string,
  at: Date
): Promise<void> {
  await client.query(
    `UPDATE telebirr_agents SET last_seen_at = $2 WHERE id = $1`,
    [id, at]
  );
}

/**
 * Bind an agent to the device that just authenticated ("first-login
 * pairing"). Only called when the agent's stored `device_id` is still an
 * unpaired placeholder — never to silently re-pair an agent that is
 * already bound to a real device (that stays an admin action).
 */
export async function adoptAgentDevice(
  client: PoolClient,
  id: string,
  deviceId: string,
  deviceName: string | null
): Promise<void> {
  await client.query(
    `UPDATE telebirr_agents
        SET device_id = $2,
            device_name = COALESCE($3, device_name)
      WHERE id = $1`,
    [id, deviceId, deviceName]
  );
}

/* ------------------------------------------------------------------------- */
/* Sessions                                                                  */
/* ------------------------------------------------------------------------- */

export async function insertAgentSession(
  client: PoolClient,
  params: {
    tenantId: string;
    agentId: string;
    deviceFingerprint: string | null;
    ipAddress: string | null;
  }
): Promise<AgentSessionRow> {
  const r = await client.query<AgentSessionRow>(
    `INSERT INTO telebirr_agent_sessions
       (tenant_id, agent_id, device_fingerprint, ip_address)
     VALUES ($1, $2, $3, $4::inet)
     RETURNING ${SELECT_SESSION}`,
    [
      params.tenantId,
      params.agentId,
      params.deviceFingerprint,
      params.ipAddress,
    ]
  );
  return r.rows[0];
}

export async function findOpenSession(
  client: PoolClient,
  agentId: string,
  sessionId: string
): Promise<AgentSessionRow | null> {
  const r = await client.query<AgentSessionRow>(
    `SELECT ${SELECT_SESSION}
       FROM telebirr_agent_sessions
      WHERE id = $1 AND agent_id = $2 AND logged_out_at IS NULL
      LIMIT 1`,
    [sessionId, agentId]
  );
  return r.rows[0] ?? null;
}

export async function bumpSessionActivity(
  client: PoolClient,
  sessionId: string,
  at: Date
): Promise<void> {
  await client.query(
    `UPDATE telebirr_agent_sessions
        SET last_active_at = $2
      WHERE id = $1 AND logged_out_at IS NULL`,
    [sessionId, at]
  );
}

export async function closeSession(
  client: PoolClient,
  sessionId: string
): Promise<void> {
  await client.query(
    `UPDATE telebirr_agent_sessions
        SET logged_out_at = now()
      WHERE id = $1 AND logged_out_at IS NULL`,
    [sessionId]
  );
}

/* ------------------------------------------------------------------------- */
/* SMS raw ingestion                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Insert one raw SMS row. When `dedupHash` is provided, conflicts on the
 * partial unique index `telebirr_sms_raw_dedup_uniq` are swallowed and
 * the existing row is returned instead — this is the idempotency
 * mechanism for the batch endpoint.
 */
export async function insertSmsRaw(
  client: PoolClient,
  params: {
    tenantId: string;
    agentId: string;
    smsBody: string;
    senderNumber: string | null;
    receivedAt: Date | null;
    dedupHash: string | null;
  }
): Promise<{ row: SmsRawRow; created: boolean }> {
  if (params.dedupHash) {
    const inserted = await client.query<SmsRawRow>(
      `INSERT INTO telebirr_sms_raw
         (tenant_id, agent_id, sms_body, sender_number, received_at, dedup_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT telebirr_sms_raw_dedup_uniq DO NOTHING
       RETURNING ${SELECT_SMS_RAW}`,
      [
        params.tenantId,
        params.agentId,
        params.smsBody,
        params.senderNumber,
        params.receivedAt,
        params.dedupHash,
      ]
    );
    if (inserted.rows[0]) return { row: inserted.rows[0], created: true };
    // Conflict → fetch the canonical row.
    const existing = await client.query<SmsRawRow>(
      `SELECT ${SELECT_SMS_RAW}
         FROM telebirr_sms_raw
        WHERE tenant_id = $1 AND agent_id = $2 AND dedup_hash = $3
        LIMIT 1`,
      [params.tenantId, params.agentId, params.dedupHash]
    );
    return { row: existing.rows[0], created: false };
  }

  const r = await client.query<SmsRawRow>(
    `INSERT INTO telebirr_sms_raw
       (tenant_id, agent_id, sms_body, sender_number, received_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SELECT_SMS_RAW}`,
    [
      params.tenantId,
      params.agentId,
      params.smsBody,
      params.senderNumber,
      params.receivedAt,
    ]
  );
  return { row: r.rows[0], created: true };
}

/* ------------------------------------------------------------------------- */
/* Status / dashboard aggregates                                             */
/* ------------------------------------------------------------------------- */

export interface AgentTodayAggregates {
  transaction_count: number;
  total_amount_credited: string;
  pending_count: number;
  unmatched_count: number;
}

/**
 * Today's metrics for a single agent. Boundaries are at the database's
 * timezone — operations should run on UTC; if/when we offset for
 * Africa/Addis_Ababa, replace `current_date` with a localised expression.
 */
export async function aggregateAgentToday(
  client: PoolClient,
  tenantId: string,
  agentId: string
): Promise<AgentTodayAggregates> {
  const r = await client.query<AgentTodayAggregates>(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'credited' AND created_at::date = current_date)::int    AS transaction_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'credited' AND created_at::date = current_date), 0)::text AS total_amount_credited,
        COUNT(*) FILTER (WHERE status = 'pending' AND created_at::date = current_date)::int     AS pending_count,
        COUNT(*) FILTER (WHERE status = 'unmatched' AND created_at::date = current_date)::int   AS unmatched_count
       FROM telebirr_transactions
      WHERE tenant_id = $1 AND agent_id = $2`,
    [tenantId, agentId]
  );
  return r.rows[0];
}

/**
 * Heartbeat returns the count of "manual tasks" — currently:
 * pending probable_match + ambiguous + unmatched rows in this tenant
 * that the cashier should resolve. The agent app surfaces this as a
 * badge on the dashboard.
 *
 * NOTE: This is a tenant-scoped count, not agent-scoped, because any
 * cashier/agent on the tenant can resolve any pending row. Switch to
 * agent-scoped if/when we restrict who can confirm what.
 */
export async function countTenantPendingTelebirr(
  client: PoolClient,
  tenantId: string
): Promise<number> {
  const r = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM telebirr_transactions
      WHERE tenant_id = $1
        AND status IN ('pending', 'unmatched')`,
    [tenantId]
  );
  return r.rows[0].count;
}

/* ------------------------------------------------------------------------- */
/* Manual confirm helpers (used by the matching service)                     */
/* ------------------------------------------------------------------------- */

export interface PendingTelebirrTxRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  telebirr_ref: string;
  amount: string;
  currency: string;
  sender_phone: string | null;
  sender_name: string | null;
  status: string;
}

export async function findPendingTxByRefForUpdate(
  client: PoolClient,
  tenantId: string,
  telebirrRef: string
): Promise<PendingTelebirrTxRow | null> {
  const r = await client.query<PendingTelebirrTxRow>(
    `SELECT id, tenant_id, agent_id, telebirr_ref, amount, currency,
            sender_phone, sender_name, status
       FROM telebirr_transactions
      WHERE tenant_id = $1 AND telebirr_ref = $2
      FOR UPDATE`,
    [tenantId, telebirrRef]
  );
  return r.rows[0] ?? null;
}

export async function markTelebirrTxCredited(
  client: PoolClient,
  id: string,
  creditTransactionId: string,
  walletId: string,
  userId: string
): Promise<void> {
  await client.query(
    `UPDATE telebirr_transactions
        SET status = 'credited',
            user_id = $2,
            wallet_id = $3,
            matched_at = COALESCE(matched_at, now()),
            credited_at = now(),
            credit_transaction_id = $4
      WHERE id = $1`,
    [id, userId, walletId, creditTransactionId]
  );
}
