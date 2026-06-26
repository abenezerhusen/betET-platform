/**
 * Settlement Service — core logic for the Ticket Settlement & Void Rules system.
 *
 * All operations run inside the caller's DB transaction (PoolClient).
 * The service does NOT start its own transactions; callers use
 * withTenantClient() to wrap groups of calls.
 *
 * Settlement status vocabulary (settlement_status column):
 *   pending | live | won | lost | postponed | awaiting_settlement |
 *   partially_voided | fully_voided | refunded | cancelled |
 *   manual_review | settled | error
 */

import type { PoolClient } from 'pg';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { emitToUser, emitWalletUpdated } from '../../../realtime/socket';
import { logger } from '../../../infrastructure/logger';

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type SettlementStatus =
  | 'pending'
  | 'live'
  | 'won'
  | 'lost'
  | 'postponed'
  | 'awaiting_settlement'
  | 'partially_voided'
  | 'fully_voided'
  | 'refunded'
  | 'cancelled'
  | 'manual_review'
  | 'settled'
  | 'error';

export type SelectionStatus =
  | 'pending'
  | 'won'
  | 'lost'
  | 'voided'
  | 'postponed'
  | 'awaiting'
  | 'manual_review';

export interface SettlementBet {
  id: string;
  tenant_id: string;
  user_id: string;
  stake: string;
  currency: string;
  total_odds: string | null;
  original_odds: string | null;
  potential_payout: string;
  actual_payout: string | null;
  status: string;
  settlement_status: string | null;
  postponed_at: Date | null;
  postpone_wait_hours: number;
  review_required: boolean;
  bet_type: string;
}

export interface SettlementLeg {
  id: string;
  bet_id: string;
  selection_id: string;
  odds_at_placement: string;
  original_odds: string | null;
  settled_odds: string | null;
  status: string;
  selection_status: string | null;
  void_reason: string | null;
}

