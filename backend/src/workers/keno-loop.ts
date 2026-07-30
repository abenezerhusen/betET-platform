import { withTenantClient } from '../infrastructure/db/tenant-client';
import { gameRngService } from '../services/game-rng.service';
import {
  emitToTenant,
  emitToUser,
  getTenantOnlineCount,
} from '../realtime/socket';
import { logger } from '../infrastructure/logger';
import { sendSmsBestEffort } from '../modules/notifications/notifications.service';

const TICK_MS = 500;
const BETTING_SECONDS = 30; // default; admin-overridable per tenant
const DRAW_INTERVAL_MS = 1500;
const COMPLETE_HOLD_MS = 5000;

// Admin-configurable betting countdown (settings key `games.countdown.fast-keno`).
// Cached per tenant and refreshed when each new round is created, so the value
// stays consistent for the lifetime of any given round.
const bettingSecondsByTenant = new Map<string, number>();

function getBettingSeconds(tenantId: string): number {
  return bettingSecondsByTenant.get(tenantId) ?? BETTING_SECONDS;
}

async function refreshBettingSeconds(tenantId: string): Promise<number> {
  try {
    const secs = await withTenantClient(
      { tenantId, bypassRls: true },
      async (client) => {
        const r = await client.query<{ value: { betting_seconds?: number } }>(
          `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'games.countdown.fast-keno'`,
          [tenantId]
        );
        const v = Number(r.rows[0]?.value?.betting_seconds);
        return Number.isFinite(v) && v >= 5 && v <= 300 ? Math.floor(v) : BETTING_SECONDS;
      }
    );
    bettingSecondsByTenant.set(tenantId, secs);
    return secs;
  } catch {
    return getBettingSeconds(tenantId);
  }
}

// "Players online" baseline. The displayed figure is this base plus the real
// number of *additional* live socket connections in the tenant, so the counter
// starts at 100 when a single player is present and rises with real traffic.
const ONLINE_BASE = 100;
const ONLINE_EMIT_INTERVAL_MS = 5000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
// Throttle the online-count broadcast per tenant (the loop ticks every 500ms).
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
  emitToTenant(tenantId, 'keno:online', { online: onlinePlayers(tenantId) });
}

function kenoMultiplier(spots: number, hits: number): number {
  const table: Record<number, Record<number, number>> = {
    1: { 1: 3.5 },
    2: { 1: 1, 2: 10 },
    3: { 2: 1.5, 3: 50 },
    4: { 2: 1, 3: 10, 4: 80 },
    5: { 3: 3, 4: 30, 5: 150 },
    6: { 3: 2, 4: 15, 5: 60, 6: 500 },
    7: { 0: 1, 4: 4, 5: 20, 6: 80, 7: 1000 },
    8: { 0: 1, 5: 5, 6: 50, 7: 200, 8: 2000 },
    9: { 0: 2, 5: 2, 6: 10, 7: 125, 8: 1000, 9: 5000 },
    10: { 0: 2, 5: 5, 6: 30, 7: 100, 8: 300, 9: 2000, 10: 10000 },
  };
  return table[spots]?.[hits] ?? 0;
}

/**
 * Binomial coefficient as a double (exact-integer precision isn't needed for
 * an RTP calibration; doubles comfortably hold C(80,20) ≈ 3.5e18).
 */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1);
  return r;
}

/**
 * Inherent return of the keno paytable for a given spot count under a fair
 * 20-of-80 draw: Σ_h P(hits=h)·payTable[spots][h], where P is the
 * hypergeometric probability. Precomputed once so `settleRound` can rescale
 * every payout to hit the admin-configured RTP exactly (each spot bucket has
 * a different natural return, so we normalise per spot count).
 */
