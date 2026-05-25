import { withTenantClient } from '../infrastructure/db/tenant-client';
import { gameRngService } from '../services/game-rng.service';
import { emitToTenant, emitToUser } from '../realtime/socket';
import { logger } from '../infrastructure/logger';
import { sendSmsBestEffort } from '../modules/notifications/notifications.service';

const TICK_MS = 200;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

function multiplierAt(elapsedMs: number): number {
  // Slightly different curve than Aviator, still server-authoritative crash flow.
  return Number((Math.exp(elapsedMs / 16_000) * 1).toFixed(2));
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

async function readGameStatusAndRtp(
  tenantId: string
): Promise<{ status: 'Active' | 'Disabled'; rtp: number } | null> {
  return withTenantClient({ tenantId, bypassRls: true }, async (client) => {
    const g = await client.query<{ status: string; default_rtp: string }>(
      `SELECT status, default_rtp::text FROM internal_games WHERE id = 'jetx'`
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
        `SELECT rtp::text FROM game_rtp_overrides WHERE game_id = 'jetx' AND client_id = $1`,
        [clientId]
      );
      if (o.rows[0]) rtp = Number(o.rows[0].rtp);
    }
    return { status: 'Active', rtp };
  });
}

async function rotateRound(tenantId: string) {
  await withTenantClient({ tenantId }, async (client) => {
    const seed = gameRngService.generateRoundSeed();
    const clientSeed = gameRngService.createClientSeed();
    const create = await client.query<{ id: string }>(
      `INSERT INTO game_rounds
       (tenant_id, game_id, server_seed, server_seed_hash, client_seed, phase, started_at)
       VALUES ($1,'jetx',$2,$3,$4,'waiting',now())
       RETURNING id`,
      [tenantId, seed.serverSeed, seed.serverSeedHash, clientSeed]
    );
    emitToTenant(tenantId, 'jetx:round_start', {
      round_id: create.rows[0].id,
      server_seed_hash: seed.serverSeedHash,
      client_seed: clientSeed,
      phase: 'waiting',
      waiting_seconds: 10,
    });
  });
}

async function tickTenant(tenantId: string) {
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
        WHERE tenant_id = $1 AND game_id = 'jetx'
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId]
    );
    return r.rows[0] ?? null;
  });

  const gameInfo = await readGameStatusAndRtp(tenantId);
  if (gameInfo?.status === 'Disabled' && (!round || round.phase === 'crashed')) {
    return;
  }

  if (!round) {
    await rotateRound(tenantId);
    return;
  }

  if (round.phase === 'waiting') {
    const elapsed = Date.now() - new Date(round.started_at).getTime();
    if (elapsed >= 10_000) {
      await withTenantClient({ tenantId }, async (client) => {
        await client.query(`UPDATE game_rounds SET phase = 'flying' WHERE id = $1`, [round.id]);
      });
      emitToTenant(tenantId, 'jetx:round_flying', { round_id: round.id, multiplier: 1 });
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
          AND game_id = 'jetx'
          AND status = 'active'
          AND auto_cashout IS NOT NULL
          AND auto_cashout <= $2::numeric
        FOR UPDATE`,
      [round.id, currentMultiplier]
    );

    for (const bet of autoQ.rows) {
      const payout = Number((Number(bet.amount) * Number(bet.auto_cashout)).toFixed(2));
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
          `jetx-auto-cashout-${bet.id}`,
          JSON.stringify({ round_id: round.id, multiplier: Number(bet.auto_cashout) }),
        ]
      );
      emitToUser(tenantId, bet.user_id, 'jetx:player_cashout', {
        amount: payout,
        multiplier: Number(bet.auto_cashout),
      });
      await sendSmsBestEffort({
        tenantId,
        to: bet.user_phone,
        templateCode: 'game_win',
        message: 'You won {amount} ETB in JetX.',
        variables: { amount: payout.toFixed(2) },
      });
    }
  });

  emitToTenant(tenantId, 'jetx:round_flying', {
    round_id: round.id,
    multiplier: currentMultiplier,
  });

  if (currentMultiplier >= crashPoint) {
    await settleRound(tenantId, round.id, crashPoint);
    emitToTenant(tenantId, 'jetx:round_crashed', {
      round_id: round.id,
      crash_point: crashPoint,
      server_seed: round.server_seed,
    });
  }
}

export function startJetxLoop(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const tenants = await withTenantClient(
        { tenantId: null, bypassRls: true },
        async (client) => {
          const fromRounds = await client.query<{ tenant_id: string }>(
            `SELECT DISTINCT tenant_id FROM game_rounds WHERE game_id = 'jetx'`
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
      logger.error({ err }, 'jetx loop tick failed');
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'jetx loop started');
}

export function stopJetxLoop(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('jetx loop stopped');
}
