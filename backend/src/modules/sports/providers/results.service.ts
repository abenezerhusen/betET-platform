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
  handleEventPostponed,
  settleBetFromLegs,
  writeAuditLog,
} from '../../admin/settlement/settlement.service';
import { extractScorePair, mapStatus } from './odds-api.normalizer';
import { gradeSelection } from './market-grading';
import type { OddsApiClient, RequestBudget } from './odds-api.client';
import type { ResolvedProviderConfig } from './provider.config';
import type { PoolClient } from 'pg';

export interface ResultsOutcome {
  finalized: number; // events whose final score was recorded
  settled: number; // tickets auto-settled won/lost from real scores
  cancelled: number; // events cancelled → tickets voided/refunded
}

/**
 * How far back the results pass reaches. the-odds-api's /scores endpoint caps
 * `daysFrom` at 3 days, so 72h is also the HARD limit of what the windowed
 * pass can resolve — anything older is handled by the targeted per-event pass
 * (while bets are pending) and the overdue-ticket flagging below.
 */
const RESULTS_LOOKBACK_HOURS = 72;
/** the-odds-api /scores accepts daysFrom 1..3. */
const MAX_SCORES_DAYS_FROM = 3;
/**
 * Leave this many requests in the hourly budget for the odds/events phases
 * after results — so draining a big backlog never starves live pricing.
 */
const RESULTS_BUDGET_RESERVE = 15;
/** Targeted per-event result resolution (events that carry pending bets). */
const TARGETED_FETCH_LIMIT = 15;
const TARGETED_MIN_AGE_HOURS = 4;
const TARGETED_RECHECK_MINUTES = 60;
/** Wait applied when the provider reports a fixture as postponed. */
const POSTPONED_DEFAULT_WAIT_HOURS = 72;

/**
 * Per-tenant re-entrancy guard: the results pass can be triggered by the
 * background loop AND the admin (Sync Now / Run Auto-Settle) at the same
 * time. Settlement itself is idempotent, but overlapping passes would burn
 * double request budget for nothing.
 */
const resultsInFlight = new Set<string>();

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
 * Shared "grade → propagate → settle" step for a set of already-scored events.
 *
 * 1. Mark markets settled only when ALL their selections are graded (so a
 *    partially-resolvable market never falsely settles a leg).
 * 2. Propagate graded selection results onto still-pending bet legs.
 * 3. Settle every ticket whose legs are now ALL terminal via the existing
 *    wallet-crediting engine. Idempotent (skips non-pending tickets / already
 *    settled), errors flagged for review — never throws for one bad ticket.
 *
 * Reused by BOTH the provider-driven pass (newly finalized events) and the
 * local backfill pass (events already flipped to `finished` by the live feed
 * but never graded). Returns the number of tickets settled this call.
 */
async function gradeAndSettleFinishedEventIds(
  c: PoolClient,
  tenantId: string,
  eventIds: string[]
): Promise<number> {
  if (eventIds.length === 0) return 0;

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
    // Only settle when the WHOLE ticket is terminal (parlays wait for all legs).
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
  return settled;
}

/**
 * LOCAL backfill pass — settle events that are ALREADY `finished` with a final
 * score recorded but whose tickets are still pending. This covers the gap where
 * a match was flipped to `finished` by the live-events feed (score present) yet
 * never graded/settled, so the provider-driven pass below — which only inspects
 * `scheduled`/`live` events — would skip it forever and strand its tickets.
 *
 * Needs NO provider request, so it also runs when the API is rate-limited/down
 * and via the admin manual trigger even with the provider disabled. Bounded and
 * targeted (only finished events that still have pending legs). Never throws.
 */
