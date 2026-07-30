/**
 * Rain Bonus engine (Stake / Roobet style).
 *
 * A "rain" is a scheduled promotional drop of free cash. When a rain event
 * fires for a game, eligible online players get a short window to CLAIM their
 * share, which is credited instantly to their wallet (main or bonus balance
 * per the admin config) — first-come until the pool / claim slots run out.
 *
 * Config is admin-controlled per game and stored in the `settings` table under
 * `games.rain.<gameId>` (see admin games settings routes). The scheduler that
 * decides WHEN to fire lives in `workers/rain-loop.ts`; this module owns the
 * in-memory active-event state, eligibility checks and the atomic wallet
 * credit performed on claim.
 *
 * The backend runs as a single process, so the API claim handler and the
 * scheduler share this module's in-memory map. Active events are short-lived
 * (a claim window is seconds→minutes), so losing them on a restart is
 * acceptable; the DB transaction reference (`rain:<eventId>:<userId>`) still
 * guarantees a player can never be credited twice for the same rain.
 */
import crypto from 'node:crypto';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { emitToTenant, emitToUser } from '../realtime/socket';
import { logger } from '../infrastructure/logger';

export type RainGameId = 'fast-keno' | 'aviator';

export interface RainConfig {
  is_enabled: boolean;
  /** Total pool per rain event (ETB). Used to derive per-claim in equal mode. */
  pool_amount: number;
  /** Fixed amount per claimer (equal mode). 0 → derive pool_amount / max_claims. */
  per_claim_amount: number;
  /** How the pool is split between claimers. */
  distribution: 'equal' | 'random';
  /** Max number of players that can claim a single rain event. */
  max_claims: number;
  /** How many rain events fire per day. */
  rains_per_day: number;
  /** Daily UTC window "HH:MM"; empty strings ⇒ all day. */
  window_start: string;
  window_end: string;
  /** Seconds a rain event stays claimable. */
  claim_deadline_seconds: number;
  /** Where the reward lands. */
  credit_target: 'bonus' | 'main';
  /** Eligibility gates. 0 disables the corresponding check. */
  min_balance: number;
  min_wager_today: number;
  min_account_age_days: number;
  currency: string;
}

export const DEFAULT_RAIN_CONFIG: RainConfig = {
  is_enabled: false,
  pool_amount: 500,
  per_claim_amount: 5,
  distribution: 'equal',
  max_claims: 10,
  rains_per_day: 20,
  window_start: '',
  window_end: '',
  claim_deadline_seconds: 600,
  credit_target: 'bonus',
  min_balance: 0,
  min_wager_today: 0,
  min_account_age_days: 0,
  currency: 'ETB',
};

export function normalizeRainConfig(raw: unknown): RainConfig {
  const c = (raw ?? {}) as Partial<RainConfig>;
  const num = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : d;
  return {
    is_enabled: Boolean(c.is_enabled),
    pool_amount: num(c.pool_amount, DEFAULT_RAIN_CONFIG.pool_amount),
    per_claim_amount: num(c.per_claim_amount, DEFAULT_RAIN_CONFIG.per_claim_amount),
    distribution: c.distribution === 'random' ? 'random' : 'equal',
    max_claims: Math.max(1, Math.floor(num(c.max_claims, DEFAULT_RAIN_CONFIG.max_claims))),
    rains_per_day: Math.max(
      1,
      Math.floor(num(c.rains_per_day, DEFAULT_RAIN_CONFIG.rains_per_day))
    ),
    window_start: typeof c.window_start === 'string' ? c.window_start : '',
    window_end: typeof c.window_end === 'string' ? c.window_end : '',
    claim_deadline_seconds: Math.max(
      10,
      Math.floor(num(c.claim_deadline_seconds, DEFAULT_RAIN_CONFIG.claim_deadline_seconds))
    ),
    credit_target: c.credit_target === 'main' ? 'main' : 'bonus',
    min_balance: Math.max(0, num(c.min_balance, 0)),
    min_wager_today: Math.max(0, num(c.min_wager_today, 0)),
    min_account_age_days: Math.max(0, Math.floor(num(c.min_account_age_days, 0))),
    currency: typeof c.currency === 'string' && c.currency ? c.currency : 'ETB',
  };
}

