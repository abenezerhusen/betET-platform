/**
 * Odds-API.io sync worker — imports real fixtures + odds into the existing
 * sportsbook tables on a schedule.
 *
 * COMPLETELY INERT unless `DATA_PROVIDER=odds_api`. Even then it only does work
 * for tenants whose `sports_data_provider` row is enabled AND has a resolvable
 * API key (env or admin-entered). When idle it costs one cheap tenant lookup
 * per base tick and nothing else — behaviour in the default `mock` mode is
 * byte-for-byte unchanged.
 *
 * Scheduling: a single base-tick loop (same pattern as notification-loop.ts)
 * decides per tenant whether the prematch or live interval has elapsed and runs
 * the corresponding phase via the sync orchestrator. Per-phase last-run times
 * are tracked in memory so we never write timestamps just to schedule.
 */

import { logger } from '../infrastructure/logger';
import { pool } from '../infrastructure/db/pool';
import { env } from '../config/env';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { getConfig } from '../modules/sports/providers/provider.repository';
import { resolveConfig } from '../modules/sports/providers/provider.config';
import { runSync } from '../modules/sports/providers/sync.service';

const TICK_MS = 30 * 1000; // base scheduler tick
/**
 * Results + auto-settlement cadence. Independent of (and faster than) the
 * prematch interval so finished matches settle within minutes — the pass is a
 * cheap no-op when nothing needs finalizing, and its provider requests are
 * still bounded by the shared hourly budget.
 */
const RESULTS_INTERVAL_SECONDS = 5 * 60;
let timer: NodeJS.Timeout | null = null;
let running = false;

type Phase = 'prematch' | 'live' | 'results';

/** In-memory per-tenant/phase last-run epoch (ms). Reset on process restart. */
const lastRun = new Map<string, number>();

function due(tenantId: string, phase: Phase, intervalSeconds: number): boolean {
  const key = `${tenantId}:${phase}`;
  const last = lastRun.get(key) ?? 0;
  return Date.now() - last >= intervalSeconds * 1000;
}

function markRun(tenantId: string, phase: Phase): void {
  lastRun.set(`${tenantId}:${phase}`, Date.now());
}

async function listActiveTenantIds(): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'active'`
  );
  return r.rows.map((row) => row.id);
}

async function runForTenant(tenantId: string): Promise<void> {
  const row = await withTenantClient({ tenantId }, (c) => getConfig(c, tenantId));
  const cfg = resolveConfig(row);
  if (!cfg.active) return; // not enabled / no key for this tenant

  // Results FIRST: recording final scores + settling real tickets always gets
  // budget priority over pricing/import work on a tight hourly quota.
  if (due(tenantId, 'results', RESULTS_INTERVAL_SECONDS)) {
    markRun(tenantId, 'results');
    const res = await runSync(tenantId, { phase: 'results' });
    if (res.resultsFinalized || res.ticketsSettled || res.eventsCancelled) {
      logger.info({ tenantId, ...res }, 'odds-sync: results cycle');
    }
  }

  if (due(tenantId, 'live', cfg.liveIntervalSeconds)) {
    markRun(tenantId, 'live');
    const res = await runSync(tenantId, { phase: 'live' });
    if (res.eventsUpserted || res.oddsUpserted) {
      logger.info({ tenantId, ...res }, 'odds-sync: live cycle');
    }
  }

  if (due(tenantId, 'prematch', cfg.prematchIntervalSeconds)) {
    markRun(tenantId, 'prematch');
    const res = await runSync(tenantId, { phase: 'prematch' });
    if (
      res.eventsUpserted ||
      res.oddsUpserted ||
      res.resultsFinalized ||
      res.ticketsSettled ||
      res.eventsCancelled
    ) {
      logger.info({ tenantId, ...res }, 'odds-sync: prematch cycle');
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  if (env.DATA_PROVIDER !== 'odds_api') return; // master switch — inert in mock
  running = true;
  try {
    let tenantIds: string[];
    try {
      tenantIds = await listActiveTenantIds();
    } catch (err) {
      logger.error({ err }, 'odds-sync-loop: failed to list tenants');
      return;
    }
    for (const tenantId of tenantIds) {
      try {
        await runForTenant(tenantId);
      } catch (err) {
        logger.error({ err, tenantId }, 'odds-sync-loop: tenant tick failed');
      }
    }
  } finally {
    running = false;
  }
}

export function startOddsSyncLoop(): void {
  if (timer) return;
  if (env.DATA_PROVIDER !== 'odds_api') {
    logger.info('odds-sync loop dormant (DATA_PROVIDER=mock)');
    return;
  }
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ tickMs: TICK_MS }, 'odds-sync loop started');
}

export function stopOddsSyncLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
