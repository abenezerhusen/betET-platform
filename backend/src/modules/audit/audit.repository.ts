import type { PoolClient } from 'pg';

export type AuditStatus = 'success' | 'failure' | 'warning' | 'info';

export interface AuditEvent {
  tenantId: string | null;
  actorId: string | null;
  actorType: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  status: AuditStatus;
}

/**
 * Append-only audit_logs writer. Caller MUST already be inside a transaction
 * with set_tenant_context() applied (i.e. invoked via withTenantClient).
 *
 * Sensitive values (passwords, tokens, hashes) MUST NOT be put in payload.
 */
export async function writeAudit(client: PoolClient, e: AuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (tenant_id, actor_id, actor_type, action, resource, resource_id,
        payload, ip, user_agent, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
    [
      e.tenantId,
      e.actorId,
      e.actorType,
      e.action,
      e.resource,
      e.resourceId,
      JSON.stringify(e.payload ?? {}),
      e.ip,
      e.userAgent,
      e.status,
    ]
  );
}

export interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_id: string | null;
  actor_type: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  status: AuditStatus;
  created_at: Date;
}

export interface ListAuditLogsParams {
  tenantId: string | null;
  actorId: string | null;
  action: string | null;
  actionPrefix: string | null;
  resource: string | null;
  resourceId: string | null;
  status: AuditStatus | null;
  from: Date | null;
  to: Date | null;
  search: string | null;
  limit: number;
  offset: number;
}

export async function listAuditLogs(
  client: PoolClient,
  params: ListAuditLogsParams
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (params.tenantId) {
    filters.push(`tenant_id = $${i++}`);
    values.push(params.tenantId);
  }
  if (params.actorId) {
    filters.push(`actor_id = $${i++}`);
    values.push(params.actorId);
  }
  if (params.action) {
    filters.push(`action = $${i++}`);
    values.push(params.action);
  }
  if (params.actionPrefix) {
    filters.push(`action LIKE $${i++}`);
    values.push(`${params.actionPrefix}%`);
  }
  if (params.resource) {
    filters.push(`resource = $${i++}`);
    values.push(params.resource);
  }
  if (params.resourceId) {
    filters.push(`resource_id = $${i++}`);
    values.push(params.resourceId);
  }
  if (params.status) {
    filters.push(`status = $${i++}`);
    values.push(params.status);
  }
  if (params.from) {
    filters.push(`created_at >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    filters.push(`created_at <= $${i++}`);
    values.push(params.to);
  }
  if (params.search) {
    filters.push(`(action ILIKE $${i} OR resource ILIKE $${i} OR resource_id ILIKE $${i})`);
    values.push(`%${params.search}%`);
    i++;
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM audit_logs ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const rows = await client.query<AuditLogRow>(
    `SELECT id, tenant_id, actor_id, actor_type, action, resource, resource_id,
            payload, host(ip) AS ip, user_agent, status, created_at
       FROM audit_logs
       ${where}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: rows.rows, total };
}
