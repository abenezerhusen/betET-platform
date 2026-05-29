/**
 * Section 18 — admin endpoints that drive match lifecycle.
 *
 *   PATCH /api/admin/matches/:id/odds    (18E)
 *     Bulk-update selection odds for a single match. Emits one
 *     `odds:update` event to the whole tenant so every live betslip
 *     refreshes without a page reload.
 *
 *   POST  /api/admin/matches/:id/result  (18C)
 *     Finalises a match by storing the score, auto-resolves any
 *     selections whose outcome is implied by the score (1X2,
 *     Over/Under markets where lookup data is on metadata.line), and
 *     settles every sportsbook bet whose legs all reach a final state.
 *     Winning users are credited with the final payout including
 *     winning-tax handling, voided legs unlock the stake from
 *     locked_balance, and per-user WS notifications fire.
 *
 *   POST  /api/admin/matches/:id/status  (helper)
 *     Locks/unlocks bet placement before kickoff (status='live').
 *
 *   The handlers are written so they REUSE the existing
 *   sports_events / sports_markets / sports_selections schema; no
 *   schema changes are required.
 */

import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import {
  Events,
  emitBetSettled,
  emitToTenant,
  emitWalletUpdated,
} from '../../../realtime/socket';
import { resetUserStreak } from '../streaks/streaks.module';
import { accrueAffiliateOnBetSettle } from '../../promotions/affiliate-hooks';
import { applyLossCashback } from '../../promotions/loss-cashback';
import {
  getAdminScope,
  getIp,
  getUa,
} from '../admin-shared';
import {
  applyWinningTax,
  loadBettingConfig,
} from '../../bets/betting-config';

/* -------------------------------------------------------------------------- */
/* DTOs                                                                       */
/* -------------------------------------------------------------------------- */

const idParam = z.object({ id: z.string().uuid() });

const oddsUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        selection_id: z.string().uuid(),
        new_odds: z.number().gt(1).max(10_000),
      })
    )
    .min(1)
    .max(200),
});

const matchResultSchema = z.object({
  home_score: z.number().int().nonnegative(),
  away_score: z.number().int().nonnegative(),
  status: z
    .enum(['finished', 'cancelled', 'postponed'])
    .default('finished'),
  /** Optional per-selection manual overrides for non-1X2 markets where
   *  the score alone does not imply an outcome (e.g. "Both Teams To
   *  Score", "Correct Score"). */
  selection_results: z
    .array(
      z.object({
        selection_id: z.string().uuid(),
        result: z.enum(['won', 'lost', 'void']),
      })
    )
    .default([]),
});

const matchStatusSchema = z.object({
  status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled']),
});

/* -------------------------------------------------------------------------- */
/* Selection auto-resolution                                                  */
/* -------------------------------------------------------------------------- */

interface SelectionRow {
  id: string;
  market_id: string;
  market_type: string;
  market_label: string;
  selection_label: string;
  odds_decimal: number;
  result: 'won' | 'lost' | 'void' | null;
}

function pickWinningLabelFor1x2(home: number, away: number): '1' | 'x' | '2' {
  if (home > away) return '1';
  if (away > home) return '2';
  return 'x';
}

/**
 * Best-effort auto-resolver for the most common markets. Returns a map
 * { selection_id -> 'won' | 'lost' | 'void' } based on the final score.
 *
 *   - 1X2 / Match Result:
 *       label "1" / "home" → home_score > away_score
 *       label "x" / "draw" → equal
 *       label "2" / "away" → away_score > home_score
 *
 *   - Over/Under N.N (market_type 'over_under_X' OR label 'Over/Under N.N'):
 *       parse the line from market_type or label, total = home+away,
 *       'over' wins if total > line, 'under' wins if total < line,
 *       push (total == line) returns 'void'.
 *
 *   - BTTS / Both Teams To Score:
 *       'yes' wins if both > 0, else 'no' wins.
 *
 *   - Anything else: not auto-resolved; caller must specify via
 *     selection_results[].
 */
