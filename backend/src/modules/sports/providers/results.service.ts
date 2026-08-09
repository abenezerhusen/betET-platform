/**
 * Results & auto-settlement bridge for the Odds-API.io provider.
 *
 * This is the piece that closes the loop so tickets settle hands-free on REAL
 * results:
 *   1. Fetch FINISHED events (final score + status) from Odds-API for the
 *      sports that actually have past-kickoff fixtures still open.
 *   2. Record the final score on the existing `sports_events` rows and flip
 *      their status to `finished` (so scores are recorded for every match,
 *      whether or not anyone bet on it).
 *   3. Auto-grade the standard markets we publish (1x2, Over/Under 2.5, BTTS)
 *      from the final score → set `sports_selections.result`.
 *   4. Propagate results onto pending `sportsbook_bet_legs` and settle every
 *      ticket whose legs are now all terminal — reusing the EXISTING,
 *      wallet-crediting `settleBetFromLegs` engine (won/lost/void, payout to
 *      the withdrawable bucket, audit log, realtime `bet:settled`).
 *
 * Nothing here touches placement, odds pricing, or the admin manual-settlement
 * flow — it only automates the grading trigger with real data. HTTP calls run
 * OUTSIDE the DB transaction (same discipline as the rest of the sync layer).
 */

import { logger } from '../../../infrastructure/logger';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  handleEventCancelled,
  settleBetFromLegs,
} from '../../admin/settlement/settlement.service';
import { mapStatus } from './odds-api.normalizer';
import { gradeSelection } from './market-grading';
import type { OddsApiClient, RequestBudget } from './odds-api.client';
import type { ResolvedProviderConfig } from './provider.config';
import type { PoolClient } from 'pg';

export interface ResultsOutcome {
  finalized: number; // events whose final score was recorded
  settled: number; // tickets auto-settled won/lost from real scores
  cancelled: number; // events cancelled → tickets voided/refunded
}

/** Minimum window looked back for finished fixtures each run. */
const RESULTS_LOOKBACK_HOURS = 72;
/**
 * Hard cap on how far back the results backfill will reach in one pass. Without
 * this, the FIRST run after a long gap could ask the provider for months of
 * settled fixtures at once. 45 days matches the fixture import window, so any
 * event we could have imported can also be finalized.
 */
const MAX_RESULTS_LOOKBACK_HOURS = 45 * 24;
/** Provider page size + max pages per sport per cycle (paginate the backlog). */
const RESULTS_PAGE = 5000;
const MAX_RESULT_PAGES = 4;
/**
 * Leave this many requests in the hourly budget for the odds/events phases
 * after results — so draining a big backlog never starves live pricing.
 */
const RESULTS_BUDGET_RESERVE = 15;

/**
 * Grade every still-open selection of a finished event from its final score
 * using the shared `market-grading` rules (the same rules the normalizer keeps
 * in lockstep with, so every published market IS gradable). Selections the
 * grader can't classify are left untouched — and their market is therefore not
 * marked settled below — so nothing is ever mis-settled.
 */
async function gradeEventFromScore(
  c: PoolClient,
  eventId: string,
  home: number,
  away: number
): Promise<void> {
  const rows = await c.query<{ id: string; market_type: string; label: string }>(
    `SELECT s.id, m.market_type, s.label
       FROM sports_selections s
       JOIN sports_markets m ON m.id = s.market_id
      WHERE m.event_id = $1 AND s.result IS NULL`,
    [eventId]
  );
  const ids: string[] = [];
  const results: string[] = [];
  for (const r of rows.rows) {
    const g = gradeSelection(r.market_type, r.label, home, away);
    if (g) {
      ids.push(r.id);
      results.push(g);
    }
  }
  if (ids.length === 0) return;
  await c.query(
    `UPDATE sports_selections s
        SET result = v.res
       FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS res) v
      WHERE s.id = v.id`,
    [ids, results]
  );
}

/**
 * Run the results + auto-settlement pass for one tenant. Safe no-op when there
 * is nothing to finalize; never throws to the caller.
 */