export async function settleAlreadyFinishedEvents(
  tenantId: string
): Promise<{ finalized: number; settled: number }> {
  try {
    return await withTenantClient({ tenantId, bypassRls: true }, async (c) => {
      const ev = await c.query<{ id: string; home_score: number; away_score: number }>(
        `SELECT DISTINCT e.id, e.home_score, e.away_score
           FROM sports_events e
          WHERE e.tenant_id = $1
            AND e.status = 'finished'
            AND e.home_score IS NOT NULL
            AND e.away_score IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM sportsbook_bet_legs leg
                JOIN sports_selections s ON s.id = leg.selection_id
                JOIN sports_markets m ON m.id = s.market_id
               WHERE m.event_id = e.id AND leg.status = 'pending'
            )
          LIMIT 500`,
        [tenantId]
      );
      if (ev.rows.length === 0) return { finalized: 0, settled: 0 };

      const eventIds: string[] = [];
      for (const row of ev.rows) {
        // Grade any still-ungraded selections from the recorded final score.
        await gradeEventFromScore(c, row.id, row.home_score, row.away_score);
        eventIds.push(row.id);
      }
      const settled = await gradeAndSettleFinishedEventIds(c, tenantId, eventIds);
      return { finalized: eventIds.length, settled };
    });
  } catch (err) {
    logger.warn({ err, tenantId }, 'settleAlreadyFinishedEvents failed');
    return { finalized: 0, settled: 0 };
  }
}

/**
 * Void + refund all pending legs of the given cancelled events via the
 * EXISTING settlement engine, then make market/selection state consistent.
 * Returns the number of events cancelled.
 */
