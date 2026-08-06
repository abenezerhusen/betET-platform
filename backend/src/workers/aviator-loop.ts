import { withTenantClient } from '../infrastructure/db/tenant-client';
import { gameRngService } from '../services/game-rng.service';
import { emitToTenant, emitToUser, getTenantOnlineCount } from '../realtime/socket';
import { logger } from '../infrastructure/logger';
import { sendSmsBestEffort } from '../modules/notifications/notifications.service';

const TICK_MS = 200;

// "Players online" baseline. The displayed figure is this base plus the real
// number of *additional* live socket connections in the tenant, so the counter
// starts at 100 when a single player is present and rises with real traffic.
const ONLINE_BASE = 100;
const ONLINE_EMIT_INTERVAL_MS = 5000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
// Throttle the online-count broadcast per tenant (the loop ticks every 200ms).
const lastOnlineEmit = new Map<string, number>();

/** Base 100 + real extra players currently connected to this tenant. */
function onlinePlayers(tenantId: string): number {
  const live = getTenantOnlineCount(tenantId);
  return ONLINE_BASE + Math.max(0, live - 1);
}

/** Broadcast the live player count, throttled to once every few seconds. */
function emitOnlineCount(tenantId: string): void {
  const now = Date.now();
  const last = lastOnlineEmit.get(tenantId) ?? 0;
  if (now - last < ONLINE_EMIT_INTERVAL_MS) return;
  lastOnlineEmit.set(tenantId, now);
  emitToTenant(tenantId, 'aviator:online', { online: onlinePlayers(tenantId) });
}

function multiplierAt(elapsedMs: number): number {
  // Smooth exponential growth curve. The divisor sets the flight pace: a
  // smaller value climbs faster (shorter rounds → more rounds per hour).
  // Tuned from 18_000 → 10_000 for a moderately faster, more engaging flight
  // (~6.9s to 2x, ~23s to 10x) without making it feel frantic. This only
  // changes how quickly the multiplier reaches the crash point — the crash
  // point itself (and therefore RTP/fairness) is unchanged.
  return Number((Math.exp(elapsedMs / 10_000) * 1).toFixed(2));
}

async function settleRound(tenantId: string, roundId: string, crashPoint: number) {
  await withTenantClient({ tenantId }, async (client) => {
    await client.query(
      `UPDATE game_rounds
          SET phase = 'crashed',
              ended_at = now(),
              reel_outcome = COALESCE(reel_outcome, '{}'::jsonb) || jsonb_build_object('crash_point', $2::numeric)
        WHERE id = $1`,
      [roundId, crashPoint]
    );

    await client.query(
      `UPDATE game_bets
          SET status = CASE WHEN status = 'active' THEN 'lost' ELSE status END,
              updated_at = now()
        WHERE round_id = $1`,
      [roundId]
    );
  });
}

/**
 * Look up the effective RTP for `gameId` honouring the per-tenant override
 * if one exists. The tenant's slug is used as the override `client_id` —
 * this mirrors how the admin panel labels white-label clients.
 *
 * Returns `null` if the game is Disabled or missing — workers skip the
 * round in that case so admin can take a game offline live.
 */
async function readGameStatusAndRtp(
  tenantId: string,
  gameId: 'aviator' | 'jetx' | 'fast-keno' | 'multi-hot-5'
): Promise<{ status: 'Active' | 'Disabled'; rtp: number; maxWin: number } | null> {
  return withTenantClient(
    { tenantId, bypassRls: true },
    async (client) => {
      const g = await client.query<{
        status: string;
        default_rtp: string;
        max_win: string;
      }>(
        `SELECT status, default_rtp::text, max_win::text FROM internal_games WHERE id = $1`,
        [gameId]
      );
      if (!g.rows[0]) return null;
      const maxWin = Number(g.rows[0].max_win);
      if (g.rows[0].status === 'Disabled') {
        return { status: 'Disabled', rtp: Number(g.rows[0].default_rtp), maxWin };
      }
      const slug = await client.query<{ slug: string | null }>(
        `SELECT slug FROM tenants WHERE id = $1`,
        [tenantId]
      );
      const clientId = slug.rows[0]?.slug ?? '';
      let rtp = Number(g.rows[0].default_rtp);
      if (clientId) {
        const o = await client.query<{ rtp: string }>(
          `SELECT rtp::text FROM game_rtp_overrides WHERE game_id = $1 AND client_id = $2`,
          [gameId, clientId]
        );
        if (o.rows[0]) rtp = Number(o.rows[0].rtp);
      }
      return { status: 'Active', rtp, maxWin };
    }
  );
}

