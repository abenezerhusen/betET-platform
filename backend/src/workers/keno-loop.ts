import { withTenantClient } from '../infrastructure/db/tenant-client';
import { gameRngService } from '../services/game-rng.service';
import { emitToTenant, emitToUser } from '../realtime/socket';
import { logger } from '../infrastructure/logger';
import { sendSmsBestEffort } from '../modules/notifications/notifications.service';

const TICK_MS = 500;
const BETTING_SECONDS = 30;
const DRAW_INTERVAL_MS = 1500;
const COMPLETE_HOLD_MS = 5000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

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

async function createRound(tenantId: string): Promise<void> {
  await withTenantClient({ tenantId }, async (client) => {
    const seed = gameRngService.generateRoundSeed();
    const clientSeed = gameRngService.createClientSeed();
    const r = await client.query<{ id: string }>(
      `INSERT INTO game_rounds
       (tenant_id, game_id, server_seed, server_seed_hash, client_seed, phase, started_at, reel_outcome)
       VALUES ($1,'fast-keno',$2,$3,$4,'betting',now(),$5::jsonb)
       RETURNING id`,
      [
        tenantId,
        seed.serverSeed,
        seed.serverSeedHash,
        clientSeed,
        JSON.stringify({ revealed_numbers: [], time_remaining: BETTING_SECONDS }),
      ]
    );
    emitToTenant(tenantId, 'keno:round_start', {
      round_id: r.rows[0].id,
      betting_seconds: BETTING_SECONDS,
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

async function settleRound(tenantId: string, roundId: string, allNumbers: number[]) {
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
         FROM game_bets
         LEFT JOIN users u ON u.id = b.user_id
        WHERE b.tenant_id = $1 AND b.round_id = $2 AND b.game_id = 'fast-keno'
          AND b.status = 'active'
        FOR UPDATE`,
      [tenantId, roundId]
    );
    for (const bet of betsQ.rows) {
      const selected = Array.isArray(bet.selected_numbers) ? bet.selected_numbers : [];
      const hits = selected.filter((n) => allNumbers.includes(n)).length;
      const multiplier = kenoMultiplier(selected.length, hits);
      const payout = Number((Number(bet.amount) * multiplier).toFixed(2));
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

    const seedQ = await client.query<{ server_seed: string | null }>(
      `SELECT server_seed FROM game_rounds WHERE id = $1 LIMIT 1`,
      [roundId]
    );
    const serverSeed = seedQ.rows[0]?.server_seed ?? null;
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

  if (!round) {
    await createRound(tenantId);
    return;
  }

  const now = Date.now();
  const startedMs = new Date(round.started_at).getTime();

  if (round.phase === 'betting') {
    const elapsedSec = Math.floor((now - startedMs) / 1000);
    const timeRemaining = Math.max(0, BETTING_SECONDS - elapsedSec);
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
      await settleRound(tenantId, round.id, allNumbers);
    }
    return;
  }

  if (round.phase === 'complete') {
    const ended = round.ended_at ? new Date(round.ended_at).getTime() : startedMs;
    if (now - ended >= COMPLETE_HOLD_MS) {
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