const KENO_TOTAL = choose(80, 20);
const KENO_BASE_RTP: Record<number, number> = (() => {
  const out: Record<number, number> = {};
  for (let spots = 1; spots <= 10; spots += 1) {
    let expected = 0;
    for (let hits = 0; hits <= spots; hits += 1) {
      const p = (choose(spots, hits) * choose(80 - spots, 20 - hits)) / KENO_TOTAL;
      expected += p * kenoMultiplier(spots, hits);
    }
    out[spots] = expected > 0 ? expected : 1;
  }
  return out;
})();

/**
 * Look up the effective RTP for Fast Keno, honouring the per-tenant override
 * (keyed on the tenant slug as client_id) exactly like the Aviator/JetX
 * workers. Returns `null` when the game row is missing.
 *
 * Fast Keno's paytable above is tuned to be roughly fair (≈100% return); the
 * admin RTP then scales every payout so the realised return matches the
 * configured percentage — identical to how Multi Hot 5 (slot) and the crash
 * games apply their RTP. Without this the admin RTP knob had NO effect on
 * Keno outcomes.
 */
async function readGameStatusAndRtp(
  tenantId: string
): Promise<{ status: 'Active' | 'Disabled'; rtp: number } | null> {
  return withTenantClient({ tenantId, bypassRls: true }, async (client) => {
    const g = await client.query<{ status: string; default_rtp: string }>(
      `SELECT status, default_rtp::text FROM internal_games WHERE id = 'fast-keno'`
    );
    if (!g.rows[0]) return null;
    if (g.rows[0].status === 'Disabled') {
      return { status: 'Disabled', rtp: Number(g.rows[0].default_rtp) };
    }
    const slug = await client.query<{ slug: string | null }>(
      `SELECT slug FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const clientId = slug.rows[0]?.slug ?? '';
    let rtp = Number(g.rows[0].default_rtp);
    if (clientId) {
      const o = await client.query<{ rtp: string }>(
        `SELECT rtp::text FROM game_rtp_overrides WHERE game_id = 'fast-keno' AND client_id = $1`,
        [clientId]
      );
      if (o.rows[0]) rtp = Number(o.rows[0].rtp);
    }
    return { status: 'Active', rtp };
  });
}

async function createRound(tenantId: string): Promise<void> {
  const bettingSeconds = await refreshBettingSeconds(tenantId);
  await withTenantClient({ tenantId }, async (client) => {
    const seed = gameRngService.generateRoundSeed();
    const clientSeed = gameRngService.createClientSeed();
    // `game_code` is filled by the column DEFAULT (8-digit sequence) — read it
    // back so the client can show a short, human-readable round Game ID.
    const r = await client.query<{ id: string; game_code: string }>(
      `INSERT INTO game_rounds
       (tenant_id, game_id, server_seed, server_seed_hash, client_seed, phase, started_at, reel_outcome)
       VALUES ($1,'fast-keno',$2,$3,$4,'betting',now(),$5::jsonb)
       RETURNING id, game_code`,
      [
        tenantId,
        seed.serverSeed,
        seed.serverSeedHash,
        clientSeed,
        JSON.stringify({ revealed_numbers: [], time_remaining: bettingSeconds }),
      ]
    );
    emitToTenant(tenantId, 'keno:round_start', {
      round_id: r.rows[0].id,
      game_code: r.rows[0].game_code,
      betting_seconds: bettingSeconds,
      online: onlinePlayers(tenantId),
    });
  });
}

async function startDrawing(tenantId: string, roundId: string): Promise<void> {
  await withTenantClient({ tenantId }, async (client) => {
    const roundQ = await client.query<{
      server_seed: string;
      client_seed: string;
    }>(
      `SELECT server_seed, client_seed
         FROM game_rounds
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
      [roundId, tenantId]
    );
    const row = roundQ.rows[0];
    if (!row) return;
    const numbers = gameRngService.generateKenoNumbers(
      row.server_seed,
      row.client_seed,
      roundId
    );
    await client.query(
      `UPDATE game_rounds
          SET phase = 'drawing',
              started_at = started_at,
              drawn_numbers = $2::int[],
              reel_outcome = $3::jsonb
        WHERE id = $1`,
      [
        roundId,
        numbers,
        JSON.stringify({
          revealed_numbers: [],
          draw_started_at: new Date().toISOString(),
          draw_index: 0,
          all_numbers: numbers,
          time_remaining: 0,
        }),
      ]
    );
  });
}