export async function loadRainConfig(
  tenantId: string,
  gameId: RainGameId
): Promise<RainConfig> {
  return withTenantClient({ tenantId, bypassRls: true }, async (client) => {
    const r = await client.query<{ value: unknown }>(
      `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2`,
      [tenantId, `games.rain.${gameId}`]
    );
    return normalizeRainConfig(r.rows[0]?.value ?? null);
  });
}

interface RainEvent {
  id: string;
  tenantId: string;
  gameId: RainGameId;
  distribution: 'equal' | 'random';
  perClaim: number;
  remainingPool: number;
  remainingClaims: number;
  totalClaims: number;
  closesAt: number;
  creditTarget: 'bonus' | 'main';
  currency: string;
  minBalance: number;
  minWagerToday: number;
  minAccountAgeDays: number;
  claimed: Set<string>;
}

const activeRains = new Map<string, RainEvent>();
const key = (tenantId: string, gameId: RainGameId) => `${tenantId}:${gameId}`;

export interface ActiveRainView {
  id: string;
  game: RainGameId;
  currency: string;
  /** Advertised per-claim amount (equal) or the pool (random). */
  amount: number;
  distribution: 'equal' | 'random';
  remaining_claims: number;
  total_claims: number;
  closes_at: number;
  seconds_left: number;
}

function toView(ev: RainEvent): ActiveRainView {
  return {
    id: ev.id,
    game: ev.gameId,
    currency: ev.currency,
    amount: ev.distribution === 'equal' ? ev.perClaim : ev.remainingPool,
    distribution: ev.distribution,
    remaining_claims: ev.remainingClaims,
    total_claims: ev.totalClaims,
    closes_at: ev.closesAt,
    seconds_left: Math.max(0, Math.round((ev.closesAt - Date.now()) / 1000)),
  };
}

/** The live rain for this game, or null when none is open. */
export function getActiveRain(
  tenantId: string,
  gameId: RainGameId
): ActiveRainView | null {
  const ev = activeRains.get(key(tenantId, gameId));
  if (!ev) return null;
  if (Date.now() >= ev.closesAt || ev.remainingClaims <= 0) {
    closeRain(tenantId, gameId, 'expired');
    return null;
  }
  return toView(ev);
}

/** Open a new rain event (called by the scheduler). Idempotent per game. */
export function openRain(
  tenantId: string,
  gameId: RainGameId,
  cfg: RainConfig
): ActiveRainView | null {
  const k = key(tenantId, gameId);
  const existing = activeRains.get(k);
  if (existing && Date.now() < existing.closesAt && existing.remainingClaims > 0) {
    return toView(existing); // one active rain per game at a time
  }
  const claims = Math.max(1, cfg.max_claims);
  const perClaim =
    cfg.per_claim_amount > 0
      ? cfg.per_claim_amount
      : Math.floor((cfg.pool_amount / claims) * 100) / 100;
  const pool = cfg.per_claim_amount > 0 ? perClaim * claims : cfg.pool_amount;
  const ev: RainEvent = {
    id: crypto.randomUUID(),
    tenantId,
    gameId,
    distribution: cfg.distribution,
    perClaim,
    remainingPool: pool,
    remainingClaims: claims,
    totalClaims: claims,
    closesAt: Date.now() + cfg.claim_deadline_seconds * 1000,
    creditTarget: cfg.credit_target,
    currency: cfg.currency,
    minBalance: cfg.min_balance,
    minWagerToday: cfg.min_wager_today,
    minAccountAgeDays: cfg.min_account_age_days,
    claimed: new Set(),
  };
  activeRains.set(k, ev);
  const view = toView(ev);
  emitToTenant(tenantId, 'rain:open', view);
  logger.info(
    { tenantId, gameId, rainId: ev.id, perClaim, claims, pool },
    'rain event opened'
  );
  return view;
}