function autoResolveSelections(
  selections: SelectionRow[],
  home: number,
  away: number,
  cancelled: boolean
): Map<string, 'won' | 'lost' | 'void'> {
  const out = new Map<string, 'won' | 'lost' | 'void'>();
  if (cancelled) {
    for (const s of selections) out.set(s.id, 'void');
    return out;
  }
  const winner1x2 = pickWinningLabelFor1x2(home, away);

  for (const s of selections) {
    if (s.result) continue; // already settled by admin
    const mtype = (s.market_type ?? '').toLowerCase();
    const mlabel = (s.market_label ?? '').toLowerCase();
    const slabel = (s.selection_label ?? '').toLowerCase();

    // 1X2 / Match Result.
    if (
      mtype === '1x2' ||
      mtype === 'match_result' ||
      mlabel.includes('match result') ||
      mlabel.includes('full time result') ||
      mlabel === '1x2'
    ) {
      const isHome = slabel.startsWith('1') || slabel.startsWith('home');
      const isDraw = slabel.startsWith('x') || slabel.startsWith('draw');
      const isAway = slabel.startsWith('2') || slabel.startsWith('away');
      const matches =
        (isHome && winner1x2 === '1') ||
        (isDraw && winner1x2 === 'x') ||
        (isAway && winner1x2 === '2');
      if (isHome || isDraw || isAway) {
        out.set(s.id, matches ? 'won' : 'lost');
        continue;
      }
    }

    // Over/Under.
    const lineMatch =
      mtype.match(/over_?under_?(\d+(?:[._]\d+)?)/) ??
      mlabel.match(/over\s*\/?\s*under\s+(\d+(?:\.\d+)?)/i);
    if (lineMatch) {
      const line = Number(lineMatch[1].replace('_', '.'));
      if (Number.isFinite(line)) {
        const total = home + away;
        const isOver = slabel.includes('over');
        const isUnder = slabel.includes('under');
        if (isOver || isUnder) {
          if (Math.abs(total - line) < 1e-9) {
            out.set(s.id, 'void');
          } else {
            const overWins = total > line;
            out.set(s.id, (isOver && overWins) || (isUnder && !overWins) ? 'won' : 'lost');
          }
          continue;
        }
      }
    }

    // BTTS / Both Teams to Score.
    if (
      mtype === 'btts' ||
      mlabel.includes('both teams to score') ||
      mlabel.includes('btts')
    ) {
      const yes = slabel.startsWith('y') || slabel === 'yes';
      const no = slabel.startsWith('n') || slabel === 'no';
      if (yes || no) {
        const bothScored = home > 0 && away > 0;
        out.set(s.id, (yes && bothScored) || (no && !bothScored) ? 'won' : 'lost');
        continue;
      }
    }

    // Anything else: leave for manual settlement.
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* PATCH /matches/:id/odds                                                    */
/* -------------------------------------------------------------------------- */

async function updateOdds(
  req: Request,
  matchId: string,
  body: z.infer<typeof oddsUpdateSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const ev = await client.query<{ id: string; status: string; tenant_id: string }>(
        `SELECT id, status, tenant_id FROM sports_events WHERE id = $1`,
        [matchId]
      );
      if (!ev.rows[0]) throw new NotFoundError('Match not found');
      const event = ev.rows[0];

      if (event.status === 'finished' || event.status === 'cancelled') {
        throw new BadRequestError(
          `Cannot update odds for a ${event.status} match`,
          { reason: 'match_finalised' }
        );
      }

      // Ensure every selection belongs to a market on this event.
      const selectionIds = body.updates.map((u) => u.selection_id);
      const owns = await client.query<{ id: string }>(
        `SELECT s.id
           FROM sports_selections s
           JOIN sports_markets m ON m.id = s.market_id
          WHERE s.id = ANY($1::uuid[]) AND m.event_id = $2`,
        [selectionIds, matchId]
      );
      if (owns.rows.length !== selectionIds.length) {
        throw new BadRequestError(
          'One or more selections do not belong to this match',
          { reason: 'selection_event_mismatch' }
        );
      }

      const updates: Array<{
        selection_id: string;
        old_odds: number;
        new_odds: number;
      }> = [];
      for (const u of body.updates) {
        // Capture the OLD value before the UPDATE so the audit trail and
        // the WS broadcast can show both sides of the change.
        const prev = await client.query<{ odds_decimal: string }>(
          `SELECT odds_decimal::text FROM sports_selections WHERE id = $1`,
          [u.selection_id]
        );
        const oldOdds = Number(prev.rows[0]?.odds_decimal ?? 0);
        const r = await client.query(
          `UPDATE sports_selections
              SET odds_decimal = $1, updated_at = now()
            WHERE id = $2`,
          [u.new_odds, u.selection_id]
        );
        if (r.rowCount && r.rowCount > 0) {
          updates.push({
            selection_id: u.selection_id,
            old_odds: oldOdds,
            new_odds: u.new_odds,
          });
        }
      }

      // One bulk broadcast — every live betslip viewer recomputes totals.
      emitToTenant(event.tenant_id, Events.ODDS_UPDATE, {
        match_id: matchId,
        event_id: matchId,
        updates: updates.map((u) => ({
          selection_id: u.selection_id,
          old_odds: u.old_odds,
          new_odds: u.new_odds,
        })),
      });

      void tryAudit({
        tenantId: event.tenant_id,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.matches.odds.update',
        resource: 'sports_selections',
        resourceId: matchId,
        payload: { updates },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      });

      return { ok: true, match_id: matchId, updated: updates.length };
    }
  );
}