async function settleRound(
  tenantId: string,
  roundId: string,
  allNumbers: number[],
  rtpMultiplier: number
) {
  await withTenantClient({ tenantId }, async (client) => {
    const betsQ = await client.query<{
      id: string;
      user_id: string;
      user_phone: string | null;
      amount: string;
      selected_numbers: number[];
      status: string;
    }>(
      `SELECT b.id, b.user_id, u.phone AS user_phone, b.amount::text, b.selected_numbers, b.status
         FROM game_bets b
         LEFT JOIN users u ON u.id = b.user_id
        WHERE b.tenant_id = $1 AND b.round_id = $2 AND b.game_id = 'fast-keno'
          AND b.status = 'active'
        FOR UPDATE OF b`,
      [tenantId, roundId]
    );
    for (const bet of betsQ.rows) {
      const selected = Array.isArray(bet.selected_numbers) ? bet.selected_numbers : [];
      const hits = selected.filter((n) => allNumbers.includes(n)).length;
      const multiplier = kenoMultiplier(selected.length, hits);
      // Rescale so the realised return matches the admin-configured RTP
      // exactly (same guarantee as Multi Hot 5 / crash games). The paytable's
      // natural return per spot count is divided out, then the target
      // rtpMultiplier (rtp% / 100) is applied: payout = stake · payMult ·
      // (targetRtp / baseRtp[spots]).
      const baseRtp = KENO_BASE_RTP[selected.length] ?? 1;
      const scale = rtpMultiplier / baseRtp;
      const payout = Number((Number(bet.amount) * multiplier * scale).toFixed(2));
      const status = payout > 0 ? 'won' : 'lost';

      await client.query(
        `UPDATE game_bets
            SET status = $2, payout = $3::numeric, updated_at = now(),
                metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('hits', $4::int, 'all_numbers', $5::int[])
          WHERE id = $1`,
        [bet.id, status, payout, hits, allNumbers]
      );

      if (payout > 0) {
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
            `keno-win-${bet.id}`,
            JSON.stringify({ round_id: roundId, hits }),
          ]
        );
        emitToUser(tenantId, bet.user_id, 'keno:player_wins', {
          spots_hit: hits,
          payout,
        });
        await sendSmsBestEffort({
          tenantId,
          to: bet.user_phone,
          templateCode: 'game_win',
          message: 'You won {amount} ETB in Fast Keno.',
          variables: { amount: payout.toFixed(2) },
        });
      }
    }

    const seedQ = await client.query<{
      server_seed: string | null;
      game_code: string | null;
    }>(
      `SELECT server_seed, game_code FROM game_rounds WHERE id = $1 LIMIT 1`,
      [roundId]
    );
    const serverSeed = seedQ.rows[0]?.server_seed ?? null;
    const gameCode = seedQ.rows[0]?.game_code ?? null;
    await client.query(
      `UPDATE game_rounds
          SET phase = 'complete',
              ended_at = now(),
              reel_outcome = COALESCE(reel_outcome, '{}'::jsonb) ||
                             jsonb_build_object('revealed_numbers', $2::int[], 'time_remaining', 0)
        WHERE id = $1`,
      [roundId, allNumbers]
    );
    emitToTenant(tenantId, 'keno:round_complete', {
      round_id: roundId,
      game_code: gameCode,
      all_numbers: allNumbers,
      server_seed: serverSeed,
    });
  });
}

