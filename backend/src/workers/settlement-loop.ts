/**
 * Settlement Loop — automatic background settlement worker.
 *
 * Runs every 5 minutes. For each active tenant it:
 *   1. Finds postponed tickets whose waiting period has expired.
 *   2. Voids expired postponed selections (odds → 1.00).
 *   3. Settles remaining legs using concluded event results.
 *   4. Settles tickets where all legs are now in a terminal state.
 *   5. Finds tickets with settlement errors and flags them for review.
 *
 * Uses the same setInterval + dedupe-key pattern as cashback-loop.ts.
 * Failures are per-tenant isolated.
 */

import { logger } from '../infrastructure/logger';
import { pool } from '../infrastructure/db/pool';
import { expirePostponedSelections } from '../modules/admin/settlement/settlement.service';

const TICK_MS = 5 * 60 * 1000; // 5 minutes
let timer: NodeJS.Timeout | null = null;

async function listTenantIds(): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'active'`
  );
  return r.rows.map((row) => row.id);
}

async function runForTenant(tenantId: string): Promise<void> {
  const count = await expirePostponedSelections({ tenantId, actorId: null });
  if (count > 0) {
    logger.info({ tenantId, count }, 'settlement-loop: auto-settled postponed tickets');
  }
}

async function tick(): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = await listTenantIds();
  } catch (err) {
    logger.error({ err }, 'settlement-loop: failed to list tenants');
    return;
  }

  for (const tenantId of tenantIds) {
    try {
      await runForTenant(tenantId);
    } catch (err) {
      logger.error({ err, tenantId }, 'settlement-loop: tenant tick failed');
    }
  }
}

export function startSettlementLoop(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ tickMs: TICK_MS }, 'settlement loop started');
}

export function stopSettlementLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
