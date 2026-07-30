/**
 * Game history retention worker.
 *
 * Game history (rounds + bets) is only kept for 45 days. This worker deletes
 * `game_rounds` older than the cutoff; the matching `game_bets` rows cascade
 * automatically via their `round_id` foreign key (ON DELETE CASCADE).
 *
 * The wallet ledger (`transactions`) is intentionally left untouched — money
 * movement is a permanent financial record, only the per-round game history is
 * pruned.
 *
 * It runs once shortly after boot (so a long-running instance still cleans up)
 * and then once every 24 hours. Deletion uses a bypass-RLS maintenance client
 * so it sweeps every tenant in a single pass.
 */
import { logger } from '../infrastructure/logger';
import { withTenantClient } from '../infrastructure/db/tenant-client';

const RETENTION_DAYS = 45;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const FIRST_RUN_DELAY_MS = 60 * 1000; // 1 min after boot

let timer: NodeJS.Timeout | null = null;
let startTimer: NodeJS.Timeout | null = null;
let running = false;

async function purgeOldRounds(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const deleted = await withTenantClient(
      { tenantId: null, bypassRls: true },
      async (client) => {
        const res = await client.query(
          `DELETE FROM game_rounds
             WHERE created_at < now() - ($1::text || ' days')::interval`,
          [String(RETENTION_DAYS)]
        );
        return res.rowCount ?? 0;
      }
    );
    if (deleted > 0) {
      logger.info(
        { deleted, retentionDays: RETENTION_DAYS },
        'game history retention: purged old rounds'
      );
    }
  } catch (err) {
    logger.error({ err }, 'game history retention purge failed');
  } finally {
    running = false;
  }
}

export function startGameRetentionLoop(): void {
  if (timer || startTimer) return;
  startTimer = setTimeout(() => {
    void purgeOldRounds();
  }, FIRST_RUN_DELAY_MS);
  if (typeof startTimer.unref === 'function') startTimer.unref();

  timer = setInterval(() => {
    void purgeOldRounds();
  }, RUN_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  logger.info(
    { retentionDays: RETENTION_DAYS },
    'game history retention loop started (daily purge)'
  );
}

export function stopGameRetentionLoop(): void {
  if (startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
