import type { PoolClient } from 'pg';

export type TelebirrDisputeStatus =
  | 'open'
  | 'investigating'
  | 'resolved_credited'
  | 'resolved_rejected'
  | 'cancelled';

export interface TelebirrDisputeRow {
  id: string;
  tenant_id: string;
  user_id: string;
  amount: string;
  currency: string;
  claimed_telebirr_ref: string | null;
  sender_telebirr_number: string;
  paid_at: Date | null;
  screenshot_url: string | null;
  description: string | null;
  status: TelebirrDisputeStatus;
  resolved_telebirr_tx_id: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_DISPUTE = `
  id, tenant_id, user_id, amount::text AS amount, currency,
  claimed_telebirr_ref, sender_telebirr_number, paid_at,
  screenshot_url, description, status, resolved_telebirr_tx_id,
  resolution_notes, resolved_by, resolved_at, created_at, updated_at
`;

/* ------------------------------------------------------------------------- */
/* Insert / mutate                                                           */
/* ------------------------------------------------------------------------- */

export async function insertDispute(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    amount: string;
    currency: string;
    claimedTelebirrRef: string | null;
    senderTelebirrNumber: string;
    paidAt: Date | null;
    screenshotUrl: string | null;
    description: string | null;
  }
): Promise<TelebirrDisputeRow> {
  const r = await client.query<TelebirrDisputeRow>(
    `INSERT INTO telebirr_disputes
       (tenant_id, user_id, amount, currency, claimed_telebirr_ref,
        sender_telebirr_number, paid_at, screenshot_url, description)
     VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9)
     RETURNING ${SELECT_DISPUTE}`,
    [
      params.tenantId,
      params.userId,
      params.amount,
      params.currency,
      params.claimedTelebirrRef,
      params.senderTelebirrNumber,
      params.paidAt,
      params.screenshotUrl,
      params.description,
    ]
  );
  return r.rows[0];
}

export async function findDisputeById(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<TelebirrDisputeRow | null> {
  const r = await client.query<TelebirrDisputeRow>(
    `SELECT ${SELECT_DISPUTE}
       FROM telebirr_disputes
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function setDisputeStatus(
  client: PoolClient,
  params: {
    id: string;
    status: TelebirrDisputeStatus;
    resolvedBy: string | null;
    resolvedTelebirrTxId: string | null;
    resolutionNotes: string | null;
  }
): Promise<TelebirrDisputeRow | null> {
  const isResolution =
    params.status === 'resolved_credited' ||
    params.status === 'resolved_rejected';
  const r = await client.query<TelebirrDisputeRow>(
    `UPDATE telebirr_disputes
        SET status = $2,
            resolved_by = COALESCE($3, resolved_by),
            resolved_telebirr_tx_id = COALESCE($4, resolved_telebirr_tx_id),
            resolution_notes = COALESCE($5, resolution_notes),
            resolved_at = CASE WHEN $6::boolean THEN now() ELSE resolved_at END
      WHERE id = $1
      RETURNING ${SELECT_DISPUTE}`,
    [
      params.id,
      params.status,
      params.resolvedBy,
      params.resolvedTelebirrTxId,
      params.resolutionNotes,
      isResolution,
    ]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Listing                                                                   */
/* ------------------------------------------------------------------------- */

export interface ListDisputesParams {
  tenantId: string;
  userId: string | null;
  status: TelebirrDisputeStatus | null;
  search: string | null;
  from: Date | null;
  to: Date | null;
  limit: number;
  offset: number;
}

export interface DisputeWithJoins extends TelebirrDisputeRow {
  user_email: string | null;
  user_phone: string | null;
}

export async function listDisputes(
  client: PoolClient,
  params: ListDisputesParams
): Promise<{ rows: DisputeWithJoins[]; total: number }> {
  const filters: string[] = ['d.tenant_id = $1'];
  const values: unknown[] = [params.tenantId];
  let i = 2;
  if (params.userId) {
    filters.push(`d.user_id = $${i++}`);
    values.push(params.userId);
  }
  if (params.status) {
    filters.push(`d.status = $${i++}`);
    values.push(params.status);
  }
  if (params.from) {
    filters.push(`d.created_at >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    filters.push(`d.created_at <= $${i++}`);
    values.push(params.to);
  }
  if (params.search) {
    filters.push(
      `(d.claimed_telebirr_ref ILIKE $${i} OR d.sender_telebirr_number ILIKE $${i} OR d.description ILIKE $${i})`
    );
    values.push(`%${params.search}%`);
    i++;
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM telebirr_disputes d ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<DisputeWithJoins>(
    `SELECT ${SELECT_DISPUTE
      .split(',')
      .map((c) => `d.${c.trim()}`)
      .join(', ')},
            u.email::text AS user_email,
            u.phone       AS user_phone
       FROM telebirr_disputes d
       LEFT JOIN users u ON u.id = d.user_id
       ${where}
      ORDER BY d.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

/**
 * Look up Telebirr SMS / transactions matching the dispute's
 * (amount, sender_phone, paid_at±N) so admins can quickly see
 * whether the SMS arrived but was unmatched. Best-effort — returns
 * empty arrays when nothing similar is found.
 */
export interface DisputeMatchSuggestions {
  raw_sms: Array<{
    id: string;
    sms_body: string;
    sender_number: string | null;
    received_at: Date | null;
    processed: boolean;
  }>;
  transactions: Array<{
    id: string;
    telebirr_ref: string;
    sender_phone: string | null;
    amount: string;
    status: string;
    created_at: Date;
  }>;
}

export async function findDisputeSuggestions(
  client: PoolClient,
  params: {
    tenantId: string;
    amount: string;
    senderPhone: string;
    paidAt: Date | null;
    /** Window in minutes around paidAt to search; ±this many minutes. */
    windowMinutes: number;
  }
): Promise<DisputeMatchSuggestions> {
  // Anchor on paidAt when supplied; otherwise widen to +/- 24h around
  // dispute creation to keep the suggestion query bounded.
  const anchor = params.paidAt ?? new Date();
  const windowMs = params.windowMinutes * 60 * 1000;
  const fromTs = new Date(anchor.getTime() - windowMs);
  const toTs = new Date(anchor.getTime() + windowMs);

  const txRes = await client.query<{
    id: string;
    telebirr_ref: string;
    sender_phone: string | null;
    amount: string;
    status: string;
    created_at: Date;
  }>(
    `SELECT id, telebirr_ref, sender_phone, amount::text AS amount,
            status, created_at
       FROM telebirr_transactions
      WHERE tenant_id = $1
        AND amount = $2::numeric
        AND created_at BETWEEN $3 AND $4
        AND (sender_phone = $5 OR sender_phone IS NULL)
      ORDER BY (sender_phone = $5) DESC, created_at DESC
      LIMIT 20`,
    [params.tenantId, params.amount, fromTs, toTs, params.senderPhone]
  );

  const smsRes = await client.query<{
    id: string;
    sms_body: string;
    sender_number: string | null;
    received_at: Date | null;
    processed: boolean;
  }>(
    `SELECT id, sms_body, sender_number, received_at, processed
       FROM telebirr_sms_raw
      WHERE tenant_id = $1
        AND created_at BETWEEN $2 AND $3
        AND (sms_body ILIKE $4 OR sms_body ILIKE $5)
      ORDER BY created_at DESC
      LIMIT 20`,
    [
      params.tenantId,
      fromTs,
      toTs,
      `%${params.senderPhone}%`,
      `%${params.amount}%`,
    ]
  );

  return {
    raw_sms: smsRes.rows,
    transactions: txRes.rows,
  };
}
