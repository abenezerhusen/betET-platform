/**
 * E2E test for the ticket fixes (run inside the backend container):
 *   docker exec playcore_backend node test-ticket-e2e.mjs
 *
 * Verifies:
 *  1. Printed coupon numbers are race-safe and unique: 10 PARALLEL sells on
 *     the same branch/day all get distinct sequential numbers, continuing
 *     after a pre-existing legacy same-day code (-0007 -> 0008..0017).
 *  2. A fresh branch/day starts at -0001.
 *  3. Strict branch separation: same-branch cashier can look up a printed
 *     ticket; a cashier from ANOTHER branch gets 403 with the
 *     "belongs to another branch" message on lookup / check-payout / sell.
 *  4. Agent Dashboard resolves the registered customer's name from
 *     bet_for_user_phone instead of showing "Walk-in Player".
 */
import pg from 'pg';

const TENANT = '1c7764a5-a7cf-41af-a570-3562d51442ad';
const API = 'http://localhost:4000';
const PASS_HASH = '$2b$10$gp6MY97HO6trRCc1V5lP2OllceRAZZ2D6u9HvKwof59TKT7Nyw8HC'; // E2ePass123!
const PASSWORD = 'E2ePass123!';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

async function cleanup() {
  await pool.query(`DELETE FROM cashier_transactions WHERE tenant_id = $1 AND reference LIKE 'ticket_sell:%' AND cashier_id IN (SELECT id FROM users WHERE email::text LIKE '%@tickete2e.local')`, [TENANT]);
  await pool.query(`DELETE FROM sportsbook_bets WHERE tenant_id = $1 AND metadata->>'e2e' = 'ticket-e2e'`, [TENANT]);
  await pool.query(`DELETE FROM printed_ticket_counters WHERE tenant_id = $1 AND (code_prefix LIKE 'TKT-E2EA01-%' OR code_prefix LIKE 'TKT-E2EB01-%')`, [TENANT]);
  await pool.query(`DELETE FROM users WHERE tenant_id = $1 AND email::text LIKE '%@tickete2e.local'`, [TENANT]);
}

async function insertUser({ email, phone = null, role, metadata }) {
  const r = await pool.query(
    `INSERT INTO users (tenant_id, email, phone, password_hash, role, status, kyc_status, metadata)
     VALUES ($1, $2::citext, $3, $4, $5, 'active', 'verified', $6::jsonb) RETURNING id`,
    [TENANT, email, phone, PASS_HASH, role, JSON.stringify(metadata)]
  );
  return r.rows[0].id;
}

async function insertBet({ userId, betForPhone = null, extraMeta = {} }) {
  const r = await pool.query(
    `INSERT INTO sportsbook_bets
       (tenant_id, user_id, channel, bet_type, stake, currency, potential_payout,
        total_odds, status, bet_for_user_phone, metadata)
     VALUES ($1, $2, 'offline', 'single', 20, 'ETB', 50, 2.5, 'pending', $3, $4::jsonb)
     RETURNING id, coupon_code`,
    [TENANT, userId, betForPhone, JSON.stringify({ e2e: 'ticket-e2e', ...extraMeta })]
  );
  return r.rows[0];
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
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

async function cashierLogin(email, branchUuid) {
  const { status, json } = await api('/api/auth/cashier/login', {
    method: 'POST',
    body: { email, branch_id: branchUuid, password: PASSWORD },
  });
  if (status !== 200) throw new Error(`cashier login ${email} failed: ${status} ${JSON.stringify(json)}`);
  return json.access_token ?? json.token ?? json.accessToken;
}

const datePart = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
})();

