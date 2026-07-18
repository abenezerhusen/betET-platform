import type { PoolClient } from 'pg';

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

export interface AgentRow {
  id: string;
  tenant_id: string;
  agent_name: string;
  telebirr_number: string;
  device_id: string;
  device_name: string | null;
  app_version: string | null;
  last_seen_at: Date | null;
  status: string;
  balance: string;
  /**
   * Net agent pre-deposit (float/collateral) = SUM of confirmed manual swaps
   * minus confirmed withdrawal swaps. Surfaced by listAgents so the wallet
   * list reflects top-ups (which are booked as swaps, not balance changes).
   */
  pre_deposit?: string;
  assigned_cashier_id: string | null;
  last_assigned_at: Date | null;
  created_at: Date;
}

export interface SwapRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  amount: string;
  source: 'manual' | 'withdrawal';
  status: 'pending' | 'added' | 'failed';
  operator_id: string | null;
  ref_user_id: string | null;
  ref_withdrawal_id: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SubAccountRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  phone: string;
  label: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CommandRow {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  reference: string | null;
  status:
    | 'pending'
    | 'sent'
    | 'executing'
    | 'success'
    | 'failed'
    | 'cancelled';
  result: Record<string, unknown>;
  error_message: string | null;
  issued_by: string | null;
  sent_at: Date | null;
  executing_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OperatorRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'client';
  status: 'active' | 'suspended';
  permissions: string[];
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OperatorAccessTokenRow {
  id: string;
  tenant_id: string;
  operator_id: string;
  token_hash: string;
  token_tail: string;
  delivered_to: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_by: string | null;
  created_at: Date;
}

export interface P2pSettingsRow {
  tenant_id: string;
  max_daily_per_wallet: string;
  max_per_transaction: string;
  auto_switch_enabled: boolean;
  auto_switch_threshold_pct: number;
  exhaustion_failover_enabled: boolean;
  exhaustion_threshold_pct: number;
  block_wallet_on_empty: boolean;
  notify_admin: boolean;
  notify_agent: boolean;
  notify_channel: 'sms' | 'email' | 'both';
  manual_approval_threshold: string;
  default_deposit_commission_pct: string;
  default_withdrawal_commission_pct: string;
  created_at: Date;
  updated_at: Date;
}

export interface WalletPriorityRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  priority: number;
  enabled: boolean;
}

export interface CommissionRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  deposit_pct: string;
  withdrawal_pct: string;
}

export interface ClientCommissionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  deposit_pct: string;
  withdrawal_pct: string;
}

export interface EventLogRow {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  kind: string;
  level: 'info' | 'warning' | 'error';
  code: string | null;
  message: string | null;
  payload: Record<string, unknown>;
  duration_ms: number | null;
  created_at: Date;
}

/* -------------------------------------------------------------------------- */
/* Wallet devices                                                               */
/* -------------------------------------------------------------------------- */

