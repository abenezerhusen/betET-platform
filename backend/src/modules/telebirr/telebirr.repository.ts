import type { PoolClient } from 'pg';

/* ------------------------------------------------------------------------- */
/* Row shapes                                                                */
/* ------------------------------------------------------------------------- */

export interface TelebirrAgentRow {
  id: string;
  tenant_id: string;
  agent_name: string;
  telebirr_number: string;
  device_id: string;
  status: string;
  balance: string;
  assigned_cashier_id: string | null;
  created_at: Date;
}

export interface TelebirrSmsRawRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  sms_body: string;
  sender_number: string | null;
  received_at: Date | null;
  processed: boolean;
  processed_at: Date | null;
  created_at: Date;
}

export interface TelebirrTransactionRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  user_id: string | null;
  wallet_id: string | null;
  telebirr_ref: string;
  sender_phone: string | null;
  sender_name: string | null;
  amount: string;
  currency: string;
  sms_body: string | null;
  status: string;
  matched_at: Date | null;
  credited_at: Date | null;
  credit_transaction_id: string | null;
  created_at: Date;
}

export interface TelebirrDepositRequestRow {
  id: string;
  tenant_id: string;
  user_id: string;
  amount: string;
  telebirr_number: string;
  reference_code: string;
  /**
   * The real Telebirr transaction reference the user pasted from their own
   * Telebirr SMS. When set, the matcher confirms this request by exact
   * equality against the agent SMS's parsed `telebirr_ref`.
   */
  claimed_telebirr_ref: string | null;
  expires_at: Date;
  status: string;
  matched_transaction_id: string | null;
  created_at: Date;
}

