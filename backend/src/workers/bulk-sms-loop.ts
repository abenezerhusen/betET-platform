/**
 * Bulk SMS worker — drains the phone-gateway (TextBee) marketing queue.
 *
 * Isolated from the notification/OTP worker: it only reads `bulk_sms_*`
 * tables and dispatches through the TextBee client. Per tick, per active
 * tenant it:
 *   1. skips tenants whose gateway is disabled / unconfigured,
 *   2. flips `queued` campaigns with pending work to `sending`,
 *   3. recovers rows stuck in `processing` (e.g. a crash mid-send),
 *   4. respects the configured daily limit (max_sms_per_day),
 *   5. claims a bounded batch of due `pending` rows and sends them one by one
 *      with the configured inter-message delay,
 *   6. retries transient failures up to 3 attempts with linear backoff, then
 *      marks the row `failed`,
 *   7. writes a permanent row to `bulk_sms_logs` for every terminal outcome
 *      (sent / failed) and advances campaign counters,
 *   8. finalizes campaigns once no pending/processing rows remain.
 *
 * Single-instance setInterval loop, same shape as notification-loop.ts.
 */

import { logger } from '../infrastructure/logger';
import { pool } from '../infrastructure/db/pool';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { openSecret } from '../infrastructure/crypto/secret-cipher';
import * as textbee from '../modules/admin/bulk-sms/textbee.service';

const TICK_MS = 10 * 1000; // 10 seconds
const BATCH_PER_TENANT = 50;
const MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 5 * 60 * 1000; // recover rows stuck > 5 min

let timer: NodeJS.Timeout | null = null;
let running = false;

interface GatewayRow {
  id: string;
  enabled: boolean;
  api_url: string;
  api_key_sealed: string | null;
  device_id: string | null;
  max_sms_per_day: number;
  delay_ms: number;
}

interface QueueRow {
  id: string;
  campaign_id: string;
  phone: string;
  message: string;
  attempts: number;
}