/** Cap an auto-cashout payout at the admin-configured max-win ceiling. */
function capWin(payout: number, maxWin: number | undefined): number {
  if (!maxWin || !Number.isFinite(maxWin) || maxWin <= 0) return payout;
  return Math.min(payout, maxWin);
}

async function rotateRound(tenantId: string) {
  await withTenantClient({ tenantId }, async (client) => {
    const seed = gameRngService.generateRoundSeed();
    const clientSeed = gameRngService.createClientSeed();
    const create = await client.query<{ id: string }>(
      `INSERT INTO game_rounds
       (tenant_id, game_id, server_seed, server_seed_hash, client_seed, phase, started_at)
       VALUES ($1,'aviator',$2,$3,$4,'waiting',now())
       RETURNING id`,
      [tenantId, seed.serverSeed, seed.serverSeedHash, clientSeed]
    );
    emitToTenant(tenantId, 'aviator:round_start', {
      round_id: create.rows[0].id,
      server_seed_hash: seed.serverSeedHash,
      client_seed: clientSeed,
      phase: 'waiting',
      waiting_seconds: 10,
    });
  });
}

async function tickTenant(tenantId: string) {
  // Broadcast the live "players online" figure (base 100 + real connections).
  emitOnlineCount(tenantId);

  const round = await withTenantClient({ tenantId }, async (client) => {
    const r = await client.query<{
      id: string;
      phase: string;
      started_at: Date;
      server_seed: string | null;
      client_seed: string;
      reel_outcome: Record<string, unknown> | null;
    }>(
      `SELECT id, phase, started_at, server_seed, client_seed, reel_outcome
         FROM game_rounds
        WHERE tenant_id = $1 AND game_id = 'aviator'
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId]
    );
    return r.rows[0] ?? null;
  });

  // Honour admin-controlled Active/Disabled status. When Disabled we
  // simply stop opening new rounds — existing rounds finish naturally.
  const gameInfo = await readGameStatusAndRtp(tenantId, 'aviator');
  if (gameInfo?.status === 'Disabled' && (!round || round.phase === 'crashed')) {
    return;
  }

  if (!round) {
    await rotateRound(tenantId);
    return;
  }

  if (round.phase === 'waiting') {
    // Auto-open flight window after short waiting period.
    const elapsed = Date.now() - new Date(round.started_at).getTime();
    if (elapsed >= 10_000) {
      await withTenantClient({ tenantId }, async (client) => {
        await client.query(`UPDATE game_rounds SET phase = 'flying' WHERE id = $1`, [round.id]);
      });
      emitToTenant(tenantId, 'aviator:round_flying', { round_id: round.id, multiplier: 1 });
    }
    return;
  }

  if (round.phase !== 'flying') {
    const elapsed = Date.now() - new Date(round.started_at).getTime();
    if (elapsed >= 20_000) await rotateRound(tenantId);
    return;
  }

  const elapsed = Date.now() - new Date(round.started_at).getTime();
  const currentMultiplier = multiplierAt(Math.max(0, elapsed - 10_000));

  const crashPoint = gameRngService.generateAviatorCrashPoint(
    round.server_seed ?? '',
    round.client_seed,
    round.id,
    gameInfo?.rtp ?? null
  );

  await withTenantClient({ tenantId }, async (client) => {
    await client.query(
      `UPDATE game_rounds
          SET reel_outcome = COALESCE(reel_outcome, '{}'::jsonb) || jsonb_build_object('current_multiplier', $2::numeric)
        WHERE id = $1`,
      [round.id, currentMultiplier]
    );

    const autoQ = await client.query<{
      id: string;
      amount: string;
      auto_cashout: string;
      user_id: string;
      user_phone: string | null;
    }>(
      `SELECT id, amount::text, auto_cashout::text
            , user_id
            , (SELECT u.phone FROM users u WHERE u.id = game_bets.user_id LIMIT 1) AS user_phone
         FROM game_bets
        WHERE round_id = $1
          AND status = 'active'
          AND auto_cashout IS NOT NULL
          AND auto_cashout <= $2::numeric
        FOR UPDATE`,
      [round.id, currentMultiplier]
    );

    for (const bet of autoQ.rows) {
      const payout = Number(
        capWin(Number(bet.amount) * Number(bet.auto_cashout), gameInfo?.maxWin).toFixed(2)
      );
      await client.query(
        `UPDATE game_bets
            SET status = 'cashed_out',
                payout = $2::numeric,
                multiplier_at_cashout = $3::numeric,
                updated_at = now()
          WHERE id = $1`,
        [bet.id, payout, Number(bet.auto_cashout)]
      );
      const walletQ = await client.query<{ id: string; balance: string }>(
        `SELECT id, balance::text
           FROM wallets
          WHERE tenant_id = $1 AND user_id = $2 AND currency = 'ETB'
          FOR UPDATE`,
        [tenantId, bet.user_id]
      );
      const wallet = walletQ.rows[0];
      if (!wallet) continue;
      const before = Number(wallet.balance);
      const after = before + payout;
      await client.query(
        `UPDATE wallets
            SET balance = $2::numeric, version = version + 1, updated_at = now()
          WHERE id = $1`,
        [wallet.id, after]
      );
      await client.query(
        `INSERT INTO transactions
         (tenant_id, wallet_id, user_id, type, amount, before_balance, after_balance, currency, reference, status, metadata)
         VALUES ($1,$2,$3,'bet_win',$4::numeric,$5::numeric,$6::numeric,'ETB',$7,'completed',$8::jsonb)`,
        [
          tenantId,
          wallet.id,
          bet.user_id,
          payout,
          before,
          after,
          `aviator-auto-cashout-${bet.id}`,
          JSON.stringify({ round_id: round.id, multiplier: Number(bet.auto_cashout) }),
        ]
      );
      emitToUser(tenantId, bet.user_id, 'aviator:player_cashout', {
        amount: payout,
        multiplier: Number(bet.auto_cashout),
      });
      await sendSmsBestEffort({
        tenantId,
        to: bet.user_phone,
        templateCode: 'game_win',
        message: 'You won {amount} ETB in Aviator.',
        variables: { amount: payout.toFixed(2) },
      });
    }
  });

  emitToTenant(tenantId, 'aviator:round_flying', {
    round_id: round.id,
    multiplier: currentMultiplier,
  });

  if (currentMultiplier >= crashPoint) {
    await settleRound(tenantId, round.id, crashPoint);
    emitToTenant(tenantId, 'aviator:round_crashed', {
      round_id: round.id,
      crash_point: crashPoint,
      server_seed: round.server_seed,
    });
  }
}

export function startAviatorLoop(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      // Collect tenants from current rounds; fallback to active tenants so we
      // can bootstrap first rounds.
      const tenants = await withTenantClient(
        { tenantId: null, bypassRls: true },
        async (client) => {
          const fromRounds = await client.query<{ tenant_id: string }>(
            `SELECT DISTINCT tenant_id FROM game_rounds WHERE game_id = 'aviator'`
          );
          if (fromRounds.rows.length > 0) {
            return fromRounds.rows.map((r) => r.tenant_id);
          }
          const fromTenants = await client.query<{ id: string }>(
            `SELECT id FROM tenants WHERE status = 'active'`
          );
          return fromTenants.rows.map((r) => r.id);
        }
      );
      for (const tenantId of tenants) {
        await tickTenant(tenantId);
      }
    } catch (err) {
      logger.error({ err }, 'aviator loop tick failed');
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'aviator loop started');
}

export function stopAviatorLoop(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('aviator loop stopped');
}
