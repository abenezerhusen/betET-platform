/**
 * Section 18 — End-to-end betting flow.
 *
 *   POST   /api/bets/place          (18A)
 *   GET    /api/bets/:id            (read own ticket)
 *   GET    /api/bets                (own ticket history)
 *   POST   /api/bets/:id/cashout    (18D)
 *
 * These routes operate on the SPORTSBOOK_BETS / SPORTSBOOK_BET_LEGS
 * tables, NOT the internal-games `bets` table. The internal-games path
 * remains at /api/user/bets/* (see modules/user/bets.routes.ts).
 *
 *  All write paths:
 *   - load the merged BettingConfig once at the top so every rule comes
 *     from the same snapshot (no race with admin edits mid-request),
 *   - debit the user's wallet via the same wallets / transactions
 *     bookkeeping used everywhere else (no shortcut SQL).
 */

import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';

import { authenticateToken } from '../../middleware/authenticate';
import { assertSiteAvailable } from '../../middleware/maintenance-mode';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import {
  Events,
  emitBetSettled,
  emitToUser,
  emitWalletUpdated,
} from '../../realtime/socket';
import {
  getIdempotencyKey,
  getIp,
  getUa,
  getUserScope,
} from '../user/user-shared';
import { applyWinningTax, loadBettingConfig } from './betting-config';
import {
  isWithinOperationHours,
  loadGeneralConfig,
} from '../admin/settings/general-config';
import { updateUserStreakProgress } from '../admin/streaks/streaks.module';
import { applyBetWageringProgress } from '../promotions/bet-hooks';

/* -------------------------------------------------------------------------- */
/* DTOs                                                                       */
/* -------------------------------------------------------------------------- */

const idParam = z.object({ id: z.string().uuid() });