async function tickTenant(tenantId: string): Promise<void> {
  const round = await withTenantClient({ tenantId }, async (client) => {
    const q = await client.query<{
      id: string;
      phase: string;
      started_at: Date;
      drawn_numbers: number[] | null;
      reel_outcome: Record<string, unknown> | null;
      ended_at: Date | null;
    }>(
      `SELECT id, phase, started_at, drawn_numbers, reel_outcome, ended_at
         FROM game_rounds
        WHERE tenant_id = $1 AND game_id = 'fast-keno'
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId]
    );
    return q.rows[0] ?? null;
  });

  // Honour admin-controlled Active/Disabled + effective RTP. When Disabled we
  // stop opening new rounds (existing rounds finish naturally); the /keno/bet
  // route already refuses new bets while Disabled.
  const gameInfo = await readGameStatusAndRtp(tenantId);
  const rtpMultiplier = gameRngService.slotPayoutMultiplier(gameInfo?.rtp ?? null);

  // Keep the "players online" figure fresh between round boundaries.
  emitOnlineCount(tenantId);

  if (!round) {
    if (gameInfo?.status === 'Disabled') return;
    await createRound(tenantId);
    return;
  }

  const now = Date.now();
  const startedMs = new Date(round.started_at).getTime();

  if (round.phase === 'betting') {
    const elapsedSec = Math.floor((now - startedMs) / 1000);
    const timeRemaining = Math.max(0, getBettingSeconds(tenantId) - elapsedSec);
    await withTenantClient({ tenantId }, async (client) => {
      await client.query(
        `UPDATE game_rounds
            SET reel_outcome = COALESCE(reel_outcome, '{}'::jsonb) ||
                               jsonb_build_object('time_remaining', $2::int)
          WHERE id = $1`,
        [round.id, timeRemaining]
      );
    });
    if (timeRemaining <= 0) {
      await startDrawing(tenantId, round.id);
    }
    return;
  }

  if (round.phase === 'drawing') {
    const drawStarted = new Date(
      (round.reel_outcome?.draw_started_at as string | undefined) ?? round.started_at
    ).getTime();
    const allNumbers = Array.isArray(round.drawn_numbers) ? round.drawn_numbers : [];
    const targetIndex = Math.min(20, Math.floor((now - drawStarted) / DRAW_INTERVAL_MS));
    const currentIndex = Number((round.reel_outcome?.draw_index ?? 0).toString());
    if (targetIndex > currentIndex) {
      await withTenantClient({ tenantId }, async (client) => {
        const revealed = allNumbers.slice(0, targetIndex);
        await client.query(
          `UPDATE game_rounds
              SET reel_outcome = COALESCE(reel_outcome, '{}'::jsonb) ||
                                 jsonb_build_object('revealed_numbers', $2::int[], 'draw_index', $3::int, 'time_remaining', 0)
            WHERE id = $1`,
          [round.id, revealed, targetIndex]
        );
        for (let i = currentIndex; i < targetIndex; i += 1) {
          emitToTenant(tenantId, 'keno:number_drawn', {
            round_id: round.id,
            number: allNumbers[i],
            position: i + 1,
          });
        }
      });
    }
    if (targetIndex >= 20) {
      await settleRound(tenantId, round.id, allNumbers, rtpMultiplier);
    }
    return;
  }

  if (round.phase === 'complete') {
    const ended = round.ended_at ? new Date(round.ended_at).getTime() : startedMs;
    if (now - ended >= COMPLETE_HOLD_MS && gameInfo?.status !== 'Disabled') {
      await createRound(tenantId);
    }
  }
}

export function startKenoLoop(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const tenants = await withTenantClient(
        { tenantId: null, bypassRls: true },
        async (client) => {
          const fromRounds = await client.query<{ tenant_id: string }>(
            `SELECT DISTINCT tenant_id FROM game_rounds WHERE game_id = 'fast-keno'`
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
      logger.error({ err }, 'keno loop tick failed');
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'keno loop started');
}

export function stopKenoLoop(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('keno loop stopped');
}
