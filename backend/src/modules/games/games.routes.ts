import { Router, type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';

import { authenticateGameLaunchToken, authenticateToken } from '../../middleware/authenticate';
import { assertSiteAvailable } from '../../middleware/maintenance-mode';
import { requireRole } from '../../middleware/require-role';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError, NotFoundError } from '../../http/errors/http-error';
import { gameRngService } from '../../services/game-rng.service';
import { emitToUser, emitWalletUpdated } from '../../realtime/socket';
import { sendSmsBestEffort } from '../notifications/notifications.service';
import { claimRain, getActiveRain, RainClaimError } from '../../services/rain.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/games/aviator/bet',
  summary: 'Place Aviator game bet',
  tags: ['Games'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['round_id', 'amount'],
          properties: {
            round_id: { type: 'string', format: 'uuid' },
            amount: { type: 'number' },
            auto_cashout: { type: 'number' },
          },
        },
      },
    },
  },
  responses: { '201': { description: 'Aviator bet accepted' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/games/jetx/bet',
  summary: 'Place JetX game bet',
  tags: ['Games'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['round_id', 'amount'],
          properties: {
            round_id: { type: 'string', format: 'uuid' },
            amount: { type: 'number' },
            auto_cashout: { type: 'number' },
          },
        },
      },
    },
  },
  responses: { '201': { description: 'JetX bet accepted' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/games/jetx/cashout',
  summary: 'JetX cashout',
  tags: ['Games'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['bet_id', 'round_id'],
          properties: {
            bet_id: { type: 'string', format: 'uuid' },
            round_id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
  },
  responses: { '200': { description: 'JetX cashout result' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/games/aviator/cashout',
  summary: 'Aviator cashout',
  tags: ['Games'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['bet_id', 'round_id'],
          properties: {
            bet_id: { type: 'string', format: 'uuid' },
            round_id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
  },
  responses: { '200': { description: 'Cashout result' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/games/keno/bet',
  summary: 'Place Keno bet',
  tags: ['Games'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['round_id', 'selected_numbers', 'spots', 'amount'],
          properties: {
            round_id: { type: 'string', format: 'uuid' },
            selected_numbers: { type: 'array', items: { type: 'number' } },
            spots: { type: 'number' },
            amount: { type: 'number' },
          },
        },
      },
    },
  },
  responses: { '201': { description: 'Keno bet accepted' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/games/slots/spin',
  summary: 'Spin slots',
  tags: ['Games'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['game_id', 'bet_per_line', 'lines'],
          properties: {
            game_id: { type: 'string', enum: ['multi-hot-5'] },
            bet_per_line: { type: 'number' },
            lines: { type: 'number' },
          },
        },
      },
    },
  },
  responses: { '201': { description: 'Spin result' } },
});

const moneySchema = z.coerce.number().positive().max(1_000_000);
const uuidSchema = z.string().uuid();

const aviatorBetSchema = z.object({
  round_id: uuidSchema,
  amount: moneySchema,
  auto_cashout: z.coerce.number().min(1).max(10_000).optional(),
});

const aviatorCashoutSchema = z.object({
  bet_id: uuidSchema,
  round_id: uuidSchema,
});

const kenoBetSchema = z.object({
  round_id: uuidSchema,
  selected_numbers: z.array(z.coerce.number().int().min(1).max(80)).min(1).max(10),
  spots: z.coerce.number().int().min(1).max(10),
  amount: moneySchema,
});

const slotsSpinSchema = z.object({
  game_id: z.literal('multi-hot-5'),
  bet_per_line: moneySchema,
  lines: z.coerce.number().int().min(1).max(25),
});

function ensureUser(req: Request) {
  if (!req.user) throw new BadRequestError('Authentication required');
  return req.user;
}

async function walletForUpdate(
  req: Request,
  currency = 'ETB'
): Promise<{ walletId: string; before: number }> {
  const user = ensureUser(req);
  return withTenantClient({ tenantId: user.tenantId }, async (client) => {
    await client.query(
      `INSERT INTO wallets (tenant_id, user_id, currency, balance)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT ON CONSTRAINT wallets_user_currency_unique DO NOTHING`,
      [user.tenantId, user.id, currency]
    );
    const r = await client.query<{ id: string; balance: string }>(
      `SELECT id, balance::text
         FROM wallets
        WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
        FOR UPDATE`,
      [user.tenantId, user.id, currency]
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError('Wallet not found');
    return { walletId: row.id, before: Number(row.balance) };
  });
}

async function createLedgerTx(args: {
  req: Request;
  walletId: string;
  amount: number;
  before: number;
  type: string;
  reference: string;
  metadata?: Record<string, unknown>;
}) {
  const { req, walletId, amount, before, type, reference, metadata } = args;
  const user = ensureUser(req);
  const after = before + amount;
  await withTenantClient({ tenantId: user.tenantId }, async (client) => {
    await client.query(
      `UPDATE wallets SET balance = $2::numeric, version = version + 1, updated_at = now() WHERE id = $1`,
      [walletId, after]
    );
    await client.query(
      `INSERT INTO transactions
       (tenant_id, wallet_id, user_id, type, amount, before_balance, after_balance, currency, reference, status, metadata)
       VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7::numeric,'ETB',$8,'completed',$9::jsonb)`,
      [
        user.tenantId,
        walletId,
        user.id,
        type,
        amount,
        before,
        after,
        reference,
        JSON.stringify(metadata ?? {}),
      ]
    );
  });
  emitWalletUpdated(user.tenantId, user.id, {
    reason: type,
    wallet: { balance: after.toFixed(2), currency: 'ETB' },
  });
  return after;
}

async function currentRound(
  tenantId: string,
  gameId: 'aviator' | 'fast-keno' | 'jetx'
) {
  return withTenantClient({ tenantId }, async (client) => {
    const r = await client.query(
      `SELECT id, game_code, phase, server_seed_hash, client_seed, started_at, ended_at, crash_point, drawn_numbers, reel_outcome
         FROM game_rounds
        WHERE tenant_id = $1 AND game_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, gameId]
    );
    return r.rows[0] ?? null;
  });
}

/**
 * Mask a player identifier for public leaderboards / bet feeds: keep the first
 * and last visible character, hide the middle (e.g. `abebe` → `a***e`).
 */
function maskPlayer(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'p***r';
  // For emails, mask only the local part before '@'.
  const local = s.includes('@') ? s.slice(0, s.indexOf('@')) : s;
  if (local.length <= 1) return `${local}***`;
  if (local.length === 2) return `${local[0]}***${local[1]}`;
  return `${local[0]}***${local[local.length - 1]}`;
}

async function getUserPhone(tenantId: string, userId: string): Promise<string | null> {
  return withTenantClient({ tenantId }, async (client) => {
    const r = await client.query<{ phone: string | null }>(
      `SELECT phone FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, userId]
    );
    return r.rows[0]?.phone ?? null;
  });
}

// secure internal rounds/bets surface
router.use((req, res, next) => {
  if (
    req.path.endsWith('/round/current') ||
    req.path === '/slots/history' ||
    req.path === '/aviator/bets' ||
    req.path === '/aviator/top'
  ) {
    return authenticateGameLaunchToken()(req, res, next);
  }
  return authenticateToken()(req, res, next);
});
router.use(requireRole('user', 'affiliate'));

router.get('/aviator/round/current', async (req, res, next) => {
  try {
    const user = ensureUser(req);
    const round = await currentRound(user.tenantId, 'aviator');
    if (!round) return res.json({ round_id: null, phase: 'waiting' });
    res.json({
      round_id: round.id,
      phase: round.phase,
      server_seed_hash: round.server_seed_hash,
      client_seed: round.client_seed,
      started_at: round.started_at,
      current_multiplier:
        round.phase === 'flying'
          ? Number((round.reel_outcome?.current_multiplier ?? 1).toString())
          : null,
      crash_point: round.phase === 'crashed' ? Number(round.crash_point) : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Live + previous round bets and the recent crash-point history that power the
 * Aviator left sidebar ("All Bets" / "Previous" tabs and the multiplier strip).
 * All player identities are masked (`d***v`) — only aggregate/anonymised data
 * leaves the server.
 */
router.get('/aviator/bets', async (req, res, next) => {
  try {
    const user = ensureUser(req);
    const data = await withTenantClient({ tenantId: user.tenantId }, async (client) => {
      const roundsQ = await client.query<{ id: string; phase: string }>(
        `SELECT id, phase
           FROM game_rounds
          WHERE tenant_id = $1 AND game_id = 'aviator'
          ORDER BY created_at DESC
          LIMIT 2`,
        [user.tenantId]
      );
      const currentId = roundsQ.rows[0]?.id ?? null;
      const previousId = roundsQ.rows[1]?.id ?? null;

      const betsForRound = async (roundId: string | null) => {
        if (!roundId) return [];
        const q = await client.query<{
          amount: string;
          status: string;
          payout: string | null;
          multiplier_at_cashout: string | null;
          uname: string | null;
        }>(
          `SELECT b.amount::text,
                  b.status,
                  b.payout::text,
                  b.multiplier_at_cashout::text,
                  COALESCE(u.metadata->>'username', u.phone, u.email) AS uname
             FROM game_bets b
             LEFT JOIN users u ON u.id = b.user_id
            WHERE b.round_id = $1
            ORDER BY b.amount DESC
            LIMIT 100`,
          [roundId]
        );
        return q.rows.map((r) => {
          const cashed = r.status === 'cashed_out';
          return {
            user: maskPlayer(r.uname),
            bet: Number(r.amount),
            multiplier: cashed && r.multiplier_at_cashout ? Number(r.multiplier_at_cashout) : null,
            won: cashed && r.payout ? Number(r.payout) : null,
          };
        });
      };

      const recentQ = await client.query<{ crash_point: string }>(
        `SELECT (reel_outcome->>'crash_point') AS crash_point
           FROM game_rounds
          WHERE tenant_id = $1 AND game_id = 'aviator'
            AND phase = 'crashed' AND reel_outcome->>'crash_point' IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 20`,
        [user.tenantId]
      );

      return {
        current: await betsForRound(currentId),
        previous: await betsForRound(previousId),
        recent_multipliers: recentQ.rows.map((r) => Number(r.crash_point)),
      };
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * "Top" tab data: biggest multipliers (x), biggest wins (win) or biggest round
 * crash points (rounds) over a rolling day / month / year window.
 */
router.get('/aviator/top', async (req, res, next) => {
  try {
    const user = ensureUser(req);
    const metric = ['x', 'win', 'rounds'].includes(String(req.query.metric))
      ? String(req.query.metric)
      : 'x';
    const period = ['day', 'month', 'year'].includes(String(req.query.period))
      ? String(req.query.period)
      : 'day';
    const interval = period === 'day' ? '1 day' : period === 'month' ? '30 days' : '365 days';

    const rows = await withTenantClient({ tenantId: user.tenantId }, async (client) => {
      if (metric === 'rounds') {
        const q = await client.query<{ crash_point: string; created_at: Date }>(
          `SELECT (reel_outcome->>'crash_point') AS crash_point, created_at
             FROM game_rounds
            WHERE tenant_id = $1 AND game_id = 'aviator'
              AND phase = 'crashed' AND reel_outcome->>'crash_point' IS NOT NULL
              AND created_at >= now() - $2::interval
            ORDER BY (reel_outcome->>'crash_point')::numeric DESC
            LIMIT 20`,
          [user.tenantId, interval]
        );
        return q.rows.map((r) => ({
          dateTime: r.created_at,
          multiplier: Number(r.crash_point),
        }));
      }
      const orderCol = metric === 'win' ? 'b.payout' : 'b.multiplier_at_cashout';
      const q = await client.query<{
        amount: string;
        payout: string | null;
        multiplier_at_cashout: string | null;
        created_at: Date;
        round_max: string | null;
        uname: string | null;
      }>(
        `SELECT b.amount::text,
                b.payout::text,
                b.multiplier_at_cashout::text,
                b.created_at,
                (gr.reel_outcome->>'crash_point') AS round_max,
                COALESCE(u.metadata->>'username', u.phone, u.email) AS uname
           FROM game_bets b
           JOIN game_rounds gr ON gr.id = b.round_id
           LEFT JOIN users u ON u.id = b.user_id
          WHERE b.tenant_id = $1 AND b.game_id = 'aviator'
            AND b.status = 'cashed_out'
            AND b.created_at >= now() - $2::interval
          ORDER BY ${orderCol} DESC NULLS LAST
          LIMIT 20`,
        [user.tenantId, interval]
      );
      return q.rows.map((r) => ({
        user: maskPlayer(r.uname),
        date: r.created_at,
        betETB: Number(r.amount),
        winETB: r.payout ? Number(r.payout) : 0,
        result: r.multiplier_at_cashout ? Number(r.multiplier_at_cashout) : 0,
        roundMax: r.round_max ? Number(r.round_max) : 0,
      }));
    });
    res.json({ metric, period, items: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/aviator/bet', async (req, res, next) => {
  try {
    await assertSiteAvailable(req);
    const body = aviatorBetSchema.parse(req.body);
    const user = ensureUser(req);
    const gameInfo = await readInternalGameRtp(user.tenantId, 'aviator');
    if (gameInfo?.status === 'Disabled') {
      throw new BadRequestError('Aviator is currently disabled');
    }
    assertBetWithinLimits(body.amount, gameInfo, 'Aviator');
    const round = await currentRound(user.tenantId, 'aviator');
    if (!round || round.id !== body.round_id) throw new NotFoundError('Round not found');
    if (round.phase !== 'waiting') throw new BadRequestError('Round is not accepting bets');

    const { walletId, before } = await walletForUpdate(req);
    if (before < body.amount) throw new BadRequestError('Insufficient balance');

    const bet = await withTenantClient({ tenantId: user.tenantId }, async (client) => {
      const r = await client.query(
        `INSERT INTO game_bets
         (tenant_id, round_id, user_id, game_id, amount, auto_cashout, status)
         VALUES ($1,$2,$3,'aviator',$4,$5,'active')
         RETURNING id`,
        [user.tenantId, body.round_id, user.id, body.amount, body.auto_cashout ?? null]
      );
      return r.rows[0];
    });

    const balanceAfter = await createLedgerTx({
      req,
      walletId,
      amount: -body.amount,
      before,
      type: 'bet_stake',
      reference: `aviator-stake-${bet.id}`,
      metadata: { round_id: body.round_id, game_id: 'aviator' },
    });

    res.status(201).json({
      bet_id: bet.id,
      round_id: body.round_id,
      amount: body.amount,
      balance_after: Number(balanceAfter.toFixed(2)),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/aviator/cashout', async (req, res, next) => {
  try {
    const body = aviatorCashoutSchema.parse(req.body);
    const user = ensureUser(req);
    const gameInfo = await readInternalGameRtp(user.tenantId, 'aviator');

    const result = await withTenantClient({ tenantId: user.tenantId }, async (client) => {
      const roundQ = await client.query<{ phase: string; metadata: Record<string, unknown> }>(
        `SELECT phase, reel_outcome AS metadata FROM game_rounds WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [body.round_id, user.tenantId]
      );
      const round = roundQ.rows[0];
      if (!round) throw new NotFoundError('Round not found');
      if (round.phase !== 'flying') throw new BadRequestError('Round is not flying');

      const betQ = await client.query<{ amount: string; status: string }>(
        `SELECT amount::text, status
           FROM game_bets
          WHERE id = $1 AND round_id = $2 AND tenant_id = $3 AND user_id = $4
          LIMIT 1`,
        [body.bet_id, body.round_id, user.tenantId, user.id]
      );
      const bet = betQ.rows[0];
      if (!bet) throw new NotFoundError('Bet not found');
      if (bet.status !== 'active') throw new BadRequestError('Bet already settled');

      const currentMultiplier = Number((round.metadata?.current_multiplier ?? 1).toString());
      const payout = Number(
        capPayout(Number(bet.amount) * currentMultiplier, gameInfo).toFixed(2)
      );

      await client.query(
        `UPDATE game_bets
            SET status = 'cashed_out',
                payout = $2::numeric,
                multiplier_at_cashout = $3::numeric,
                updated_at = now()
          WHERE id = $1`,
        [body.bet_id, payout, currentMultiplier]
      );

      const wallet = await client.query<{ id: string; balance: string }>(
        `SELECT id, balance::text FROM wallets WHERE tenant_id = $1 AND user_id = $2 AND currency = 'ETB' FOR UPDATE`,
        [user.tenantId, user.id]
      );
      const w = wallet.rows[0];
      if (!w) throw new NotFoundError('Wallet not found');
      const before = Number(w.balance);
      const after = before + payout;

      await client.query(
        `UPDATE wallets SET balance = $2::numeric, version = version + 1, updated_at = now() WHERE id = $1`,
        [w.id, after]
      );
      await client.query(
        `INSERT INTO transactions
         (tenant_id, wallet_id, user_id, type, amount, before_balance, after_balance, currency, reference, status, metadata)
         VALUES ($1,$2,$3,'bet_win',$4::numeric,$5::numeric,$6::numeric,'ETB',$7,'completed',$8::jsonb)`,
        [
          user.tenantId,
          w.id,
          user.id,
          payout,
          before,
          after,
          `aviator-cashout-${body.bet_id}`,
          JSON.stringify({ round_id: body.round_id, multiplier: currentMultiplier }),
        ]
      );

      return { payout, currentMultiplier, balanceAfter: after };
    });

    emitToUser(user.tenantId, user.id, 'aviator:player_cashout', {
      amount: result.payout,
      multiplier: result.currentMultiplier,
    });
    const phone = await getUserPhone(user.tenantId, user.id);
    await sendSmsBestEffort({
      tenantId: user.tenantId,
      to: phone,
      templateCode: 'game_win',
      message: 'You won {amount} ETB in Aviator.',
      variables: { amount: result.payout.toFixed(2) },
    });

    res.json({
      payout: result.payout,
      multiplier_at_cashout: result.currentMultiplier,
      balance_after: Number(result.balanceAfter.toFixed(2)),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/jetx/round/current', async (req, res, next) => {
  try {
    const user = ensureUser(req);
    const round = await currentRound(user.tenantId, 'jetx');
    if (!round) return res.json({ round_id: null, phase: 'waiting' });
    res.json({
      round_id: round.id,
      phase: round.phase,
      server_seed_hash: round.server_seed_hash,
      client_seed: round.client_seed,
      started_at: round.started_at,
      current_multiplier:
        round.phase === 'flying'
          ? Number((round.reel_outcome?.current_multiplier ?? 1).toString())
          : null,
      crash_point: round.phase === 'crashed' ? Number(round.crash_point) : null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/jetx/bet', async (req, res, next) => {
  try {
    await assertSiteAvailable(req);
    const body = aviatorBetSchema.parse(req.body);
    const user = ensureUser(req);
    const gameInfo = await readInternalGameRtp(user.tenantId, 'jetx');
    if (gameInfo?.status === 'Disabled') {
      throw new BadRequestError('JetX is currently disabled');
    }
    assertBetWithinLimits(body.amount, gameInfo, 'JetX');
    const round = await currentRound(user.tenantId, 'jetx');
    if (!round || round.id !== body.round_id) throw new NotFoundError('Round not found');
    if (round.phase !== 'waiting') throw new BadRequestError('Round is not accepting bets');

    const { walletId, before } = await walletForUpdate(req);
    if (before < body.amount) throw new BadRequestError('Insufficient balance');

    const bet = await withTenantClient({ tenantId: user.tenantId }, async (client) => {
      const r = await client.query(
        `INSERT INTO game_bets
         (tenant_id, round_id, user_id, game_id, amount, auto_cashout, status)
         VALUES ($1,$2,$3,'jetx',$4,$5,'active')
         RETURNING id`,
        [user.tenantId, body.round_id, user.id, body.amount, body.auto_cashout ?? null]
      );
      return r.rows[0];
    });

    const balanceAfter = await createLedgerTx({
      req,
      walletId,
      amount: -body.amount,
      before,
      type: 'bet_stake',
      reference: `jetx-stake-${bet.id}`,
      metadata: { round_id: body.round_id, game_id: 'jetx' },
    });

    res.status(201).json({
      bet_id: bet.id,
      round_id: body.round_id,
      amount: body.amount,
      balance_after: Number(balanceAfter.toFixed(2)),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/jetx/cashout', async (req, res, next) => {
  try {
    const body = aviatorCashoutSchema.parse(req.body);
    const user = ensureUser(req);
    const gameInfo = await readInternalGameRtp(user.tenantId, 'jetx');

    const result = await withTenantClient({ tenantId: user.tenantId }, async (client) => {
      const roundQ = await client.query<{ phase: string; metadata: Record<string, unknown> }>(
        `SELECT phase, reel_outcome AS metadata FROM game_rounds WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [body.round_id, user.tenantId]
      );
      const round = roundQ.rows[0];
      if (!round) throw new NotFoundError('Round not found');
      if (round.phase !== 'flying') throw new BadRequestError('Round is not flying');

      const betQ = await client.query<{ amount: string; status: string }>(
        `SELECT amount::text, status
           FROM game_bets
          WHERE id = $1 AND round_id = $2 AND tenant_id = $3 AND user_id = $4
          LIMIT 1`,
        [body.bet_id, body.round_id, user.tenantId, user.id]
      );
      const bet = betQ.rows[0];
      if (!bet) throw new NotFoundError('Bet not found');
      if (bet.status !== 'active') throw new BadRequestError('Bet already settled');

      const currentMultiplier = Number((round.metadata?.current_multiplier ?? 1).toString());
      const payout = Number(
        capPayout(Number(bet.amount) * currentMultiplier, gameInfo).toFixed(2)
      );

      await client.query(
        `UPDATE game_bets
            SET status = 'cashed_out',
                payout = $2::numeric,
                multiplier_at_cashout = $3::numeric,
                updated_at = now()
          WHERE id = $1`,
        [body.bet_id, payout, currentMultiplier]
      );

      const wallet = await client.query<{ id: string; balance: string }>(
        `SELECT id, balance::text FROM wallets WHERE tenant_id = $1 AND user_id = $2 AND currency = 'ETB' FOR UPDATE`,
        [user.tenantId, user.id]
      );
      const w = wallet.rows[0];
      if (!w) throw new NotFoundError('Wallet not found');
      const before = Number(w.balance);
      const after = before + payout;

      await client.query(
        `UPDATE wallets SET balance = $2::numeric, version = version + 1, updated_at = now() WHERE id = $1`,
        [w.id, after]
      );
      await client.query(
        `INSERT INTO transactions
         (tenant_id, wallet_id, user_id, type, amount, before_balance, after_balance, currency, reference, status, metadata)
         VALUES ($1,$2,$3,'bet_win',$4::numeric,$5::numeric,$6::numeric,'ETB',$7,'completed',$8::jsonb)`,
        [
          user.tenantId,
          w.id,
          user.id,
          payout,
          before,
          after,
          `jetx-cashout-${body.bet_id}`,
          JSON.stringify({ round_id: body.round_id, multiplier: currentMultiplier }),
        ]
      );

      return { payout, currentMultiplier, balanceAfter: after };
    });

    emitToUser(user.tenantId, user.id, 'jetx:player_cashout', {
      amount: result.payout,
      multiplier: result.currentMultiplier,
    });
    const phone = await getUserPhone(user.tenantId, user.id);
    await sendSmsBestEffort({
      tenantId: user.tenantId,
      to: phone,
      templateCode: 'game_win',
      message: 'You won {amount} ETB in JetX.',
      variables: { amount: result.payout.toFixed(2) },
    });

    res.json({
      payout: result.payout,
      multiplier_at_cashout: result.currentMultiplier,
      balance_after: Number(result.balanceAfter.toFixed(2)),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/keno/round/current', async (req, res, next) => {
  try {
    const user = ensureUser(req);
    const round = await currentRound(user.tenantId, 'fast-keno');
    if (!round) return res.json({ round_id: null, phase: 'betting', numbers_drawn: [] });
    res.json({
      round_id: round.id,
      game_code: round.game_code ?? null,
      phase: round.phase,
      numbers_drawn:
        round.phase === 'complete'
          ? (round.drawn_numbers ?? [])
          : (round.reel_outcome?.revealed_numbers ?? []),
      time_remaining: Number((round.reel_outcome?.time_remaining ?? 0).toString()),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/keno/bet', async (req, res, next) => {
  try {
    await assertSiteAvailable(req);
    const body = kenoBetSchema.parse(req.body);
    const user = ensureUser(req);
    if (body.selected_numbers.length !== body.spots) {
      throw new BadRequestError('spots must match selected_numbers length');
    }
    const gameInfo = await readInternalGameRtp(user.tenantId, 'fast-keno');
    if (gameInfo?.status === 'Disabled') {
      throw new BadRequestError('Fast Keno is currently disabled');
    }
    assertBetWithinLimits(body.amount, gameInfo, 'Fast Keno');
    const round = await currentRound(user.tenantId, 'fast-keno');
    if (!round || round.id !== body.round_id) throw new NotFoundError('Round not found');
    if (round.phase !== 'betting') throw new BadRequestError('Round is not accepting bets');

    const { walletId, before } = await walletForUpdate(req);
    if (before < body.amount) throw new BadRequestError('Insufficient balance');

    const bet = await withTenantClient({ tenantId: user.tenantId }, async (client) => {
      const r = await client.query(
        `INSERT INTO game_bets
         (tenant_id, round_id, user_id, game_id, amount, selected_numbers, status)
         VALUES ($1,$2,$3,'fast-keno',$4,$5::int[],'active')
         RETURNING id`,
        [user.tenantId, body.round_id, user.id, body.amount, body.selected_numbers]
      );
      return r.rows[0];
    });

    const balanceAfter = await createLedgerTx({
      req,
      walletId,
      amount: -body.amount,
      before,
      type: 'bet_stake',
      reference: `keno-stake-${bet.id}`,
      metadata: { round_id: body.round_id, game_id: 'fast-keno' },
    });

    res.status(201).json({ bet_id: bet.id, balance_after: Number(balanceAfter.toFixed(2)) });
  } catch (err) {
    next(err);
  }
});

/**
 * Multi Hot 5 paytable — line-win multiple of bet-per-line for a 3-of-a-kind
 * of each symbol. Mirrors the values shown on the in-game rules screen
 * (77 ×15, $$ ×10, bells ×5, watermelon/grapes ×4, low fruits ×2).
 */
const MULTI_HOT_5_PAYTABLE: Record<string, number> = {
  seven: 15,
  dollar: 10,
  bell: 5,
  watermelon: 4,
  grapes: 4,
  orange: 2,
  cherry: 2,
  lemon: 2,
  plum: 2,
};

interface InternalGameConfig {
  status: 'Active' | 'Disabled';
  rtp: number;
  minBet: number;
  maxBet: number;
  maxWin: number;
}

async function readInternalGameRtp(
  tenantId: string,
  gameId: 'aviator' | 'jetx' | 'fast-keno' | 'multi-hot-5'
): Promise<InternalGameConfig | null> {
  return withTenantClient(
    { tenantId, bypassRls: true },
    async (client) => {
      const g = await client.query<{
        status: string;
        default_rtp: string;
        min_bet: string;
        max_bet: string;
        max_win: string;
      }>(
        `SELECT status, default_rtp::text, min_bet::text, max_bet::text, max_win::text
           FROM internal_games WHERE id = $1`,
        [gameId]
      );
      if (!g.rows[0]) return null;
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
      return {
        status: (g.rows[0].status as 'Active' | 'Disabled') ?? 'Active',
        rtp,
        minBet: Number(g.rows[0].min_bet),
        maxBet: Number(g.rows[0].max_bet),
        maxWin: Number(g.rows[0].max_win),
      };
    }
  );
}

/**
 * Enforce the admin-configured per-game bet range. `stake` is the TOTAL amount
 * risked on the round (for slots, bet-per-line × lines). No-op when the game
 * row / limits are unavailable so a config gap never blocks play.
 */
function assertBetWithinLimits(
  stake: number,
  cfg: InternalGameConfig | null,
  gameName: string
): void {
  if (!cfg) return;
  if (Number.isFinite(cfg.minBet) && stake < cfg.minBet) {
    throw new BadRequestError(
      `Minimum bet for ${gameName} is ${cfg.minBet} ETB`,
      { min_bet: cfg.minBet, max_bet: cfg.maxBet }
    );
  }
  if (Number.isFinite(cfg.maxBet) && stake > cfg.maxBet) {
    throw new BadRequestError(
      `Maximum bet for ${gameName} is ${cfg.maxBet} ETB`,
      { min_bet: cfg.minBet, max_bet: cfg.maxBet }
    );
  }
}

/** Cap a single-round payout at the admin-configured max-win ceiling. */
function capPayout(payout: number, cfg: InternalGameConfig | null): number {
  if (!cfg || !Number.isFinite(cfg.maxWin) || cfg.maxWin <= 0) return payout;
  return Math.min(payout, cfg.maxWin);
}

router.post('/slots/spin', async (req, res, next) => {
  try {
    await assertSiteAvailable(req);
    const body = slotsSpinSchema.parse(req.body);
    const user = ensureUser(req);
    const totalStake = Number((body.bet_per_line * body.lines).toFixed(2));
    const gameInfo = await readInternalGameRtp(user.tenantId, 'multi-hot-5');
    if (gameInfo?.status === 'Disabled') {
      throw new BadRequestError('Multi Hot 5 is currently disabled');
    }
    assertBetWithinLimits(totalStake, gameInfo, 'Multi Hot 5');
    const { walletId, before } = await walletForUpdate(req);
    if (before < totalStake) throw new BadRequestError('Insufficient balance');

    const round = await withTenantClient({ tenantId: user.tenantId }, async (client) => {
      const seed = gameRngService.generateRoundSeed();
      const clientSeed = gameRngService.createClientSeed();
      const roundId = crypto.randomUUID();
      // RTP is applied inside the RNG as a win-frequency gate (default 97.05%,
      // or the admin-configured value), so the payout here is the EXACT
      // paytable amount — never scaled. Premium symbols (777/$$$) are never
      // forced; they only appear naturally and are extremely rare.
      const outcome = gameRngService.generateMultiHot5Outcome(
        seed.serverSeed,
        clientSeed,
        roundId,
        gameInfo?.rtp ?? null
      );
      const reels = outcome.grid; // 3 reels × 3 rows
      const multiplier = outcome.multiplier;
      // Each winning line pays betPerLine × symbol-multiple; sum every winning
      // line, then apply the 1x–5x multiplier reel once to the total.
      //   e.g. 777 line at 2/line, mult 4x → (2 × 15) × 4 = 120
      //        777 + Bell + Watermelon at 5/line, mult 3x
      //          → (5×15 + 5×5 + 5×4) × 3 = 360
      let payout = 0;
      let winLines: number[] = [];
      if (outcome.winningLines.length > 0) {
        let baseWin = 0;
        for (const wl of outcome.winningLines) {
          baseWin += body.bet_per_line * (MULTI_HOT_5_PAYTABLE[wl.symbol] ?? 0);
        }
        // Enforce the admin-configured max-win ceiling on the round payout.
        payout = Number(capPayout(baseWin * multiplier, gameInfo).toFixed(2));
        winLines = outcome.winningLines.map((wl) => wl.line + 1);
      }

      // `game_code` is filled by the column DEFAULT (8-digit sequence) — read
      // it back so the client and admin history can show the short Game ID.
      const roundRow = await client.query<{ game_code: string }>(
        `INSERT INTO game_rounds
         (id, tenant_id, game_id, server_seed, server_seed_hash, client_seed, reel_outcome, phase, started_at, ended_at)
         VALUES ($1,$2,'multi-hot-5',$3,$4,$5,$6::jsonb,'complete',now(),now())
         RETURNING game_code`,
        [roundId, user.tenantId, seed.serverSeed, seed.serverSeedHash, clientSeed, JSON.stringify(reels)]
      );
      const gameCode = roundRow.rows[0]?.game_code ?? '';

      const bet = await client.query(
        `INSERT INTO game_bets
         (tenant_id, round_id, user_id, game_id, amount, lines, payout, status, metadata)
         VALUES ($1,$2,$3,'multi-hot-5',$4,$5,$6,$7,$8::jsonb)
         RETURNING id`,
        [
          user.tenantId,
          roundId,
          user.id,
          totalStake,
          body.lines,
          payout,
          payout > 0 ? 'won' : 'lost',
          JSON.stringify({ reels, win_lines: winLines, multiplier, bet_per_line: body.bet_per_line }),
        ]
      );

      return {
        roundId,
        gameCode,
        betId: bet.rows[0].id as string,
        reels,
        multiplier,
        payout,
        winLines,
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.serverSeedHash,
        clientSeed,
      };
    });

    const afterStake = await createLedgerTx({
      req,
      walletId,
      amount: -totalStake,
      before,
      type: 'bet_stake',
      reference: `slots-stake-${round.betId}`,
      metadata: { round_id: round.roundId, game_id: 'multi-hot-5' },
    });

    let finalBalance = afterStake;
    if (round.payout > 0) {
      finalBalance = await createLedgerTx({
        req,
        walletId,
        amount: round.payout,
        before: afterStake,
        type: 'bet_win',
        reference: `slots-win-${round.betId}`,
        metadata: { round_id: round.roundId, game_id: 'multi-hot-5' },
      });
      const phone = await getUserPhone(user.tenantId, user.id);
      await sendSmsBestEffort({
        tenantId: user.tenantId,
        to: phone,
        templateCode: 'game_win',
        message: 'You won {amount} ETB in Multi Hot 5.',
        variables: { amount: round.payout.toFixed(2) },
      });
    }

    res.status(201).json({
      round_id: round.roundId,
      game_code: round.gameCode,
      reels: round.reels,
      win_lines: round.winLines,
      multiplier: round.multiplier,
      total_payout: round.payout,
      balance_after: Number(finalBalance.toFixed(2)),
      server_seed_hash: round.serverSeedHash,
      server_seed: round.serverSeed,
      client_seed: round.clientSeed,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/slots/history', async (req, res, next) => {
  try {
    const user = ensureUser(req);
    const out = await withTenantClient({ tenantId: user.tenantId }, async (client) => {
      const r = await client.query(
        `SELECT b.id, b.round_id, b.amount::text, b.payout::text, b.status, b.metadata, b.created_at,
                gr.server_seed_hash, gr.server_seed, gr.client_seed
           FROM game_bets b
           JOIN game_rounds gr ON gr.id = b.round_id
          WHERE b.tenant_id = $1 AND b.user_id = $2 AND b.game_id = 'multi-hot-5'
          ORDER BY b.created_at DESC
          LIMIT 50`,
        [user.tenantId, user.id]
      );
      return r.rows;
    });
    res.json({ items: out });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------------- */
/* Rain Bonus — active event lookup + claim (Fast Keno & Aviator)            */
/* ------------------------------------------------------------------------- */

const rainGameSchema = z.enum(['fast-keno', 'aviator']);

// GET /api/games/rain/active?game=fast-keno — current claimable rain, if any.
router.get('/rain/active', async (req, res, next) => {
  try {
    const user = ensureUser(req);
    const game = rainGameSchema.parse(String(req.query.game ?? ''));
    const active = getActiveRain(user.tenantId, game);
    res.json({ active });
  } catch (err) {
    next(err);
  }
});

// POST /api/games/rain/claim { game } — claim your share of the live rain.
router.post('/rain/claim', async (req, res, next) => {
  try {
    await assertSiteAvailable(req);
    const user = ensureUser(req);
    const game = rainGameSchema.parse((req.body ?? {}).game);
    const result = await claimRain({
      tenantId: user.tenantId,
      userId: user.id,
      gameId: game,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RainClaimError) {
      return res.status(400).json({ ok: false, code: err.code, message: err.message });
    }
    next(err);
  }
});

export default router;
