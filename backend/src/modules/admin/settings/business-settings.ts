/**
 * Tenant-scoped business settings used by the cashier and admin panels.
 *
 * Settings live in the `settings` key/value table; this module wraps the
 * keys that have typed semantics (defaults, min/max, etc.).
 */

import type { PoolClient } from 'pg';

export const TICKET_EXPIRY_DAYS_KEY = 'ticket_expiry_days';
export const TICKET_EXPIRY_DAYS_DEFAULT = 7;
export const TICKET_EXPIRY_DAYS_MIN = 1;
export const TICKET_EXPIRY_DAYS_MAX = 365;

/**
 * Resolve the configured ticket-payout expiry window (days) for a tenant.
 *
 * Falls back to the platform default of 7 days when the admin hasn't
 * set anything. Always returns a positive integer within sane bounds so
 * downstream callers don't need to validate.
 */
export async function getTicketExpiryDays(
  client: PoolClient,
  tenantId: string
): Promise<number> {
  const r = await client.query<{ value: unknown }>(
    `SELECT value FROM settings
      WHERE tenant_id = $1 AND key = $2
      LIMIT 1`,
    [tenantId, TICKET_EXPIRY_DAYS_KEY]
  );
  const raw = r.rows[0]?.value;
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    n = Number(raw);
  } else if (
    raw &&
    typeof raw === 'object' &&
    'days' in (raw as Record<string, unknown>)
  ) {
    n = Number((raw as Record<string, unknown>).days);
  } else {
    n = TICKET_EXPIRY_DAYS_DEFAULT;
  }
  if (!Number.isFinite(n) || n < TICKET_EXPIRY_DAYS_MIN) {
    return TICKET_EXPIRY_DAYS_DEFAULT;
  }
  return Math.min(Math.floor(n), TICKET_EXPIRY_DAYS_MAX);
}

/**
 * Compute the absolute expiry instant for a ticket placed at `placedAt`.
 */
export function computeTicketExpiresAt(
  placedAt: Date,
  expiryDays: number
): Date {
  const out = new Date(placedAt.getTime());
  out.setDate(out.getDate() + expiryDays);
  return out;
}
