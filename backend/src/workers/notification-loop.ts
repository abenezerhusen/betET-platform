/**
 * Notification worker — drains queued bulk-notification campaigns.
 *
 * Every tick it claims a batch of pending `bulk_notification_recipients`
 * per active tenant, dispatches each through the central notification
 * service (active provider: SMS / Telegram), records per-recipient status,
 * and advances the parent campaign counters. Campaigns are marked
 * `completed` once no pending recipients remain.
 *
 * A single-instance setInterval loop (same pattern as settlement-loop.ts).
 * Best-effort and per-tenant isolated — one failure never blocks others.
 */

import { logger } from '../infrastructure/logger';
import { pool } from '../infrastructure/db/pool';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import {
  notify,
  NOTIFICATION_EVENTS,
  type NotificationCategory,
} from '../modules/notifications/notification.service';
import { loadNotificationSettings } from '../modules/notifications/notification-config';

const TICK_MS = 15 * 1000; // 15 seconds
const BATCH_PER_TENANT = 100;
let timer: NodeJS.Timeout | null = null;
let running = false;

interface QueueRow {
  recipient_id: string;
  bulk_id: string;
  user_id: string | null;
  recipient: string | null;
  title: string;
  message: string;
  channel: string;
  category: string;
  event: string | null;
}

async function listTenantIds(): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'active'`
  );
  return r.rows.map((row) => row.id);
}

function resolveEvent(category: string, event: string | null): string {
  if (event) return event;
  return category === 'system'
    ? NOTIFICATION_EVENTS.SYSTEM_UPDATE
    : NOTIFICATION_EVENTS.ADMIN_BROADCAST;
}

async function runForTenant(tenantId: string): Promise<void> {
  // Pre-load the provider settings once per tenant per tick to avoid a DB
  // round-trip for every recipient.
  const settings = await loadNotificationSettings(tenantId);

  const rows = await withTenantClient({ tenantId }, async (client) => {
    // Flip queued campaigns that have work into "sending".
    await client.query(
      `UPDATE bulk_notifications
          SET status = 'sending', started_at = COALESCE(started_at, now())
        WHERE tenant_id = $1 AND status = 'queued'`,
      [tenantId]
    );
    const r = await client.query<QueueRow>(
      `SELECT r.id AS recipient_id, r.bulk_id, r.user_id, r.recipient,
              b.title, b.message, b.channel, b.category,
              b.audience_filter->>'event' AS event
         FROM bulk_notification_recipients r
         JOIN bulk_notifications b ON b.id = r.bulk_id
        WHERE r.tenant_id = $1
          AND r.status = 'pending'
          AND b.status = 'sending'
        ORDER BY r.created_at ASC
        LIMIT $2`,
      [tenantId, BATCH_PER_TENANT]
    );
    return r.rows;
  });

  if (rows.length === 0) {
    // Finalize campaigns with no remaining pending recipients.
    await withTenantClient({ tenantId }, async (client) => {
      await client.query(
        `UPDATE bulk_notifications b
            SET status = 'completed', completed_at = now()
          WHERE b.tenant_id = $1
            AND b.status = 'sending'
            AND NOT EXISTS (
              SELECT 1 FROM bulk_notification_recipients r
               WHERE r.bulk_id = b.id AND r.status = 'pending'
            )`,
        [tenantId]
      );
    });
    return;
  }

  for (const row of rows) {
    let ok = false;
    let errMsg: string | null = null;
    if (!row.recipient) {
      errMsg = 'no_recipient';
    } else {
      const composed = row.title ? `${row.title}\n${row.message}` : row.message;
      const channelPref =
        row.channel === 'sms' || row.channel === 'telegram'
          ? row.channel
          : 'default';
      const result = await notify({
        tenantId,
        userId: row.user_id,
        to: row.recipient,
        category: row.category as NotificationCategory,
        event: resolveEvent(row.category, row.event),
        channel: channelPref,
        message: composed,
        settings,
        // The per-recipient row IS the delivery record here; the central
        // service still logs, so disable its own log to avoid duplication.
        log: false,
      });
      ok = result.status === 'sent';
      errMsg = ok ? null : result.reason ?? result.status;
    }

    await withTenantClient({ tenantId }, async (client) => {
      await client.query(
        `UPDATE bulk_notification_recipients
            SET status = $2, error = $3, attempts = attempts + 1,
                sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
          WHERE id = $1`,
        [row.recipient_id, ok ? 'sent' : 'failed', errMsg]
      );
      await client.query(
        `UPDATE bulk_notifications
            SET sent_count = sent_count + $2,
                failed_count = failed_count + $3
          WHERE id = $1`,
        [row.bulk_id, ok ? 1 : 0, ok ? 0 : 1]
      );
    });
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
      logger.error({ err }, 'notification-loop: failed to list tenants');
      return;
    }
    for (const tenantId of tenantIds) {
      try {
        await runForTenant(tenantId);
      } catch (err) {
        logger.error({ err, tenantId }, 'notification-loop: tenant tick failed');
      }
    }
  } finally {
    running = false;
  }
}

export function startNotificationLoop(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ tickMs: TICK_MS }, 'notification loop started');
}

export function stopNotificationLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