export async function settleFinishedResults(
  tenantId: string,
  client: OddsApiClient,
  budget: RequestBudget,
  cfg: ResolvedProviderConfig
): Promise<ResultsOutcome> {
  // 1) Which sports have past-kickoff fixtures still open? Only those are worth
  //    a request. (Covers score-recording for every recently-finished match,
  //    not just ones with bets.)
  const needing = await withTenantClient({ tenantId }, async (c) => {
    const r = await c.query<{ sport: string; oldest: Date | null }>(
      `SELECT lower(sport) AS sport, min(starts_at) AS oldest
         FROM sports_events
        WHERE tenant_id = $1
          AND metadata ? 'provider_event_id'
          AND status IN ('scheduled', 'live')
          AND starts_at < now()
        GROUP BY lower(sport)`,
      [tenantId]
    );
    return r.rows;
  });

  const sportsNeeding = needing.map((row) => row.sport);
  const sports = cfg.sports.filter((s) => sportsNeeding.includes(s.toLowerCase()));
  if (sports.length === 0) return { finalized: 0, settled: 0, cancelled: 0 };

  // How far back must we look? Cover the OLDEST still-open past-kickoff event
  // (so nothing stays permanently unsettled once it finishes), but never look
  // back further than MAX_RESULTS_LOOKBACK_HOURS in a single pass, and always
  // at least the default RESULTS_LOOKBACK_HOURS window.
  const oldestOpenMs = needing
    .map((row) => (row.oldest ? new Date(row.oldest).getTime() : null))
    .filter((v): v is number => v !== null)
    .reduce((min, v) => (v < min ? v : min), Number.POSITIVE_INFINITY);

  // 2) Fetch finished + cancelled fixtures (HTTP, outside any transaction).
  //    Odds-API status vocabulary is pending | live | settled | cancelled —
  //    FINISHED games come back as `settled` (with final `scores`), abandoned
  //    ones as `cancelled`. Both are pulled in ONE call per sport to stay
  //    inside the request budget.
  const nowMs = Date.now();
  const floorMs = nowMs - RESULTS_LOOKBACK_HOURS * 60 * 60 * 1000;
  const maxBackMs = nowMs - MAX_RESULTS_LOOKBACK_HOURS * 60 * 60 * 1000;
  const fromMs = Number.isFinite(oldestOpenMs)
    ? Math.min(floorMs, Math.max(oldestOpenMs, maxBackMs))
    : floorMs;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(nowMs).toISOString();
  const finalById = new Map<string, { home: number; away: number }>();
  const cancelledIds = new Set<string>();

  let stop = false;
  for (const sport of sports) {
    if (stop || budget.remaining() <= RESULTS_BUDGET_RESERVE) break;
    // Paginate the settled feed so a multi-week backlog is drained across
    // cycles instead of being truncated at the first 5000 rows.
    for (let page = 0; page < MAX_RESULT_PAGES; page += 1) {
      if (budget.remaining() <= RESULTS_BUDGET_RESERVE) {
        stop = true;
        break;
      }
      let events;
      try {
        // The /events filter only accepts pending | live | settled. Cancelled
        // / abandoned fixtures surface inside the settled feed with their own
        // per-event status, so we classify each row via mapStatus below.
        events = await client.getEvents(
          {
            sport,
            status: 'settled',
            from: fromIso,
            to: toIso,
            limit: RESULTS_PAGE,
            skip: page * RESULTS_PAGE,
          },
          budget
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err, tenantId, sport }, 'odds-sync: results fetch failed');
        // Rate limited / provider unavailable — stop this cycle; whatever we
        // already collected is still applied, the rest retries next cycle.
        if (msg.includes('429') || msg.includes('503') || msg.includes('rate_limited')) {
          stop = true;
        }
        break;
      }
      for (const e of events) {
        const st = mapStatus(e.status);
        if (st === 'cancelled') {
          cancelledIds.add(String(e.id));
          continue;
        }
        const h = e.scores?.home;
        const a = e.scores?.away;
        if (typeof h === 'number' && typeof a === 'number') {
          finalById.set(String(e.id), { home: h, away: a });
        }
      }
      if (events.length < RESULTS_PAGE) break; // last page for this sport
    }
  }

  if (finalById.size === 0 && cancelledIds.size === 0) {
    return { finalized: 0, settled: 0, cancelled: 0 };
  }

  // 3) Record scores, grade, and auto-settle — one short transaction.
  //    bypassRls so we can update bet legs/bets across users (mirrors the
  //    admin settlement service).
  const scored = await withTenantClient({ tenantId, bypassRls: true }, async (c) => {
    const ids = [...finalById.keys()];
    if (ids.length === 0) return { finalized: 0, settled: 0 };
    const ourEvents = await c.query<{ id: string; pid: string }>(
      `SELECT id, metadata->>'provider_event_id' AS pid
         FROM sports_events
        WHERE tenant_id = $1
          AND metadata->>'provider_event_id' = ANY($2)
          AND status <> 'finished'`,
      [tenantId, ids]
    );

    const eventIds: string[] = [];
    for (const row of ourEvents.rows) {
      const sc = finalById.get(row.pid);
      if (!sc) continue;
      await c.query(
        `UPDATE sports_events
            SET home_score = $2,
                away_score = $3,
                status = 'finished',
                updated_at = now()
          WHERE id = $1`,
        [row.id, sc.home, sc.away]
      );
      await gradeEventFromScore(c, row.id, sc.home, sc.away);
      eventIds.push(row.id);
    }

    if (eventIds.length === 0) return { finalized: 0, settled: 0 as number };

    // Mark settled only the markets whose selections are ALL graded — so a
    // market we couldn't fully resolve stays open (and never falsely settles a
    // leg). With normalizer/grader in lockstep this settles everything we
    // published.
    await c.query(
      `UPDATE sports_markets sm
          SET status = 'settled', settled_at = now()
        WHERE sm.event_id = ANY($1) AND sm.status <> 'settled'
          AND NOT EXISTS (
            SELECT 1 FROM sports_selections s
             WHERE s.market_id = sm.id AND s.result IS NULL
          )`,
      [eventIds]
    );

    // Propagate graded results onto pending legs.
    const affected = await c.query<{ bet_id: string }>(
      `UPDATE sportsbook_bet_legs leg
          SET status = sel.result,
              selection_status = CASE sel.result
                WHEN 'won' THEN 'won'
                WHEN 'lost' THEN 'lost'
                ELSE 'voided'
              END,
              settled_odds = CASE WHEN sel.result = 'void'
                                  THEN 1.00 ELSE leg.odds_at_placement END,
              settled_at = now()
         FROM sports_selections sel
        WHERE leg.selection_id = sel.id
          AND leg.status = 'pending'
          AND sel.result IS NOT NULL
          AND sel.market_id IN (
            SELECT id FROM sports_markets WHERE event_id = ANY($1)
          )
        RETURNING leg.bet_id`,
      [eventIds]
    );

    const betIds = [...new Set(affected.rows.map((r) => r.bet_id))];
    let settled = 0;
    for (const betId of betIds) {
      // Only settle when the WHOLE ticket is terminal (parlays wait for all
      // legs). Leave still-pending multis for a later cycle.
      const pend = await c.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM sportsbook_bet_legs
          WHERE bet_id = $1 AND status = 'pending'`,
        [betId]
      );
      if (Number(pend.rows[0]?.n ?? 0) > 0) continue;
      const b = await c.query<{ status: string }>(
        `SELECT status FROM sportsbook_bets WHERE id = $1`,
        [betId]
      );
      if (!b.rows[0] || b.rows[0].status !== 'pending') continue;
      try {
        await settleBetFromLegs(c, {
          tenantId,
          betId,
          actorId: null,
          reason: 'auto_settle_real_result',
        });
        settled += 1;
      } catch (err) {
        logger.warn({ err, betId, tenantId }, 'auto-settle failed');
        await c.query(
          `UPDATE sportsbook_bets
              SET settlement_status = 'error',
                  settlement_error = $1,
                  review_required = true
            WHERE id = $2`,
          [String(err instanceof Error ? err.message : err), betId]
        );
      }
    }

    return { finalized: eventIds.length, settled };
  });

  // 4) Cancelled / abandoned fixtures → void all pending legs and refund
  //    stakes via the EXISTING settlement engine (handleEventCancelled), then
  //    make the market + selection results consistent (voided).
  let cancelled = 0;
  if (cancelledIds.size > 0) {
    const rows = await withTenantClient({ tenantId }, (c) =>
      c.query<{ id: string }>(
        `SELECT id FROM sports_events
          WHERE tenant_id = $1
            AND metadata->>'provider_event_id' = ANY($2)
            AND status NOT IN ('cancelled', 'finished')`,
        [tenantId, [...cancelledIds]]
      )
    );
    const cancelledEventIds: string[] = [];
    for (const row of rows.rows) {
      try {
        await handleEventCancelled({ tenantId, eventId: row.id, actorId: null });
        cancelledEventIds.push(row.id);
        cancelled += 1;
      } catch (err) {
        logger.warn(
          { err, tenantId, eventId: row.id },
          'odds-sync: event-cancel void failed'
        );
      }
    }
    if (cancelledEventIds.length > 0) {
      await withTenantClient({ tenantId, bypassRls: true }, async (c) => {
        await c.query(
          `UPDATE sports_markets SET status = 'cancelled', settled_at = now()
            WHERE event_id = ANY($1) AND status NOT IN ('cancelled', 'settled')`,
          [cancelledEventIds]
        );
        await c.query(
          `UPDATE sports_selections SET result = 'void'
            WHERE result IS NULL
              AND market_id IN (SELECT id FROM sports_markets WHERE event_id = ANY($1))`,
          [cancelledEventIds]
        );
      });
    }
  }

  return { finalized: scored.finalized, settled: scored.settled, cancelled };
}