export function closeRain(
  tenantId: string,
  gameId: RainGameId,
  reason: 'expired' | 'depleted' | 'disabled'
): void {
  const k = key(tenantId, gameId);
  const ev = activeRains.get(k);
  if (!ev) return;
  activeRains.delete(k);
  emitToTenant(tenantId, 'rain:closed', { id: ev.id, game: gameId, reason });
}

export class RainClaimError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface RainClaimResult {
  amount: number;
  currency: string;
  credit_target: 'bonus' | 'main';
  balance_after: number;
  rain_id: string;
}

/**
 * Claim the current rain for a game. Validates eligibility, credits the wallet
 * atomically and records an idempotent ledger entry. Throws RainClaimError on
 * any ineligibility so the route can map it to a 400 with a reason.
 */
export async function claimRain(params: {
  tenantId: string;
  userId: string;
  gameId: RainGameId;
}): Promise<RainClaimResult> {
  const { tenantId, userId, gameId } = params;
  const ev = activeRains.get(key(tenantId, gameId));
  if (!ev || Date.now() >= ev.closesAt) {
    throw new RainClaimError('no_active_rain', 'No active rain to claim');
  }
  if (ev.remainingClaims <= 0 || ev.remainingPool <= 0) {
    closeRain(tenantId, gameId, 'depleted');
    throw new RainClaimError('rain_depleted', 'This rain has been fully claimed');
  }
  if (ev.claimed.has(userId)) {
    throw new RainClaimError('already_claimed', 'You already claimed this rain');
  }
  // Reserve a slot up-front to avoid two concurrent claims over-drawing the
  // pool; released on failure.
  ev.claimed.add(userId);
  ev.remainingClaims -= 1;

  try {
    // Compute this claimer's share.
    let amount: number;
    if (ev.distribution === 'random') {
      // Random within remaining pool but leave enough for the remaining slots
      // (min 1 ETB each) so late claimers still receive something.
      const reserveForOthers = ev.remainingClaims * 1;
      const maxThis = Math.max(1, ev.remainingPool - reserveForOthers);
      const isLast = ev.remainingClaims === 0;
      amount = isLast
        ? Math.round(ev.remainingPool * 100) / 100
        : Math.round((1 + Math.random() * (maxThis - 1)) * 100) / 100;
    } else {
      amount = Math.min(ev.perClaim, ev.remainingPool);
    }
    amount = Math.max(0, Math.round(amount * 100) / 100);
    if (amount <= 0) {
      throw new RainClaimError('rain_depleted', 'This rain has been fully claimed');
    }

    const result = await withTenantClient({ tenantId }, async (client) => {
      // Eligibility: account age + min balance + min wager today + active.
      const userQ = await client.query<{
        status: string;
        created_at: Date;
      }>(`SELECT status, created_at FROM users WHERE id = $1 AND tenant_id = $2`, [
        userId,
        tenantId,
      ]);
      const user = userQ.rows[0];
      if (!user) throw new RainClaimError('user_not_found', 'User not found');
      if (user.status !== 'active') {
        throw new RainClaimError('account_inactive', `Account is ${user.status}`);
      }
      if (ev.minAccountAgeDays > 0) {
        const ageMs = Date.now() - new Date(user.created_at).getTime();
        if (ageMs < ev.minAccountAgeDays * 86_400_000) {
          throw new RainClaimError(
            'account_too_new',
            `Account must be at least ${ev.minAccountAgeDays} day(s) old`
          );
        }
      }

      // Lock wallet.
      const walletQ = await client.query<{
        id: string;
        balance: string;
        bonus_balance: string;
        currency: string;
      }>(
        `SELECT id, balance::text, bonus_balance::text, currency
           FROM wallets
          WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
          FOR UPDATE`,
        [tenantId, userId, ev.currency]
      );
      let wallet = walletQ.rows[0];
      if (!wallet) {
        // Lazily create a wallet so brand-new players can still receive rain.
        await client.query(
          `INSERT INTO wallets (tenant_id, user_id, currency, balance)
           VALUES ($1,$2,$3,0)
           ON CONFLICT ON CONSTRAINT wallets_user_currency_unique DO NOTHING`,
          [tenantId, userId, ev.currency]
        );
        const again = await client.query<{
          id: string;
          balance: string;
          bonus_balance: string;
          currency: string;
        }>(
          `SELECT id, balance::text, bonus_balance::text, currency
             FROM wallets WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
             FOR UPDATE`,
          [tenantId, userId, ev.currency]
        );
        wallet = again.rows[0];
      }
      if (!wallet) throw new RainClaimError('no_wallet', 'No wallet for currency');

      if (ev.minBalance > 0 && Number(wallet.balance) < ev.minBalance) {
        throw new RainClaimError(
          'below_min_balance',
          `Minimum balance of ${ev.minBalance} ${ev.currency} required`
        );
      }
      if (ev.minWagerToday > 0) {
        const wagerQ = await client.query<{ wagered: string }>(
          `SELECT COALESCE(SUM(-amount),0)::text AS wagered
             FROM transactions
            WHERE wallet_id = $1 AND type = 'bet_stake'
              AND created_at >= date_trunc('day', now())`,
          [wallet.id]
        );
        if (Number(wagerQ.rows[0]?.wagered ?? 0) < ev.minWagerToday) {
          throw new RainClaimError(
            'below_min_wager',
            `Wager at least ${ev.minWagerToday} ${ev.currency} today to qualify`
          );
        }
      }

      // Idempotency: never credit the same player twice for a rain.
      const reference = `rain:${ev.id}:${userId}`;
      const dup = await client.query(
        `SELECT 1 FROM transactions WHERE tenant_id = $1 AND reference = $2 LIMIT 1`,
        [tenantId, reference]
      );
      if ((dup.rowCount ?? 0) > 0) {
        throw new RainClaimError('already_claimed', 'You already claimed this rain');
      }

      const toBonus = ev.creditTarget === 'bonus';
      const before = toBonus ? Number(wallet.bonus_balance) : Number(wallet.balance);
      const after = Math.round((before + amount) * 100) / 100;
      await client.query(
        toBonus
          ? `UPDATE wallets SET bonus_balance = bonus_balance + $2::numeric,
                 version = version + 1, updated_at = now() WHERE id = $1`
          : `UPDATE wallets SET balance = balance + $2::numeric,
                 version = version + 1, updated_at = now() WHERE id = $1`,
        [wallet.id, amount]
      );
      await client.query(
        `INSERT INTO transactions
           (tenant_id, wallet_id, user_id, type, amount, before_balance,
            after_balance, currency, reference, status, metadata)
         VALUES ($1,$2,$3,'bonus_credit',$4::numeric,$5::numeric,$6::numeric,
                 $7,$8,'completed',$9::jsonb)`,
        [
          tenantId,
          wallet.id,
          userId,
          amount,
          before,
          after,
          ev.currency,
          reference,
          JSON.stringify({
            source: 'rain_bonus',
            game_id: gameId,
            rain_id: ev.id,
            credit_target: ev.creditTarget,
            non_withdrawable: toBonus,
          }),
        ]
      );
      return { after };
    });

    // Commit succeeded → decrement the pool and notify.
    ev.remainingPool = Math.max(0, Math.round((ev.remainingPool - amount) * 100) / 100);
    if (ev.remainingClaims <= 0 || ev.remainingPool <= 0) {
      closeRain(tenantId, gameId, 'depleted');
    }
    emitToUser(tenantId, userId, 'rain:claimed', {
      rain_id: ev.id,
      game: gameId,
      amount,
      currency: ev.currency,
    });
    emitToUser(tenantId, userId, 'WALLET_UPDATED', {
      reason: 'rain_bonus',
      currency: ev.currency,
    });
    return {
      amount,
      currency: ev.currency,
      credit_target: ev.creditTarget,
      balance_after: result.after,
      rain_id: ev.id,
    };
  } catch (err) {
    // Release the reserved slot so someone else can claim.
    ev.claimed.delete(userId);
    ev.remainingClaims += 1;
    throw err;
  }
}