/* -------------------------------------------------------------------------- */
/* POST /matches/:id/status                                                   */
/* -------------------------------------------------------------------------- */

async function setMatchStatus(
  req: Request,
  matchId: string,
  body: z.infer<typeof matchStatusSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query<{ id: string; tenant_id: string; status: string }>(
        `UPDATE sports_events
            SET status = $1, updated_at = now()
          WHERE id = $2
          RETURNING id, tenant_id, status`,
        [body.status, matchId]
      );
      if (!r.rows[0]) throw new NotFoundError('Match not found');

      // Lock all markets on this match when going live, so no more
      // pre-match selections can be added during in-play. Live markets
      // remain bettable via the dedicated live UI.
      if (body.status === 'live') {
        await client.query(
          `UPDATE sports_markets
              SET status = 'locked', updated_at = now()
            WHERE event_id = $1 AND status = 'open'`,
          [matchId]
        );
      }
      emitToTenant(r.rows[0].tenant_id, Events.MATCH_STATUS, {
        match_id: matchId,
        status: body.status,
      });
      return r.rows[0];
    }
  );
}

/* -------------------------------------------------------------------------- */
/* POST /matches/:id/result — auto-settle bets                                */
/* -------------------------------------------------------------------------- */

async function setMatchResult(
  req: Request,
  matchId: string,
  body: z.infer<typeof matchResultSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const ev = await client.query<{
        id: string;
        tenant_id: string;
        status: string;
        home_team: string;
        away_team: string;
      }>(
        `SELECT id, tenant_id, status, home_team, away_team
           FROM sports_events
          WHERE id = $1
          FOR UPDATE`,
        [matchId]
      );
      const event = ev.rows[0];
      if (!event) throw new NotFoundError('Match not found');
      const tenantId = event.tenant_id;

      // 1. Finalise event row.
      await client.query(
        `UPDATE sports_events
            SET status = $1, home_score = $2, away_score = $3, updated_at = now()
          WHERE id = $4`,
        [body.status, body.home_score, body.away_score, matchId]
      );

      // 2. Gather selections under this match.
      const sels = await client.query<SelectionRow>(
        `SELECT s.id, s.market_id, m.market_type, m.label AS market_label,
                s.label AS selection_label, s.odds_decimal::float AS odds_decimal,
                s.result
           FROM sports_selections s
           JOIN sports_markets m ON m.id = s.market_id
          WHERE m.event_id = $1`,
        [matchId]
      );

      const cancelled = body.status !== 'finished';
      const autoMap = autoResolveSelections(
        sels.rows,
        body.home_score,
        body.away_score,
        cancelled
      );
      // Apply admin overrides last (they win over auto-resolution).
      for (const o of body.selection_results ?? []) {
        autoMap.set(o.selection_id, o.result);
      }

      // 3. Write selection results + bet legs.
      const settledSelections: string[] = [];
      for (const [selId, res] of autoMap) {
        await client.query(
          `UPDATE sports_selections
              SET result = $1, updated_at = now()
            WHERE id = $2 AND result IS NULL`,
          [res, selId]
        );
        await client.query(
          `UPDATE sportsbook_bet_legs
              SET status = $1, settled_at = now()
            WHERE selection_id = $2 AND status = 'pending'`,
          [res, selId]
        );
        settledSelections.push(selId);
      }

      // 4. Mark markets that have NO remaining unresolved selection as settled.
      await client.query(
        `UPDATE sports_markets m
            SET status = 'settled', settled_at = now(), updated_at = now()
          WHERE m.event_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM sports_selections s
               WHERE s.market_id = m.id AND s.result IS NULL
            )`,
        [matchId]
      );

      // 5. Find every bet that touches any settled selection AND now has
      //    zero pending legs — those are ready to be settled.
      const cfg = await loadBettingConfig(client, tenantId);

      const readyBets = await client.query<{
        bet_id: string;
        user_id: string;
        stake: string;
        currency: string;
        potential_payout: string;
        total_odds: string;
        bonus_funded: boolean;
        any_lost: boolean;
        any_void: boolean;
        total_legs: number;
        wallet_id: string | null;
      }>(
        `WITH touched AS (
            SELECT DISTINCT l.bet_id
              FROM sportsbook_bet_legs l
              JOIN sports_selections s ON s.id = l.selection_id
             WHERE s.market_id IN (SELECT id FROM sports_markets WHERE event_id = $1)
          ),
          summary AS (
            SELECT l.bet_id,
                   COUNT(*)::int AS total_legs,
                   COUNT(*) FILTER (WHERE l.status = 'pending')::int AS pending_legs,
                   BOOL_OR(l.status = 'lost') AS any_lost,
                   BOOL_OR(l.status = 'void') AS any_void
              FROM sportsbook_bet_legs l
             WHERE l.bet_id IN (SELECT bet_id FROM touched)
             GROUP BY l.bet_id
          )
          SELECT b.id          AS bet_id,
                 b.user_id,
                 b.stake::text AS stake,
                 b.currency,
                 b.potential_payout::text AS potential_payout,
                 b.total_odds::text       AS total_odds,
                 COALESCE((b.metadata->>'balance_source') = 'bonus', false) AS bonus_funded,
                 s.any_lost,
                 s.any_void,
                 s.total_legs,
                 (SELECT id FROM wallets w
                   WHERE w.user_id = b.user_id AND w.currency = b.currency
                   ORDER BY w.created_at ASC LIMIT 1) AS wallet_id
            FROM sportsbook_bets b
            JOIN summary s ON s.bet_id = b.id
           WHERE s.pending_legs = 0
             AND b.status = 'pending'
             AND b.tenant_id = $2
           FOR UPDATE OF b`,
        [matchId, tenantId]
      );

      const settlements: Array<{
        bet_id: string;
        user_id: string;
        status: string;
        net_payout: number;
        tax_amount: number;
        gross_payout: number;
      }> = [];

      for (const r of readyBets.rows) {
        const stake = Number(r.stake);
        const potential = Number(r.potential_payout);

        let status: 'won' | 'lost' | 'void' = 'lost';
        let netPay = 0;
        let taxAmt = 0;
        let credit = 0;

        if (r.any_lost) {
          status = 'lost';
        } else if (r.any_void && r.total_legs === 1) {
          // Single-leg bet that went void: refund the stake.
          status = 'void';
          credit = stake;
        } else {
          // All legs won (with possibly some void → recompute odds).
          const winningLegs = await client.query<{ odds: string }>(
            `SELECT odds_at_placement::text AS odds
               FROM sportsbook_bet_legs
              WHERE bet_id = $1 AND status = 'won'`,
            [r.bet_id]
          );
          if (winningLegs.rows.length === 0) {
            // Only void legs left — refund.
            status = 'void';
            credit = stake;
          } else {
            const effOdds = winningLegs.rows.reduce(
              (acc, w) => acc * Number(w.odds),
              1
            );
            const gross = Math.round(stake * effOdds * 100) / 100;
            const taxed = applyWinningTax(gross, cfg.tax);
            netPay = taxed.final_payout;
            taxAmt = taxed.tax_amount;
            status = 'won';
            credit = netPay;
          }
        }

        // Persist bet status.
        await client.query(
          `UPDATE sportsbook_bets
              SET status = $1,
                  actual_payout = $2,
                  tax_amount = $3,
                  settled_at = now()
            WHERE id = $4`,
          [status, credit, taxAmt, r.bet_id]
        );

        // Credit wallet & write ledger entry.
        if (credit > 0 && r.wallet_id) {
          const wallet = await client.query<{
            id: string;
            balance: string;
            locked_balance: string;
          }>(
            `SELECT id, balance::text, locked_balance::text
               FROM wallets WHERE id = $1 FOR UPDATE`,
            [r.wallet_id]
          );
          const w = wallet.rows[0];
          if (w) {
            const before = Number(w.balance);
            const newBalance = Math.round((before + credit) * 100) / 100;
            const newLocked = Math.round(
              Math.max(0, Number(w.locked_balance) - stake) * 100
            ) / 100;
            await client.query(
              `UPDATE wallets
                  SET balance = $1, locked_balance = $2, updated_at = now()
                WHERE id = $3`,
              [newBalance, newLocked, w.id]
            );
            await client.query(
              `INSERT INTO transactions
                 (tenant_id, user_id, wallet_id, type, currency, amount,
                  before_balance, after_balance, status, reference, metadata)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10::jsonb)`,
              [
                tenantId,
                r.user_id,
                w.id,
                status === 'void' ? 'bet_refund' : 'bet_win',
                r.currency,
                credit,
                before,
                newBalance,
                `settle:${r.bet_id}`,
                JSON.stringify({
                  bet_id: r.bet_id,
                  status,
                  tax_amount: taxAmt,
                  gross_payout: netPay + taxAmt,
                }),
              ]
            );
            // Send WS push (balance + bet settled).
            emitWalletUpdated(tenantId, r.user_id, {
              reason: status === 'void' ? 'bet_refunded' : 'bet_won',
              wallet: {
                id: w.id,
                balance: newBalance.toFixed(2),
                locked_balance: newLocked.toFixed(2),
                currency: r.currency,
              },
              bet_id: r.bet_id,
            });
          }
        } else if (status === 'lost') {
          // Stake stays gone — but we still need to release the lock so
          // locked_balance accurately reflects pending-only stakes.
          if (r.wallet_id) {
            await client.query(
              `UPDATE wallets
                  SET locked_balance = GREATEST(0, locked_balance - $1::numeric),
                      updated_at = now()
                WHERE id = $2`,
              [stake, r.wallet_id]
            );
          }
        }

        emitBetSettled(tenantId, r.user_id, {
          bet_id: r.bet_id,
          status,
          payout: status === 'won' ? credit.toFixed(2) : status === 'void' ? credit.toFixed(2) : '0',
          currency: r.currency,
        });

        // Streak reset on loss (spec).
        if (status === 'lost') {
          void resetUserStreak({
            tenantId,
            userId: r.user_id,
            reason: 'loss',
          });
        }

        // Section 24 Step 1 — affiliate revenue-share accrual: bumps the
        // referrer's earnings_total by commission_pct × (stake − payout).
        // Detached so a stuck affiliate update never blocks bet settlement.
        void accrueAffiliateOnBetSettle({
          tenantId,
          userId: r.user_id,
          betId: r.bet_id,
          stake,
          payout: status === 'won' ? credit : status === 'void' ? credit : 0,
        });

        // Section 25 — per-ticket "Cashback for Losses" engine. Only
        // losing bets are evaluated; the cashback module re-loads the
        // active rule (Rule One vs Rule Two) and decides eligibility
        // inside its own transaction so it never blocks settlement.
        if (status === 'lost') {
          void applyLossCashback({
            tenantId,
            betId: r.bet_id,
            userId: r.user_id,
            stake,
            currency: r.currency,
            walletId: r.wallet_id,
          });
        }

        settlements.push({
          bet_id: r.bet_id,
          user_id: r.user_id,
          status,
          net_payout: status === 'won' ? netPay : credit,
          tax_amount: taxAmt,
          gross_payout: netPay + taxAmt,
        });
      }

      void tryAudit({
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.matches.result',
        resource: 'sports_events',
        resourceId: matchId,
        payload: {
          home_score: body.home_score,
          away_score: body.away_score,
          status: body.status,
          settled_selections: settledSelections.length,
          settled_bets: settlements.length,
          settlements,
        },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      });

      emitToTenant(tenantId, Events.MATCH_RESULT, {
        match_id: matchId,
        home_score: body.home_score,
        away_score: body.away_score,
        status: body.status,
      });

      return {
        match_id: matchId,
        status: body.status,
        home_score: body.home_score,
        away_score: body.away_score,
        settled_selections: settledSelections.length,
        settled_bets: settlements.length,
      };
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const router = Router();

router.patch(
  '/:id/odds',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return updateOdds(req, id, oddsUpdateSchema.parse(req.body));
  })
);

router.post(
  '/:id/status',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return setMatchStatus(req, id, matchStatusSchema.parse(req.body));
  })
);

router.post(
  '/:id/result',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return setMatchResult(req, id, matchResultSchema.parse(req.body));
  })
);

export default router;