export async function listAgents(
  client: PoolClient,
  tenantId: string | null,
  params: {
    status: string | null;
    search: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: AgentRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (tenantId) {
    filters.push(`tenant_id = $${i++}`);
    values.push(tenantId);
  }
  if (params.status && ['active', 'inactive', 'suspended'].includes(params.status)) {
    filters.push(`status = $${i++}`);
    values.push(params.status);
  }
  if (params.search) {
    filters.push(`(agent_name ILIKE $${i} OR telebirr_number ILIKE $${i} OR device_id ILIKE $${i})`);
    values.push(`%${params.search}%`);
    i++;
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM telebirr_agents ${where}`,
    values
  );
  const rowsRes = await client.query<AgentRow>(
    `SELECT a.id, a.tenant_id, a.agent_name, a.telebirr_number, a.device_id, a.device_name,
            a.app_version, a.last_seen_at, a.status, a.balance, a.assigned_cashier_id,
            a.last_assigned_at, a.created_at,
            COALESCE(sw.pre_deposit, a.balance, 0)::text AS pre_deposit
       FROM telebirr_agents a
       LEFT JOIN (
         SELECT agent_id,
                SUM(CASE WHEN source = 'manual'     AND status = 'added' THEN amount
                         WHEN source = 'withdrawal' AND status = 'added' THEN -amount
                         ELSE 0 END) AS pre_deposit
           FROM p2p_swaps
          GROUP BY agent_id
       ) sw ON sw.agent_id = a.id
       ${where}
     ORDER BY a.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );

  return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function getAgent(
  client: PoolClient,
  id: string
): Promise<AgentRow | null> {
  const res = await client.query<AgentRow>(
    `SELECT id, tenant_id, agent_name, telebirr_number, device_id, device_name,
            app_version, last_seen_at, status, balance, assigned_cashier_id,
            last_assigned_at, created_at
       FROM telebirr_agents WHERE id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function createAgent(
  client: PoolClient,
  tenantId: string,
  input: {
    agent_name: string;
    telebirr_number: string;
    device_id: string;
    auth_token_hash?: string;
    ussd_pin_encrypted?: string | null;
  }
): Promise<AgentRow> {
  const res = await client.query<AgentRow>(
    `INSERT INTO telebirr_agents (
       tenant_id, agent_name, telebirr_number, device_id, auth_token_hash,
       ussd_pin_encrypted, status
     ) VALUES ($1,$2,$3,$4,$5,$6,'active')
     RETURNING id, tenant_id, agent_name, telebirr_number, device_id, device_name,
               app_version, last_seen_at, status, balance, assigned_cashier_id,
               last_assigned_at, created_at`,
    [
      tenantId,
      input.agent_name,
      input.telebirr_number,
      input.device_id,
      input.auth_token_hash ?? null,
      input.ussd_pin_encrypted ?? null,
    ]
  );
  return res.rows[0];
}

/**
 * Set (or replace) the sealed USSD PIN for a wallet device. The caller
 * passes the already-sealed ciphertext.
 */
export async function setAgentUssdPin(
  client: PoolClient,
  id: string,
  ussdPinEncrypted: string
): Promise<AgentRow | null> {
  const res = await client.query<AgentRow>(
    `UPDATE telebirr_agents
        SET ussd_pin_encrypted = $2
      WHERE id = $1
      RETURNING id, tenant_id, agent_name, telebirr_number, device_id, device_name,
                app_version, last_seen_at, status, balance, assigned_cashier_id,
                last_assigned_at, created_at`,
    [id, ussdPinEncrypted]
  );
  return res.rows[0] ?? null;
}

/**
 * Read the sealed USSD PIN ciphertext for an agent (by id). Returns null
 * when unset. Only used server-side to build the outbound withdraw USSD.
 */
export async function getAgentUssdPinEncrypted(
  client: PoolClient,
  agentId: string
): Promise<string | null> {
  const res = await client.query<{ ussd_pin_encrypted: string | null }>(
    `SELECT ussd_pin_encrypted FROM telebirr_agents WHERE id = $1`,
    [agentId]
  );
  return res.rows[0]?.ussd_pin_encrypted ?? null;
}

export async function updateAgent(
  client: PoolClient,
  id: string,
  patch: { agent_name?: string; status?: string }
): Promise<AgentRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.agent_name !== undefined) {
    sets.push(`agent_name = $${i++}`);
    values.push(patch.agent_name);
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(patch.status);
  }
  if (!sets.length) return getAgent(client, id);
  values.push(id);

  const res = await client.query<AgentRow>(
    `UPDATE telebirr_agents SET ${sets.join(', ')}
       WHERE id = $${i}
       RETURNING id, tenant_id, agent_name, telebirr_number, device_id, device_name,
                 app_version, last_seen_at, status, balance, assigned_cashier_id,
                 last_assigned_at, created_at`,
    values
  );
  return res.rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Sub-accounts                                                                 */
/* -------------------------------------------------------------------------- */

export async function listSubAccounts(
  client: PoolClient,
  agentId: string
): Promise<SubAccountRow[]> {
  const res = await client.query<SubAccountRow>(
    `SELECT id, tenant_id, agent_id, phone, label, enabled, created_at, updated_at
       FROM p2p_sub_accounts WHERE agent_id = $1 ORDER BY created_at`,
    [agentId]
  );
  return res.rows;
}

export async function addSubAccount(
  client: PoolClient,
  tenantId: string,
  agentId: string,
  input: { phone: string; label?: string }
): Promise<SubAccountRow> {
  const res = await client.query<SubAccountRow>(
    `INSERT INTO p2p_sub_accounts (tenant_id, agent_id, phone, label, enabled)
     VALUES ($1,$2,$3,$4,true)
     RETURNING id, tenant_id, agent_id, phone, label, enabled, created_at, updated_at`,
    [tenantId, agentId, input.phone, input.label ?? null]
  );
  return res.rows[0];
}

export async function toggleSubAccount(
  client: PoolClient,
  id: string,
  enabled: boolean
): Promise<SubAccountRow | null> {
  const res = await client.query<SubAccountRow>(
    `UPDATE p2p_sub_accounts SET enabled = $1 WHERE id = $2
     RETURNING id, tenant_id, agent_id, phone, label, enabled, created_at, updated_at`,
    [enabled, id]
  );
  return res.rows[0] ?? null;
}

export async function removeSubAccount(
  client: PoolClient,
  id: string
): Promise<boolean> {
  const res = await client.query(`DELETE FROM p2p_sub_accounts WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* Swaps                                                                        */
/* -------------------------------------------------------------------------- */

export async function listSwaps(
  client: PoolClient,
  tenantId: string | null,
  params: {
    agentId: string | null;
    source: string | null;
    status: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: SwapRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (tenantId) {
    filters.push(`tenant_id = $${i++}`);
    values.push(tenantId);
  }
  if (params.agentId) {
    filters.push(`agent_id = $${i++}`);
    values.push(params.agentId);
  }
  if (params.source) {
    filters.push(`source = $${i++}`);
    values.push(params.source);
  }
  if (params.status) {
    filters.push(`status = $${i++}`);
    values.push(params.status);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM p2p_swaps ${where}`,
    values
  );
  const rowsRes = await client.query<SwapRow>(
    `SELECT id, tenant_id, agent_id, amount, source, status, operator_id,
            ref_user_id, ref_withdrawal_id, note, created_at, updated_at
       FROM p2p_swaps
       ${where}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function createSwap(
  client: PoolClient,
  tenantId: string,
  input: {
    agent_id: string;
    amount: number;
    source: 'manual' | 'withdrawal';
    status?: 'pending' | 'added' | 'failed';
    operator_id?: string | null;
    ref_user_id?: string | null;
    ref_withdrawal_id?: string | null;
    note?: string | null;
  }
): Promise<SwapRow> {
  const res = await client.query<SwapRow>(
    `INSERT INTO p2p_swaps (
       tenant_id, agent_id, amount, source, status, operator_id,
       ref_user_id, ref_withdrawal_id, note
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, tenant_id, agent_id, amount, source, status, operator_id,
               ref_user_id, ref_withdrawal_id, note, created_at, updated_at`,
    [
      tenantId,
      input.agent_id,
      input.amount,
      input.source,
      input.status ?? 'added',
      input.operator_id ?? null,
      input.ref_user_id ?? null,
      input.ref_withdrawal_id ?? null,
      input.note ?? null,
    ]
  );
  return res.rows[0];
}

export async function updateSwapStatus(
  client: PoolClient,
  id: string,
  status: 'added' | 'failed',
  note?: string
): Promise<SwapRow | null> {
  const res = await client.query<SwapRow>(
    `UPDATE p2p_swaps SET status = $1, note = COALESCE($2, note)
       WHERE id = $3
       RETURNING id, tenant_id, agent_id, amount, source, status, operator_id,
                 ref_user_id, ref_withdrawal_id, note, created_at, updated_at`,
    [status, note ?? null, id]
  );
  return res.rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                     */
/* -------------------------------------------------------------------------- */

export async function listCommands(
  client: PoolClient,
  tenantId: string | null,
  params: {
    status: string | null;
    agentId: string | null;
    kind: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: CommandRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (tenantId) {
    filters.push(`tenant_id = $${i++}`);
    values.push(tenantId);
  }
  if (params.status) {
    filters.push(`status = $${i++}`);
    values.push(params.status);
  }
  if (params.agentId) {
    filters.push(`agent_id = $${i++}`);
    values.push(params.agentId);
  }
  if (params.kind) {
    filters.push(`kind = $${i++}`);
    values.push(params.kind);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM p2p_commands ${where}`,
    values
  );
  const rowsRes = await client.query<CommandRow>(
    `SELECT id, tenant_id, agent_id, kind, payload, reference, status, result,
            error_message, issued_by, sent_at, executing_at, completed_at,
            created_at, updated_at
       FROM p2p_commands
       ${where}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function getCommand(
  client: PoolClient,
  id: string
): Promise<CommandRow | null> {
  const res = await client.query<CommandRow>(
    `SELECT id, tenant_id, agent_id, kind, payload, reference, status, result,
            error_message, issued_by, sent_at, executing_at, completed_at,
            created_at, updated_at
       FROM p2p_commands WHERE id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function createCommand(
  client: PoolClient,
  tenantId: string,
  input: {
    agent_id: string | null;
    kind: string;
    payload: Record<string, unknown>;
    reference: string | null;
    issued_by: string | null;
  }
): Promise<CommandRow> {
  const res = await client.query<CommandRow>(
    `INSERT INTO p2p_commands (
       tenant_id, agent_id, kind, payload, reference, issued_by, status
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,'pending')
     RETURNING id, tenant_id, agent_id, kind, payload, reference, status, result,
               error_message, issued_by, sent_at, executing_at, completed_at,
               created_at, updated_at`,
    [
      tenantId,
      input.agent_id,
      input.kind,
      JSON.stringify(input.payload ?? {}),
      input.reference,
      input.issued_by,
    ]
  );
  return res.rows[0];
}

export async function updateCommandStatus(
  client: PoolClient,
  id: string,
  patch: {
    status: CommandRow['status'];
    result?: Record<string, unknown>;
    error_message?: string | null;
  }
): Promise<CommandRow | null> {
  const sets: string[] = [`status = $1`];
  const values: unknown[] = [patch.status];
  let i = 2;
  if (patch.result !== undefined) {
    sets.push(`result = $${i++}::jsonb`);
    values.push(JSON.stringify(patch.result));
  }
  if (patch.error_message !== undefined) {
    sets.push(`error_message = $${i++}`);
    values.push(patch.error_message);
  }
  if (patch.status === 'sent') {
    sets.push(`sent_at = COALESCE(sent_at, now())`);
  } else if (patch.status === 'executing') {
    sets.push(`executing_at = COALESCE(executing_at, now())`);
  } else if (
    patch.status === 'success' ||
    patch.status === 'failed' ||
    patch.status === 'cancelled'
  ) {
    sets.push(`completed_at = COALESCE(completed_at, now())`);
  }
  values.push(id);
  const res = await client.query<CommandRow>(
    `UPDATE p2p_commands SET ${sets.join(', ')}
       WHERE id = $${i}
       RETURNING id, tenant_id, agent_id, kind, payload, reference, status, result,
                 error_message, issued_by, sent_at, executing_at, completed_at,
                 created_at, updated_at`,
    values
  );
  return res.rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Operators                                                                    */
/* -------------------------------------------------------------------------- */

export async function listOperators(
  client: PoolClient,
  tenantId: string | null,
  params: {
    role: string | null;
    status: string | null;
    search: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: OperatorRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (tenantId) {
    filters.push(`tenant_id = $${i++}`);
    values.push(tenantId);
  }
  if (params.role) {
    filters.push(`role = $${i++}`);
    values.push(params.role);
  }
  if (params.status) {
    filters.push(`status = $${i++}`);
    values.push(params.status);
  }
  if (params.search) {
    filters.push(`(name ILIKE $${i} OR email ILIKE $${i})`);
    values.push(`%${params.search}%`);
    i++;
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM p2p_operators ${where}`,
    values
  );
  const rowsRes = await client.query<OperatorRow>(
    `SELECT id, tenant_id, user_id, name, email, role, status, permissions,
            last_login_at, created_at, updated_at
       FROM p2p_operators
       ${where}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function getOperator(
  client: PoolClient,
  id: string
): Promise<OperatorRow | null> {
  const res = await client.query<OperatorRow>(
    `SELECT id, tenant_id, user_id, name, email, role, status, permissions,
            last_login_at, created_at, updated_at
       FROM p2p_operators WHERE id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function createOperator(
  client: PoolClient,
  tenantId: string,
  input: {
    name: string;
    email: string;
    role: 'admin' | 'operator' | 'client';
    status: 'active' | 'suspended';
    permissions: string[];
    user_id?: string | null;
  }
): Promise<OperatorRow> {
  const res = await client.query<OperatorRow>(
    `INSERT INTO p2p_operators (
       tenant_id, user_id, name, email, role, status, permissions
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, tenant_id, user_id, name, email, role, status, permissions,
               last_login_at, created_at, updated_at`,
    [
      tenantId,
      input.user_id ?? null,
      input.name,
      input.email,
      input.role,
      input.status,
      input.permissions,
    ]
  );
  return res.rows[0];
}

export async function updateOperator(
  client: PoolClient,
  id: string,
  patch: Partial<{
    name: string;
    email: string;
    role: 'admin' | 'operator' | 'client';
    status: 'active' | 'suspended';
    permissions: string[];
  }>
): Promise<OperatorRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (!sets.length) return getOperator(client, id);
  values.push(id);
  const res = await client.query<OperatorRow>(
    `UPDATE p2p_operators SET ${sets.join(', ')}
       WHERE id = $${i}
       RETURNING id, tenant_id, user_id, name, email, role, status, permissions,
                 last_login_at, created_at, updated_at`,
    values
  );
  return res.rows[0] ?? null;
}

export async function setOperatorAssignments(
  client: PoolClient,
  tenantId: string,
  operatorId: string,
  agentIds: string[]
): Promise<{ assigned: string[] }> {
  await client.query(`DELETE FROM p2p_operator_assignments WHERE operator_id = $1`, [
    operatorId,
  ]);
  if (agentIds.length === 0) return { assigned: [] };
  const placeholders = agentIds
    .map((_, idx) => `($1, $2, $${idx + 3})`)
    .join(', ');
  await client.query(
    `INSERT INTO p2p_operator_assignments (tenant_id, operator_id, agent_id)
       VALUES ${placeholders}
       ON CONFLICT (operator_id, agent_id) DO NOTHING`,
    [tenantId, operatorId, ...agentIds]
  );
  return { assigned: [...agentIds] };
}

export async function getOperatorAssignments(
  client: PoolClient,
  operatorId: string
): Promise<string[]> {
  const res = await client.query<{ agent_id: string }>(
    `SELECT agent_id FROM p2p_operator_assignments WHERE operator_id = $1`,
    [operatorId]
  );
  return res.rows.map((r) => r.agent_id);
}

/* -------------------------------------------------------------------------- */
/* Operator access tokens                                                       */
/* -------------------------------------------------------------------------- */

export async function listAccessTokens(
  client: PoolClient,
  operatorId: string
): Promise<OperatorAccessTokenRow[]> {
  const res = await client.query<OperatorAccessTokenRow>(
    `SELECT id, tenant_id, operator_id, token_hash, token_tail, delivered_to,
            expires_at, revoked_at, last_used_at, created_by, created_at
       FROM p2p_operator_access_tokens
       WHERE operator_id = $1
       ORDER BY created_at DESC`,
    [operatorId]
  );
  return res.rows;
}

export async function insertAccessToken(
  client: PoolClient,
  tenantId: string,
  input: {
    operator_id: string;
    token_hash: string;
    token_tail: string;
    delivered_to: string | null;
    expires_at: Date;
    created_by: string | null;
  }
): Promise<OperatorAccessTokenRow> {
  const res = await client.query<OperatorAccessTokenRow>(
    `INSERT INTO p2p_operator_access_tokens (
       tenant_id, operator_id, token_hash, token_tail, delivered_to,
       expires_at, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, tenant_id, operator_id, token_hash, token_tail, delivered_to,
               expires_at, revoked_at, last_used_at, created_by, created_at`,
    [
      tenantId,
      input.operator_id,
      input.token_hash,
      input.token_tail,
      input.delivered_to,
      input.expires_at,
      input.created_by,
    ]
  );
  return res.rows[0];
}

export async function revokeAccessToken(
  client: PoolClient,
  id: string
): Promise<OperatorAccessTokenRow | null> {
  const res = await client.query<OperatorAccessTokenRow>(
    `UPDATE p2p_operator_access_tokens SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING id, tenant_id, operator_id, token_hash, token_tail, delivered_to,
                 expires_at, revoked_at, last_used_at, created_by, created_at`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function findAccessTokenByHash(
  client: PoolClient,
  tokenHash: string
): Promise<OperatorAccessTokenRow | null> {
  const res = await client.query<OperatorAccessTokenRow>(
    `SELECT id, tenant_id, operator_id, token_hash, token_tail, delivered_to,
            expires_at, revoked_at, last_used_at, created_by, created_at
       FROM p2p_operator_access_tokens
       WHERE token_hash = $1`,
    [tokenHash]
  );
  return res.rows[0] ?? null;
}

export async function touchAccessTokenLastUsed(
  client: PoolClient,
  id: string
): Promise<void> {
  await client.query(
    `UPDATE p2p_operator_access_tokens SET last_used_at = now() WHERE id = $1`,
    [id]
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                     */
/* -------------------------------------------------------------------------- */

export async function getOrCreateSettings(
  client: PoolClient,
  tenantId: string
): Promise<P2pSettingsRow> {
  const existing = await client.query<P2pSettingsRow>(
    `SELECT * FROM p2p_settings WHERE tenant_id = $1`,
    [tenantId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query<P2pSettingsRow>(
    `INSERT INTO p2p_settings (tenant_id) VALUES ($1)
     ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
     RETURNING *`,
    [tenantId]
  );
  return inserted.rows[0];
}

export async function updateSettings(
  client: PoolClient,
  tenantId: string,
  patch: Record<string, unknown>
): Promise<P2pSettingsRow> {
  const cols = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!cols.length) return getOrCreateSettings(client, tenantId);
  await getOrCreateSettings(client, tenantId);
  const sets = cols.map((c, idx) => `${c} = $${idx + 2}`).join(', ');
  const values = cols.map((c) => patch[c]);
  const res = await client.query<P2pSettingsRow>(
    `UPDATE p2p_settings SET ${sets} WHERE tenant_id = $1 RETURNING *`,
    [tenantId, ...values]
  );
  return res.rows[0];
}

/* -------------------------------------------------------------------------- */
/* Wallet priority                                                              */
/* -------------------------------------------------------------------------- */

export async function listWalletPriority(
  client: PoolClient,
  tenantId: string | null
): Promise<WalletPriorityRow[]> {
  const filter = tenantId ? `WHERE tenant_id = $1` : '';
  const values = tenantId ? [tenantId] : [];
  const res = await client.query<WalletPriorityRow>(
    `SELECT id, tenant_id, agent_id, priority, enabled
       FROM p2p_wallet_priority ${filter}
       ORDER BY priority ASC`,
    values
  );
  return res.rows;
}

export async function setWalletPriority(
  client: PoolClient,
  tenantId: string,
  items: Array<{ agent_id: string; priority: number; enabled: boolean }>
): Promise<void> {
  await client.query(
    `DELETE FROM p2p_wallet_priority WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!items.length) return;
  const placeholders = items
    .map((_, idx) => {
      const base = idx * 3 + 2;
      return `($1, $${base}, $${base + 1}, $${base + 2})`;
    })
    .join(', ');
  const flat: unknown[] = [tenantId];
  for (const it of items) {
    flat.push(it.agent_id, it.priority, it.enabled);
  }
  await client.query(
    `INSERT INTO p2p_wallet_priority (tenant_id, agent_id, priority, enabled)
     VALUES ${placeholders}`,
    flat
  );
}

/* -------------------------------------------------------------------------- */
/* Commissions                                                                  */
/* -------------------------------------------------------------------------- */

export async function listWalletCommissions(
  client: PoolClient,
  tenantId: string | null
): Promise<CommissionRow[]> {
  const filter = tenantId ? `WHERE tenant_id = $1` : '';
  const values = tenantId ? [tenantId] : [];
  const res = await client.query<CommissionRow>(
    `SELECT id, tenant_id, agent_id, deposit_pct, withdrawal_pct
       FROM p2p_commissions ${filter}`,
    values
  );
  return res.rows;
}

export async function upsertWalletCommission(
  client: PoolClient,
  tenantId: string,
  input: { agent_id: string; deposit_pct: number; withdrawal_pct: number }
): Promise<CommissionRow> {
  const res = await client.query<CommissionRow>(
    `INSERT INTO p2p_commissions (tenant_id, agent_id, deposit_pct, withdrawal_pct)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, agent_id)
     DO UPDATE SET deposit_pct = EXCLUDED.deposit_pct,
                   withdrawal_pct = EXCLUDED.withdrawal_pct
     RETURNING id, tenant_id, agent_id, deposit_pct, withdrawal_pct`,
    [tenantId, input.agent_id, input.deposit_pct, input.withdrawal_pct]
  );
  return res.rows[0];
}

export async function listClientCommissions(
  client: PoolClient,
  tenantId: string | null
): Promise<ClientCommissionRow[]> {
  const filter = tenantId ? `WHERE tenant_id = $1` : '';
  const values = tenantId ? [tenantId] : [];
  const res = await client.query<ClientCommissionRow>(
    `SELECT id, tenant_id, user_id, deposit_pct, withdrawal_pct
       FROM p2p_client_commissions ${filter}`,
    values
  );
  return res.rows;
}

export async function upsertClientCommission(
  client: PoolClient,
  tenantId: string,
  input: { user_id: string; deposit_pct: number; withdrawal_pct: number }
): Promise<ClientCommissionRow> {
  const res = await client.query<ClientCommissionRow>(
    `INSERT INTO p2p_client_commissions (tenant_id, user_id, deposit_pct, withdrawal_pct)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, user_id)
     DO UPDATE SET deposit_pct = EXCLUDED.deposit_pct,
                   withdrawal_pct = EXCLUDED.withdrawal_pct
     RETURNING id, tenant_id, user_id, deposit_pct, withdrawal_pct`,
    [tenantId, input.user_id, input.deposit_pct, input.withdrawal_pct]
  );
  return res.rows[0];
}

export async function deleteClientCommission(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<boolean> {
  const res = await client.query(
    `DELETE FROM p2p_client_commissions WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId]
  );
  return (res.rowCount ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* Event logs                                                                   */
/* -------------------------------------------------------------------------- */

export async function listEventLogs(
  client: PoolClient,
  tenantId: string | null,
  params: {
    kind: string | null;
    level: string | null;
    agentId: string | null;
    search: string | null;
    from: Date | null;
    to: Date | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: EventLogRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (tenantId) {
    filters.push(`tenant_id = $${i++}`);
    values.push(tenantId);
  }
  if (params.kind) {
    filters.push(`kind = $${i++}`);
    values.push(params.kind);
  }
  if (params.level) {
    filters.push(`level = $${i++}`);
    values.push(params.level);
  }
  if (params.agentId) {
    filters.push(`agent_id = $${i++}`);
    values.push(params.agentId);
  }
  if (params.search) {
    filters.push(`(message ILIKE $${i} OR code ILIKE $${i})`);
    values.push(`%${params.search}%`);
    i++;
  }
  if (params.from) {
    filters.push(`created_at >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    filters.push(`created_at <= $${i++}`);
    values.push(params.to);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM p2p_event_logs ${where}`,
    values
  );
  const rowsRes = await client.query<EventLogRow>(
    `SELECT id, tenant_id, agent_id, kind, level, code, message, payload,
            duration_ms, created_at
       FROM p2p_event_logs
       ${where}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function logEvent(
  client: PoolClient,
  tenantId: string,
  input: {
    agent_id: string | null;
    kind: string;
    level?: 'info' | 'warning' | 'error';
    code?: string | null;
    message?: string | null;
    payload?: Record<string, unknown>;
    duration_ms?: number | null;
  }
): Promise<EventLogRow> {
  const res = await client.query<EventLogRow>(
    `INSERT INTO p2p_event_logs (
       tenant_id, agent_id, kind, level, code, message, payload, duration_ms
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING id, tenant_id, agent_id, kind, level, code, message, payload,
               duration_ms, created_at`,
    [
      tenantId,
      input.agent_id,
      input.kind,
      input.level ?? 'info',
      input.code ?? null,
      input.message ?? null,
      JSON.stringify(input.payload ?? {}),
      input.duration_ms ?? null,
    ]
  );
  return res.rows[0];
}

/* -------------------------------------------------------------------------- */
/* Dashboard aggregates                                                          */
/* -------------------------------------------------------------------------- */

export async function dashboardKpis(
  client: PoolClient,
  tenantId: string | null
): Promise<{
  total_deposits_today: string;
  total_withdrawals_today: string;
  successful_deposits_today: number;
  successful_withdrawals_today: number;
  failed_today: number;
  manual_review_count: number;
  active_agents: number;
  total_agents: number;
}> {
  const filter = tenantId ? `AND tenant_id = $1` : '';
  const values = tenantId ? [tenantId] : [];

  const today = `created_at >= date_trunc('day', now())`;

  const depositsRes = await client.query<{
    total: string;
    cnt: string;
    failed: string;
  }>(
    `SELECT
        COALESCE(SUM(CASE WHEN status IN ('matched','credited') THEN amount ELSE 0 END), 0)::text AS total,
        COUNT(*) FILTER (WHERE status IN ('matched','credited'))::text AS cnt,
        COUNT(*) FILTER (WHERE status IN ('disputed','duplicate','unmatched'))::text AS failed
       FROM telebirr_transactions
       WHERE ${today} ${filter}`,
    values
  );

  const withdrawalsRes = await client.query<{
    total: string;
    cnt: string;
    failed: string;
  }>(
    `SELECT
        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0)::text AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::text AS cnt,
        COUNT(*) FILTER (WHERE status IN ('rejected','failed','cancelled'))::text AS failed
       FROM telebirr_withdrawal_requests
       WHERE ${today} ${filter}`,
    values
  );

  const reviewRes = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM telebirr_transactions
       WHERE status IN ('pending','unmatched','disputed') ${filter}`,
    values
  );

  const agentsRes = await client.query<{ active: string; total: string }>(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'active')::text AS active,
        COUNT(*)::text AS total
       FROM telebirr_agents
       WHERE 1=1 ${filter}`,
    values
  );

  return {
    total_deposits_today: depositsRes.rows[0]?.total ?? '0',
    total_withdrawals_today: withdrawalsRes.rows[0]?.total ?? '0',
    successful_deposits_today: Number(depositsRes.rows[0]?.cnt ?? 0),
    successful_withdrawals_today: Number(withdrawalsRes.rows[0]?.cnt ?? 0),
    failed_today:
      Number(depositsRes.rows[0]?.failed ?? 0) +
      Number(withdrawalsRes.rows[0]?.failed ?? 0),
    manual_review_count: Number(reviewRes.rows[0]?.cnt ?? 0),
    active_agents: Number(agentsRes.rows[0]?.active ?? 0),
    total_agents: Number(agentsRes.rows[0]?.total ?? 0),
  };
}

/**
 * Section 7 dashboard wallet/capacity table. For every Telebirr agent in the
 * tenant we return:
 *   - status / balance / device link
 *   - daily_limit (from p2p_settings.max_daily_per_wallet)
 *   - used_today (sum of credited deposits today)
 *   - pre_deposit (agent's pre-funded base = SUM of manual top-up swaps,
 *     falling back to the SIM-reported balance when none booked yet)
 *   - commission_rate (from p2p_commissions.deposit_pct override, else the
 *     tenant default)
 *   - total_capacity = pre_deposit × (1 + commission_rate%)
 *   - available_capacity = total_capacity − credited deposits + withdrawal
 *     swaps (the live pre-deposit pool: deposits consume headroom, paid-out
 *     withdrawals restore it)
 *   - withdrawals_today (sum of withdrawal swaps booked today)
 *   - earned_today (deposits_today × commission_rate%)
 */
export interface DashboardWalletRow {
  agent_id: string;
  agent_name: string;
  device_id: string | null;
  device_name: string | null;
  telebirr_number: string;
  status: string;
  last_seen_at: Date | null;
  balance: string;
  daily_limit: string;
  used_today: string;
  pre_deposit: string;
  commission_rate: string;
  total_capacity: string;
  available_capacity: string;
  deposits_today: string;
  withdrawals_today: string;
  earned_today: string;
}

export async function dashboardWalletStatus(
  client: PoolClient,
  tenantId: string | null
): Promise<DashboardWalletRow[]> {
  const params: unknown[] = tenantId ? [tenantId] : [];
  const tenantClause = (alias: string) =>
    tenantId ? `${alias}.tenant_id = $1` : 'TRUE';

  const sql = `
    WITH agents AS (
      SELECT a.id            AS agent_id,
             a.tenant_id,
             a.agent_name,
             a.telebirr_number,
             a.device_id,
             a.device_name,
             a.status,
             a.last_seen_at,
             a.balance::text  AS balance
        FROM telebirr_agents a
       WHERE ${tenantClause('a')}
    ),
    dep AS (
      SELECT t.agent_id,
             COALESCE(SUM(t.amount) FILTER (
               WHERE t.status IN ('matched','credited')
             ), 0)::numeric                                    AS total,
             COALESCE(SUM(t.amount) FILTER (
               WHERE t.status IN ('matched','credited')
                 AND t.created_at >= date_trunc('day', now())
             ), 0)::numeric                                    AS today
        FROM telebirr_transactions t
       WHERE ${tenantClause('t')}
       GROUP BY t.agent_id
    ),
    swaps AS (
      SELECT s.agent_id,
             SUM(s.amount) FILTER (
               WHERE s.source = 'manual' AND s.status = 'added'
             )                                                 AS manual_added,
             COALESCE(SUM(s.amount) FILTER (
               WHERE s.source = 'withdrawal' AND s.status = 'added'
             ), 0)::numeric                                    AS wd_added,
             COALESCE(SUM(s.amount) FILTER (
               WHERE s.source = 'withdrawal' AND s.status = 'added'
                 AND s.created_at >= date_trunc('day', now())
             ), 0)::numeric                                    AS wd_added_today
        FROM p2p_swaps s
       WHERE ${tenantClause('s')}
       GROUP BY s.agent_id
    ),
    settings AS (
      SELECT p.max_daily_per_wallet::text                    AS daily_limit,
             p.default_deposit_commission_pct::text          AS default_pct
        FROM p2p_settings p
       WHERE ${tenantClause('p')}
       LIMIT 1
    ),
    commissions AS (
      SELECT c.agent_id, c.deposit_pct::text AS deposit_pct
        FROM p2p_commissions c
       WHERE ${tenantClause('c')}
    )
    SELECT
      a.agent_id,
      a.agent_name,
      a.device_id,
      a.device_name,
      a.telebirr_number,
      a.status,
      a.last_seen_at,
      -- Live cash held: pre-deposit + deposits received - withdrawals paid,
      -- clamped at 0 (matches the agent app's Balance figure exactly).
      GREATEST(
        COALESCE(sw.manual_added, a.balance::numeric, 0)
        + COALESCE(dep.total, 0)
        - COALESCE(sw.wd_added, 0),
        0
      )::text                                                 AS balance,
      COALESCE((SELECT daily_limit FROM settings), '0')      AS daily_limit,
      COALESCE(dep.today, 0)::text                            AS used_today,
      COALESCE(sw.manual_added, a.balance::numeric, 0)::text  AS pre_deposit,
      COALESCE(c.deposit_pct, (SELECT default_pct FROM settings), '0')
                                                              AS commission_rate,
      ROUND(
        COALESCE(sw.manual_added, a.balance::numeric, 0)
        * (1 + COALESCE(
                 c.deposit_pct::numeric,
                 (SELECT default_pct FROM settings)::numeric, 0
               ) / 100.0)
      )::text                                                 AS total_capacity,
      GREATEST(
        ROUND(
          COALESCE(sw.manual_added, a.balance::numeric, 0)
          * (1 + COALESCE(
                   c.deposit_pct::numeric,
                   (SELECT default_pct FROM settings)::numeric, 0
                 ) / 100.0)
        )
          - COALESCE(dep.total, 0)
          + COALESCE(sw.wd_added, 0),
        0
      )::text                                                 AS available_capacity,
      COALESCE(dep.today, 0)::text                            AS deposits_today,
      COALESCE(sw.wd_added_today, 0)::text                    AS withdrawals_today,
      (
        COALESCE(dep.today, 0)
        * COALESCE(c.deposit_pct::numeric, (SELECT default_pct FROM settings)::numeric, 0)
        / 100.0
      )::text                                                 AS earned_today
      FROM agents a
      LEFT JOIN dep         ON dep.agent_id = a.agent_id
      LEFT JOIN swaps  sw   ON sw.agent_id  = a.agent_id
      LEFT JOIN commissions  c  ON c.agent_id  = a.agent_id
      ORDER BY a.agent_name
  `;

  const res = await client.query<DashboardWalletRow>(sql, params);
  return res.rows;
}

/**
 * Live activity feed for the dashboard. Emits the latest 20 events from
 * the deposit/withdrawal/command tables in chronological-DESC order. Each
 * row is normalised to the same shape so the UI can render them in a
 * single timeline.
 */
export interface DashboardActivityRow {
  id: string;
  kind: 'deposit' | 'withdrawal' | 'command' | 'event';
  status: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  amount: string | null;
  agent_id: string | null;
  agent_name: string | null;
  reference: string | null;
  created_at: Date;
}

export async function dashboardActivityFeed(
  client: PoolClient,
  tenantId: string | null,
  limit = 20
): Promise<DashboardActivityRow[]> {
  const params: unknown[] = tenantId ? [tenantId, limit] : [limit];
  const T = tenantId ? `t.tenant_id = $1` : 'TRUE';
  const W = tenantId ? `w.tenant_id = $1` : 'TRUE';
  const C = tenantId ? `c.tenant_id = $1` : 'TRUE';
  const E = tenantId ? `e.tenant_id = $1` : 'TRUE';
  const limitParam = `$${tenantId ? 2 : 1}`;

  const sql = `
    SELECT * FROM (
      SELECT t.id::text                                      AS id,
             'deposit'::text                                AS kind,
             t.status::text                                 AS status,
             CASE WHEN t.status IN ('disputed','duplicate','unmatched','rejected')
                  THEN 'error'
                  WHEN t.status = 'pending' THEN 'warning'
                  ELSE 'info' END                           AS level,
             ('Telebirr SMS deposit ' || t.amount::text || ' from ' ||
              COALESCE(t.sender_phone, t.sender_name, 'unknown'))
                                                            AS message,
             t.amount::text                                 AS amount,
             t.agent_id::text                               AS agent_id,
             a.agent_name                                   AS agent_name,
             t.telebirr_ref                                 AS reference,
             t.created_at                                   AS created_at
        FROM telebirr_transactions t
        LEFT JOIN telebirr_agents a ON a.id = t.agent_id
       WHERE ${T}

      UNION ALL
      SELECT w.id::text                                      AS id,
             'withdrawal'::text                              AS kind,
             w.status::text                                  AS status,
             CASE WHEN w.status IN ('rejected','failed','cancelled')
                  THEN 'error'
                  WHEN w.status IN ('pending','processing') THEN 'warning'
                  ELSE 'info' END                            AS level,
             ('Withdrawal ' || w.amount::text || ' to ' || w.telebirr_number)
                                                              AS message,
             w.amount::text                                   AS amount,
             NULL::text                                       AS agent_id,
             NULL::text                                       AS agent_name,
             COALESCE(w.telebirr_ref, w.id::text)             AS reference,
             w.created_at                                     AS created_at
        FROM telebirr_withdrawal_requests w
       WHERE ${W}

      UNION ALL
      SELECT c.id::text                                      AS id,
             'command'::text                                  AS kind,
             c.status::text                                   AS status,
             CASE WHEN c.status = 'failed' THEN 'error'
                  WHEN c.status IN ('pending','sent','executing') THEN 'warning'
                  ELSE 'info' END                             AS level,
             ('Command ' || c.kind || ' → ' || c.status)
                                                              AS message,
             NULL::text                                       AS amount,
             c.agent_id::text                                 AS agent_id,
             a.agent_name                                     AS agent_name,
             c.reference                                      AS reference,
             c.created_at                                     AS created_at
        FROM p2p_commands c
        LEFT JOIN telebirr_agents a ON a.id = c.agent_id
       WHERE ${C}

      UNION ALL
      SELECT e.id::text                                      AS id,
             'event'::text                                    AS kind,
             e.kind::text                                     AS status,
             e.level                                          AS level,
             COALESCE(e.message, e.code, e.kind)              AS message,
             NULL::text                                       AS amount,
             e.agent_id::text                                 AS agent_id,
             a.agent_name                                     AS agent_name,
             e.code                                           AS reference,
             e.created_at                                     AS created_at
        FROM p2p_event_logs e
        LEFT JOIN telebirr_agents a ON a.id = e.agent_id
       WHERE ${E}
    ) merged
    ORDER BY created_at DESC
    LIMIT ${limitParam}
  `;

  const res = await client.query<DashboardActivityRow>(sql, params);
  return res.rows;
}

/**
 * Unified P2P transactions list — combines telebirr_transactions
 * (deposits) with telebirr_withdrawal_requests (withdrawals) so the
 * "P2P → Transactions" page can be backed by a single endpoint.
 */
export interface UnifiedTransactionRow {
  id: string;
  kind: 'deposit' | 'withdrawal';
  user_id: string | null;
  user_email: string | null;
  user_phone: string | null;
  amount: string;
  currency: string;
  status: string;
  status_label: string;
  reference: string | null;
  agent_id: string | null;
  agent_name: string | null;
  wallet_phone: string | null;
  created_at: Date;
}

export async function listUnifiedTransactions(
  client: PoolClient,
  tenantId: string | null,
  params: {
    tab: 'all' | 'deposit' | 'withdrawal' | 'failed';
    status: string | null;
    agentId: string | null;
    search: string | null;
    from: Date | null;
    to: Date | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: UnifiedTransactionRow[]; total: number }> {
  const values: unknown[] = [];
  let i = 1;

  const T = tenantId ? `tenant_id = $${i++}` : 'TRUE';
  if (tenantId) values.push(tenantId);

  const fromIdx = params.from ? `$${i++}` : null;
  if (params.from) values.push(params.from);
  const toIdx = params.to ? `$${i++}` : null;
  if (params.to) values.push(params.to);

  const agentIdx = params.agentId ? `$${i++}` : null;
  if (params.agentId) values.push(params.agentId);

  const searchIdx = params.search ? `$${i++}` : null;
  if (params.search) values.push(`%${params.search}%`);

  const includeDeposits = params.tab !== 'withdrawal';
  const includeWithdrawals = params.tab !== 'deposit';

  const depositSelect = `
    SELECT t.id::text                                      AS id,
           'deposit'::text                                  AS kind,
           t.user_id::text                                  AS user_id,
           u.email                                          AS user_email,
           u.phone                                          AS user_phone,
           t.amount::text                                   AS amount,
           t.currency                                       AS currency,
           t.status::text                                   AS status,
           CASE
             WHEN t.status IN ('matched','credited') THEN 'Success'
             WHEN t.status = 'pending'              THEN 'Pending'
             WHEN t.status IN ('disputed','duplicate','unmatched','rejected')
                                                    THEN 'Failed'
             ELSE t.status
           END                                              AS status_label,
           t.telebirr_ref                                   AS reference,
           t.agent_id::text                                 AS agent_id,
           a.agent_name                                     AS agent_name,
           t.sender_phone                                   AS wallet_phone,
           t.created_at                                     AS created_at
      FROM telebirr_transactions t
      LEFT JOIN telebirr_agents a ON a.id = t.agent_id
      LEFT JOIN users           u ON u.id = t.user_id
     WHERE ${tenantId ? `t.tenant_id = $1` : 'TRUE'}
       ${fromIdx ? `AND t.created_at >= ${fromIdx}` : ''}
       ${toIdx ? `AND t.created_at <= ${toIdx}` : ''}
       ${agentIdx ? `AND t.agent_id = ${agentIdx}` : ''}
       ${
         searchIdx
           ? `AND (t.telebirr_ref ILIKE ${searchIdx}
              OR t.sender_phone ILIKE ${searchIdx}
              OR u.phone ILIKE ${searchIdx}
              OR u.email ILIKE ${searchIdx})`
           : ''
       }
       ${
         params.tab === 'failed'
           ? `AND t.status IN ('disputed','duplicate','unmatched','rejected')`
           : ''
       }
       ${
         params.status
           ? `AND CASE
                    WHEN t.status IN ('matched','credited') THEN 'success'
                    WHEN t.status = 'pending'              THEN 'pending'
                    WHEN t.status IN ('disputed','duplicate','unmatched','rejected')
                                                          THEN 'failed'
                    ELSE t.status::text
                  END = '${params.status}'`
           : ''
       }
  `;

  const withdrawalSelect = `
    SELECT w.id::text                                      AS id,
           'withdrawal'::text                              AS kind,
           w.user_id::text                                  AS user_id,
           u.email                                          AS user_email,
           u.phone                                          AS user_phone,
           w.amount::text                                   AS amount,
           w.currency                                       AS currency,
           w.status::text                                   AS status,
           CASE
             WHEN w.status = 'completed'                       THEN 'Success'
             WHEN w.status = 'processing'                      THEN 'Processing'
             WHEN w.status = 'pending'                         THEN 'Pending'
             WHEN w.status IN ('rejected','failed','cancelled') THEN 'Failed'
             ELSE w.status
           END                                              AS status_label,
           w.telebirr_ref                                   AS reference,
           NULL::text                                       AS agent_id,
           NULL::text                                       AS agent_name,
           w.telebirr_number                                AS wallet_phone,
           w.created_at                                     AS created_at
      FROM telebirr_withdrawal_requests w
      LEFT JOIN users u ON u.id = w.user_id
     WHERE ${tenantId ? `w.tenant_id = $1` : 'TRUE'}
       ${fromIdx ? `AND w.created_at >= ${fromIdx}` : ''}
       ${toIdx ? `AND w.created_at <= ${toIdx}` : ''}
       ${
         searchIdx
           ? `AND (w.telebirr_ref ILIKE ${searchIdx}
              OR w.telebirr_number ILIKE ${searchIdx}
              OR w.account_name ILIKE ${searchIdx}
              OR u.phone ILIKE ${searchIdx}
              OR u.email ILIKE ${searchIdx})`
           : ''
       }
       ${
         params.tab === 'failed'
           ? `AND w.status IN ('rejected','failed','cancelled')`
           : ''
       }
       ${
         params.status
           ? `AND CASE
                    WHEN w.status = 'completed'  THEN 'success'
                    WHEN w.status = 'processing' THEN 'processing'
                    WHEN w.status = 'pending'    THEN 'pending'
                    WHEN w.status IN ('rejected','failed','cancelled') THEN 'failed'
                    ELSE w.status::text
                  END = '${params.status}'`
           : ''
       }
  `;

  const parts: string[] = [];
  if (includeDeposits) parts.push(depositSelect);
  if (includeWithdrawals && !params.agentId) parts.push(withdrawalSelect);
  const merged = parts.length
    ? `(${parts.join(') UNION ALL (')})`
    : depositSelect; // fallback

  const totalSql = `SELECT COUNT(*)::text AS count FROM (${merged}) AS merged`;
  const totalRes = await client.query<{ count: string }>(totalSql, values);

  const rowsSql = `
    SELECT * FROM (${merged}) AS merged
    ORDER BY created_at DESC
    LIMIT $${i++} OFFSET $${i++}
  `;
  const rowsRes = await client.query<UnifiedTransactionRow>(rowsSql, [
    ...values,
    params.limit,
    params.offset,
  ]);

  return { rows: rowsRes.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}