async function main() {
  await cleanup();

  /* ------------------------- fixtures ------------------------- */
  const branchA = await insertUser({
    email: 'branch-a@tickete2e.local', role: 'branch',
    metadata: { branch_id: 'E2EA01', name: 'E2E Branch A' },
  });
  const branchB = await insertUser({
    email: 'branch-b@tickete2e.local', role: 'branch',
    metadata: { branch_id: 'E2EB01', name: 'E2E Branch B' },
  });
  const perms = ['sell_tickets', 'can_payout', 'cancel_tickets'];
  const cashierA1 = await insertUser({
    email: 'cashier-a1@tickete2e.local', role: 'cashier',
    metadata: { branch_id: branchA, permissions: perms, full_name: 'E2E Cashier A1', username: 'e2e-a1' },
  });
  await insertUser({
    email: 'cashier-a2@tickete2e.local', role: 'cashier',
    metadata: { branch_id: branchA, permissions: perms, full_name: 'E2E Cashier A2', username: 'e2e-a2' },
  });
  await insertUser({
    email: 'cashier-b1@tickete2e.local', role: 'cashier',
    metadata: { branch_id: branchB, permissions: perms, full_name: 'E2E Cashier B1', username: 'e2e-b1' },
  });
  const registered = await insertUser({
    email: 'customer@tickete2e.local', phone: '+251944556677', role: 'user',
    metadata: { full_name: 'Abebe Kebede E2E' },
  });
  void registered;

  let walkinId;
  const w = await pool.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND email = 'walkin@playcore.local' LIMIT 1`, [TENANT]);
  if (w.rows[0]) walkinId = w.rows[0].id;
  else walkinId = await insertUser({
    email: 'walkin@playcore.local', role: 'user',
    metadata: { full_name: 'Walk-in Player', placeholder: true },
  });

  // The BRANCH segment of the printed code is the first 6 chars of the
  // branch UUID (cashier metadata carries the UUID, not a human label) —
  // matches production codes like TKT-3937DD-… / TKT-372C66-….
  const prefixA = `TKT-${branchA.slice(0, 6).toUpperCase()}-${datePart}`;
  const prefixB = `TKT-${branchB.slice(0, 6).toUpperCase()}-${datePart}`;

  // Legacy same-day code on branch A (old COUNT+1 generator output) — the
  // new counter must seed past it, never re-issue it.
  const legacy = await insertBet({ userId: walkinId, extraMeta: { legacy: true } });
  await pool.query(
    `UPDATE sportsbook_bets SET printed_ticket_code = $2, sold_at = now(), sold_by_cashier_id = $3, sold_branch_id = $4 WHERE id = $1`,
    [legacy.id, `${prefixA}-0007`, cashierA1, branchA]
  );

  const parallelBets = [];
  for (let i = 0; i < 10; i++) parallelBets.push(await insertBet({ userId: walkinId }));
  const freshB = await insertBet({ userId: walkinId });
  const forUser = await insertBet({ userId: walkinId, betForPhone: '0944556677' });

  /* ------------------------- logins ------------------------- */
  const tokA1 = await cashierLogin('cashier-a1@tickete2e.local', branchA);
  const tokA2 = await cashierLogin('cashier-a2@tickete2e.local', branchA);
  const tokB1 = await cashierLogin('cashier-b1@tickete2e.local', branchB);

  /* ---------------- 1) parallel sells, unique + sequential ---------------- */
  const sells = await Promise.all(
    parallelBets.map((b) => api(`/api/cashier/tickets/${b.id}/sell`, { method: 'POST', token: tokA1 }))
  );
  const codes = sells.map((s) => s.json?.ticket?.printed_ticket_code ?? `ERR:${s.status}`);
  const uniq = new Set(codes);
  check('10 parallel sells all succeeded', sells.every((s) => s.status === 200), JSON.stringify(codes));
  check('10 parallel sells produced 10 DISTINCT coupon numbers', uniq.size === 10, JSON.stringify(codes));
  const seqs = codes.map((c) => Number(String(c).slice(-4))).sort((a, b) => a - b);
  check(
    'sequence continues after legacy -0007 (got 0008..0017)',
    JSON.stringify(seqs) === JSON.stringify([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
    JSON.stringify(seqs)
  );
  check('codes use TKT-{BRANCH}-YYYYMMDD- prefix', codes.every((c) => String(c).startsWith(`${prefixA}-`)), JSON.stringify(codes));

  /* ---------------- 2) fresh branch/day starts at 0001 ---------------- */
  const sellB = await api(`/api/cashier/tickets/${freshB.id}/sell`, { method: 'POST', token: tokB1 });
  const codeB = sellB.json?.ticket?.printed_ticket_code;
  check('first ticket of a fresh branch/day is -0001', codeB === `${prefixB}-0001`, String(codeB));

  /* ---------------- 3) strict branch separation ---------------- */
  const printedA = codes[0];
  const sameBranch = await api(`/api/cashier/tickets/${encodeURIComponent(printedA)}`, { token: tokA2 });
  check('same-branch cashier CAN look up the ticket', sameBranch.status === 200, `status=${sameBranch.status}`);

  const crossLookup = await api(`/api/cashier/tickets/${encodeURIComponent(printedA)}`, { token: tokB1 });
  check('cross-branch lookup is BLOCKED (403)', crossLookup.status === 403, `status=${crossLookup.status}`);
  check(
    'cross-branch error message says it belongs to another branch',
    /belongs to another branch/i.test(String(crossLookup.json?.message ?? crossLookup.json?.error ?? '')),
    JSON.stringify(crossLookup.json)
  );
  const crossCheck = await api(`/api/cashier/tickets/${encodeURIComponent(printedA)}/check-payout`, { token: tokB1 });
  check('cross-branch check-payout is BLOCKED (403)', crossCheck.status === 403, `status=${crossCheck.status}`);
  const crossSell = await api(`/api/cashier/tickets/${encodeURIComponent(printedA)}/sell`, { method: 'POST', token: tokB1 });
  check('cross-branch sell/reprint is BLOCKED (403)', crossSell.status === 403, `status=${crossSell.status}`);

  const sameCheck = await api(`/api/cashier/tickets/${encodeURIComponent(printedA)}/check-payout`, { token: tokA2 });
  check('same-branch check-payout still works', sameCheck.status === 200, `status=${sameCheck.status}`);

  // Cross-branch lookup by SBK coupon code must be blocked too.
  const crossCoupon = await api(`/api/cashier/tickets/${encodeURIComponent(parallelBets[1].coupon_code)}`, { token: tokB1 });
  check('cross-branch lookup by SBK coupon is BLOCKED (403)', crossCoupon.status === 403, `status=${crossCoupon.status}`);

  /* ---------------- 4) Agent Dashboard registered-user name ---------------- */
  const sellForUser = await api(`/api/cashier/tickets/${forUser.id}/sell`, { method: 'POST', token: tokA1 });
  check('bet-for-user ticket sold', sellForUser.status === 200, `status=${sellForUser.status}`);

  const adminLogin = await api('/api/auth/admin/login', {
    method: 'POST',
    body: { email: 'superadmin@playcore.local', password: 'Admin@123456' },
  });
  const adminTok = adminLogin.json?.access_token;
  const printedForUser = sellForUser.json?.ticket?.printed_ticket_code;
  const list = await api(
    `/api/admin/agent-dashboard/tickets?search=${encodeURIComponent(printedForUser)}`,
    { token: adminTok }
  );
  const row = (list.json?.items ?? []).find((r) => r.printed_ticket_code === printedForUser);
  check('dashboard row found for bet-for-user ticket', !!row, JSON.stringify(list.json)?.slice(0, 300));
  check(
    'dashboard shows the REGISTERED user name (not Walk-in Player)',
    row?.user_name === 'Abebe Kebede E2E',
    `user_name=${JSON.stringify(row?.user_name)}`
  );
  check(
    'dashboard row still carries the customer phone',
    (row?.bet_for_user_phone ?? row?.user_phone ?? '').includes('944556677') ||
      (row?.user_phone ?? '').includes('944556677'),
    `phones=${JSON.stringify({ b: row?.bet_for_user_phone, u: row?.user_phone })}`
  );

  // A genuine anonymous ticket must STILL show Walk-in Player.
  const anonList = await api(
    `/api/admin/agent-dashboard/tickets?search=${encodeURIComponent(printedA)}`,
    { token: adminTok }
  );
  const anonRow = (anonList.json?.items ?? []).find((r) => r.printed_ticket_code === printedA);
  check(
    'true walk-in ticket still shows Walk-in Player',
    anonRow?.user_name === 'Walk-in Player',
    `user_name=${JSON.stringify(anonRow?.user_name)}`
  );

  /* ---------------- teardown ---------------- */
  await pool.query(`DELETE FROM printed_ticket_counters WHERE tenant_id = $1 AND code_prefix IN ($2, $3)`, [TENANT, prefixA, prefixB]);
  await cleanup();
  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch(async (err) => {
    console.error('E2E error:', err);
    try { await cleanup(); } catch { /* ignore */ }
    process.exit(1);
  })
  .finally(() => pool.end());
