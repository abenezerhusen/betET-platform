/**
 * Data-access layer for the Bulk SMS module. All queries are tenant-scoped;
 * RLS enforces isolation, the explicit `tenant_id = $1` filters keep queries
 * fast and readable.
 */

import type { PoolClient } from 'pg';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */
export interface GatewaySettingsRow {
  id: string;
  tenant_id: string;
  enabled: boolean;
  gateway_name: string;
  api_url: string;
  api_key_sealed: string | null;
  device_id: string | null;
  sender_number: string | null;
  default_country_code: string;
  max_sms_per_day: number;
  delay_ms: number;
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
}

export interface TemplateRow {
  id: string;
  tenant_id: string;
  name: string;
  body: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CampaignRow {
  id: string;
  tenant_id: string;
  name: string;
  template_id: string | null;
  message: string;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

/* -------------------------------------------------------------------------- */
/*  Gateway settings                                                          */
/* -------------------------------------------------------------------------- */
const GW_COLS = `
  id, tenant_id, enabled, gateway_name, api_url, api_key_sealed, device_id,
  sender_number, default_country_code, max_sms_per_day, delay_ms,
  created_at, updated_at, updated_by
`;

export async function getGatewaySettings(
  client: PoolClient,
  tenantId: string
): Promise<GatewaySettingsRow | null> {
  const r = await client.query<GatewaySettingsRow>(
    `SELECT ${GW_COLS} FROM bulk_sms_gateway_settings WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  return r.rows[0] ?? null;
}

export interface UpsertGatewayParams {
  tenantId: string;
  enabled: boolean;
  gatewayName: string;
  apiUrl: string;
  /** Pass null to keep the existing sealed key, string to replace it. */
  apiKeySealed: string | null;
  deviceId: string | null;
  senderNumber: string | null;
  defaultCountryCode: string;
  maxSmsPerDay: number;
  delayMs: number;
  updatedBy: string | null;
}

export async function upsertGatewaySettings(
  client: PoolClient,
  p: UpsertGatewayParams
): Promise<GatewaySettingsRow> {
  const r = await client.query<GatewaySettingsRow>(
    `INSERT INTO bulk_sms_gateway_settings
       (tenant_id, enabled, gateway_name, api_url, api_key_sealed, device_id,
        sender_number, default_country_code, max_sms_per_day, delay_ms, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id) DO UPDATE SET
       enabled              = EXCLUDED.enabled,
       gateway_name         = EXCLUDED.gateway_name,
       api_url              = EXCLUDED.api_url,
       api_key_sealed       = COALESCE($5, bulk_sms_gateway_settings.api_key_sealed),
       device_id            = EXCLUDED.device_id,
       sender_number        = EXCLUDED.sender_number,
       default_country_code = EXCLUDED.default_country_code,
       max_sms_per_day      = EXCLUDED.max_sms_per_day,
       delay_ms             = EXCLUDED.delay_ms,
       updated_by           = EXCLUDED.updated_by,
       updated_at           = now()
     RETURNING ${GW_COLS}`,
    [
      p.tenantId,
      p.enabled,
      p.gatewayName,
      p.apiUrl,
      p.apiKeySealed,
      p.deviceId,
      p.senderNumber,
      p.defaultCountryCode,
      p.maxSmsPerDay,
      p.delayMs,
      p.updatedBy,
    ]
  );
  return r.rows[0];
}

/* -------------------------------------------------------------------------- */
/*  Templates                                                                 */
/* -------------------------------------------------------------------------- */
const TPL_COLS = `id, tenant_id, name, body, created_by, created_at, updated_at`;

export async function listTemplates(
  client: PoolClient,
  tenantId: string,
  params: { limit: number; offset: number; search: string | null }
): Promise<{ items: TemplateRow[]; total: number }> {
  const where = ['tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (params.search) {
    args.push(`%${params.search}%`);
    where.push(`name ILIKE $${args.length}`);
  }
  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM bulk_sms_templates WHERE ${where.join(' AND ')}`,
    args
  );
  args.push(params.limit, params.offset);
  const rows = await client.query<TemplateRow>(
    `SELECT ${TPL_COLS} FROM bulk_sms_templates
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );
  return { items: rows.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function getTemplate(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<TemplateRow | null> {
  const r = await client.query<TemplateRow>(
    `SELECT ${TPL_COLS} FROM bulk_sms_templates WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function createTemplate(
  client: PoolClient,
  params: { tenantId: string; name: string; body: string; createdBy: string | null }
): Promise<TemplateRow> {
  const r = await client.query<TemplateRow>(
    `INSERT INTO bulk_sms_templates (tenant_id, name, body, created_by)
     VALUES ($1,$2,$3,$4) RETURNING ${TPL_COLS}`,
    [params.tenantId, params.name, params.body, params.createdBy]
  );
  return r.rows[0];
}

export async function updateTemplate(
  client: PoolClient,
  params: { tenantId: string; id: string; name?: string; body?: string }
): Promise<TemplateRow | null> {
  const r = await client.query<TemplateRow>(
    `UPDATE bulk_sms_templates
        SET name = COALESCE($3, name),
            body = COALESCE($4, body),
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING ${TPL_COLS}`,
    [params.tenantId, params.id, params.name ?? null, params.body ?? null]
  );
  return r.rows[0] ?? null;
}

export async function deleteTemplate(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<boolean> {
  const r = await client.query(
    `DELETE FROM bulk_sms_templates WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return (r.rowCount ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/*  Campaigns + queue                                                         */
/* -------------------------------------------------------------------------- */
const CMP_COLS = `
  id, tenant_id, name, template_id, message, status, total_recipients,
  sent_count, failed_count, created_by, created_at, updated_at,
  started_at, completed_at
`;

export async function createCampaign(
  client: PoolClient,
  params: {
    tenantId: string;
    name: string;
    templateId: string | null;
    message: string;
    status: string;
    totalRecipients: number;
    createdBy: string | null;
  }
): Promise<CampaignRow> {
  const r = await client.query<CampaignRow>(
    `INSERT INTO bulk_sms_campaigns
       (tenant_id, name, template_id, message, status, total_recipients, created_by,
        started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $5 IN ('queued','sending') THEN now() ELSE NULL END)
     RETURNING ${CMP_COLS}`,
    [
      params.tenantId,
      params.name,
      params.templateId,
      params.message,
      params.status,
      params.totalRecipients,
      params.createdBy,
    ]
  );
  return r.rows[0];
}

export async function insertQueueBatch(
  client: PoolClient,
  tenantId: string,
  campaignId: string,
  items: Array<{ phone: string; message: string }>
): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const values: string[] = [];
    const args: unknown[] = [tenantId, campaignId];
    let p = 3;
    for (const it of slice) {
      values.push(`($1,$2,$${p++},$${p++})`);
      args.push(it.phone, it.message);
    }
    await client.query(
      `INSERT INTO bulk_sms_queue (tenant_id, campaign_id, phone, message)
       VALUES ${values.join(',')}`,
      args
    );
  }
}

export async function listCampaigns(
  client: PoolClient,
  tenantId: string,
  params: { limit: number; offset: number; status: string | null; search: string | null }
): Promise<{ items: CampaignRow[]; total: number }> {
  const where = ['tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (params.status) {
    args.push(params.status);
    where.push(`status = $${args.length}`);
  }
  if (params.search) {
    args.push(`%${params.search}%`);
    where.push(`name ILIKE $${args.length}`);
  }
  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM bulk_sms_campaigns WHERE ${where.join(' AND ')}`,
    args
  );
  args.push(params.limit, params.offset);
  const rows = await client.query<CampaignRow>(
    `SELECT ${CMP_COLS} FROM bulk_sms_campaigns
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );
  return { items: rows.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function getCampaign(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<CampaignRow | null> {
  const r = await client.query<CampaignRow>(
    `SELECT ${CMP_COLS} FROM bulk_sms_campaigns WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function cancelCampaign(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<boolean> {
  const r = await client.query<{ id: string }>(
    `UPDATE bulk_sms_campaigns
        SET status = 'cancelled', completed_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status IN ('queued','sending')
      RETURNING id`,
    [tenantId, id]
  );
  if ((r.rowCount ?? 0) === 0) return false;
  await client.query(
    `UPDATE bulk_sms_queue
        SET status = 'failed', error = 'campaign_cancelled', updated_at = now()
      WHERE tenant_id = $1 AND campaign_id = $2 AND status IN ('pending','processing')`,
    [tenantId, id]
  );
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Queue + logs (read)                                                       */
/* -------------------------------------------------------------------------- */
export async function listQueue(
  client: PoolClient,
  tenantId: string,
  params: {
    limit: number;
    offset: number;
    status: string | null;
    campaignId: string | null;
  }
): Promise<{ items: unknown[]; total: number }> {
  const where = ['q.tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (params.status) {
    args.push(params.status);
    where.push(`q.status = $${args.length}`);
  }
  if (params.campaignId) {
    args.push(params.campaignId);
    where.push(`q.campaign_id = $${args.length}`);
  }
  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM bulk_sms_queue q WHERE ${where.join(' AND ')}`,
    args
  );
  args.push(params.limit, params.offset);
  const rows = await client.query(
    `SELECT q.id, q.campaign_id, c.name AS campaign_name, q.phone, q.message,
            q.status, q.attempts, q.error, q.next_attempt_at, q.sent_at, q.created_at
       FROM bulk_sms_queue q
       LEFT JOIN bulk_sms_campaigns c ON c.id = q.campaign_id
      WHERE ${where.join(' AND ')}
      ORDER BY q.created_at ASC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );
  return { items: rows.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function listLogs(
  client: PoolClient,
  tenantId: string,
  params: {
    limit: number;
    offset: number;
    status: string | null;
    campaignId: string | null;
    search: string | null;
  }
): Promise<{ items: unknown[]; total: number }> {
  const where = ['l.tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (params.status) {
    args.push(params.status);
    where.push(`l.status = $${args.length}`);
  }
  if (params.campaignId) {
    args.push(params.campaignId);
    where.push(`l.campaign_id = $${args.length}`);
  }
  if (params.search) {
    args.push(`%${params.search}%`);
    where.push(`l.phone ILIKE $${args.length}`);
  }
  const totalRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM bulk_sms_logs l WHERE ${where.join(' AND ')}`,
    args
  );
  args.push(params.limit, params.offset);
  const rows = await client.query(
    `SELECT l.id, l.campaign_id, c.name AS campaign_name, l.phone, l.message,
            l.status, l.provider_response, l.error, l.sent_at, l.created_at
       FROM bulk_sms_logs l
       LEFT JOIN bulk_sms_campaigns c ON c.id = l.campaign_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.created_at DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );
  return { items: rows.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
}

/** Count SMS successfully sent today (tenant local UTC) for daily-limit checks. */
export async function countSentToday(
  client: PoolClient,
  tenantId: string
): Promise<number> {
  const r = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM bulk_sms_logs
      WHERE tenant_id = $1 AND status = 'sent'
        AND sent_at >= date_trunc('day', now())`,
    [tenantId]
  );
  return Number(r.rows[0]?.count ?? 0);
}

/** Aggregate reporting numbers for the Reports tab. */
export async function reportSummary(
  client: PoolClient,
  tenantId: string
): Promise<{
  totals: { sent: number; failed: number; today: number };
  campaigns: number;
  queue_pending: number;
}> {
  const [logs, camp, queue] = await Promise.all([
    client.query<{ status: string; count: string; today: string }>(
      `SELECT status, COUNT(*)::text AS count,
              COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::text AS today
         FROM bulk_sms_logs WHERE tenant_id = $1 GROUP BY status`,
      [tenantId]
    ),
    client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bulk_sms_campaigns WHERE tenant_id = $1`,
      [tenantId]
    ),
    client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bulk_sms_queue
        WHERE tenant_id = $1 AND status IN ('pending','processing')`,
      [tenantId]
    ),
  ]);
  let sent = 0;
  let failed = 0;
  let today = 0;
  for (const row of logs.rows) {
    if (row.status === 'sent') sent = Number(row.count);
    if (row.status === 'failed') failed = Number(row.count);
    today += Number(row.today);
  }
  return {
    totals: { sent, failed, today },
    campaigns: Number(camp.rows[0]?.count ?? 0),
    queue_pending: Number(queue.rows[0]?.count ?? 0),
  };
}
