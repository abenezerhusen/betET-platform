import type { PoolClient } from 'pg';

export interface MobileTokenRow {
  id: string;
  tenant_id: string;
  user_id: string;
  device_token: string;
  platform: string;
  app_version: string | null;
  device_model: string | null;
  status: string;
  last_seen: Date;
  created_at: Date;
  updated_at: Date;
}

const SELECT_TOKEN = `
  id, tenant_id, user_id, device_token, platform, app_version, device_model,
  status, last_seen, created_at, updated_at
`;

/**
 * Idempotent device registration. (user_id, device_token) is unique, so a
 * re-registration of the same device updates platform/version/last_seen and
 * reactivates the row if it had been revoked.
 */
export async function upsertDevice(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    deviceToken: string;
    platform: string;
    appVersion: string | null;
    deviceModel: string | null;
  }
): Promise<{ row: MobileTokenRow; created: boolean }> {
  const r = await client.query<MobileTokenRow & { xmax: string }>(
    `INSERT INTO mobile_tokens
       (tenant_id, user_id, device_token, platform, app_version, device_model)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ON CONSTRAINT mobile_tokens_user_token_unique
     DO UPDATE SET
       platform     = EXCLUDED.platform,
       app_version  = EXCLUDED.app_version,
       device_model = EXCLUDED.device_model,
       status       = 'active',
       last_seen    = now(),
       updated_at   = now()
     RETURNING ${SELECT_TOKEN}, xmax::text`,
    [
      params.tenantId,
      params.userId,
      params.deviceToken,
      params.platform,
      params.appVersion,
      params.deviceModel,
    ]
  );
  const row = r.rows[0];
  // xmax = '0' on INSERT, non-zero on UPDATE.
  const created = row.xmax === '0';
  // Strip xmax before returning to caller.
  const { xmax: _xmax, ...clean } = row;
  void _xmax;
  return { row: clean as MobileTokenRow, created };
}

export async function listDevicesByUser(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<MobileTokenRow[]> {
  const r = await client.query<MobileTokenRow>(
    `SELECT ${SELECT_TOKEN}
       FROM mobile_tokens
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY last_seen DESC`,
    [tenantId, userId]
  );
  return r.rows;
}

export async function revokeDevice(
  client: PoolClient,
  tenantId: string,
  userId: string,
  id: string
): Promise<MobileTokenRow | null> {
  const r = await client.query<MobileTokenRow>(
    `UPDATE mobile_tokens
        SET status     = 'revoked',
            updated_at = now()
      WHERE id = $1 AND tenant_id = $2 AND user_id = $3
      RETURNING ${SELECT_TOKEN}`,
    [id, tenantId, userId]
  );
  return r.rows[0] ?? null;
}

/**
 * Resolve recipient device tokens for a push send.
 *
 * Either explicit user ids (validated against the tenant) or a segment.
 * Returns one row per device — a single user can have multiple devices
 * (phone, tablet, web).
 */
export async function listActiveTokensForUsers(
  client: PoolClient,
  tenantId: string,
  userIds: string[]
): Promise<MobileTokenRow[]> {
  if (userIds.length === 0) return [];
  const r = await client.query<MobileTokenRow>(
    `SELECT ${SELECT_TOKEN}
       FROM mobile_tokens
      WHERE tenant_id = $1
        AND status = 'active'
        AND user_id = ANY($2::uuid[])`,
    [tenantId, userIds]
  );
  return r.rows;
}

export async function listActiveTokensBySegment(
  client: PoolClient,
  tenantId: string,
  segment: string
): Promise<{ tokens: MobileTokenRow[]; user_count: number }> {
  let userFilter: string;
  switch (segment) {
    case 'kyc_verified':
      userFilter = `kyc_status = 'verified'`;
      break;
    case 'kyc_pending':
      userFilter = `kyc_status IN ('pending','submitted')`;
      break;
    case 'high_value':
      userFilter = `id IN (
        SELECT user_id FROM wallets
        WHERE tenant_id = $1 AND balance >= 1000
      )`;
      break;
    case 'inactive_30d':
      userFilter = `last_login_at < (now() - interval '30 days')`;
      break;
    case 'all_active':
    default:
      userFilter = `status = 'active'`;
  }
  const r = await client.query<MobileTokenRow>(
    `SELECT mt.id, mt.tenant_id, mt.user_id, mt.device_token, mt.platform,
            mt.app_version, mt.device_model, mt.status, mt.last_seen,
            mt.created_at, mt.updated_at
       FROM mobile_tokens mt
       JOIN users u ON u.id = mt.user_id
      WHERE mt.tenant_id = $1
        AND mt.status = 'active'
        AND u.tenant_id = $1
        AND ${userFilter}`,
    [tenantId]
  );
  const userCount = new Set(r.rows.map((row) => row.user_id)).size;
  return { tokens: r.rows, user_count: userCount };
}

export async function markDeviceSeen(
  client: PoolClient,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  await client.query(
    `UPDATE mobile_tokens
        SET last_seen = now()
      WHERE id = ANY($1::uuid[])`,
    [ids]
  );
}

export async function markDeviceFailed(
  client: PoolClient,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  // For now we only flip permanently invalid tokens to 'revoked'. Transient
  // failures should not be passed in here.
  await client.query(
    `UPDATE mobile_tokens
        SET status     = 'revoked',
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [ids]
  );
}
