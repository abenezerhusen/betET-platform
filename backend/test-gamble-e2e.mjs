/**
 * E2E test for the Multi Hot 5 Red/Black gamble fix:
 *   docker cp backend/test-gamble-e2e.mjs playcore_backend:/app/
 *   docker exec playcore_backend node test-gamble-e2e.mjs
 *
 * Covers every flow from the requirements:
 *   - no gamble: win credited at spin (existing behaviour unchanged)
 *   - gamble WIN + Take: net wallet effect = 2x the win, credited exactly once
 *   - gamble LOSE: net wallet effect = 0
 *   - duplicate/parallel Take requests: exactly ONE credit transaction
 *   - gamble on an old bet / already-settled gamble: rejected
 */
import pg from 'pg';
import crypto from 'node:crypto';

const TENANT = '1c7764a5-a7cf-41af-a570-3562d51442ad';
const API = 'http://localhost:4000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let failures = 0;
const eps = 0.005;
const close = (a, b) => Math.abs(Number(a) - Number(b)) < eps;
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

async function api(path, { method = 'GET', token = null, body = null } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': TENANT,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

function decodeJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function walletBalance(userId) {
  const r = await pool.query(
    `SELECT balance::text AS b FROM wallets WHERE tenant_id = $1 AND user_id = $2 AND currency = 'ETB'`,
    [TENANT, userId]
  );
  return Number(r.rows[0]?.b ?? 0);
}

/** Fabricate a completed won multi-hot-5 bet directly in the DB. */
async function fabricateWonBet(userId, payout, { ageMinutes = 0, status = 'won', gambleMeta = null } = {}) {
  const roundId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO game_rounds (id, tenant_id, game_id, server_seed, server_seed_hash, client_seed, reel_outcome, phase, started_at, ended_at)
     VALUES ($1,$2,'multi-hot-5','seed','hash','client','[]'::jsonb,'complete',now(),now())`,
    [roundId, TENANT]
  );
  const meta = { reels: [], win_lines: [1], multiplier: 1, bet_per_line: 1, e2e_gamble_test: true };
  if (gambleMeta) meta.gamble = gambleMeta;
  const bet = await pool.query(
    `INSERT INTO game_bets (tenant_id, round_id, user_id, game_id, amount, lines, payout, status, metadata, created_at)
     VALUES ($1,$2,$3,'multi-hot-5',5,5,$4,$5,$6::jsonb, now() - make_interval(mins => $7))
     RETURNING id`,
    [TENANT, roundId, userId, payout, status, JSON.stringify(meta), ageMinutes]
  );
  return { betId: bet.rows[0].id, roundId };
}

const fabricated = { rounds: [], bets: [] };
async function cleanup(userId) {
  if (fabricated.bets.length) {
    await pool.query(`DELETE FROM transactions WHERE tenant_id = $1 AND reference = ANY($2)`, [
      TENANT,
      fabricated.bets.flatMap((b) => [`slots-gamble-stake-${b}`, `slots-gamble-win-${b}`]),
    ]);
    await pool.query(`DELETE FROM game_bets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [TENANT, fabricated.bets]);
  }
  if (fabricated.rounds.length) {
    await pool.query(`DELETE FROM game_rounds WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [TENANT, fabricated.rounds]);
  }
}

async function main() {
  const tokRes = await api('/api/auth/dev/game-token', { method: 'POST' });
  const token = tokRes.json?.access_token;
  check('dev game token minted', !!token, JSON.stringify(tokRes.json)?.slice(0, 150));
  const claims = decodeJwt(token);
  const userId = claims.sub ?? claims.user_id ?? claims.id;
  check('token has user id', !!userId, JSON.stringify(claims).slice(0, 200));

  // Make sure the player can afford plenty of spins.
  await pool.query(
    `UPDATE wallets SET balance = 500 WHERE tenant_id = $1 AND user_id = $2 AND currency = 'ETB'`,
    [TENANT, userId]
  );

  /* ============ Real spin flow: win → gamble (both outcomes) ============ */
  let sawGambleWinTake = false;
  let sawGambleLose = false;
  let spinChecked = false;

  for (let i = 0; i < 80 && !(sawGambleWinTake && sawGambleLose); i++) {
    const before = await walletBalance(userId);
    const spin = await api('/api/games/slots/spin', {
      method: 'POST', token,
      body: { game_id: 'multi-hot-5', bet_per_line: 1, lines: 5 },
    });
    if (spin.status !== 201) {
      check('spin succeeds', false, `status=${spin.status} ${JSON.stringify(spin.json)?.slice(0, 150)}`);
      break;
    }
    const payout = Number(spin.json.total_payout);
    if (!spinChecked) {
      check('spin response includes bet_id', typeof spin.json.bet_id === 'string' && spin.json.bet_id.length > 0);
      spinChecked = true;
    }
    // No-gamble flow: wallet math at spin time (stake out, win in immediately).
    if (!close(spin.json.balance_after, before - 5 + payout)) {
      check('spin balance math (stake −5, win +payout)', false,
        `before=${before} payout=${payout} after=${spin.json.balance_after}`);
      break;
    }
    if (payout <= 0) continue;

    const betId = spin.json.bet_id;
    const balAfterSpin = Number(spin.json.balance_after);

    // First card pick — must stake (debit) the original win.
    const g1 = await api('/api/games/slots/gamble', {
      method: 'POST', token, body: { bet_id: betId, choice: 'red' },
    });
    if (g1.status !== 200) {
      check('gamble call succeeds', false, `status=${g1.status} ${JSON.stringify(g1.json)?.slice(0, 200)}`);
      break;
    }
    if (!close(g1.json.balance_after, balAfterSpin - payout)) {
      check('first pick debits the original win', false,
        `expected ${balAfterSpin - payout} got ${g1.json.balance_after}`);
      break;
    }

    if (g1.json.result === 'win' && !sawGambleWinTake) {
      check('gamble WIN doubles pending amount', close(g1.json.pending_amount, payout * 2),
        `payout=${payout} pending=${g1.json.pending_amount}`);
      // Take — credits the doubled amount exactly once.
      const take = await api('/api/games/slots/gamble/take', { method: 'POST', token, body: { bet_id: betId } });
      check('take credits the doubled amount', take.status === 200 && close(take.json.credited, payout * 2),
        `status=${take.status} ${JSON.stringify(take.json)}`);
      check('wallet after take = spin balance + win (net 2x total)',
        close(take.json.balance_after, balAfterSpin + payout),
        `expected ${balAfterSpin + payout} got ${take.json.balance_after}`);
      // Duplicate take — idempotent, credits nothing.
      const dup = await api('/api/games/slots/gamble/take', { method: 'POST', token, body: { bet_id: betId } });
      check('duplicate take credits 0', dup.status === 200 && Number(dup.json.credited) === 0, JSON.stringify(dup.json));
      const txCount = await pool.query(
        `SELECT count(*)::int AS n FROM transactions WHERE tenant_id = $1 AND reference = $2`,
        [TENANT, `slots-gamble-win-${betId}`]
      );
      check('exactly ONE gamble-win transaction recorded', txCount.rows[0].n === 1, `n=${txCount.rows[0].n}`);
      // Gamble again on a finished bet — rejected.
      const again = await api('/api/games/slots/gamble', { method: 'POST', token, body: { bet_id: betId, choice: 'red' } });
      check('gamble after take is rejected', again.status >= 400, `status=${again.status}`);
      sawGambleWinTake = true;
    } else if (g1.json.result === 'lose' && !sawGambleLose) {
      check('gamble LOSE zeroes pending amount', Number(g1.json.pending_amount) === 0, JSON.stringify(g1.json));
      const bal = await walletBalance(userId);
      check('wallet after lose = spin balance − win (net +0 for the win)',
        close(bal, balAfterSpin - payout), `expected ${balAfterSpin - payout} got ${bal}`);
      // Take after lose credits nothing.
      const take = await api('/api/games/slots/gamble/take', { method: 'POST', token, body: { bet_id: betId } });
      check('take after lose credits 0', take.status === 200 && Number(take.json.credited) === 0, JSON.stringify(take.json));
      // Another card pick after losing — rejected.
      const again = await api('/api/games/slots/gamble', { method: 'POST', token, body: { bet_id: betId, choice: 'black' } });
      check('gamble after lose is rejected', again.status >= 400, `status=${again.status}`);
      sawGambleLose = true;
    } else if (g1.json.result === 'win') {
      // Extra win path we already covered — just take it to keep balances sane.
      await api('/api/games/slots/gamble/take', { method: 'POST', token, body: { bet_id: betId } });
    }
  }
  check('observed a gamble WIN + take flow', sawGambleWinTake);
  check('observed a gamble LOSE flow', sawGambleLose);

  /* ============ Deterministic edge cases (fabricated bets) ============ */

  // Parallel duplicate takes: exactly one credit.
  {
    const { betId, roundId } = await fabricateWonBet(userId, 10, {
      gambleMeta: { pending: 30, settled: false, taken: false, rounds: [] },
    });
    fabricated.bets.push(betId); fabricated.rounds.push(roundId);
    const before = await walletBalance(userId);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api('/api/games/slots/gamble/take', { method: 'POST', token, body: { bet_id: betId } }))
    );
    const credits = results.map((r) => Number(r.json?.credited ?? 0));
    const totalCredited = credits.reduce((a, b) => a + b, 0);
    const after = await walletBalance(userId);
    check('6 parallel takes credit the pending amount exactly once',
      close(totalCredited, 30) && close(after, before + 30),
      `credits=[${credits}] before=${before} after=${after}`);
    const txCount = await pool.query(
      `SELECT count(*)::int AS n FROM transactions WHERE tenant_id = $1 AND reference = $2`,
      [TENANT, `slots-gamble-win-${betId}`]
    );
    check('parallel takes: exactly ONE transaction row', txCount.rows[0].n === 1, `n=${txCount.rows[0].n}`);
  }

  // Old bet (outside the 10-minute window) cannot start a gamble.
  {
    const { betId, roundId } = await fabricateWonBet(userId, 10, { ageMinutes: 20 });
    fabricated.bets.push(betId); fabricated.rounds.push(roundId);
    const g = await api('/api/games/slots/gamble', { method: 'POST', token, body: { bet_id: betId, choice: 'red' } });
    check('gamble on an old bet is rejected', g.status >= 400, `status=${g.status} ${JSON.stringify(g.json)?.slice(0, 120)}`);
  }

  // Losing spin cannot be gambled.
  {
    const { betId, roundId } = await fabricateWonBet(userId, 0, { status: 'lost' });
    fabricated.bets.push(betId); fabricated.rounds.push(roundId);
    const g = await api('/api/games/slots/gamble', { method: 'POST', token, body: { bet_id: betId, choice: 'red' } });
    check('gamble on a losing spin is rejected', g.status >= 400, `status=${g.status}`);
  }

  // Another user's bet cannot be gambled (bet lookup is scoped to the caller).
  {
    const other = await pool.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND role = 'user' AND id <> $2 LIMIT 1`, [TENANT, userId]
    );
    if (other.rows[0]) {
      const { betId, roundId } = await fabricateWonBet(other.rows[0].id, 10);
      fabricated.bets.push(betId); fabricated.rounds.push(roundId);
      const g = await api('/api/games/slots/gamble', { method: 'POST', token, body: { bet_id: betId, choice: 'red' } });
      check("gambling another user's bet is rejected", g.status === 404, `status=${g.status}`);
    }
  }

  await cleanup(userId);
  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch(async (err) => {
    console.error('E2E error:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
