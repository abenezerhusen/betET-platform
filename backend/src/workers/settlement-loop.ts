/**
 * Settlement Loop — automatic background settlement worker.
 *
 * Runs every 5 minutes, INDEPENDENTLY of the odds-sync loop / provider state,
 * so tickets keep settling even when the data provider is disabled, keyless,
 * rate-limited, or down. For each active tenant it:
 *   1. Settles events already `finished` with a recorded score whose tickets
 *      are still pending (grade → propagate → wallet-crediting settle). Uses
 *      NO provider requests — scores may have come from the live feed, the
 *      results sync, or an admin entering them manually.
 *   2. Finds postponed tickets whose waiting period has expired and voids
 *      their expired selections (odds → 1.00), then settles the ticket.
 *   3. Flags tickets stuck without a resolvable result (event unresolved long
 *      past kickoff, or not provider-linked at all) as review_required so
 *      they surface in Manual Settlement → Errors instead of hiding forever.
 *
 * Fetching NEW results from the provider lives in odds-sync-loop (results
 * phase) — this loop stays request-free by design.
 *
 * Uses the same setInterval + dedupe-key pattern as cashback-loop.ts.
 * Failures are per-tenant isolated.
 */

import { logger } from '../infrastructure/logger';
import { pool } from '../infrastructure/db/pool';
import { expirePostponedSelections } from '../modules/admin/settlement/settlement.service';
import {
  flagOverdueUnresolvedTickets,
  settleAlreadyFinishedEvents,
} from '../modules/sports/providers/results.service';

const TICK_MS = 5 * 60 * 1000; // 5 minutes
let timer: NodeJS.Timeout | null = null;

async function listTenantIds(): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'active'`
  );
  return r.rows.map((row) => row.id);
}

async function runForTenant(tenantId: string): Promise<void> {
  // 1) Local grade+settle for events that already have a final score.
  const local = await settleAlreadyFinishedEvents(tenantId);
  if (local.settled > 0 || local.finalized > 0) {
    logger.info(
      { tenantId, ...local },
      'settlement-loop: settled tickets from recorded final scores'
    );
  }

  // 2) Expire postponed tickets whose waiting period elapsed.
  const count = await expirePostponedSelections({ tenantId, actorId: null });
  if (count > 0) {
    logger.info({ tenantId, count }, 'settlement-loop: auto-settled postponed tickets');
  }

  // 3) Surface unresolvable tickets for admin review (no money movement).
  const flagged = await flagOverdueUnresolvedTickets(tenantId);
  if (flagged > 0) {
    logger.warn(
      { tenantId, flagged },
      'settlement-loop: flagged overdue tickets for manual review'
    );
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