export interface AuditEntry {
  tenantId: string;
  betId: string;
  legId?: string;
  actorId: string | null;
  action: string;
  oldStatus?: string;
  newStatus?: string;
  oldOdds?: number;
  newOdds?: number;
  stake?: number;
  originalPayout?: number;
  recalculatedPayout?: number;
  voidReason?: string;
  settlementReason?: string;
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Audit helper                                                         */
/* ------------------------------------------------------------------ */

export async function writeAuditLog(
  client: PoolClient,
  entry: AuditEntry
): Promise<void> {
  await client.query(
    `INSERT INTO settlement_audit_logs
       (tenant_id, bet_id, leg_id, actor_id, action,
        old_status, new_status, old_odds, new_odds, stake,
        original_payout, recalculated_payout, void_reason,
        settlement_reason, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
    [
      entry.tenantId,
      entry.betId,
      entry.legId ?? null,
      entry.actorId ?? null,
      entry.action,
      entry.oldStatus ?? null,
      entry.newStatus ?? null,
      entry.oldOdds ?? null,
      entry.newOdds ?? null,
      entry.stake ?? null,
      entry.originalPayout ?? null,
      entry.recalculatedPayout ?? null,
      entry.voidReason ?? null,
      entry.settlementReason ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ]
  );
}

/* ------------------------------------------------------------------ */
/* Recalculate odds after legs are voided                              */
/* ------------------------------------------------------------------ */

/**
 * Recalculate total_odds for a sportsbook bet from its non-void legs.
 * Voided legs contribute odds = 1.00 to the product.
 * Returns the new effective total odds.
 */
export async function recalculateOdds(
  client: PoolClient,
  betId: string
): Promise<number> {
  const legs = await client.query<{
    odds_at_placement: string;
    settled_odds: string | null;
    status: string;
    selection_status: string | null;
  }>(
    `SELECT odds_at_placement, settled_odds, status, selection_status
       FROM sportsbook_bet_legs
      WHERE bet_id = $1`,
    [betId]
  );

  let product = 1;
  for (const leg of legs.rows) {
    const isVoided =
      leg.selection_status === 'voided' ||
      leg.status === 'void';
    const odds = isVoided ? 1.0 : Number(leg.settled_odds ?? leg.odds_at_placement);
    product *= odds;
  }

  const rounded = Math.round(product * 1e8) / 1e8;

  await client.query(
    `UPDATE sportsbook_bets
        SET recalculated_odds = $1, updated_at = now()
      WHERE id = $2`,
    [rounded, betId]
  );

  return rounded;
}

/* ------------------------------------------------------------------ */
/* Credit wallet helper (mirrors matches.module.ts)                    */
/* ------------------------------------------------------------------ */

export async function creditWallet(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    currency: string;
    betId: string;
    stake: number;
    credit: number;
    txType: 'bet_win' | 'bet_refund';
    reason: string;
  }
): Promise<void> {
  const wallet = await client.query<{
    id: string;
    balance: string;
    locked_balance: string;
    withdrawable_balance: string;
    payable_balance: string;
  }>(
    `SELECT id, balance::text, locked_balance::text,
            withdrawable_balance::text, payable_balance::text
       FROM wallets
      WHERE user_id = $1 AND currency = $2
      ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
    [params.userId, params.currency]
  );
  const w = wallet.rows[0];
  if (!w) return;

  const before = Number(w.balance);
  // Per platform rule: winnings (bet_win) go to the Withdrawable bucket so
  // the user can cash them out (after KYC / pending-period rules). Refunds
  // return the stake to the Deductable bucket so it can be staked again.
  // The legacy `balance` column (Deductable) is kept in sync for backwards
  // compatibility with existing bet-placement code that debits from it.
  const isWin = params.txType === 'bet_win';
  const newBalance = Math.round((before + (isWin ? 0 : params.credit)) * 100) / 100;
  const newLocked = Math.round(
    Math.max(0, Number(w.locked_balance) - params.stake) * 100
  ) / 100;
  const newWithdrawable = Math.round(
    (Number(w.withdrawable_balance) + (isWin ? params.credit : 0)) * 100
  ) / 100;
  // Payable bucket is where pending winnings live before settlement; here
  // the bet is already settled, so we don't credit payable — we move
  // straight to withdrawable. Kept for accounting transparency in metadata.
  const newPayable = Number(w.payable_balance);

  await client.query(
    `UPDATE wallets
        SET balance              = $1,
            locked_balance       = $2,
            withdrawable_balance = $3,
            payable_balance      = $4,
            updated_at           = now()
      WHERE id = $5`,
    [newBalance, newLocked, newWithdrawable, newPayable, w.id]
  );

  await client.query(
    `INSERT INTO transactions
       (tenant_id, user_id, wallet_id, type, currency, amount,
        before_balance, after_balance, status, reference, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10::jsonb)`,
    [
      params.tenantId,
      params.userId,
      w.id,
      params.txType,
      params.currency,
      params.credit,
      before,
      isWin ? newWithdrawable : newBalance,
      `settlement:${params.betId}`,
      JSON.stringify({
        reason: params.reason,
        bet_id: params.betId,
        bucket: isWin ? 'withdrawable' : 'deductable',
        withdrawable_balance: newWithdrawable.toFixed(2),
        payable_balance: newPayable.toFixed(2),
      }),
    ]
  );

  emitWalletUpdated(params.tenantId, params.userId, {
    reason: params.txType === 'bet_win' ? 'bet_won' : 'bet_refunded',
    wallet: {
      id: w.id,
      currency: params.currency,
      balance: newBalance.toFixed(2),
      locked_balance: newLocked.toFixed(2),
      withdrawable_balance: newWithdrawable.toFixed(2),
      payable_balance: newPayable.toFixed(2),
    },
  });
}

/* ------------------------------------------------------------------ */
/* Release locked balance (for lost bets)                              */
/* ------------------------------------------------------------------ */

export async function releaseLockedBalance(
  client: PoolClient,
  params: { userId: string; currency: string; stake: number }
): Promise<void> {
  await client.query(
    `UPDATE wallets
        SET locked_balance = GREATEST(0, locked_balance - $1::numeric),
            updated_at = now()
      WHERE user_id = $2 AND currency = $3`,
    [params.stake, params.userId, params.currency]
  );
}

/* ------------------------------------------------------------------ */
/* Core: settle a bet from its legs                                    */
/* ------------------------------------------------------------------ */

/**
 * Settle a sportsbook bet whose legs are all in a terminal state.
 * Determines won/lost/fully_voided outcome, credits wallet, updates
 * settlement_status and status columns.
 */
export async function settleBetFromLegs(
  client: PoolClient,
  params: {
    tenantId: string;
    betId: string;
    actorId: string | null;
    reason: string;
  }
): Promise<{ status: string; credit: number }> {
  const betRow = await client.query<SettlementBet>(
    `SELECT id, tenant_id, user_id, stake::text, currency,
            total_odds, original_odds, potential_payout::text,
            actual_payout, status, settlement_status,
            postponed_at, postpone_wait_hours, review_required, bet_type
       FROM sportsbook_bets WHERE id = $1 FOR UPDATE`,
    [params.betId]
  );
  const bet = betRow.rows[0];
  if (!bet) throw new Error(`Bet ${params.betId} not found`);

  const stake = Number(bet.stake);
  const currency = bet.currency;

  const legs = await client.query<{
    status: string;
    selection_status: string | null;
    odds_at_placement: string;
    settled_odds: string | null;
  }>(
    `SELECT status, selection_status, odds_at_placement::text, settled_odds::text
       FROM sportsbook_bet_legs WHERE bet_id = $1`,
    [params.betId]
  );

  if (legs.rows.length === 0) {
    throw new Error(`Bet ${params.betId} has no legs`);
  }

  const anyLost = legs.rows.some(
    (l) => l.status === 'lost' || l.selection_status === 'lost'
  );
  const allVoided = legs.rows.every(
    (l) => l.status === 'void' || l.selection_status === 'voided'
  );
  const anyPending = legs.rows.some(
    (l) =>
      (l.status === 'pending' || l.status === null) &&
      l.selection_status !== 'voided'
  );

  if (anyPending) {
    throw new Error(`Bet ${params.betId} still has pending legs — cannot settle`);
  }

  let newStatus: string;
  let settlementStatus: SettlementStatus;
  let credit = 0;

  if (anyLost) {
    newStatus = 'lost';
    settlementStatus = 'lost';
    await releaseLockedBalance(client, {
      userId: bet.user_id,
      currency,
      stake,
    });
  } else if (allVoided) {
    newStatus = 'void';
    settlementStatus = 'fully_voided';
    credit = stake;
    await creditWallet(client, {
      tenantId: params.tenantId,
      userId: bet.user_id,
      currency,
      betId: params.betId,
      stake,
      credit,
      txType: 'bet_refund',
      reason: 'fully_voided',
    });
  } else {
    // Won — compute from non-void legs
    const effectiveOdds = legs.rows.reduce((acc, l) => {
      const isVoid = l.status === 'void' || l.selection_status === 'voided';
      return acc * (isVoid ? 1.0 : Number(l.settled_odds ?? l.odds_at_placement));
    }, 1);

    const gross = Math.round(stake * effectiveOdds * 100) / 100;
    credit = gross;
    newStatus = 'won';
    settlementStatus =
      legs.rows.some(
        (l) => l.status === 'void' || l.selection_status === 'voided'
      )
        ? 'partially_voided'
        : 'won';

    await creditWallet(client, {
      tenantId: params.tenantId,
      userId: bet.user_id,
      currency,
      betId: params.betId,
      stake,
      credit,
      txType: 'bet_win',
      reason: params.reason,
    });
  }

  await client.query(
    `UPDATE sportsbook_bets
        SET status = $1,
            settlement_status = $2,
            actual_payout = $3,
            recalculated_odds = $4,
            settled_at = now(),
            settled_by = $5,
            settlement_reason = $6,
            updated_at = now()
      WHERE id = $7`,
    [
      newStatus,
      settlementStatus,
      credit > 0 ? credit : null,
      await recalculateOdds(client, params.betId),
      params.actorId,
      params.reason,
      params.betId,
    ]
  );

  await writeAuditLog(client, {
    tenantId: params.tenantId,
    betId: params.betId,
    actorId: params.actorId,
    action: 'settle',
    oldStatus: bet.settlement_status ?? bet.status,
    newStatus: settlementStatus,
    stake,
    originalPayout: Number(bet.potential_payout),
    recalculatedPayout: credit,
    settlementReason: params.reason,
  });

  emitToUser(params.tenantId, bet.user_id, 'bet:settled', {
    bet_id: params.betId,
    status: newStatus,
    settlement_status: settlementStatus,
    payout: credit,
    currency,
  });

  return { status: settlementStatus, credit };
}

/* ------------------------------------------------------------------ */
/* Void a single selection / leg                                        */
/* ------------------------------------------------------------------ */

export async function voidSelection(
  client: PoolClient,
  params: {
    tenantId: string;
    betId: string;
    legId: string;
    reason: string;
    actorId: string | null;
  }
): Promise<void> {
  const legRow = await client.query<SettlementLeg>(
    `SELECT id, bet_id, selection_id, odds_at_placement::text,
            original_odds, settled_odds, status, selection_status, void_reason
       FROM sportsbook_bet_legs
      WHERE id = $1 AND bet_id = $2 FOR UPDATE`,
    [params.legId, params.betId]
  );
  const leg = legRow.rows[0];
  if (!leg) throw new Error(`Leg ${params.legId} not found`);

  await client.query(
    `UPDATE sportsbook_bet_legs
        SET status = 'void',
            selection_status = 'voided',
            settled_odds = 1.00,
            void_reason = $1,
            settled_at = now()
      WHERE id = $2`,
    [params.reason, params.legId]
  );

  await writeAuditLog(client, {
    tenantId: params.tenantId,
    betId: params.betId,
    legId: params.legId,
    actorId: params.actorId,
    action: 'void_selection',
    oldStatus: leg.selection_status ?? leg.status,
    newStatus: 'voided',
    oldOdds: Number(leg.original_odds ?? leg.odds_at_placement),
    newOdds: 1.0,
    voidReason: params.reason,
  });

  // Update bet settlement_status to partially_voided if still pending
  await client.query(
    `UPDATE sportsbook_bets
        SET settlement_status = CASE
              WHEN settlement_status IN ('pending','live','postponed','awaiting_settlement') THEN 'partially_voided'
              ELSE settlement_status
            END,
            updated_at = now()
      WHERE id = $1`,
    [params.betId]
  );
}

/* ------------------------------------------------------------------ */
/* Mark an event as postponed and flag affected tickets               */
/* ------------------------------------------------------------------ */

export async function handleEventPostponed(params: {
  tenantId: string;
  eventId: string;
  waitHours: number;
  actorId: string | null;
}): Promise<number> {
  return withTenantClient(
    { tenantId: params.tenantId, bypassRls: true },
    async (client) => {
      // Update event status
      await client.query(
        `UPDATE sports_events SET status = 'postponed', updated_at = now()
          WHERE id = $1 AND tenant_id = $2`,
        [params.eventId, params.tenantId]
      );

      // Get markets for this event
      const markets = await client.query<{ id: string }>(
        `SELECT id FROM sports_markets WHERE event_id = $1`,
        [params.eventId]
      );
      const marketIds = markets.rows.map((m) => m.id);
      if (marketIds.length === 0) return 0;

      // Find pending legs for these markets and mark them postponed
      await client.query(
        `UPDATE sportsbook_bet_legs
            SET selection_status = 'postponed',
                void_reason = 'event_postponed'
          WHERE selection_id IN (
            SELECT id FROM sports_selections WHERE market_id = ANY($1::uuid[])
          )
            AND status = 'pending'`,
        [marketIds]
      );

      // Mark affected bets as postponed
      const affectedBets = await client.query<{
        id: string;
        user_id: string;
        stake: string;
        currency: string;
      }>(
        `UPDATE sportsbook_bets b
            SET settlement_status = 'postponed',
                postponed_at = now(),
                postpone_wait_hours = $1,
                updated_at = now()
           FROM sportsbook_bet_legs l
           JOIN sports_selections sel ON sel.id = l.selection_id
          WHERE l.bet_id = b.id
            AND sel.market_id = ANY($2::uuid[])
            AND b.status = 'pending'
            AND b.settlement_status NOT IN ('won','lost','fully_voided','refunded','cancelled')
          RETURNING b.id, b.user_id, b.stake::text, b.currency`,
        [params.waitHours, marketIds]
      );

      for (const bet of affectedBets.rows) {
        await writeAuditLog(client, {
          tenantId: params.tenantId,
          betId: bet.id,
          actorId: params.actorId,
          action: 'event_postponed',
          oldStatus: 'pending',
          newStatus: 'postponed',
          settlementReason: `Event postponed. Waiting ${params.waitHours}h.`,
        });
        emitToUser(params.tenantId, bet.user_id, 'bet:postponed', {
          bet_id: bet.id,
          wait_hours: params.waitHours,
        });
      }

      return affectedBets.rows.length;
    }
  );
}

/* ------------------------------------------------------------------ */
/* Handle cancelled event — void all selections                        */
/* ------------------------------------------------------------------ */

export async function handleEventCancelled(params: {
  tenantId: string;
  eventId: string;
  actorId: string | null;
}): Promise<{ settled: number }> {
  return withTenantClient(
    { tenantId: params.tenantId, bypassRls: true },
    async (client) => {
      await client.query(
        `UPDATE sports_events SET status = 'cancelled', updated_at = now()
          WHERE id = $1`,
        [params.eventId]
      );

      const markets = await client.query<{ id: string }>(
        `SELECT id FROM sports_markets WHERE event_id = $1`,
        [params.eventId]
      );
      const marketIds = markets.rows.map((m) => m.id);
      if (marketIds.length === 0) return { settled: 0 };

      // Void all pending legs
      await client.query(
        `UPDATE sportsbook_bet_legs
            SET status = 'void',
                selection_status = 'voided',
                settled_odds = 1.00,
                void_reason = 'event_cancelled',
                settled_at = now()
          WHERE selection_id IN (
            SELECT id FROM sports_selections WHERE market_id = ANY($1::uuid[])
          )
            AND status = 'pending'`,
        [marketIds]
      );

      // Find bets where all legs now have an outcome and settle them
      const bets = await client.query<{
        id: string;
        user_id: string;
        stake: string;
        currency: string;
        pending_legs: string;
      }>(
        `SELECT b.id, b.user_id, b.stake::text, b.currency,
                COUNT(l.id) FILTER (WHERE l.status = 'pending') AS pending_legs
           FROM sportsbook_bets b
           JOIN sportsbook_bet_legs l ON l.bet_id = b.id
          WHERE l.selection_id IN (
            SELECT id FROM sports_selections WHERE market_id = ANY($1::uuid[])
          )
            AND b.status = 'pending'
          GROUP BY b.id, b.user_id, b.stake, b.currency`,
        [marketIds]
      );

      let settled = 0;
      for (const bet of bets.rows) {
        if (Number(bet.pending_legs) > 0) continue;
        try {
          await settleBetFromLegs(client, {
            tenantId: params.tenantId,
            betId: bet.id,
            actorId: params.actorId,
            reason: 'event_cancelled',
          });
          settled++;
        } catch (err) {
          logger.warn({ err, betId: bet.id }, 'auto-settle failed for cancelled event');
          await client.query(
            `UPDATE sportsbook_bets SET settlement_status = 'error',
              settlement_error = $1, review_required = true WHERE id = $2`,
            [String(err instanceof Error ? err.message : err), bet.id]
          );
        }
      }

      return { settled };
    }
  );
}

/* ------------------------------------------------------------------ */
/* Expire postponed selections (called by scheduler)                  */
/* ------------------------------------------------------------------ */

export async function expirePostponedSelections(params: {
  tenantId: string;
  actorId: string | null;
}): Promise<number> {
  return withTenantClient(
    { tenantId: params.tenantId, bypassRls: true },
    async (client) => {
      // Find postponed bets whose waiting period has elapsed
      const expired = await client.query<{
        id: string;
        user_id: string;
        stake: string;
        currency: string;
      }>(
        `SELECT id, user_id, stake::text, currency
           FROM sportsbook_bets
          WHERE tenant_id = $1
            AND settlement_status = 'postponed'
            AND postponed_at IS NOT NULL
            AND postponed_at + (postpone_wait_hours || ' hours')::interval < now()`,
        [params.tenantId]
      );

      let count = 0;
      for (const bet of expired.rows) {
        try {
          // Void all still-postponed legs (convert odds to 1.00)
          await client.query(
            `UPDATE sportsbook_bet_legs
                SET status = 'void',
                    selection_status = 'voided',
                    settled_odds = 1.00,
                    void_reason = 'postponement_expired'
              WHERE bet_id = $1
                AND selection_status = 'postponed'`,
            [bet.id]
          );

          // Settle remaining pending legs that belong to concluded events
          await client.query(
            `UPDATE sportsbook_bet_legs l
                SET status = sel.result,
                    selection_status = CASE sel.result
                      WHEN 'won' THEN 'won'
                      WHEN 'lost' THEN 'lost'
                      ELSE 'voided'
                    END,
                    settled_at = now()
               FROM sports_selections sel
              WHERE l.selection_id = sel.id
                AND l.bet_id = $1
                AND l.status = 'pending'
                AND sel.result IS NOT NULL`,
            [bet.id]
          );

          await settleBetFromLegs(client, {
            tenantId: params.tenantId,
            betId: bet.id,
            actorId: params.actorId,
            reason: 'postponement_expired_auto_settle',
          });
          count++;
        } catch (err) {
          logger.error(
            { err, betId: bet.id, tenantId: params.tenantId },
            'failed to auto-settle postponed bet'
          );
          await client.query(
            `UPDATE sportsbook_bets
                SET settlement_status = 'error',
                    settlement_error = $1,
                    review_required = true
              WHERE id = $2`,
            [String(err instanceof Error ? err.message : err), bet.id]
          );
        }
      }

      return count;
    }
  );
}

/* ------------------------------------------------------------------ */
/* List unsettled / error tickets for the admin UI                     */
/* ------------------------------------------------------------------ */

export async function listSettlementTickets(params: {
  tenantId: string;
  filter: 'unsettled' | 'errors' | 'all';
  page: number;
  limit: number;
}): Promise<{
  items: unknown[];
  total: number;
  page: number;
  limit: number;
}> {
  return withTenantClient(
    { tenantId: params.tenantId, bypassRls: true },
    async (client) => {
      const offset = (params.page - 1) * params.limit;

      let whereClause: string;
      if (params.filter === 'unsettled') {
        whereClause = `b.tenant_id = $1
          AND b.status = 'pending'
          AND (b.settlement_status IS NULL OR b.settlement_status NOT IN
            ('won','lost','fully_voided','refunded','cancelled','error'))`;
      } else if (params.filter === 'errors') {
        whereClause = `b.tenant_id = $1
          AND (b.review_required = true OR b.settlement_status = 'error')`;
      } else {
        whereClause = `b.tenant_id = $1
          AND b.status NOT IN ('won','lost','void','cashout')`;
      }

      const countRow = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total
           FROM sportsbook_bets b
          WHERE ${whereClause}`,
        [params.tenantId]
      );

      const rows = await client.query(
        `SELECT b.id, b.tenant_id, b.user_id, b.channel, b.bet_type,
                b.stake::text, b.currency, b.potential_payout::text,
                b.actual_payout::text, b.status, b.settlement_status,
                b.void_reason, b.settlement_reason, b.settlement_error,
                b.original_odds::text, b.recalculated_odds::text,
                b.total_odds::text, b.postponed_at, b.postpone_wait_hours,
                b.review_required, b.placed_at, b.settled_at, b.updated_at,
                b.coupon_code,
                u.email AS user_email, u.phone AS user_phone,
                COUNT(l.id) AS total_legs,
                COUNT(l.id) FILTER (WHERE l.status = 'pending') AS pending_legs,
                COUNT(l.id) FILTER (WHERE l.status = 'void' OR l.selection_status = 'voided') AS void_legs
           FROM sportsbook_bets b
           LEFT JOIN users u ON u.id = b.user_id
           LEFT JOIN sportsbook_bet_legs l ON l.bet_id = b.id
          WHERE ${whereClause}
          GROUP BY b.id, u.email, u.phone
          ORDER BY b.updated_at DESC
          LIMIT $2 OFFSET $3`,
        [params.tenantId, params.limit, offset]
      );

      return {
        items: rows.rows,
        total: Number(countRow.rows[0]?.total ?? 0),
        page: params.page,
        limit: params.limit,
      };
    }
  );
}

/* ------------------------------------------------------------------ */
/* Get single ticket with full legs detail                             */
/* ------------------------------------------------------------------ */

export async function getSettlementTicket(params: {
  tenantId: string;
  betId: string;
}): Promise<unknown> {
  return withTenantClient(
    { tenantId: params.tenantId, bypassRls: true },
    async (client) => {
      const betRow = await client.query(
        `SELECT b.id, b.tenant_id, b.user_id, b.channel, b.bet_type,
                b.stake::text, b.currency, b.potential_payout::text,
                b.actual_payout::text, b.status, b.settlement_status,
                b.void_reason, b.settlement_reason, b.settlement_error,
                b.original_odds::text, b.recalculated_odds::text,
                b.total_odds::text, b.postponed_at, b.postpone_wait_hours,
                b.review_required, b.placed_at, b.settled_at, b.updated_at,
                b.coupon_code,
                u.email AS user_email, u.phone AS user_phone
           FROM sportsbook_bets b
           LEFT JOIN users u ON u.id = b.user_id
          WHERE b.id = $1 AND b.tenant_id = $2`,
        [params.betId, params.tenantId]
      );
      const bet = betRow.rows[0];
      if (!bet) return null;

      const legsRow = await client.query(
        `SELECT l.id, l.selection_id, l.odds_at_placement::text,
                l.original_odds::text, l.settled_odds::text,
                l.status, l.selection_status, l.void_reason, l.settled_at,
                sel.label AS selection_label, sel.result AS selection_result,
                m.label AS market_label, m.market_type, m.status AS market_status,
                e.home_team, e.away_team, e.league, e.sport,
                e.starts_at, e.status AS event_status
           FROM sportsbook_bet_legs l
           LEFT JOIN sports_selections sel ON sel.id = l.selection_id
           LEFT JOIN sports_markets m ON m.id = sel.market_id
           LEFT JOIN sports_events e ON e.id = m.event_id
          WHERE l.bet_id = $1
          ORDER BY l.created_at`,
        [params.betId]
      );

      const auditRow = await client.query(
        `SELECT id, actor_id, action, old_status, new_status,
                old_odds::text, new_odds::text, void_reason,
                settlement_reason, metadata, created_at
           FROM settlement_audit_logs
          WHERE bet_id = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [params.betId]
      );

      return {
        ...bet,
        legs: legsRow.rows,
        audit: auditRow.rows,
      };
    }
  );
}