async function applyCancelledEvents(
  tenantId: string,
  internalEventIds: string[]
): Promise<number> {
  let cancelled = 0;
  const cancelledEventIds: string[] = [];
  for (const eventId of internalEventIds) {
    try {
      await handleEventCancelled({ tenantId, eventId, actorId: null });
      cancelledEventIds.push(eventId);
      cancelled += 1;
    } catch (err) {
      logger.warn({ err, tenantId, eventId }, 'odds-sync: event-cancel void failed');
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
  return cancelled;
}

/** Stamp metadata.result_checked_at so targeted fetches back off per event. */
async function touchResultChecked(
  tenantId: string,
  eventIds: string[]
): Promise<void> {
  if (eventIds.length === 0) return;
  await withTenantClient({ tenantId, bypassRls: true }, (c) =>
    c.query(
      `UPDATE sports_events
          SET metadata = COALESCE(metadata, '{}'::jsonb)
                || jsonb_build_object('result_checked_at', now()),
              updated_at = now()
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, eventIds]
    )
  );
}

/**
 * TARGETED result resolution — one GET /events/{id} per fixture that carries
 * PENDING BETS but is still open past kickoff. This is the money-first safety
 * net: even when the windowed settled feed misses an event (sport mismatch,
 * backlog truncation, provider hiccup), any fixture someone actually bet on
 * is resolved individually, oldest first.
 *
 * Handles every provider verdict safely:
 *   settled   → record score, grade, settle tickets
 *   cancelled → void legs + refund via the existing engine
 *   postponed → mark postponed (expiry loop voids it after the wait window)
 *   pending with a future date → fixture was rescheduled; update kickoff
 *   unknown/404 → back off (stamped) — the overdue-flagging pass surfaces it
 */
async function resolveEventsWithPendingBets(
  tenantId: string,
  client: OddsApiClient,
  budget: RequestBudget
): Promise<{ finalized: number; settled: number; cancelled: number }> {
  const due = await withTenantClient({ tenantId, bypassRls: true }, (c) =>
    c.query<{ id: string; pid: string }>(
      `SELECT DISTINCT e.id, e.metadata->>'provider_event_id' AS pid, e.starts_at
         FROM sports_events e
        WHERE e.tenant_id = $1
          AND e.metadata ? 'provider_event_id'
          AND e.status IN ('scheduled', 'live')
          AND e.starts_at < now() - make_interval(hours => $2)
          AND (
            e.metadata->>'result_checked_at' IS NULL
            OR (e.metadata->>'result_checked_at')::timestamptz
               < now() - make_interval(mins => $3)
          )
          AND EXISTS (
            SELECT 1
              FROM sportsbook_bet_legs leg
              JOIN sports_selections s ON s.id = leg.selection_id
              JOIN sports_markets m ON m.id = s.market_id
             WHERE m.event_id = e.id AND leg.status = 'pending'
          )
        ORDER BY e.starts_at ASC
        LIMIT $4`,
      [tenantId, TARGETED_MIN_AGE_HOURS, TARGETED_RECHECK_MINUTES, TARGETED_FETCH_LIMIT]
    )
  );
  if (due.rows.length === 0) return { finalized: 0, settled: 0, cancelled: 0 };

  const finishedByInternalId = new Map<string, { home: number; away: number }>();
  const cancelledInternalIds: string[] = [];
  const postponedInternalIds: string[] = [];
  const rescheduled: Array<{ id: string; startsAt: string }> = [];
  const checkedIds: string[] = [];

  for (const row of due.rows) {
    if (budget.remaining() <= RESULTS_BUDGET_RESERVE) break;
    let event;
    try {
      event = await client.getEventById(row.pid, budget);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err, tenantId, pid: row.pid }, 'odds-sync: targeted result fetch failed');
      if (msg.includes('429') || msg.includes('rate_limited') || msg.includes('budget')) break;
      continue;
    }
    checkedIds.push(row.id);
    if (!event) continue; // 404 — unknown upstream; overdue flagging will surface it

    const st = mapStatus(event.status);
    if (st === 'finished') {
      // v4 scores come as [{name, score}] — matched to home/away by team name.
      const sc = extractScorePair(event);
      if (sc.home !== null && sc.away !== null) {
        finishedByInternalId.set(row.id, { home: sc.home, away: sc.away });
      }
    } else if (st === 'cancelled') {
      cancelledInternalIds.push(row.id);
    } else if (st === 'postponed') {
      postponedInternalIds.push(row.id);
    } else if (st === 'scheduled' && event.commence_time) {
      const newStart = new Date(event.commence_time);
      if (!Number.isNaN(newStart.getTime()) && newStart.getTime() > Date.now()) {
        rescheduled.push({ id: row.id, startsAt: newStart.toISOString() });
      }
    }
  }

  await touchResultChecked(tenantId, checkedIds);

  let finalized = 0;
  let settled = 0;
  if (finishedByInternalId.size > 0) {
    const outcome = await withTenantClient({ tenantId, bypassRls: true }, async (c) => {
      const eventIds: string[] = [];
      for (const [id, sc] of finishedByInternalId) {
        await c.query(
          `UPDATE sports_events
              SET home_score = $2, away_score = $3, status = 'finished', updated_at = now()
            WHERE id = $1 AND status <> 'finished'`,
          [id, sc.home, sc.away]
        );
        await gradeEventFromScore(c, id, sc.home, sc.away);
        eventIds.push(id);
      }
      const n = await gradeAndSettleFinishedEventIds(c, tenantId, eventIds);
      return { finalized: eventIds.length, settled: n };
    });
    finalized = outcome.finalized;
    settled = outcome.settled;
  }

  const cancelled = await applyCancelledEvents(tenantId, cancelledInternalIds);

  for (const id of postponedInternalIds) {
    try {
      await handleEventPostponed({
        tenantId,
        eventId: id,
        waitHours: POSTPONED_DEFAULT_WAIT_HOURS,
        actorId: null,
      });
    } catch (err) {
      logger.warn({ err, tenantId, eventId: id }, 'odds-sync: event-postpone failed');
    }
  }

  if (rescheduled.length > 0) {
    await withTenantClient({ tenantId, bypassRls: true }, async (c) => {
      for (const r of rescheduled) {
        await c.query(
          `UPDATE sports_events SET starts_at = $2, updated_at = now() WHERE id = $1`,
          [r.id, r.startsAt]
        );
      }
    });
  }

  return { finalized, settled, cancelled };
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
  if (resultsInFlight.has(tenantId)) {
    return { finalized: 0, settled: 0, cancelled: 0 };
  }
  resultsInFlight.add(tenantId);
  try {
    return await runResultsPass(tenantId, client, budget, cfg);
  } finally {
    resultsInFlight.delete(tenantId);
  }
}

async function runResultsPass(
  tenantId: string,
  client: OddsApiClient,
  budget: RequestBudget,
  cfg: ResolvedProviderConfig
): Promise<ResultsOutcome> {
  void cfg; // config gates activation upstream; sports below come from the DB
  // 0) LOCAL backfill (no provider request): settle any event already marked
  //    `finished` with a score but whose tickets are still pending — the gap
  //    the provider pass below cannot reach (it only looks at scheduled/live).
  const local = await settleAlreadyFinishedEvents(tenantId);

  // 0.5) TARGETED pass — fixtures with pending bets are resolved individually
  //      first, so tickets with money on them never wait for (or get lost in)
  //      the windowed backlog drain below.
  let targeted = { finalized: 0, settled: 0, cancelled: 0 };
  try {
    targeted = await resolveEventsWithPendingBets(tenantId, client, budget);
  } catch (err) {
    logger.warn({ err, tenantId }, 'odds-sync: targeted results pass failed');
  }

  // 1) Which sports have past-kickoff fixtures still open? Only those are
  //    worth a request. Uses the sport slugs AS STORED (they come from the
  //    provider's own sport.slug at import) — never the admin-configured
  //    list, whose spellings can differ (e.g. `mixed-martial-arts` vs `mma`)
  //    and would silently exclude whole sports from results forever.
  //    Events older than the max lookback are excluded so a handful of
  //    ancient unresolvable fixtures can't pin the window in the past.
  const needing = await withTenantClient({ tenantId }, async (c) => {
    const r = await c.query<{ sport: string; oldest: Date | null }>(
      `SELECT lower(sport) AS sport, min(starts_at) AS oldest
         FROM sports_events
        WHERE tenant_id = $1
          AND metadata ? 'provider_event_id'
          AND status IN ('scheduled', 'live')
          AND starts_at < now()
          AND starts_at > now() - make_interval(hours => $2)
        GROUP BY lower(sport)`,
      [tenantId, RESULTS_LOOKBACK_HOURS]
    );
    return r.rows;
  });

  if (needing.length === 0) {
    return {
      finalized: local.finalized + targeted.finalized,
      settled: local.settled + targeted.settled,
      cancelled: targeted.cancelled,
    };
  }

  // 2) Fetch finished fixtures via GET /sports/{sport_key}/scores?daysFrom=
  //    (HTTP, outside any transaction). The scores feed carries
  //    `completed: true/false` plus the final `scores` array — completed
  //    matches are recorded directly. `daysFrom` is sized to reach the
  //    sport's OLDEST still-open kickoff (capped at the provider's 3-day
  //    maximum). the-odds-api exposes no "cancelled" state, so abandoned
  //    fixtures are handled by the targeted pass + overdue flagging instead.
  const nowMs = Date.now();
  const finalById = new Map<string, { home: number; away: number }>();
  const cancelledIds = new Set<string>();

  for (const row of needing) {
    if (budget.remaining() <= RESULTS_BUDGET_RESERVE) break;
    const sport = row.sport;
    const oldestMs = row.oldest ? new Date(row.oldest).getTime() : nowMs;
    const daysFrom = Math.min(
      MAX_SCORES_DAYS_FROM,
      Math.max(1, Math.ceil((nowMs - oldestMs) / (24 * 60 * 60 * 1000)))
    );

    let events;
    try {
      events = await client.getScores(sport, daysFrom, budget);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err, tenantId, sport }, 'odds-sync: results fetch failed');
      // Rate limited / provider unavailable — stop this cycle; whatever we
      // already collected is still applied, the rest retries next cycle.
      if (msg.includes('429') || msg.includes('503') || msg.includes('rate_limited') || msg.includes('budget')) {
        break;
      }
      continue;
    }
    for (const e of events) {
      if (e.completed !== true) continue; // still in progress — not final
      const sc = extractScorePair(e);
      if (sc.home !== null && sc.away !== null) {
        finalById.set(String(e.id), { home: sc.home, away: sc.away });
      }
    }
  }

  if (finalById.size === 0 && cancelledIds.size === 0) {
    return {
      finalized: local.finalized + targeted.finalized,
      settled: local.settled + targeted.settled,
      cancelled: targeted.cancelled,
    };
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

    // Grade → propagate → settle the freshly finalized events (shared helper,
    // identical to the local backfill pass so behaviour stays in lockstep).
    const settled = await gradeAndSettleFinishedEventIds(c, tenantId, eventIds);
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
    cancelled = await applyCancelledEvents(
      tenantId,
      rows.rows.map((r) => r.id)
    );
  }

  return {
    finalized: scored.finalized + local.finalized + targeted.finalized,
    settled: scored.settled + local.settled + targeted.settled,
    cancelled: cancelled + targeted.cancelled,
  };
}

/* -------------------------------------------------------------------------- */
/*  Overdue-ticket flagging (no provider request, no money movement)          */
/* -------------------------------------------------------------------------- */

/** Flag tickets for admin review once their event is this long past kickoff
 *  with no resolvable result (still scheduled/live, or not provider-linked). */
const REVIEW_AFTER_HOURS = 48;

/**
 * Surface stuck tickets instead of leaving them invisible: any PENDING ticket
 * with a pending leg whose event kicked off > REVIEW_AFTER_HOURS ago and is
 * still unresolved (event stuck `scheduled`/`live`, or a seed/manual event
 * with no provider mapping at all) is flagged `review_required` +
 * `awaiting_settlement` so it appears in the Manual Settlement → Errors queue.
 *
 * NEVER moves money and NEVER guesses a result — resolution stays with the
 * targeted/windowed result passes or an admin. Idempotent: already-flagged
 * tickets are skipped. Returns the number of tickets newly flagged.
 */
export async function flagOverdueUnresolvedTickets(
  tenantId: string
): Promise<number> {
  try {
    return await withTenantClient({ tenantId, bypassRls: true }, async (c) => {
      const flagged = await c.query<{ id: string; settlement_status: string | null }>(
        `UPDATE sportsbook_bets b
            SET review_required = true,
                settlement_status = CASE
                  WHEN b.settlement_status IS NULL
                    OR b.settlement_status IN ('pending', 'live')
                  THEN 'awaiting_settlement'
                  ELSE b.settlement_status
                END,
                updated_at = now()
          WHERE b.tenant_id = $1
            AND b.status = 'pending'
            AND b.review_required = false
            AND COALESCE(b.settlement_status, 'pending')
                NOT IN ('postponed', 'manual_review', 'error')
            AND EXISTS (
              SELECT 1
                FROM sportsbook_bet_legs leg
                JOIN sports_selections s ON s.id = leg.selection_id
                JOIN sports_markets m ON m.id = s.market_id
                JOIN sports_events e ON e.id = m.event_id
               WHERE leg.bet_id = b.id
                 AND leg.status = 'pending'
                 AND e.starts_at < now() - make_interval(hours => $2)
                 AND (
                   e.status IN ('scheduled', 'live')
                   OR NOT (e.metadata ? 'provider_event_id')
                 )
            )
          RETURNING b.id, b.settlement_status`,
        [tenantId, REVIEW_AFTER_HOURS]
      );

      for (const row of flagged.rows) {
        await writeAuditLog(c, {
          tenantId,
          betId: row.id,
          actorId: null,
          action: 'flag_awaiting_result',
          newStatus: row.settlement_status ?? 'awaiting_settlement',
          settlementReason:
            `Event unresolved ${REVIEW_AFTER_HOURS}h after kickoff — ` +
            'flagged for admin review (no result available from provider).',
        });
      }
      return flagged.rows.length;
    });
  } catch (err) {
    logger.warn({ err, tenantId }, 'flagOverdueUnresolvedTickets failed');
    return 0;
  }
}