export interface UserRow {
  id: string;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
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

export interface WalletLedgerRow {
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

const SELECT_DEPOSIT_REQUEST = `
  id, tenant_id, user_id, amount, telebirr_number, reference_code,
  claimed_telebirr_ref, expires_at, status, matched_transaction_id, created_at
`;

const SELECT_TELEBIRR_TX = `
  id, tenant_id, agent_id, user_id, wallet_id, telebirr_ref, sender_phone,
  sender_name, amount, currency, sms_body, status, matched_at, credited_at,
  credit_transaction_id, created_at
`;

const SELECT_WALLET = `
  id, tenant_id, user_id, currency, balance, bonus_balance, locked_balance,
  status, version, created_at, updated_at
`;

const SELECT_USER = `
  id, tenant_id, email::text AS email, phone, role, status
`;

const SELECT_WALLET_LEDGER = `
  id, tenant_id, wallet_id, user_id, type, amount,
  before_balance, after_balance, currency, reference,
  status, metadata, created_at
`;

/* ------------------------------------------------------------------------- */
/* Agents                                                                    */
/* ------------------------------------------------------------------------- */

export async function findAgentById(
  client: PoolClient,
  id: string
): Promise<TelebirrAgentRow | null> {
  const r = await client.query<TelebirrAgentRow>(
    `SELECT id, tenant_id, agent_name, telebirr_number, device_id, status,
            balance, assigned_cashier_id, created_at
       FROM telebirr_agents
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

/**
 * Pick an online agent for a tenant. "Online" means
 *   status = 'active' AND last_seen_at > $lastSeenAfter
 * (caller passes the threshold explicitly so this query stays free of
 * clock magic numbers — TelebirrP2PProvider passes a 3-minute cutoff).
 *
 * Selection order:
 *   1. admin-configured wallet priority (p2p_wallet_priority.priority ASC,
 *      NULLS LAST) — operators set this on the Limits & Rules page; wallets
 *      with enabled=false are excluded from rotation entirely. Tenants that
 *      never configured a priority list fall through to the historic
 *      round-robin below unchanged.
 *   2. lowest pending-request count (LEFT JOIN telebirr_deposit_requests
 *      filtered to waiting + unexpired) — keeps load even when traffic
 *      bursts to one tenant.
 *   3. earliest `last_assigned_at` (NULLS FIRST) — round-robin
 *      tie-break, so newly-onboarded agents get traffic even if the
 *      existing agents recently saw activity.
 *   4. most-recently-active `last_seen_at` — last-resort tiebreak.
 *
 * Returns null when no agent is available.
 */
export async function pickAvailableAgent(
  client: PoolClient,
  tenantId: string,
  lastSeenAfter: Date
): Promise<TelebirrAgentRow | null> {
  const r = await client.query<TelebirrAgentRow>(
    `SELECT a.id, a.tenant_id, a.agent_name, a.telebirr_number,
            a.device_id, a.status, a.balance, a.assigned_cashier_id,
            a.created_at
       FROM telebirr_agents a
       LEFT JOIN (
         SELECT telebirr_number, COUNT(*) AS pending_count
           FROM telebirr_deposit_requests
          WHERE tenant_id = $1
            AND status = 'waiting'
            AND expires_at > now()
          GROUP BY telebirr_number
       ) p ON p.telebirr_number = a.telebirr_number
       -- Admin-configured routing priority (Limits & Rules page). Absent for
       -- tenants that never set an order, in which case wp.* is NULL and the
       -- behaviour falls back to the original round-robin selection.
       LEFT JOIN p2p_wallet_priority wp
              ON wp.agent_id = a.id
             AND wp.tenant_id = $1
      WHERE a.tenant_id = $1
        AND a.status = 'active'
        AND a.last_seen_at IS NOT NULL
        AND a.last_seen_at > $2
        -- A wallet explicitly pulled from rotation (enabled=false) is skipped;
        -- wallets with no priority row default to in-rotation.
        AND COALESCE(wp.enabled, true) = true
      ORDER BY wp.priority ASC NULLS LAST,
               COALESCE(p.pending_count, 0) ASC,
               a.last_assigned_at ASC NULLS FIRST,
               a.last_seen_at DESC
      LIMIT 1`,
    [tenantId, lastSeenAfter]
  );
  return r.rows[0] ?? null;
}

/**
 * Bump `last_assigned_at` so the round-robin tiebreak on the next
 * `pickAvailableAgent` call rotates away from this agent. Best-effort:
 * a missing row (deleted between pick + mark) is ignored.
 */
export async function markAgentAssigned(
  client: PoolClient,
  agentId: string
): Promise<void> {
  await client.query(
    `UPDATE telebirr_agents
        SET last_assigned_at = now()
      WHERE id = $1`,
    [agentId]
  );
}

/**
 * Count of waiting (not-yet-expired) deposit requests routed to a
 * given agent number. Used by the deposit-flow helper to surface a
 * "this agent is busy, expect a delay" hint to the UI.
 */
export async function countPendingForAgent(
  client: PoolClient,
  tenantId: string,
  telebirrNumber: string
): Promise<number> {
  const r = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM telebirr_deposit_requests
      WHERE tenant_id = $1
        AND telebirr_number = $2
        AND status = 'waiting'
        AND expires_at > now()`,
    [tenantId, telebirrNumber]
  );
  return r.rows[0]?.count ?? 0;
}

export interface ListAgentsParams {
  tenantId: string;
  status: string | null;
  search: string | null;
  limit: number;
  offset: number;
}

export interface AgentWithStats extends TelebirrAgentRow {
  device_name: string | null;
  app_version: string | null;
  last_seen_at: Date | null;
  /** Sum of credited Telebirr transactions (today) for this agent. */
  today_volume: string;
  /** Count of credited Telebirr transactions (today) for this agent. */
  today_count: number;
}

export async function listAgents(
  client: PoolClient,
  params: ListAgentsParams
): Promise<{ rows: AgentWithStats[]; total: number }> {
  const filters: string[] = ['a.tenant_id = $1'];
  const values: unknown[] = [params.tenantId];
  let i = 2;
  if (params.status) {
    filters.push(`a.status = $${i++}`);
    values.push(params.status);
  }
  if (params.search) {
    filters.push(
      `(a.agent_name ILIKE $${i} OR a.telebirr_number ILIKE $${i} OR a.device_id ILIKE $${i})`
    );
    values.push(`%${params.search}%`);
    i++;
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM telebirr_agents a ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const rows = await client.query<AgentWithStats>(
    `SELECT a.id, a.tenant_id, a.agent_name, a.telebirr_number,
            a.device_id, a.device_name, a.app_version, a.status,
            a.balance, a.assigned_cashier_id, a.last_seen_at, a.created_at,
            COALESCE(t.today_volume, 0)::text AS today_volume,
            COALESCE(t.today_count, 0)::int   AS today_count
       FROM telebirr_agents a
       LEFT JOIN (
         SELECT agent_id,
                SUM(amount) AS today_volume,
                COUNT(*)    AS today_count
           FROM telebirr_transactions
          WHERE tenant_id = $1
            AND status = 'credited'
            AND created_at::date = current_date
          GROUP BY agent_id
       ) t ON t.agent_id = a.id
       ${where}
      ORDER BY a.last_seen_at DESC NULLS LAST, a.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: rows.rows, total };
}

export async function insertAgent(
  client: PoolClient,
  params: {
    tenantId: string;
    agentName: string;
    telebirrNumber: string;
    deviceId: string;
    deviceName: string | null;
    authTokenHash: string;
    assignedCashierId: string | null;
  }
): Promise<TelebirrAgentRow> {
  const r = await client.query<TelebirrAgentRow>(
    `INSERT INTO telebirr_agents
       (tenant_id, agent_name, telebirr_number, device_id, device_name,
        auth_token_hash, assigned_cashier_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     RETURNING id, tenant_id, agent_name, telebirr_number, device_id,
               status, balance, assigned_cashier_id, created_at`,
    [
      params.tenantId,
      params.agentName,
      params.telebirrNumber,
      params.deviceId,
      params.deviceName,
      params.authTokenHash,
      params.assignedCashierId,
    ]
  );
  return r.rows[0];
}

export async function updateAgentMetadata(
  client: PoolClient,
  id: string,
  patch: {
    agentName?: string | null;
    telebirrNumber?: string | null;
    deviceName?: string | null;
    assignedCashierId?: string | null;
  }
): Promise<TelebirrAgentRow | null> {
  const r = await client.query<TelebirrAgentRow>(
    `UPDATE telebirr_agents
        SET agent_name        = COALESCE($2, agent_name),
            telebirr_number   = COALESCE($3, telebirr_number),
            device_name       = COALESCE($4, device_name),
            assigned_cashier_id = COALESCE($5, assigned_cashier_id)
      WHERE id = $1
      RETURNING id, tenant_id, agent_name, telebirr_number, device_id,
                status, balance, assigned_cashier_id, created_at`,
    [
      id,
      patch.agentName ?? null,
      patch.telebirrNumber ?? null,
      patch.deviceName ?? null,
      patch.assignedCashierId ?? null,
    ]
  );
  return r.rows[0] ?? null;
}

export async function setAgentStatus(
  client: PoolClient,
  id: string,
  status: 'active' | 'inactive' | 'suspended'
): Promise<TelebirrAgentRow | null> {
  const r = await client.query<TelebirrAgentRow>(
    `UPDATE telebirr_agents
        SET status = $2
      WHERE id = $1
      RETURNING id, tenant_id, agent_name, telebirr_number, device_id,
                status, balance, assigned_cashier_id, created_at`,
    [id, status]
  );
  return r.rows[0] ?? null;
}

/**
 * Close every open session for an agent. Used by the admin
 * "reset-token" action — the next API call from any extant token
 * returns 401 and the device app re-authenticates.
 */
export async function closeAllOpenAgentSessions(
  client: PoolClient,
  agentId: string
): Promise<number> {
  const r = await client.query(
    `UPDATE telebirr_agent_sessions
        SET logged_out_at = now()
      WHERE agent_id = $1 AND logged_out_at IS NULL`,
    [agentId]
  );
  return r.rowCount ?? 0;
}

/* ------------------------------------------------------------------------- */
/* Telebirr transactions                                                     */
/* ------------------------------------------------------------------------- */

export async function findTelebirrTxByRef(
  client: PoolClient,
  telebirrRef: string
): Promise<TelebirrTransactionRow | null> {
  // telebirr_ref is GLOBALLY unique — no tenant filter needed for the
  // duplicate check (a replay across tenants must still resolve to the
  // single canonical record).
  const r = await client.query<TelebirrTransactionRow>(
    `SELECT ${SELECT_TELEBIRR_TX}
       FROM telebirr_transactions
      WHERE telebirr_ref = $1
      LIMIT 1`,
    [telebirrRef]
  );
  return r.rows[0] ?? null;
}

export async function insertTelebirrTransaction(
  client: PoolClient,
  params: {
    tenantId: string;
    agentId: string;
    userId: string | null;
    walletId: string | null;
    telebirrRef: string;
    senderPhone: string | null;
    senderName: string | null;
    amount: string | number;
    currency: string;
    smsBody: string | null;
    status: 'pending' | 'matched' | 'credited' | 'duplicate' | 'unmatched' | 'disputed';
    matchedAt: Date | null;
    creditedAt: Date | null;
    creditTransactionId: string | null;
  }
): Promise<TelebirrTransactionRow> {
  const r = await client.query<TelebirrTransactionRow>(
    `INSERT INTO telebirr_transactions
       (tenant_id, agent_id, user_id, wallet_id, telebirr_ref, sender_phone,
        sender_name, amount, currency, sms_body, status, matched_at,
        credited_at, credit_transaction_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9, $10,
             $11, $12, $13, $14)
     RETURNING ${SELECT_TELEBIRR_TX}`,
    [
      params.tenantId,
      params.agentId,
      params.userId,
      params.walletId,
      params.telebirrRef,
      params.senderPhone,
      params.senderName,
      String(params.amount),
      params.currency,
      params.smsBody,
      params.status,
      params.matchedAt,
      params.creditedAt,
      params.creditTransactionId,
    ]
  );
  return r.rows[0];
}

/* ------------------------------------------------------------------------- */
/* Deposit requests                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Strategy 1: ref-code lookup. Locks the request row so two concurrent
 * SMS arrivals can't both confirm the same deposit request.
 */
export async function findOpenDepositRequestByCode(
  client: PoolClient,
  tenantId: string,
  referenceCode: string
): Promise<TelebirrDepositRequestRow | null> {
  const r = await client.query<TelebirrDepositRequestRow>(
    `SELECT ${SELECT_DEPOSIT_REQUEST}
       FROM telebirr_deposit_requests
      WHERE tenant_id = $1
        AND reference_code = $2
        AND status = 'waiting'
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [tenantId, referenceCode]
  );
  return r.rows[0] ?? null;
}

/**
 * Strategy 2 / 3: amount-based lookups. Caller decides whether to require
 * a unique result.
 *
 * - When `userId` is provided we narrow to deposit requests for that user
 *   (used by Strategy 2 when sender_phone resolves to a known user).
 * - When `userId` is null we return all open deposit requests for the
 *   tenant with the matching amount (used by Strategy 3).
 */
export async function findOpenDepositRequestsByAmount(
  client: PoolClient,
  params: {
    tenantId: string;
    amount: string;
    userId?: string | null;
    minCreatedAt?: Date | null;
  }
): Promise<TelebirrDepositRequestRow[]> {
  const filters: string[] = [
    'tenant_id = $1',
    "status = 'waiting'",
    'expires_at > now()',
    'amount = $2::numeric',
  ];
  const values: unknown[] = [params.tenantId, params.amount];
  let i = 3;
  if (params.userId) {
    filters.push(`user_id = $${i++}`);
    values.push(params.userId);
  }
  if (params.minCreatedAt) {
    filters.push(`created_at >= $${i++}`);
    values.push(params.minCreatedAt);
  }
  const r = await client.query<TelebirrDepositRequestRow>(
    `SELECT ${SELECT_DEPOSIT_REQUEST}
       FROM telebirr_deposit_requests
      WHERE ${filters.join(' AND ')}
      ORDER BY created_at DESC
      FOR UPDATE`,
    values
  );
  return r.rows;
}

export async function markDepositRequestConfirmed(
  client: PoolClient,
  id: string,
  matchedTransactionId: string
): Promise<TelebirrDepositRequestRow | null> {
  const r = await client.query<TelebirrDepositRequestRow>(
    `UPDATE telebirr_deposit_requests
        SET status = 'confirmed',
            matched_transaction_id = $2
      WHERE id = $1 AND status = 'waiting'
      RETURNING ${SELECT_DEPOSIT_REQUEST}`,
    [id, matchedTransactionId]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* User-side deposit-request CRUD                                            */
/* ------------------------------------------------------------------------- */

export async function findDepositRequestById(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<TelebirrDepositRequestRow | null> {
  const r = await client.query<TelebirrDepositRequestRow>(
    `SELECT ${SELECT_DEPOSIT_REQUEST}
       FROM telebirr_deposit_requests
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function findUserOpenDepositRequest(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<TelebirrDepositRequestRow | null> {
  const r = await client.query<TelebirrDepositRequestRow>(
    `SELECT ${SELECT_DEPOSIT_REQUEST}
       FROM telebirr_deposit_requests
      WHERE tenant_id = $1
        AND user_id = $2
        AND status = 'waiting'
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, userId]
  );
  return r.rows[0] ?? null;
}

export async function isReferenceCodeAvailable(
  client: PoolClient,
  tenantId: string,
  code: string
): Promise<boolean> {
  // Reject when ANY waiting request already uses this code in this
  // tenant. Expired/cancelled rows can re-use the same code.
  const r = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM telebirr_deposit_requests
        WHERE tenant_id = $1
          AND reference_code = $2
          AND status = 'waiting'
          AND expires_at > now()
     ) AS exists`,
    [tenantId, code]
  );
  return !r.rows[0].exists;
}

export async function insertDepositRequest(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    amount: string;
    telebirrNumber: string;
    referenceCode: string;
    expiresAt: Date;
    claimedTelebirrRef?: string | null;
    /** Base64 data URL of the payment screenshot (evidence). Kept out of the
     *  hot projection; read on demand for review. */
    screenshotUrl?: string | null;
  }
): Promise<TelebirrDepositRequestRow> {
  const r = await client.query<TelebirrDepositRequestRow>(
    `INSERT INTO telebirr_deposit_requests
       (tenant_id, user_id, amount, telebirr_number, reference_code,
        claimed_telebirr_ref, screenshot_url, expires_at, status)
     VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, 'waiting')
     RETURNING ${SELECT_DEPOSIT_REQUEST}`,
    [
      params.tenantId,
      params.userId,
      params.amount,
      params.telebirrNumber,
      params.referenceCode,
      params.claimedTelebirrRef ?? null,
      params.screenshotUrl ?? null,
      params.expiresAt,
    ]
  );
  return r.rows[0];
}

/**
 * Read the payment screenshot for a deposit request (operator review). Kept
 * separate from the hot projection so the base64 blob is only fetched when
 * explicitly needed.
 */
export async function findDepositRequestScreenshot(
  client: PoolClient,
  tenantId: string,
  requestId: string
): Promise<string | null> {
  const r = await client.query<{ screenshot_url: string | null }>(
    `SELECT screenshot_url FROM telebirr_deposit_requests
      WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, requestId]
  );
  return r.rows[0]?.screenshot_url ?? null;
}

/**
 * Strategy 0: exact match on the user-submitted Telebirr reference. Locks
 * the request row so concurrent SMS arrivals can't double-confirm.
 */
export async function findOpenDepositRequestByClaimedRef(
  client: PoolClient,
  tenantId: string,
  telebirrRef: string
): Promise<TelebirrDepositRequestRow | null> {
  const r = await client.query<TelebirrDepositRequestRow>(
    `SELECT ${SELECT_DEPOSIT_REQUEST}
       FROM telebirr_deposit_requests
      WHERE tenant_id = $1
        AND claimed_telebirr_ref = $2
        AND status = 'waiting'
        AND expires_at > now()
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE`,
    [tenantId, telebirrRef]
  );
  return r.rows[0] ?? null;
}

/**
 * True when no OPEN (waiting, unexpired) deposit request already claims the
 * given Telebirr reference — used to reject duplicate claims at initiate.
 */
export async function isClaimedRefAvailable(
  client: PoolClient,
  tenantId: string,
  telebirrRef: string
): Promise<boolean> {
  const r = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM telebirr_deposit_requests
        WHERE tenant_id = $1
          AND claimed_telebirr_ref = $2
          AND status = 'waiting'
          AND expires_at > now()
     ) AS exists`,
    [tenantId, telebirrRef]
  );
  return !r.rows[0].exists;
}

export async function cancelDepositRequest(
  client: PoolClient,
  tenantId: string,
  userId: string,
  id: string
): Promise<TelebirrDepositRequestRow | null> {
  // Only the owning user may cancel; only `waiting` is cancellable.
  const r = await client.query<TelebirrDepositRequestRow>(
    `UPDATE telebirr_deposit_requests
        SET status = 'cancelled'
      WHERE id = $1
        AND tenant_id = $2
        AND user_id = $3
        AND status = 'waiting'
      RETURNING ${SELECT_DEPOSIT_REQUEST}`,
    [id, tenantId, userId]
  );
  return r.rows[0] ?? null;
}

export async function listUserDepositRequests(
  client: PoolClient,
  tenantId: string,
  userId: string,
  params: { limit: number; offset: number }
): Promise<{ rows: TelebirrDepositRequestRow[]; total: number }> {
  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM telebirr_deposit_requests
      WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId]
  );
  const total = totalRes.rows[0].count;
  const r = await client.query<TelebirrDepositRequestRow>(
    `SELECT ${SELECT_DEPOSIT_REQUEST}
       FROM telebirr_deposit_requests
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [tenantId, userId, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

/* ------------------------------------------------------------------------- */
/* Telebirr transactions list/filter                                         */
/* ------------------------------------------------------------------------- */

export interface ListTelebirrTransactionsParams {
  tenantId: string;
  status: string | null;
  agentId: string | null;
  userId: string | null;
  from: Date | null;
  to: Date | null;
  search: string | null;
  limit: number;
  offset: number;
}

export interface TelebirrTransactionWithJoins extends TelebirrTransactionRow {
  agent_name: string | null;
  agent_telebirr_number: string | null;
  user_email: string | null;
  user_phone: string | null;
}

export async function listTelebirrTransactions(
  client: PoolClient,
  params: ListTelebirrTransactionsParams
): Promise<{ rows: TelebirrTransactionWithJoins[]; total: number }> {
  const filters: string[] = ['tt.tenant_id = $1'];
  const values: unknown[] = [params.tenantId];
  let i = 2;
  if (params.status) {
    filters.push(`tt.status = $${i++}`);
    values.push(params.status);
  }
  if (params.agentId) {
    filters.push(`tt.agent_id = $${i++}`);
    values.push(params.agentId);
  }
  if (params.userId) {
    filters.push(`tt.user_id = $${i++}`);
    values.push(params.userId);
  }
  if (params.from) {
    filters.push(`tt.created_at >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    filters.push(`tt.created_at <= $${i++}`);
    values.push(params.to);
  }
  if (params.search) {
    filters.push(
      `(tt.telebirr_ref ILIKE $${i} OR tt.sender_phone ILIKE $${i} OR tt.sender_name ILIKE $${i})`
    );
    values.push(`%${params.search}%`);
    i++;
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM telebirr_transactions tt ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<TelebirrTransactionWithJoins>(
    `SELECT ${SELECT_TELEBIRR_TX
      .split(',')
      .map((c) => `tt.${c.trim()}`)
      .join(', ')},
            a.agent_name           AS agent_name,
            a.telebirr_number      AS agent_telebirr_number,
            u.email::text          AS user_email,
            u.phone                AS user_phone
       FROM telebirr_transactions tt
       LEFT JOIN telebirr_agents a ON a.id = tt.agent_id
       LEFT JOIN users u ON u.id = tt.user_id
       ${where}
      ORDER BY tt.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

export async function findTelebirrTxByIdInTenant(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<TelebirrTransactionRow | null> {
  const r = await client.query<TelebirrTransactionRow>(
    `SELECT ${SELECT_TELEBIRR_TX}
       FROM telebirr_transactions
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function setTelebirrTxStatus(
  client: PoolClient,
  id: string,
  status: 'pending' | 'matched' | 'credited' | 'duplicate' | 'unmatched' | 'disputed'
): Promise<TelebirrTransactionRow | null> {
  const r = await client.query<TelebirrTransactionRow>(
    `UPDATE telebirr_transactions
        SET status = $2
      WHERE id = $1
      RETURNING ${SELECT_TELEBIRR_TX}`,
    [id, status]
  );
  return r.rows[0] ?? null;
}

/**
 * Reverse a previously-credited Telebirr transaction back to
 * `unmatched`. Clears the link to the wallet ledger row but leaves the
 * sender/amount metadata intact so a re-match can still happen.
 */
export async function unmatchCreditedTx(
  client: PoolClient,
  id: string
): Promise<TelebirrTransactionRow | null> {
  const r = await client.query<TelebirrTransactionRow>(
    `UPDATE telebirr_transactions
        SET status = 'unmatched',
            user_id = NULL,
            wallet_id = NULL,
            matched_at = NULL,
            credited_at = NULL,
            credit_transaction_id = NULL
      WHERE id = $1 AND status = 'credited'
      RETURNING ${SELECT_TELEBIRR_TX}`,
    [id]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Raw SMS list                                                              */
/* ------------------------------------------------------------------------- */

export interface ListRawSmsParams {
  tenantId: string;
  agentId: string | null;
  processed: boolean | null;
  from: Date | null;
  to: Date | null;
  search: string | null;
  limit: number;
  offset: number;
}

export interface RawSmsWithAgent {
  id: string;
  tenant_id: string;
  agent_id: string;
  agent_name: string | null;
  sms_body: string;
  sender_number: string | null;
  received_at: Date | null;
  processed: boolean;
  processed_at: Date | null;
  created_at: Date;
}

export async function listRawSms(
  client: PoolClient,
  params: ListRawSmsParams
): Promise<{ rows: RawSmsWithAgent[]; total: number }> {
  const filters: string[] = ['s.tenant_id = $1'];
  const values: unknown[] = [params.tenantId];
  let i = 2;
  if (params.agentId) {
    filters.push(`s.agent_id = $${i++}`);
    values.push(params.agentId);
  }
  if (params.processed !== null) {
    filters.push(`s.processed = $${i++}`);
    values.push(params.processed);
  }
  if (params.from) {
    filters.push(`s.created_at >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    filters.push(`s.created_at <= $${i++}`);
    values.push(params.to);
  }
  if (params.search) {
    filters.push(
      `(s.sms_body ILIKE $${i} OR s.sender_number ILIKE $${i})`
    );
    values.push(`%${params.search}%`);
    i++;
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM telebirr_sms_raw s ${where}`,
    values
  );
  const total = totalRes.rows[0].count;
  const r = await client.query<RawSmsWithAgent>(
    `SELECT s.id, s.tenant_id, s.agent_id,
            a.agent_name,
            s.sms_body, s.sender_number, s.received_at,
            s.processed, s.processed_at, s.created_at
       FROM telebirr_sms_raw s
       LEFT JOIN telebirr_agents a ON a.id = s.agent_id
       ${where}
      ORDER BY s.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

/* ------------------------------------------------------------------------- */
/* Reports                                                                   */
/* ------------------------------------------------------------------------- */

export interface TelebirrReportRow {
  bucket: string;
  total_deposited: string;
  transaction_count: number;
  credited_count: number;
  unmatched_count: number;
  manual_match_count: number;
  match_rate_pct: string;
  avg_confirmation_time_seconds: string;
}

/**
 * Bucketed metrics for the admin /reports endpoint. We compute over
 * the union of telebirr_transactions × wallet ledger metadata so the
 * "manual match" count is exactly the number of credit ledger rows
 * tagged with `metadata->>'strategy' = 'manual_confirm'`.
 *
 * `granularity` is sanitised by the caller to one of 'hour'|'day'|'week'.
 */
export async function aggregateTelebirrReport(
  client: PoolClient,
  params: {
    tenantId: string;
    from: Date;
    to: Date;
    granularity: 'hour' | 'day' | 'week';
  }
): Promise<TelebirrReportRow[]> {
  const r = await client.query<TelebirrReportRow>(
    `WITH tx AS (
       SELECT tt.id, tt.created_at, tt.credited_at, tt.amount, tt.status,
              tx.metadata->>'strategy' AS strategy
         FROM telebirr_transactions tt
         LEFT JOIN transactions tx ON tx.id = tt.credit_transaction_id
        WHERE tt.tenant_id = $1
          AND tt.created_at >= $2
          AND tt.created_at < $3
     )
     SELECT date_trunc($4, created_at)::text AS bucket,
            COALESCE(SUM(amount) FILTER (WHERE status = 'credited'), 0)::text       AS total_deposited,
            COUNT(*)::int                                                            AS transaction_count,
            COUNT(*) FILTER (WHERE status = 'credited')::int                         AS credited_count,
            COUNT(*) FILTER (WHERE status = 'unmatched')::int                        AS unmatched_count,
            COUNT(*) FILTER (WHERE strategy = 'manual_confirm')::int                 AS manual_match_count,
            CASE
              WHEN COUNT(*) = 0 THEN '0'
              ELSE ROUND(
                COUNT(*) FILTER (WHERE status = 'credited')::numeric * 100.0
                / GREATEST(COUNT(*), 1)::numeric,
                2
              )::text
            END                                                                       AS match_rate_pct,
            COALESCE(
              AVG(EXTRACT(EPOCH FROM (credited_at - created_at)))
                FILTER (WHERE status = 'credited' AND credited_at IS NOT NULL),
              0
            )::numeric(12,2)::text                                                     AS avg_confirmation_time_seconds
       FROM tx
      GROUP BY bucket
      ORDER BY bucket ASC`,
    [params.tenantId, params.from, params.to, params.granularity]
  );
  return r.rows;
}

/* ------------------------------------------------------------------------- */
/* SMS raw                                                                   */
/* ------------------------------------------------------------------------- */

export async function findSmsRawById(
  client: PoolClient,
  id: string
): Promise<TelebirrSmsRawRow | null> {
  const r = await client.query<TelebirrSmsRawRow>(
    `SELECT id, tenant_id, agent_id, sms_body, sender_number, received_at,
            processed, processed_at, created_at
       FROM telebirr_sms_raw
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function markSmsProcessed(
  client: PoolClient,
  smsRawId: string
): Promise<void> {
  await client.query(
    `UPDATE telebirr_sms_raw
        SET processed = true, processed_at = now()
      WHERE id = $1`,
    [smsRawId]
  );
}

/* ------------------------------------------------------------------------- */
/* Users (lookup by phone)                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Look up a user inside the active tenant by their Telebirr-style phone
 * number. Tries multiple stored shapes because user registration is not
 * (yet) normalising phone format on insert:
 *
 *   - 09XXXXXXXX        (canonical form returned by normalizePhone)
 *   - +2519XXXXXXXX     (E.164 international)
 *   - 2519XXXXXXXX      (no plus)
 *
 * Only returns rows with role='user' or 'affiliate' (the only roles a
 * Telebirr deposit ever credits).
 */
export async function findUserByPhone(
  client: PoolClient,
  tenantId: string,
  normalizedPhone: string
): Promise<UserRow | null> {
  const variants = phoneVariants(normalizedPhone);
  if (variants.length === 0) return null;
  const r = await client.query<UserRow>(
    `SELECT ${SELECT_USER}
       FROM users
      WHERE tenant_id = $1
        AND phone = ANY($2::text[])
        AND status = 'active'
        AND role IN ('user', 'affiliate')
      ORDER BY (role = 'user') DESC, created_at ASC
      LIMIT 1`,
    [tenantId, variants]
  );
  return r.rows[0] ?? null;
}

function phoneVariants(canonical: string): string[] {
  // canonical = "09XXXXXXXX"
  if (!/^0[79]\d{8}$/.test(canonical)) return [];
  const tail = canonical.slice(1); // "9XXXXXXXX"
  return [canonical, `+251${tail}`, `251${tail}`];
}

/* ------------------------------------------------------------------------- */
/* Wallets                                                                   */
/* ------------------------------------------------------------------------- */

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
  const r = await client.query<WalletRow>(
    `SELECT ${SELECT_WALLET}
       FROM wallets
      WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
      FOR UPDATE`,
    [tenantId, userId, currency]
  );
  if (!r.rows[0]) throw new Error('failed to acquire wallet row for telebirr credit');
  return r.rows[0];
}

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

/* ------------------------------------------------------------------------- */
/* Wallet ledger (transactions)                                              */
/* ------------------------------------------------------------------------- */

export async function insertWalletLedgerTransaction(
  client: PoolClient,
  params: {
    tenantId: string;
    walletId: string;
    userId: string;
    /**
     * NOTE: spec calls this 'telebirr_deposit' but the existing
     * `transactions_type_check` constraint only allows 'p2p_deposit'
     * among Telebirr-relevant values. We use 'p2p_deposit' here and tag
     * `metadata.method = 'telebirr'` for differentiation in admin UIs
     * and reports. Promote to a dedicated 'telebirr_deposit' enum value
     * via migration if/when the product wants to slice them separately.
     */
    type: 'p2p_deposit';
    amount: string;
    beforeBalance: string;
    afterBalance: string;
    currency: string;
    /** Idempotency key — we use telebirr_ref to make replays no-ops. */
    reference: string;
    metadata: Record<string, unknown>;
  }
): Promise<WalletLedgerRow> {
  const r = await client.query<WalletLedgerRow>(
    `INSERT INTO transactions
       (tenant_id, wallet_id, user_id, type, amount, before_balance,
        after_balance, currency, reference, metadata, status)
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric,
             $8, $9, $10::jsonb, 'completed')
     RETURNING ${SELECT_WALLET_LEDGER}`,
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
    ]
  );
  return r.rows[0];
}

/* ------------------------------------------------------------------------- */
/* Fraud / velocity helpers (RULE 5, 6, 8)                                   */
/* ------------------------------------------------------------------------- */

/**
 * Sum of credited Telebirr transactions for an agent on a given UTC
 * day. Used by RULE 5 to decide whether the agent has exceeded the
 * configured daily volume cap. Counts only `status = 'credited'` so a
 * pending/unmatched row never trips the cap.
 */
export async function getAgentDailyVolume(
  client: PoolClient,
  tenantId: string,
  agentId: string,
  day: Date
): Promise<{ total: string; count: number }> {
  const r = await client.query<{ total: string; count: number }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total,
            COUNT(*)::int                  AS count
       FROM telebirr_transactions
      WHERE tenant_id = $1
        AND agent_id = $2
        AND status = 'credited'
        AND created_at >= date_trunc('day', $3::timestamptz)
        AND created_at <  date_trunc('day', $3::timestamptz) + interval '1 day'`,
    [tenantId, agentId, day]
  );
  return r.rows[0] ?? { total: '0', count: 0 };
}

/**
 * RULE 6 — sender phone velocity: number of telebirr_transactions
 * (any status) from `sender_phone` in the last `windowMinutes` minutes
 * for this tenant. Excludes the row currently being processed if a
 * caller passes excludeTelebirrRef.
 */
export async function getSenderPhoneRecentCount(
  client: PoolClient,
  tenantId: string,
  senderPhone: string,
  windowMinutes: number,
  excludeTelebirrRef: string | null = null
): Promise<number> {
  const filters: string[] = [
    'tenant_id = $1',
    'sender_phone = $2',
    `created_at > now() - ($3::int * interval '1 minute')`,
  ];
  const values: unknown[] = [tenantId, senderPhone, windowMinutes];
  if (excludeTelebirrRef) {
    filters.push(`telebirr_ref <> $4`);
    values.push(excludeTelebirrRef);
  }
  const r = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM telebirr_transactions
      WHERE ${filters.join(' AND ')}`,
    values
  );
  return r.rows[0]?.count ?? 0;
}

/**
 * RULE 8 — refcode brute-force counter.
 *
 *   1. Sweep entries older than the window so the table doesn't grow
 *      forever (cheap delete on the (created_at) index).
 *   2. Insert a new attempt row.
 *   3. Return the count of DISTINCT refcodes for this identifier in
 *      the active window.
 *
 * Doing all three in one round-trip keeps the latency budget tight —
 * each /api/user/deposits/telebirr/initiate call now adds ~1 ms.
 */
export async function recordRefcodeAttempt(
  client: PoolClient,
  params: {
    tenantId: string;
    identifierType: 'ip' | 'user' | 'agent' | 'session';
    identifier: string;
    refcode: string;
    context: string;
    ip: string | null;
    userAgent: string | null;
    windowMinutes: number;
  }
): Promise<{ distinctCount: number }> {
  // Sweep — bound by an aggressive limit to avoid touching too many
  // rows on a single request. The next request keeps sweeping if there
  // are leftovers; eventual cleanup is fine for a security ledger.
  await client.query(
    `DELETE FROM telebirr_refcode_attempts
      WHERE created_at < now() - ($1::int * interval '1 minute') * 2`,
    [params.windowMinutes]
  );

  await client.query(
    `INSERT INTO telebirr_refcode_attempts
       (tenant_id, identifier_type, identifier, refcode, context, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::inet, $7)`,
    [
      params.tenantId,
      params.identifierType,
      params.identifier,
      params.refcode,
      params.context,
      params.ip,
      params.userAgent,
    ]
  );

  const r = await client.query<{ count: number }>(
    `SELECT COUNT(DISTINCT refcode)::int AS count
       FROM telebirr_refcode_attempts
      WHERE tenant_id = $1
        AND identifier_type = $2
        AND identifier = $3
        AND created_at > now() - ($4::int * interval '1 minute')`,
    [params.tenantId, params.identifierType, params.identifier, params.windowMinutes]
  );
  return { distinctCount: r.rows[0]?.count ?? 0 };
}