const placeSlipSchema = z.object({
  stake: z.coerce.number().positive().max(10_000_000),
  bet_type: z.enum(['single', 'combo', 'system']).default('combo'),
  currency: z.string().trim().min(2).max(8).default('ETB'),
  selections: z
    .array(
      z.object({
        selection_id: z.string().uuid(),
        /** Snapshot of odds the user saw on the slip. The server still
         *  re-reads the canonical odds; this is used only as a "did the
         *  odds change while the slip was open?" guard. */
        odds_seen: z.number().positive().optional(),
      })
    )
    .min(1)
    .max(50),
  idempotency_key: z.string().trim().min(1).max(255).optional(),
  accept_odds_changed: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

const cashoutSchema = z
  .object({
    confirm: z.boolean().optional(),
  })
  .default({});

const listQuery = z.object({
  status: z
    .enum(['pending', 'won', 'lost', 'void', 'cashout', 'partial'])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(20),
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcTotalOdds(odds: number[]): number {
  if (!odds.length) return 1;
  return odds.reduce((acc, o) => acc * o, 1);
}

interface ResolvedSelection {
  selection_id: string;
  market_id: string;
  event_id: string;
  event_status: string;
  event_starts_at: Date;
  selection_odds: number;
  selection_result: 'won' | 'lost' | 'void' | null;
  market_status: 'open' | 'locked' | 'settled' | 'cancelled';
}

async function resolveSelections(
  client: import('pg').PoolClient,
  tenantId: string,
  selectionIds: string[]
): Promise<ResolvedSelection[]> {
  const r = await client.query<ResolvedSelection>(
    `SELECT s.id   AS selection_id,
            s.market_id,
            m.event_id,
            ev.status                    AS event_status,
            ev.starts_at                 AS event_starts_at,
            s.odds_decimal::float        AS selection_odds,
            s.result                     AS selection_result,
            m.status                     AS market_status
       FROM sports_selections s
       JOIN sports_markets m  ON m.id = s.market_id
       JOIN sports_events ev  ON ev.id = m.event_id
      WHERE s.tenant_id = $1
        AND s.id = ANY($2::uuid[])`,
    [tenantId, selectionIds]
  );
  return r.rows;
}

/* -------------------------------------------------------------------------- */
/* 18A — Place                                                                */
/* -------------------------------------------------------------------------- */

interface PlaceOutcome {
  bet: {
    id: string;
    coupon_code: string;
    status: string;
    stake: string;
    total_odds: string;
    potential_payout: string;
    estimated_tax: string;
    estimated_net_pay: string;
    currency: string;
    placed_at: string;
    cashout_available: boolean;
  };
  wallet: { id: string; balance: string; currency: string };
  legs: Array<{
    selection_id: string;
    market_id: string;
    event_id: string;
    odds_at_placement: string;
  }>;
  idempotent: boolean;
}

async function placeSlip(
  req: Request,
  body: z.infer<typeof placeSlipSchema>
): Promise<PlaceOutcome> {
  await assertSiteAvailable(req);
  const scope = getUserScope(req);
  const idem = getIdempotencyKey(req, body.idempotency_key);

  return withTenantClient(
    { tenantId: scope.tenantId },
    async (client): Promise<PlaceOutcome> => {
      // 0. Idempotency: if a bet with this key already exists, return it.
      if (idem) {
        const dup = await client.query(
          `SELECT id FROM sportsbook_bets
             WHERE tenant_id = $1 AND user_id = $2 AND idempotency_key = $3
             LIMIT 1`,
          [scope.tenantId, scope.userId, idem]
        );
        if (dup.rows[0]) {
          return loadOutcome(client, scope.tenantId, dup.rows[0].id, true);
        }
      }

      const cfg = await loadBettingConfig(client, scope.tenantId);

      // Section 19 — refuse bets placed outside platform operation hours
      // when the admin has opted in (`operation_hours_enforce_bets`).
      const general = await loadGeneralConfig(client, scope.tenantId);
      if (general.operation_hours_enforce_bets && !isWithinOperationHours(general)) {
        throw new BadRequestError('Platform is currently closed', {
          reason: 'outside_operation_hours',
        });
      }

      // 1. Selections — distinct, exist, belong to this tenant.
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const sel of body.selections) {
        if (seen.has(sel.selection_id)) {
          throw new BadRequestError('Duplicate selection in slip', {
            reason: 'duplicate_leg',
            selection_id: sel.selection_id,
          });
        }
        seen.add(sel.selection_id);
        ids.push(sel.selection_id);
      }
      const resolved = await resolveSelections(client, scope.tenantId, ids);
      if (resolved.length !== ids.length) {
        throw new BadRequestError('One or more selections not found', {
          reason: 'selection_not_found',
        });
      }

      // 2. Eligibility per Section-18A:
      //    - match has not already started (unless live betting allowed)
      //    - market open
      //    - odds still valid (no late settlement)
      //    - per-leg min_individual_odd
      const seenEvents = new Set<string>();
      for (const r of resolved) {
        seenEvents.add(r.event_id);
        if (r.selection_result !== null) {
          throw new BadRequestError('A selection has already settled', {
            reason: 'selection_settled',
            selection_id: r.selection_id,
          });
        }
        if (r.market_status !== 'open') {
          throw new BadRequestError('A market is closed for betting', {
            reason: 'market_closed',
            market_id: r.market_id,
          });
        }
        if (r.event_status === 'finished' || r.event_status === 'cancelled') {
          throw new BadRequestError('A match has already concluded', {
            reason: 'match_finished',
            event_id: r.event_id,
          });
        }
        if (r.event_status === 'live' && !cfg.live_betting_enabled) {
          throw new BadRequestError('In-play betting is disabled', {
            reason: 'live_betting_disabled',
          });
        }
        if (
          r.event_status === 'scheduled' &&
          new Date(r.event_starts_at).getTime() <= Date.now()
        ) {
          throw new BadRequestError('Match has already started', {
            reason: 'match_started',
            event_id: r.event_id,
          });
        }
        if (r.selection_odds < cfg.slip.min_individual_odd) {
          throw new BadRequestError(
            `Odds ${r.selection_odds.toFixed(2)} below minimum ${cfg.slip.min_individual_odd}`,
            { reason: 'odds_too_low', selection_id: r.selection_id }
          );
        }
      }

      // 3. Slip rules (Section 18F).
      if (resolved.length > cfg.slip.max_legs) {
        throw new BadRequestError(
          `Too many selections (max ${cfg.slip.max_legs})`,
          { reason: 'too_many_legs', max: cfg.slip.max_legs }
        );
      }
      if (body.bet_type === 'combo' && resolved.length < 2) {
        throw new BadRequestError(
          'A combo bet must have at least 2 selections',
          { reason: 'combo_needs_two' }
        );
      }
      if (resolved.length !== seenEvents.size) {
        // Two legs on the same event would let users hedge their own slip
        // against themselves. Reject for combo bets.
        if (body.bet_type === 'combo') {
          throw new BadRequestError(
            'Cannot combine multiple selections from the same match',
            { reason: 'duplicate_event' }
          );
        }
      }

      // 4. Total odds & potential payout.
      const oddsList = resolved.map((r) => r.selection_odds);
      const totalOdds = calcTotalOdds(oddsList);
      if (totalOdds > cfg.slip.max_total_odds) {
        throw new BadRequestError(
          `Total odds ${totalOdds.toFixed(2)} exceed maximum ${cfg.slip.max_total_odds}`,
          { reason: 'total_odds_too_high', max: cfg.slip.max_total_odds }
        );
      }
      const stake = body.stake;
      if (stake < cfg.slip.online_min_stake) {
        throw new BadRequestError(
          `Stake ${stake} below online minimum ${cfg.slip.online_min_stake}`,
          { reason: 'stake_below_min', min: cfg.slip.online_min_stake }
        );
      }
      const potentialWin = round2(stake * totalOdds);
      if (potentialWin > cfg.slip.max_payout_per_slip) {
        throw new BadRequestError(
          `Potential payout ${potentialWin} exceeds slip cap ${cfg.slip.max_payout_per_slip}`,
          { reason: 'payout_exceeds_cap' }
        );
      }

      // 5. "Odds changed while the slip was open?" guard.
      if (!body.accept_odds_changed) {
        for (let i = 0; i < body.selections.length; i++) {
          const seen = body.selections[i]?.odds_seen;
          const cur = resolved.find(
            (r) => r.selection_id === body.selections[i].selection_id
          )?.selection_odds;
          if (seen && cur && Math.abs(seen - cur) > 0.0001) {
            throw new BadRequestError('Odds have changed', {
              reason: 'odds_changed',
              selection_id: body.selections[i].selection_id,
              odds_seen: seen,
              odds_now: cur,
            });
          }
        }
      }

      // 6. User eligibility: active account, max_pending_slips, etc.
      const user = await client.query<{
        id: string;
        status: string;
      }>(`SELECT id, status FROM users WHERE id = $1`, [scope.userId]);
      if (!user.rows[0]) throw new NotFoundError('User not found');
      if (user.rows[0].status !== 'active') {
        throw new BadRequestError(`Account is ${user.rows[0].status}`, {
          reason: 'user_not_active',
        });
      }

      const pendingCount = await client.query<{ pending: string; locked: string }>(
        `SELECT COUNT(*)::text                          AS pending,
                COALESCE(SUM(stake), 0)::text          AS locked
           FROM sportsbook_bets
          WHERE tenant_id = $1 AND user_id = $2 AND status = 'pending'`,
        [scope.tenantId, scope.userId]
      );
      const pendingNum = Number(pendingCount.rows[0]?.pending ?? 0);
      const lockedStake = Number(pendingCount.rows[0]?.locked ?? 0);
      if (pendingNum >= cfg.slip.max_pending_slips) {
        throw new BadRequestError(
          `Pending slip limit reached (max ${cfg.slip.max_pending_slips})`,
          { reason: 'max_pending_slips' }
        );
      }
      if (lockedStake + stake > cfg.slip.max_pending_stake) {
        throw new BadRequestError(
          `Pending stake would exceed ${cfg.slip.max_pending_stake}`,
          { reason: 'max_pending_stake' }
        );
      }

      // 7. Wallet — lock stake into locked_balance.
      const wallet = await client.query<{
        id: string;
        balance: string;
        locked_balance: string;
        currency: string;
        status: string;
      }>(
        `SELECT id, balance::text, locked_balance::text, currency, status
           FROM wallets
          WHERE user_id = $1 AND tenant_id = $2 AND currency = $3
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE`,
        [scope.userId, scope.tenantId, body.currency]
      );
      const w = wallet.rows[0];
      if (!w) {
        throw new BadRequestError('No wallet for this currency', {
          currency: body.currency,
        });
      }
      if (w.status !== 'active') {
        throw new BadRequestError(`Wallet is ${w.status}`, {
          reason: 'wallet_inactive',
        });
      }
      const before = Number(w.balance);
      if (before < stake) {
        throw new BadRequestError('Insufficient balance', {
          reason: 'insufficient_balance',
          balance: before,
        });
      }
      const afterBalance = round2(before - stake);
      const afterLocked = round2(Number(w.locked_balance) + stake);
      await client.query(
        `UPDATE wallets
            SET balance = $1, locked_balance = $2, updated_at = now()
          WHERE id = $3`,
        [afterBalance, afterLocked, w.id]
      );

      // 8. Insert sportsbook_bet + legs.
      const tax = applyWinningTax(potentialWin, cfg.tax);
      const betType = resolved.length === 1 ? 'single' : body.bet_type;
      const inserted = await client.query<{ id: string; coupon_code: string }>(
        `INSERT INTO sportsbook_bets (
             tenant_id, user_id, channel, bet_type,
             stake, currency, total_odds, potential_payout, tax_amount,
             idempotency_key, status, cashout_available, metadata
           ) VALUES (
             $1, $2, 'online', $3,
             $4, $5, $6, $7, 0,
             $8, 'pending', $9, $10::jsonb
           )
           RETURNING id, coupon_code`,
        [
          scope.tenantId,
          scope.userId,
          betType,
          stake,
          body.currency,
          totalOdds,
          potentialWin,
          idem,
          cfg.cashout.enabled,
          JSON.stringify({
            ...(body.metadata ?? {}),
            placed_via: 'user_panel',
            estimated_tax: tax.tax_amount,
            estimated_net_pay: tax.final_payout,
            min_individual_odd: cfg.slip.min_individual_odd,
          }),
        ]
      );
      const betId = inserted.rows[0].id;

      // Bulk insert legs.
      for (const r of resolved) {
        await client.query(
          `INSERT INTO sportsbook_bet_legs
             (tenant_id, bet_id, selection_id, odds_at_placement, status)
           VALUES ($1, $2, $3, $4, 'pending')`,
          [scope.tenantId, betId, r.selection_id, r.selection_odds]
        );
      }

      // 9. Ledger entry: bet_stake debit.
      await client.query(
        `INSERT INTO transactions
           (tenant_id, user_id, wallet_id, type, currency, amount,
            before_balance, after_balance, status, reference, metadata)
         VALUES ($1, $2, $3, 'bet_stake', $4, $5, $6, $7, 'completed', $8,
                 $9::jsonb)`,
        [
          scope.tenantId,
          scope.userId,
          w.id,
          body.currency,
          -stake,
          before,
          afterBalance,
          idem ?? `sbk:${betId}`,
          JSON.stringify({
            bet_id: betId,
            kind: 'sportsbook',
            total_odds: totalOdds,
            potential_payout: potentialWin,
            legs: resolved.length,
          }),
        ]
      );

      const outcome = await loadOutcome(client, scope.tenantId, betId, false);

      // Real-time push.
      emitToUser(scope.tenantId, scope.userId, Events.BET_PLACED, {
        bet_id: betId,
        coupon_code: outcome.bet.coupon_code,
        stake: outcome.bet.stake,
        total_odds: outcome.bet.total_odds,
        potential_payout: outcome.bet.potential_payout,
      });
      emitWalletUpdated(scope.tenantId, scope.userId, {
        reason: 'sportsbook_bet_placed',
        wallet: outcome.wallet,
        bet_id: betId,
      });

      // Best-effort audit.
      void tryAudit({
        tenantId: scope.tenantId,
        actorId: scope.userId,
        actorType: 'user',
        action: 'user.bet.sportsbook.place',
        resource: 'sportsbook_bets',
        resourceId: betId,
        payload: {
          stake,
          total_odds: totalOdds,
          potential_payout: potentialWin,
          legs: resolved.length,
          idempotent: false,
        },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      });

      // Section 24 Step 4 — every placed sportsbook bet advances the user
      // streak (today vs yesterday accounting + reward emission inside the
      // streak module) and progresses any active bonus wagering assignment.
      // Both calls are detached so a failure in promotions can never reverse
      // an already-committed bet.
      void updateUserStreakProgress({
        tenantId: scope.tenantId,
        userId: scope.userId,
        betAmount: stake,
      });
      void applyBetWageringProgress({
        tenantId: scope.tenantId,
        userId: scope.userId,
        betId,
        stake,
        odds: totalOdds,
      });

      return outcome;
    }
  );
}

async function loadOutcome(
  client: import('pg').PoolClient,
  tenantId: string,
  betId: string,
  idempotent: boolean
): Promise<PlaceOutcome> {
  const bet = await client.query(
    `SELECT b.id, b.coupon_code, b.status, b.stake::text, b.total_odds::text,
            b.potential_payout::text, b.tax_amount::text, b.currency,
            b.placed_at, b.cashout_available, b.metadata, b.user_id
       FROM sportsbook_bets b
      WHERE b.id = $1 AND b.tenant_id = $2`,
    [betId, tenantId]
  );
  const row = bet.rows[0];
  if (!row) throw new NotFoundError('Bet not found');

  const wallet = await client.query<{
    id: string;
    balance: string;
    currency: string;
  }>(
    `SELECT id, balance::text, currency
       FROM wallets WHERE user_id = $1 AND currency = $2
        ORDER BY created_at ASC LIMIT 1`,
    [row.user_id, row.currency]
  );

  const legs = await client.query(
    `SELECT l.selection_id, l.odds_at_placement::text, m.id AS market_id,
            m.event_id
       FROM sportsbook_bet_legs l
       JOIN sports_selections s ON s.id = l.selection_id
       JOIN sports_markets m    ON m.id = s.market_id
      WHERE l.bet_id = $1`,
    [betId]
  );

  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    bet: {
      id: row.id,
      coupon_code: row.coupon_code,
      status: row.status,
      stake: row.stake,
      total_odds: row.total_odds,
      potential_payout: row.potential_payout,
      estimated_tax: String(meta.estimated_tax ?? row.tax_amount ?? '0'),
      estimated_net_pay: String(
        meta.estimated_net_pay ??
          Number(row.potential_payout) - Number(row.tax_amount ?? 0)
      ),
      currency: row.currency,
      placed_at: row.placed_at,
      cashout_available: row.cashout_available,
    },
    wallet: wallet.rows[0] ?? {
      id: '',
      balance: '0',
      currency: row.currency,
    },
    legs: legs.rows,
    idempotent,
  };
}

/* -------------------------------------------------------------------------- */
/* 18D — Cashout                                                              */
/* -------------------------------------------------------------------------- */

interface CashoutOutcome {
  bet_id: string;
  cashout_amount: string;
  status: string;
  wallet: { id: string; balance: string; currency: string };
}

async function cashoutBet(
  req: Request,
  betId: string
): Promise<CashoutOutcome> {
  const scope = getUserScope(req);

  return withTenantClient(
    { tenantId: scope.tenantId },
    async (client): Promise<CashoutOutcome> => {
      const cfg = await loadBettingConfig(client, scope.tenantId);

      if (!cfg.cashout.enabled) {
        throw new BadRequestError('Cashout is disabled', {
          reason: 'cashout_disabled',
        });
      }

      const bet = await client.query<{
        id: string;
        user_id: string;
        tenant_id: string;
        status: string;
        stake: string;
        total_odds: string;
        potential_payout: string;
        currency: string;
        cashout_available: boolean;
        metadata: Record<string, unknown>;
      }>(
        `SELECT id, user_id, tenant_id, status, stake::text, total_odds::text,
                potential_payout::text, currency, cashout_available, metadata
           FROM sportsbook_bets
          WHERE id = $1 AND tenant_id = $2
          FOR UPDATE`,
        [betId, scope.tenantId]
      );
      const b = bet.rows[0];
      if (!b) throw new NotFoundError('Bet not found');
      if (b.user_id !== scope.userId) {
        throw new ForbiddenError('You do not own this bet');
      }
      if (b.status !== 'pending') {
        throw new BadRequestError(
          `Cashout not available — bet is ${b.status}`,
          { reason: 'bet_not_pending', status: b.status }
        );
      }
      if (!b.cashout_available) {
        throw new BadRequestError('Cashout not allowed on this bet', {
          reason: 'cashout_not_allowed',
        });
      }
      if (
        !cfg.cashout.allow_bonus_cashout &&
        b.metadata?.balance_source === 'bonus'
      ) {
        throw new BadRequestError(
          'Cashout is disabled for bonus-funded bets',
          { reason: 'cashout_bonus_disabled' }
        );
      }

      const stake = Number(b.stake);
      const totalOdds = Number(b.total_odds);
      const potential = Number(b.potential_payout);
      if (stake < cfg.cashout.min_stake) {
        throw new BadRequestError(
          `Cashout requires stake >= ${cfg.cashout.min_stake}`,
          { reason: 'stake_below_cashout_min' }
        );
      }
      if (totalOdds < cfg.cashout.min_total_odd) {
        throw new BadRequestError(
          `Cashout requires total odds >= ${cfg.cashout.min_total_odd}`,
          { reason: 'odds_below_cashout_min' }
        );
      }

      const legs = await client.query<{
        selection_id: string;
        odds_at_placement: string;
        status: 'pending' | 'won' | 'lost' | 'void';
        selection_result: 'won' | 'lost' | 'void' | null;
        event_status: string;
        market_status: string;
      }>(
        `SELECT l.selection_id, l.odds_at_placement::text, l.status,
                s.result AS selection_result,
                ev.status AS event_status,
                m.status AS market_status
           FROM sportsbook_bet_legs l
           JOIN sports_selections s ON s.id = l.selection_id
           JOIN sports_markets    m ON m.id = s.market_id
           JOIN sports_events    ev ON ev.id = m.event_id
          WHERE l.bet_id = $1`,
        [betId]
      );
      if (legs.rows.length < cfg.cashout.min_matches) {
        throw new BadRequestError(
          `Cashout requires at least ${cfg.cashout.min_matches} selections`,
          { reason: 'too_few_legs' }
        );
      }
      const minIndiv = cfg.cashout.min_individual_odd;
      for (const l of legs.rows) {
        if (Number(l.odds_at_placement) < minIndiv) {
          throw new BadRequestError(
            `A selection has odds below cashout minimum ${minIndiv}`,
            { reason: 'leg_odds_below_min' }
          );
        }
        if (l.status === 'lost') {
          throw new BadRequestError(
            'One selection already lost — bet will be settled',
            { reason: 'leg_already_lost' }
          );
        }
        if (
          !cfg.cashout.allow_abandoned_match &&
          (l.event_status === 'postponed' || l.event_status === 'cancelled')
        ) {
          throw new BadRequestError(
            'Cashout disabled when a match is abandoned',
            { reason: 'abandoned_match' }
          );
        }
      }

      // Section 18D formula:
      //   cashout_value = potential_win * (won/total) * (1 - retention_rate)
      // For pending legs we treat "currently in progress" as still
      // contributing only when status is 'won' (settled won) — this is
      // the safe interpretation: the user can never withdraw more than
      // they would receive if the bet settled with the current legs.
      const total = legs.rows.length;
      const won = legs.rows.filter((l) => l.status === 'won').length;
      const ratio = total === 0 ? 0 : won / total;
      const rawValue = potential * ratio * (1 - cfg.cashout.retention_rate);
      const cashoutValue = round2(
        Math.min(
          Math.max(rawValue, stake * 0.05), // floor: 5% of stake so users always get something back
          cfg.cashout.max_cashout_amount
        )
      );

      // Win-criteria gate.
      if (cfg.cashout.win_criteria === 'percentage') {
        const pct = (cashoutValue / Math.max(potential, 1)) * 100;
        if (pct < cfg.cashout.win_criteria_value) {
          throw new BadRequestError(
            `Cashout value is below ${cfg.cashout.win_criteria_value}% of potential payout`,
            { reason: 'below_win_criteria', value: cashoutValue, potential }
          );
        }
      } else {
        if (cashoutValue < cfg.cashout.win_criteria_value) {
          throw new BadRequestError(
            `Cashout value is below the configured floor of ${cfg.cashout.win_criteria_value}`,
            { reason: 'below_win_criteria', value: cashoutValue }
          );
        }
      }

      // ── Cashout Boost Promotion (optional layer — never modifies base calc) ──
      let promotionEnabled = false;
      let promotionType: 'percentage' | 'fixed' = 'percentage';
      let promotionValue = 0;
      let promotionAmount = 0;
      let finalCashoutValue = cashoutValue;

      try {
        const boostRow = await client.query<{ value: Record<string, unknown> }>(
          `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'promotions.cashout_boost'`,
          [scope.tenantId]
        );
        const boost = boostRow.rows[0]?.value as Record<string, unknown> | undefined;
        if (boost && boost.is_enabled === true) {
          const avail = (boost.availability ?? {}) as Record<string, boolean>;
          const sports = (boost.sports ?? {}) as Record<string, boolean>;
          const legsCount = legs.rows.length;
          const isLive = legs.rows.some((l) => l.event_status === 'live');
          const isSingle = legsCount === 1;
          const isMultiple = legsCount > 1;

          // Check availability eligibility.
          const liveOk = !isLive || avail.live_bets !== false;
          const prematchOk = isLive || avail.prematch_bets !== false;
          const singleOk = !isSingle || avail.single_bets !== false;
          const multipleOk = !isMultiple || avail.multiple_bets !== false;
          const availOk = liveOk && prematchOk && singleOk && multipleOk;

          // Check sport eligibility by querying sport from the legs events.
          let sportOk = true;
          if (availOk) {
            const sportRow = await client.query<{ sport: string }>(
              `SELECT LOWER(COALESCE(ev.sport, 'others')) AS sport
                 FROM sportsbook_bet_legs l
                 JOIN sports_selections s ON s.id = l.selection_id
                 JOIN sports_markets    m ON m.id = s.market_id
                 JOIN sports_events    ev ON ev.id = m.event_id
                WHERE l.bet_id = $1
                LIMIT 1`,
              [betId]
            );
            const sport = sportRow.rows[0]?.sport ?? 'others';
            const sportKey =
              sport === 'football' ? 'football'
              : sport === 'basketball' ? 'basketball'
              : sport === 'tennis' ? 'tennis'
              : sport === 'volleyball' ? 'volleyball'
              : sport === 'esports' ? 'esports'
              : sport === 'virtual' ? 'virtual'
              : 'others';
            sportOk = sports[sportKey] !== false;
          }

          if (availOk && sportOk) {
            promotionEnabled = true;
            promotionType = (boost.promotion_type as 'percentage' | 'fixed') ?? 'percentage';
            promotionValue = Number(boost.promotion_value ?? 0);
            promotionAmount = round2(
              promotionType === 'percentage'
                ? cashoutValue * (promotionValue / 100)
                : promotionValue
            );
            finalCashoutValue = round2(cashoutValue + promotionAmount);
          }
        }
      } catch {
        // Promotion check is non-critical — fall back to base cashout value.
        finalCashoutValue = cashoutValue;
        promotionEnabled = false;
      }

      // Credit wallet: unlock the stake, add the cashout amount on top.
      const wallet = await client.query<{
        id: string;
        balance: string;
        locked_balance: string;
        currency: string;
      }>(
        `SELECT id, balance::text, locked_balance::text, currency
           FROM wallets
          WHERE user_id = $1 AND tenant_id = $2 AND currency = $3
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE`,
        [b.user_id, scope.tenantId, b.currency]
      );
      const w = wallet.rows[0];
      if (!w) throw new NotFoundError('Wallet not found');

      const before = Number(w.balance);
      const afterBalance = round2(before + finalCashoutValue);
      const afterLocked = round2(Math.max(0, Number(w.locked_balance) - stake));
      await client.query(
        `UPDATE wallets
            SET balance = $1, locked_balance = $2, updated_at = now()
          WHERE id = $3`,
        [afterBalance, afterLocked, w.id]
      );

      await client.query(
        `INSERT INTO transactions
           (tenant_id, user_id, wallet_id, type, currency, amount,
            before_balance, after_balance, status, reference, metadata)
         VALUES ($1,$2,$3,'bet_cashout',$4,$5,$6,$7,'completed',$8,$9::jsonb)`,
        [
          scope.tenantId,
          scope.userId,
          w.id,
          b.currency,
          finalCashoutValue,
          before,
          afterBalance,
          `cashout:${betId}`,
          JSON.stringify({
            bet_id: betId,
            won_legs: won,
            total_legs: total,
            retention_rate: cfg.cashout.retention_rate,
            original_cashout: cashoutValue,
            promotion_enabled: promotionEnabled,
            promotion_type: promotionEnabled ? promotionType : undefined,
            promotion_value: promotionEnabled ? promotionValue : undefined,
            promotion_amount: promotionEnabled ? promotionAmount : undefined,
            final_cashout: finalCashoutValue,
          }),
        ]
      );

      await client.query(
        `UPDATE sportsbook_bets
            SET status = 'cashout',
                cashout_amount = $1,
                cashout_at = now(),
                actual_payout = $1,
                settled_at = now()
          WHERE id = $2`,
        [finalCashoutValue, betId]
      );

      void tryAudit({
        tenantId: scope.tenantId,
        actorId: scope.userId,
        actorType: 'user',
        action: 'user.bet.sportsbook.cashout',
        resource: 'sportsbook_bets',
        resourceId: betId,
        payload: {
          cashout_amount: cashoutValue,
          stake,
          potential_payout: potential,
          legs_won: won,
          legs_total: total,
        },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      });

      emitBetSettled(scope.tenantId, scope.userId, {
        bet_id: betId,
        status: 'cashout',
        payout: String(cashoutValue),
        currency: b.currency,
      });
      emitWalletUpdated(scope.tenantId, scope.userId, {
        reason: 'bet_cashout',
        wallet: {
          id: w.id,
          balance: afterBalance.toFixed(2),
          locked_balance: afterLocked.toFixed(2),
          currency: w.currency,
        },
        bet_id: betId,
      });

      return {
        bet_id: betId,
        cashout_amount: finalCashoutValue.toFixed(2),
        status: 'cashout',
        wallet: {
          id: w.id,
          balance: afterBalance.toFixed(2),
          currency: w.currency,
        },
        // Optional promotion fields — present only when a boost was applied.
        ...(promotionEnabled && {
          promotionEnabled: true,
          promotionType,
          promotionValue,
          promotionAmount: promotionAmount.toFixed(2),
          originalCashOut: cashoutValue.toFixed(2),
          finalCashOut: finalCashoutValue.toFixed(2),
        }),
      };
    }
  );
}

/* -------------------------------------------------------------------------- */
/* GET                                                                        */
/* -------------------------------------------------------------------------- */

async function listMyBets(
  req: Request,
  q: z.infer<typeof listQuery>
) {
  const scope = getUserScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient({ tenantId: scope.tenantId }, async (client) => {
    const filters = ['b.tenant_id = $1', 'b.user_id = $2'];
    const values: unknown[] = [scope.tenantId, scope.userId];
    let i = 3;
    if (q.status) {
      filters.push(`b.status = $${i++}`);
      values.push(q.status);
    }
    if (q.from) {
      filters.push(`b.placed_at >= $${i++}`);
      values.push(q.from);
    }
    if (q.to) {
      filters.push(`b.placed_at <= $${i++}`);
      values.push(q.to);
    }
    const where = `WHERE ${filters.join(' AND ')}`;
    const total = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sportsbook_bets b ${where}`,
      values
    );
    const rows = await client.query(
      `SELECT b.id, b.coupon_code, b.bet_type, b.stake::text,
              b.total_odds::text, b.potential_payout::text,
              b.tax_amount::text, b.actual_payout::text,
              b.cashout_amount::text, b.status,
              b.settlement_status, b.void_reason, b.settlement_reason,
              b.postponed_at, b.postpone_wait_hours,
              b.currency, b.placed_at, b.settled_at,
              (SELECT COUNT(*)::int FROM sportsbook_bet_legs l WHERE l.bet_id = b.id) AS legs_count
         FROM sportsbook_bets b
         ${where}
         ORDER BY b.placed_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
      [...values, q.limit, offset]
    );

    // ── Compute cashout availability + value per bet ───────────────────────
    // Mirrors the eligibility logic in `cashoutBet` so the user panel can
    // show a "Cash Out" button with the live offer amount on each eligible
    // ticket. Bets that are already cashed out / settled / void are skipped.
    const cfg = await loadBettingConfig(client, scope.tenantId);
    const eligibleBets = rows.rows.filter((b) => b.status === 'pending');
    const cashoutInfo: Record<string, { available: boolean; value: number }> = {};

    if (cfg.cashout.enabled && eligibleBets.length > 0) {
      // Load boost config once (applied as an additional layer, never
      // modifying the base calculation — same approach as `cashoutBet`).
      let boostCfg: {
        enabled?: boolean;
        type?: 'percentage' | 'fixed';
        value?: number;
      } = {};
      try {
        const boostRow = await client.query<{ value: Record<string, unknown> }>(
          `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'promotions.cashout_boost'`,
          [scope.tenantId]
        );
        if (boostRow.rows[0]?.value) {
          const v = boostRow.rows[0].value;
          boostCfg = {
            enabled: v.is_enabled === true,
            type: v.promotion_type === 'fixed' ? 'fixed' : 'percentage',
            value: typeof v.promotion_value === 'number' ? v.promotion_value : 0,
          };
        }
      } catch {
        // Non-critical — fall back to no boost.
      }

      for (const b of eligibleBets) {
        const stake = Number(b.stake);
        const totalOdds = Number(b.total_odds);
        const potential = Number(b.potential_payout);
        if (stake < cfg.cashout.min_stake) continue;
        if (totalOdds < cfg.cashout.min_total_odd) continue;

        const legs = await client.query<{
          odds_at_placement: string;
          status: string;
          event_status: string;
        }>(
          `SELECT l.odds_at_placement::text, l.status, ev.status AS event_status
             FROM sportsbook_bet_legs l
             JOIN sports_selections sel ON sel.id = l.selection_id
             JOIN sports_markets   m   ON m.id   = sel.market_id
             JOIN sports_events    ev  ON ev.id  = m.event_id
            WHERE l.bet_id = $1`,
          [b.id]
        );
        if (legs.rows.length < cfg.cashout.min_matches) continue;

        let blocked = false;
        for (const l of legs.rows) {
          if (Number(l.odds_at_placement) < cfg.cashout.min_individual_odd) {
            blocked = true;
            break;
          }
          if (l.status === 'lost') {
            blocked = true;
            break;
          }
          if (
            !cfg.cashout.allow_abandoned_match &&
            (l.event_status === 'postponed' || l.event_status === 'cancelled')
          ) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        const total = legs.rows.length;
        const won = legs.rows.filter((l) => l.status === 'won').length;
        const ratio = total === 0 ? 0 : won / total;
        const rawValue = potential * ratio * (1 - cfg.cashout.retention_rate);
        const baseValue = round2(
          Math.min(
            Math.max(rawValue, stake * 0.05),
            cfg.cashout.max_cashout_amount
          )
        );

        // Win-criteria gate.
        let passesGate = true;
        if (cfg.cashout.win_criteria === 'percentage') {
          const pct = (baseValue / Math.max(potential, 1)) * 100;
          passesGate = pct >= cfg.cashout.win_criteria_value;
        } else {
          passesGate = baseValue >= cfg.cashout.win_criteria_value;
        }
        if (!passesGate) continue;

        // Apply optional boost layer (never modifies base calc).
        let finalValue = baseValue;
        if (boostCfg.enabled && boostCfg.value && boostCfg.value > 0) {
          if (boostCfg.type === 'percentage') {
            finalValue = round2(baseValue + baseValue * (boostCfg.value / 100));
          } else {
            finalValue = round2(baseValue + boostCfg.value);
          }
        }

        cashoutInfo[b.id] = { available: true, value: finalValue };
      }
    }

    const items = rows.rows.map((b) => {
      const info = cashoutInfo[b.id];
      return {
        ...b,
        cashout_available: !!info?.available,
        cashout_value: info ? String(info.value) : null,
        placed_at: b.placed_at instanceof Date ? b.placed_at.toISOString() : b.placed_at,
        settled_at: b.settled_at instanceof Date ? b.settled_at?.toISOString() : b.settled_at,
        postponed_at: b.postponed_at instanceof Date ? b.postponed_at?.toISOString() : b.postponed_at,
      };
    });

    return {
      items,
      total: Number(total.rows[0]?.count ?? 0),
      page: q.page,
      limit: q.limit,
    };
  });
}

/**
 * Ticket reload — look a ticket up by coupon code (SBK-XXXXXXXX) or bet
 * UUID and return its selections in a shape the betslip can replay as a
 * brand-new bet. Any authenticated user may reload a code they hold
 * (bet codes are shareable, mirroring the cashier ticket flow).
 */
async function reloadTicket(req: Request, rawCode: string) {
  const scope = getUserScope(req);
  const code = rawCode.trim();
  if (!code) throw new BadRequestError('Ticket code required');

  return withTenantClient({ tenantId: scope.tenantId }, async (client) => {
    const bet = await client.query(
      `SELECT b.id, b.coupon_code, b.status, b.bet_type,
              b.stake::text AS stake, b.total_odds::text AS total_odds,
              b.potential_payout::text AS potential_payout,
              b.currency, b.placed_at
         FROM sportsbook_bets b
        WHERE b.tenant_id = $1
          AND (upper(b.coupon_code) = upper($2) OR b.id::text = lower($2))
        LIMIT 1`,
      [scope.tenantId, code]
    );
    const b = bet.rows[0];

    // ── Legacy fallback ────────────────────────────────────────────────
    // Some online sportsbook slips were placed via the legacy internal-
    // games endpoint (POST /api/user/bets/place) before every OddsButton
    // threaded a real selection_id. Those slips live in the `bets` table
    // with metadata.selection.source = 'sportsbook' and their picks are
    // stored inline in metadata.selection.picks (no sportsbook_bet_legs
    // rows). Reconstruct a reload response from that metadata so users
    // can still see match details and the Bet Code loader works.
    if (!b) {
      const legacy = await client.query<{
        id: string;
        status: string;
        stake: string;
        potential_win: string;
        currency: string;
        placed_at: Date;
        metadata: Record<string, unknown>;
      }>(
        `SELECT id, status, stake::text, potential_win::text,
                currency, placed_at, metadata
           FROM bets
          WHERE tenant_id = $1
            AND (id::text = lower($2) OR id::text LIKE lower($2) || '%')
          LIMIT 1`,
        [scope.tenantId, code]
      );
      const lb = legacy.rows[0];
      if (!lb) throw new NotFoundError('Ticket not found');

      const selection = (lb.metadata as Record<string, unknown>)?.selection as
        | { source?: string; picks?: Array<Record<string, unknown>> }
        | undefined;
      const picks = Array.isArray(selection?.picks) ? selection!.picks! : [];

      return {
        bet: {
          id: lb.id,
          coupon_code: lb.id.slice(0, 12).toUpperCase(),
          status: lb.status,
          bet_type: 'single',
          stake: lb.stake,
          total_odds: '0',
          potential_payout: lb.potential_win,
          currency: lb.currency,
          placed_at: lb.placed_at,
        },
        selections: picks.map((p) => {
          const matchStr = String(p.match ?? '');
          const [homeTeam, awayTeam] = matchStr.split(/\s+V\s+/i).map((s) => s.trim());
          return {
            selection_id: String(p.selection_id ?? ''),
            market_id: '',
            event_id: '',
            home_team: homeTeam ?? matchStr,
            away_team: awayTeam ?? '',
            league: String(p.league ?? ''),
            sport: '',
            market_label: String(p.market ?? ''),
            selection_label: String(p.selection ?? ''),
            odds_at_placement: String(p.odds ?? '0'),
            current_odds: String(p.odds ?? '0'),
            starts_at: '',
            event_status: '',
            market_status: '',
            selection_result: null,
            replayable: false,
          };
        }),
      };
    }

    const legs = await client.query<{
      selection_id: string;
      market_id: string;
      event_id: string;
      odds_at_placement: string;
      current_odds: string;
      selection_label: string;
      selection_result: 'won' | 'lost' | 'void' | null;
      market_label: string;
      market_status: string;
      home_team: string;
      away_team: string;
      league: string;
      sport: string;
      starts_at: Date;
      event_status: string;
    }>(
      `SELECT l.selection_id,
              m.id AS market_id,
              ev.id AS event_id,
              l.odds_at_placement::text,
              s.odds_decimal::text AS current_odds,
              s.label AS selection_label,
              s.result AS selection_result,
              m.label AS market_label,
              m.status AS market_status,
              ev.home_team, ev.away_team, ev.league, ev.sport,
              ev.starts_at, ev.status AS event_status
         FROM sportsbook_bet_legs l
         JOIN sports_selections s ON s.id = l.selection_id
         JOIN sports_markets m    ON m.id = s.market_id
         JOIN sports_events ev    ON ev.id = m.event_id
        WHERE l.bet_id = $1
        ORDER BY l.created_at ASC`,
      [b.id]
    );

    return {
      bet: {
        id: b.id,
        coupon_code: b.coupon_code,
        status: b.status,
        bet_type: b.bet_type,
        stake: b.stake,
        total_odds: b.total_odds,
        potential_payout: b.potential_payout,
        currency: b.currency,
        placed_at: b.placed_at,
      },
      selections: legs.rows.map((l) => {
        const startsAt = new Date(l.starts_at);
        const replayable =
          l.selection_result === null &&
          l.market_status === 'open' &&
          l.event_status === 'scheduled' &&
          startsAt.getTime() > Date.now();
        return {
          selection_id: l.selection_id,
          market_id: l.market_id,
          event_id: l.event_id,
          home_team: l.home_team,
          away_team: l.away_team,
          league: l.league,
          sport: l.sport,
          market_label: l.market_label,
          selection_label: l.selection_label,
          odds_at_placement: l.odds_at_placement,
          current_odds: l.current_odds,
          starts_at: l.starts_at,
          event_status: l.event_status,
          market_status: l.market_status,
          /**
           * Per-leg settlement result. null = still pending; settled bets
           * carry 'won' | 'lost' | 'void' from `sports_selections.result`.
           */
          selection_result: l.selection_result,
          replayable,
        };
      }),
    };
  });
}

async function getMyBet(req: Request, betId: string) {
  const scope = getUserScope(req);
  return withTenantClient({ tenantId: scope.tenantId }, async (client) => {
    const bet = await client.query(
      `SELECT b.*, b.stake::text AS stake, b.total_odds::text AS total_odds,
              b.potential_payout::text AS potential_payout,
              b.tax_amount::text AS tax_amount,
              b.actual_payout::text AS actual_payout,
              b.cashout_amount::text AS cashout_amount
         FROM sportsbook_bets b
        WHERE b.id = $1 AND b.tenant_id = $2`,
      [betId, scope.tenantId]
    );
    const b = bet.rows[0];
    if (!b) throw new NotFoundError('Bet not found');
    if (b.user_id !== scope.userId) {
      throw new ForbiddenError('You do not own this bet');
    }
    const legs = await client.query(
      `SELECT l.id, l.selection_id, l.odds_at_placement::text, l.status,
              l.settled_at,
              s.label AS selection_label, s.odds_decimal::text AS current_odds,
              s.result,
              m.market_type, m.label AS market_label,
              ev.id AS event_id, ev.home_team, ev.away_team, ev.league,
              ev.sport, ev.starts_at, ev.status AS event_status,
              ev.home_score, ev.away_score
         FROM sportsbook_bet_legs l
         JOIN sports_selections s ON s.id = l.selection_id
         JOIN sports_markets m    ON m.id = s.market_id
         JOIN sports_events ev    ON ev.id = m.event_id
        WHERE l.bet_id = $1
        ORDER BY l.created_at ASC`,
      [betId]
    );
    return { ...b, legs: legs.rows };
  });
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

const router = Router();
router.use(authenticateToken());

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };
const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.post(
  '/place',
  wrapStatus(201, (req) => placeSlip(req, placeSlipSchema.parse(req.body)))
);

router.get('/', wrap((req) => listMyBets(req, listQuery.parse(req.query))));

// Must be registered before `/:id` so "reload" isn't parsed as a UUID.
router.get(
  '/reload/:code',
  wrap((req) => reloadTicket(req, String(req.params.code ?? '')))
);

router.get(
  '/:id',
  wrap((req) => getMyBet(req, idParam.parse(req.params).id))
);

router.post(
  '/:id/cashout',
  wrap((req) => {
    // schema parse is a no-op (empty body allowed) but keeps the contract honest.
    cashoutSchema.parse(req.body ?? {});
    return cashoutBet(req, idParam.parse(req.params).id);
  })
);

/* -------------------------------------------------------------------------- */
/* User self-cancel — POST /api/bets/:id/cancel                               */
/*                                                                            */
/* Allows a user to cancel their own PENDING ticket before any event starts,  */
/* subject to the `settlement.config.cancel_window_minutes` setting.          */
/* Refunds the full stake to the wallet.                                       */
/* -------------------------------------------------------------------------- */

router.post(
  '/:id/cancel',
  wrap(async (req) => {
    const scope = getUserScope(req);
    const betId = idParam.parse(req.params).id;

    return withTenantClient({ tenantId: scope.tenantId }, async (client) => {
      /* ---- Load settlement config to check if cancel is allowed ---- */
      const cfgRow = await client.query<{ value: unknown }>(
        `SELECT value FROM settings
          WHERE tenant_id = $1 AND key = 'settlement.config'
          LIMIT 1`,
        [scope.tenantId]
      );
      const cfg = (cfgRow.rows[0]?.value ?? {}) as Record<string, unknown>;
      // Default: cancellation DISABLED. The admin must explicitly enable
      // it via the Settlement Rules section of Main Configuration.
      const allowCancel = cfg.allow_user_cancel === true;
      if (!allowCancel) {
        throw new BadRequestError('Ticket cancellation is not allowed', {
          reason: 'cancel_disabled',
        });
      }
      const cancelWindowMinutes = typeof cfg.cancel_window_minutes === 'number'
        ? cfg.cancel_window_minutes
        : 30;

      /* ---- Load the bet (must belong to this user) ---- */
      const betRow = await client.query<{
        id: string;
        user_id: string;
        tenant_id: string;
        stake: string;
        currency: string;
        status: string;
        settlement_status: string | null;
        placed_at: Date;
      }>(
        `SELECT id, user_id, tenant_id, stake::text, currency,
                status, settlement_status, placed_at
           FROM sportsbook_bets
          WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [betId, scope.tenantId]
      );
      const bet = betRow.rows[0];
      if (!bet) throw new NotFoundError('Ticket not found');
      if (bet.user_id !== scope.userId) throw new ForbiddenError('Not your ticket');

      if (bet.status !== 'pending') {
        throw new BadRequestError('Only pending tickets can be cancelled', {
          reason: 'ticket_not_pending',
          current_status: bet.status,
        });
      }

      /* ---- Check that no event has already started ---- */
      const startedLegs = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count
           FROM sportsbook_bet_legs l
           JOIN sports_selections sel ON sel.id = l.selection_id
           JOIN sports_markets m      ON m.id   = sel.market_id
           JOIN sports_events  ev     ON ev.id  = m.event_id
          WHERE l.bet_id = $1
            AND ev.starts_at <= now() - ($2 || ' minutes')::interval`,
        [betId, cancelWindowMinutes]
      );
      if (Number(startedLegs.rows[0]?.count ?? 0) > 0) {
        throw new BadRequestError(
          'Cannot cancel — one or more events have already started',
          { reason: 'event_started' }
        );
      }

      /* ---- Cancel the bet ---- */
      await client.query(
        `UPDATE sportsbook_bets
            SET status = 'void',
                settlement_status = 'cancelled',
                settlement_reason = 'user_cancelled',
                settled_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [betId]
      );

      /* ---- Refund stake ---- */
      const walletRow = await client.query<{
        id: string; balance: string; locked_balance: string; currency: string;
      }>(
        `SELECT id, balance::text, locked_balance::text, currency
           FROM wallets
          WHERE user_id = $1 AND currency = $2
          ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
        [scope.userId, bet.currency]
      );
      const w = walletRow.rows[0];
      if (w) {
        const stake = Number(bet.stake);
        const before = Number(w.balance);
        const newBalance = Math.round((before + stake) * 100) / 100;
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
           VALUES ($1,$2,$3,'bet_refund',$4,$5,$6,$7,'completed',$8,$9::jsonb)`,
          [
            scope.tenantId, scope.userId, w.id, bet.currency,
            stake, before, newBalance,
            `cancel:${betId}`,
            JSON.stringify({ reason: 'user_cancelled', bet_id: betId }),
          ]
        );
      }

      /* ---- Write settlement audit log ---- */
      await client.query(
        `INSERT INTO settlement_audit_logs
           (tenant_id, bet_id, actor_id, action,
            old_status, new_status, stake, void_reason, settlement_reason)
         VALUES ($1,$2,$3,'user_cancel','pending','cancelled',$4,'user_cancelled','user_cancelled')`,
        [scope.tenantId, betId, scope.userId, bet.stake]
      );

      return {
        success: true,
        bet_id: betId,
        refunded: bet.stake,
        currency: bet.currency,
        new_balance: w ? String(Number(w.balance) + Number(bet.stake)) : null,
      };
    });
  })
);

// Mutation verbs against an already-placed slip are NOT allowed. Audit
// is the only spec channel for changes (see Section 10).
router.all('/:id', (req, res, next) => {
  if (req.method === 'GET') return next();
  res.set('Allow', 'GET, POST');
  res.status(405).json({
    error: 'method_not_allowed',
    message: 'Bets are immutable from the user surface — see /cashout or /cancel.',
  });
});

export default router;