async function listTenantIds(): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'active'`
  );
  return r.rows.map((row) => row.id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function runForTenant(tenantId: string): Promise<void> {
  // Load gateway config + do lifecycle bookkeeping in one short transaction.
  const setup = await withTenantClient({ tenantId }, async (client) => {
    const gwRes = await client.query<GatewayRow>(
      `SELECT id, enabled, api_url, api_key_sealed, device_id,
              max_sms_per_day, delay_ms
         FROM bulk_sms_gateway_settings
        WHERE tenant_id = $1
        LIMIT 1`,
      [tenantId]
    );
    const gw = gwRes.rows[0] ?? null;
    if (!gw || !gw.enabled || !gw.api_key_sealed || !gw.device_id) {
      return { gw: null as GatewayRow | null, rows: [] as QueueRow[], sentToday: 0 };
    }

    // Recover stale "processing" rows back to pending (crash safety).
    await client.query(
      `UPDATE bulk_sms_queue
          SET status = 'pending'
        WHERE tenant_id = $1
          AND status = 'processing'
          AND updated_at < now() - ($2::text || ' milliseconds')::interval`,
      [tenantId, String(STALE_PROCESSING_MS)]
    );

    // Flip queued campaigns that have pending work into "sending".
    await client.query(
      `UPDATE bulk_sms_campaigns b
          SET status = 'sending', started_at = COALESCE(started_at, now())
        WHERE b.tenant_id = $1 AND b.status = 'queued'
          AND EXISTS (
            SELECT 1 FROM bulk_sms_queue q
             WHERE q.campaign_id = b.id AND q.status = 'pending'
          )`,
      [tenantId]
    );

    const sentTodayRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM bulk_sms_logs
        WHERE tenant_id = $1 AND status = 'sent'
          AND sent_at >= date_trunc('day', now())`,
      [tenantId]
    );
    const sentToday = Number(sentTodayRes.rows[0]?.count ?? 0);
    const remaining = Math.max(0, gw.max_sms_per_day - sentToday);
    if (remaining <= 0) {
      return { gw, rows: [] as QueueRow[], sentToday };
    }

    // Claim a bounded batch of due rows and mark them processing so a second
    // instance / tick cannot pick them up.
    const claimLimit = Math.min(BATCH_PER_TENANT, remaining);
    const claimed = await client.query<QueueRow>(
      `UPDATE bulk_sms_queue q
          SET status = 'processing', updated_at = now()
        WHERE q.id IN (
          SELECT id FROM bulk_sms_queue
           WHERE tenant_id = $1
             AND status = 'pending'
             AND next_attempt_at <= now()
           ORDER BY created_at ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
        )
        RETURNING q.id, q.campaign_id, q.phone, q.message, q.attempts`,
      [tenantId, claimLimit]
    );
    return { gw, rows: claimed.rows, sentToday };
  });

  if (!setup.gw) return;

  if (setup.rows.length === 0) {
    // Finalize campaigns that have no more pending/processing rows.
    await withTenantClient({ tenantId }, async (client) => {
      await client.query(
        `UPDATE bulk_sms_campaigns b
            SET status = 'completed', completed_at = now()
          WHERE b.tenant_id = $1
            AND b.status = 'sending'
            AND NOT EXISTS (
              SELECT 1 FROM bulk_sms_queue q
               WHERE q.campaign_id = b.id
                 AND q.status IN ('pending','processing')
            )`,
        [tenantId]
      );
    });
    return;
  }

  const config: textbee.TextBeeConfig = {
    apiUrl: setup.gw.api_url,
    apiKey: openSecret(setup.gw.api_key_sealed),
    deviceId: setup.gw.device_id ?? '',
  };
  const delayMs = setup.gw.delay_ms;

  for (let i = 0; i < setup.rows.length; i += 1) {
    const row = setup.rows[i];
    const result = await textbee.sendSms(config, row.phone, row.message);
    const attempts = row.attempts + 1;
    const ok = result.ok;
    const canRetry = !ok && attempts < MAX_ATTEMPTS;

    await withTenantClient({ tenantId }, async (client) => {
      if (ok) {
        await client.query(
          `UPDATE bulk_sms_queue
              SET status = 'sent', attempts = $2, error = NULL,
                  provider_response = $3::jsonb, sent_at = now(), updated_at = now()
            WHERE id = $1`,
          [row.id, attempts, JSON.stringify(result.response ?? null)]
        );
        await client.query(
          `INSERT INTO bulk_sms_logs
             (tenant_id, campaign_id, phone, message, status, provider_response, sent_at)
           VALUES ($1,$2,$3,$4,'sent',$5::jsonb, now())`,
          [
            tenantId,
            row.campaign_id,
            row.phone,
            row.message,
            JSON.stringify(result.response ?? null),
          ]
        );
        await client.query(
          `UPDATE bulk_sms_campaigns SET sent_count = sent_count + 1 WHERE id = $1`,
          [row.campaign_id]
        );
      } else if (canRetry) {
        // Linear backoff: attempt #1 → +1 min, #2 → +2 min.
        await client.query(
          `UPDATE bulk_sms_queue
              SET status = 'pending', attempts = $2, error = $3,
                  provider_response = $4::jsonb,
                  next_attempt_at = now() + ($5::text || ' minutes')::interval,
                  updated_at = now()
            WHERE id = $1`,
          [
            row.id,
            attempts,
            result.error ?? `gateway_status_${result.status}`,
            JSON.stringify(result.response ?? null),
            String(attempts),
          ]
        );
      } else {
        await client.query(
          `UPDATE bulk_sms_queue
              SET status = 'failed', attempts = $2, error = $3,
                  provider_response = $4::jsonb, updated_at = now()
            WHERE id = $1`,
          [
            row.id,
            attempts,
            result.error ?? `gateway_status_${result.status}`,
            JSON.stringify(result.response ?? null),
          ]
        );
        await client.query(
          `INSERT INTO bulk_sms_logs
             (tenant_id, campaign_id, phone, message, status, provider_response, error)
           VALUES ($1,$2,$3,$4,'failed',$5::jsonb,$6)`,
          [
            tenantId,
            row.campaign_id,
            row.phone,
            row.message,
            JSON.stringify(result.response ?? null),
            result.error ?? `gateway_status_${result.status}`,
          ]
        );
        await client.query(
          `UPDATE bulk_sms_campaigns SET failed_count = failed_count + 1 WHERE id = $1`,
          [row.campaign_id]
        );
      }
    });

    // Throttle between messages (skip the wait after the final send).
    if (delayMs > 0 && i < setup.rows.length - 1) {
      await sleep(delayMs);
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    let tenantIds: string[];
    try {
      tenantIds = await listTenantIds();
    } catch (err) {
      logger.error({ err }, 'bulk-sms-loop: failed to list tenants');
      return;
    }
    for (const tenantId of tenantIds) {
      try {
        await runForTenant(tenantId);
      } catch (err) {
        logger.error({ err, tenantId }, 'bulk-sms-loop: tenant tick failed');
      }
    }
  } finally {
    running = false;
  }
}

export function startBulkSmsLoop(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ tickMs: TICK_MS }, 'bulk sms loop started');
}

export function stopBulkSmsLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
