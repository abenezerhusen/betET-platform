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
  await pool.query(`DELETE FROM cashier_transactions WHERE tenant_id = $1 AND (reference LIKE 'ticket_sell:%' OR reference LIKE 'ticket_payout:%') AND cashier_id IN (SELECT id FROM users WHERE email::text LIKE '%@tickete2e.local')`, [TENANT]);
  await pool.query(`DELETE FROM sportsbook_bets WHERE tenant_id = $1 AND metadata->>'e2e' = 'ticket-e2e'`, [TENANT]);
  await pool.query(`DELETE FROM printed_ticket_counters WHERE tenant_id = $1 AND code_prefix ~ '^TKT-(E2EA01|E2EB01|E2EL01)-'`, [TENANT]);
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

  /* ------- 5) branch guard for PRODUCTION-shaped cashiers (no branch metadata) ------- */
  // Most real cashier accounts carry NO branch in metadata — their branch is
  // whatever they logged in with. The guard must still separate branches.
  const cashierP1 = await insertUser({
    email: 'cashier-p1@tickete2e.local', role: 'cashier',
    metadata: { permissions: perms, full_name: 'E2E Prod Cashier 1', username: 'e2e-p1' },
  });
  void cashierP1;
  await insertUser({
    email: 'cashier-p2@tickete2e.local', role: 'cashier',
    metadata: { permissions: perms, full_name: 'E2E Prod Cashier 2', username: 'e2e-p2' },
  });
  const tokP1 = await cashierLogin('cashier-p1@tickete2e.local', branchA);   // by UUID
  const tokP2 = await cashierLogin('cashier-p2@tickete2e.local', 'E2EB01'); // by human code

  const prodBet = await insertBet({ userId: walkinId });
  const sellP = await api(`/api/cashier/tickets/${prodBet.id}/sell`, { method: 'POST', token: tokP1 });
  check('metadata-less cashier can sell (login branch attributed)', sellP.status === 200, `status=${sellP.status} ${JSON.stringify(sellP.json)?.slice(0, 200)}`);
  check(
    'sell stamps sold_branch_id from the LOGIN branch',
    sellP.json?.ticket?.sold_branch_id === branchA,
    `sold_branch_id=${sellP.json?.ticket?.sold_branch_id}`
  );
  const crossProd = await api(`/api/cashier/tickets/${encodeURIComponent(prodBet.coupon_code)}`, { token: tokP2 });
  check('cross-branch lookup BLOCKED for metadata-less cashiers too (403)', crossProd.status === 403, `status=${crossProd.status}`);
  const sameProd = await api(`/api/cashier/tickets/${encodeURIComponent(prodBet.coupon_code)}`, { token: tokA1 });
  check('same-branch lookup still works for metadata-less-sold ticket', sameProd.status === 200, `status=${sameProd.status}`);

  /* ------- 6) reprint the same ticket: recorded, same code, no duplicate sale ------- */
  const reSell = await api(`/api/cashier/tickets/${prodBet.id}/sell`, { method: 'POST', token: tokP1 });
  check('reprint returns already_sold (no second sale)', reSell.status === 200 && reSell.json?.already_sold === true, JSON.stringify(reSell.json)?.slice(0, 200));
  check(
    'reprint keeps the SAME printed code',
    reSell.json?.ticket?.printed_ticket_code === sellP.json?.ticket?.printed_ticket_code,
    `${reSell.json?.ticket?.printed_ticket_code} vs ${sellP.json?.ticket?.printed_ticket_code}`
  );
  check(
    'system RECORDS the ticket was printed twice (print_count=2)',
    Number(reSell.json?.ticket?.metadata?.print_count) === 2,
    `print_count=${reSell.json?.ticket?.metadata?.print_count}`
  );
  const sellTx = await pool.query(
    `SELECT COUNT(*)::int AS n FROM cashier_transactions WHERE tenant_id = $1 AND reference = $2`,
    [TENANT, `ticket_sell:${prodBet.id}`]
  );
  check('reprint creates NO duplicate sale transaction', sellTx.rows[0].n === 1, `n=${sellTx.rows[0].n}`);

  /* ------- 7) SBK coupon is what the receipt prints ------- */
  check(
    'ticket payload carries the original SBK coupon for the receipt',
    /^SBK-/.test(String(sellP.json?.ticket?.coupon_code ?? '')),
    `coupon_code=${sellP.json?.ticket?.coupon_code}`
  );

  /* ------- 8) winning ticket printed twice: pays exactly ONCE ------- */
  await pool.query(
    `UPDATE sportsbook_bets SET status = 'won', actual_payout = 50, settled_at = now() WHERE id = $1`,
    [prodBet.id]
  );
  const chk1 = await api(`/api/cashier/tickets/${encodeURIComponent(prodBet.coupon_code)}/check-payout`, { token: tokP1 });
  check('person 1 check shows WIN — UNPAID', chk1.status === 200 && chk1.json?.status === 'won' && !chk1.json?.paid_at, JSON.stringify(chk1.json)?.slice(0, 200));
  const pay1 = await api(`/api/cashier/tickets/${encodeURIComponent(prodBet.coupon_code)}/payout`, { method: 'POST', token: tokP1 });
  check('person 1 payout succeeds', pay1.status === 200 && Number(pay1.json?.paid_amount) === 50, `status=${pay1.status} paid=${pay1.json?.paid_amount}`);
  const chk2 = await api(`/api/cashier/tickets/${encodeURIComponent(prodBet.coupon_code)}/check-payout`, { token: tokP1 });
  check('person 2 check shows ALREADY PAID', chk2.status === 200 && chk2.json?.status === 'already_paid', JSON.stringify(chk2.json)?.slice(0, 200));
  const pay2 = await api(`/api/cashier/tickets/${encodeURIComponent(prodBet.coupon_code)}/payout`, { method: 'POST', token: tokP1 });
  check('person 2 payout is REFUSED (409, no double payment)', pay2.status === 409, `status=${pay2.status}`);
  const payTx = await pool.query(
    `SELECT COUNT(*)::int AS n FROM cashier_transactions WHERE tenant_id = $1 AND reference = $2`,
    [TENANT, `ticket_payout:${prodBet.id}`]
  );
  check('exactly ONE payout transaction recorded', payTx.rows[0].n === 1, `n=${payTx.rows[0].n}`);

  // Parallel double-click safety on a second winning ticket.
  const wonBet2 = await insertBet({ userId: walkinId });
  await api(`/api/cashier/tickets/${wonBet2.id}/sell`, { method: 'POST', token: tokP1 });
  await pool.query(`UPDATE sportsbook_bets SET status = 'won', actual_payout = 50, settled_at = now() WHERE id = $1`, [wonBet2.id]);
  const race = await Promise.all([
    api(`/api/cashier/tickets/${wonBet2.id}/payout`, { method: 'POST', token: tokP1 }),
    api(`/api/cashier/tickets/${wonBet2.id}/payout`, { method: 'POST', token: tokP1 }),
    api(`/api/cashier/tickets/${wonBet2.id}/payout`, { method: 'POST', token: tokP1 }),
  ]);
  const okCount = race.filter((r) => r.status === 200).length;
  check('3 PARALLEL payout clicks → exactly one success', okCount === 1, JSON.stringify(race.map((r) => r.status)));

  /* ------- 9) label-branch cashier payout must NOT 500 ("Something went wrong") ------- */
  const branchL = await insertUser({
    email: 'branch-l@tickete2e.local', role: 'branch',
    metadata: { branch_id: 'E2EL01' }, // real branches store only the human code
  });
  await insertUser({
    email: 'cashier-l1@tickete2e.local', role: 'cashier',
    metadata: { branch_id: 'E2EL01', permissions: perms, full_name: 'E2E Label Cashier' },
  });
  const tokL = await cashierLogin('cashier-l1@tickete2e.local', 'E2EL01');
  const lBet = await insertBet({ userId: walkinId });
  const sellL = await api(`/api/cashier/tickets/${lBet.id}/sell`, { method: 'POST', token: tokL });
  check('label-branch cashier sell succeeds', sellL.status === 200, `status=${sellL.status}`);
  await pool.query(`UPDATE sportsbook_bets SET status = 'won', actual_payout = 50, settled_at = now() WHERE id = $1`, [lBet.id]);
  const payL = await api(`/api/cashier/tickets/${lBet.id}/payout`, { method: 'POST', token: tokL });
  check(
    'label-branch payout succeeds (no false "Something went wrong" 500)',
    payL.status === 200,
    `status=${payL.status} ${JSON.stringify(payL.json)?.slice(0, 200)}`
  );
  const lRow = await pool.query(`SELECT paid_branch_id FROM sportsbook_bets WHERE id = $1`, [lBet.id]);
  check(
    'paid_branch_id stamped with the canonical branch UUID',
    lRow.rows[0]?.paid_branch_id === branchL,
    `paid_branch_id=${lRow.rows[0]?.paid_branch_id}`
  );

  /* ------- 10) Admin Panel offline ticket list fields ------- */
  const adminList2 = await api(
    `/api/admin/bets?type=offline&search=${encodeURIComponent(prodBet.coupon_code)}`,
    { token: adminTok }
  );
  const adminRow = (adminList2.json?.items ?? []).find((r) => r.id === prodBet.id);
  check('admin offline list finds the ticket by SBK coupon', !!adminRow, JSON.stringify(adminList2.json)?.slice(0, 300));
  check('admin list: Full Name populated', !!adminRow?.user_name && adminRow.user_name !== 'null', `user_name=${adminRow?.user_name}`);
  check(
    'admin list: anonymous walk-in shows the BRANCH name (not "Walk-in Player")',
    adminRow?.user_name === 'E2E Branch A',
    `user_name=${adminRow?.user_name}`
  );
  check('admin list: Branch resolved from sold_branch_id', adminRow?.branch_name === 'E2E Branch A', `branch_name=${adminRow?.branch_name}`);
  check('admin list: Cashier is the seller', adminRow?.sold_by_cashier_name === 'E2E Prod Cashier 1', `cashier=${adminRow?.sold_by_cashier_name}`);
  check('admin list: paid_at + paid amount present after payout', !!adminRow?.paid_at && Number(adminRow?.actual_payout) === 50, `paid_at=${adminRow?.paid_at} amount=${adminRow?.actual_payout}`);

  // Branch with only a human code (no name) must still show that code.
  const adminListL = await api(
    `/api/admin/bets?type=offline&search=${encodeURIComponent(lBet.coupon_code)}`,
    { token: adminTok }
  );
  const adminRowL = (adminListL.json?.items ?? []).find((r) => r.id === lBet.id);
  check('admin list: code-only branch shows its code (not blank)', adminRowL?.branch_name === 'E2EL01', `branch_name=${adminRowL?.branch_name}`);

  /* ------- 11) PAID DUPLICATE COPIES (admin "Enable Duplicate Slip") ------- */
  // Save the tenant's real config keys, force-enable for the test, restore after.
  const cfgRow = await pool.query(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'general.config'`, [TENANT]);
  const origVal = cfgRow.rows[0]?.value ?? {};
  const hadDupKey = Object.prototype.hasOwnProperty.call(origVal, 'cashier_enable_duplicate_slip');
  const hadMaxKey = Object.prototype.hasOwnProperty.call(origVal, 'cashier_max_duplicate_copies');
  const origDup = origVal.cashier_enable_duplicate_slip;
  const origMax = origVal.cashier_max_duplicate_copies;
  const setDupCfg = (enabled, max) => pool.query(
    `UPDATE settings
        SET value = value || jsonb_build_object(
              'cashier_enable_duplicate_slip', $2::boolean,
              'cashier_max_duplicate_copies', $3::int)
      WHERE tenant_id = $1 AND key = 'general.config'`,
    [TENANT, enabled, max]);
  const restoreDupCfg = async () => {
    await pool.query(
      `UPDATE settings SET value = value - 'cashier_enable_duplicate_slip' - 'cashier_max_duplicate_copies'
        WHERE tenant_id = $1 AND key = 'general.config'`, [TENANT]);
    if (hadDupKey || hadMaxKey) {
      await pool.query(
        `UPDATE settings SET value = value || $2::jsonb WHERE tenant_id = $1 AND key = 'general.config'`,
        [TENANT, JSON.stringify({
          ...(hadDupKey ? { cashier_enable_duplicate_slip: origDup } : {}),
          ...(hadMaxKey ? { cashier_max_duplicate_copies: origMax } : {}),
        })]);
    }
  };
  await setDupCfg(true, 2);

  try {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 3600 * 1000).toISOString();

    // Group ticket: 1 original + up to 2 paid copies (limit 2).
    const grpBet = await insertBet({
      userId: walkinId,
      extraMeta: { selections: [{ starts_at: future, event: 'E2E FC vs Copy United' }] },
    });
    const sellG0 = await api(`/api/cashier/tickets/${grpBet.id}/sell`, { method: 'POST', token: tokA1 });
    check('copy test: original sold normally', sellG0.status === 200 && sellG0.json?.already_sold === false, `status=${sellG0.status}`);

    const sellG1 = await api(`/api/cashier/tickets/${grpBet.id}/sell`, { method: 'POST', token: tokA1 });
    const c1 = sellG1.json?.ticket;
    check('2nd print SELLS a new ticket (not already_sold)', sellG1.status === 200 && sellG1.json?.already_sold === false, `status=${sellG1.status} ${JSON.stringify(sellG1.json)?.slice(0, 200)}`);
    check('copy 1 has its OWN new SBK coupon', /^SBK-/.test(String(c1?.coupon_code)) && c1?.coupon_code !== grpBet.coupon_code, `orig=${grpBet.coupon_code} copy=${c1?.coupon_code}`);
    check('copy 1 has its own printed receipt code', !!c1?.printed_ticket_code && c1.printed_ticket_code !== sellG0.json?.ticket?.printed_ticket_code, `${c1?.printed_ticket_code}`);
    check('copy 1 response says which ticket it duplicates', sellG1.json?.duplicate_of === grpBet.coupon_code, `duplicate_of=${sellG1.json?.duplicate_of}`);
    check('copy 1 metadata links back to the original bet', c1?.metadata?.copy_of === grpBet.id && Number(c1?.metadata?.copy_number) === 1, `copy_of=${c1?.metadata?.copy_of} n=${c1?.metadata?.copy_number}`);

    const sellG2 = await api(`/api/cashier/tickets/${grpBet.id}/sell`, { method: 'POST', token: tokA1 });
    const c2 = sellG2.json?.ticket;
    check('3rd print sells copy 2 with another distinct SBK', sellG2.status === 200 && /^SBK-/.test(String(c2?.coupon_code)) && new Set([grpBet.coupon_code, c1?.coupon_code, c2?.coupon_code]).size === 3, `codes=${grpBet.coupon_code},${c1?.coupon_code},${c2?.coupon_code}`);

    const sellG3 = await api(`/api/cashier/tickets/${grpBet.id}/sell`, { method: 'POST', token: tokA1 });
    check('4th print REFUSED — admin copy limit (2) reached (409)', sellG3.status === 409, `status=${sellG3.status} ${JSON.stringify(sellG3.json)?.slice(0, 200)}`);

    const famTx = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cashier_transactions
        WHERE tenant_id = $1 AND type = 'ticket_sell'
          AND reference IN ($2, $3, $4)`,
      [TENANT, `ticket_sell:${grpBet.id}`, `ticket_sell:${c1?.bet_id}`, `ticket_sell:${c2?.bet_id}`]);
    check('each paid copy recorded its OWN sale transaction (3 total)', famTx.rows[0].n === 3, `n=${famTx.rows[0].n}`);

    // Copies must be sellable/payable through their own codes too.
    const lookC1 = await api(`/api/cashier/tickets/${encodeURIComponent(c1.coupon_code)}`, { token: tokA2 });
    check('copy is findable by its own SBK code', lookC1.status === 200 && lookC1.json?.bet_id === c1.bet_id, `status=${lookC1.status}`);

    // Independent payouts: original and copy 1 win → each paper pays once.
    await pool.query(
      `UPDATE sportsbook_bets SET status = 'won', actual_payout = 50, settled_at = now() WHERE id = ANY($1::uuid[])`,
      [[grpBet.id, c1.bet_id]]);
    const payOrig = await api(`/api/cashier/tickets/${grpBet.id}/payout`, { method: 'POST', token: tokA1 });
    check('original ticket pays out', payOrig.status === 200 && Number(payOrig.json?.paid_amount) === 50, `status=${payOrig.status}`);
    const payC1 = await api(`/api/cashier/tickets/${c1.bet_id}/payout`, { method: 'POST', token: tokA1 });
    check('copy 1 pays out INDEPENDENTLY', payC1.status === 200 && Number(payC1.json?.paid_amount) === 50, `status=${payC1.status} ${JSON.stringify(payC1.json)?.slice(0, 200)}`);
    const payC1again = await api(`/api/cashier/tickets/${c1.bet_id}/payout`, { method: 'POST', token: tokA1 });
    check('copy 1 second payout REFUSED (409)', payC1again.status === 409, `status=${payC1again.status}`);

    // Copies appear as their own rows in the admin offline list.
    const adminCopy = await api(
      `/api/admin/bets?type=offline&search=${encodeURIComponent(c1.coupon_code)}`, { token: adminTok });
    const copyRow = (adminCopy.json?.items ?? []).find((r) => r.id === c1.bet_id);
    check('admin offline list shows the copy as its own ticket', !!copyRow, JSON.stringify(adminCopy.json)?.slice(0, 200));

    // Kick-off guard: once a match started, NO paid copy (clear 400, no charge).
    const startedBet = await insertBet({
      userId: walkinId,
      extraMeta: { selections: [{ starts_at: past, event: 'E2E Started Match' }] },
    });
    await api(`/api/cashier/tickets/${startedBet.id}/sell`, { method: 'POST', token: tokA1 });
    const copyStarted = await api(`/api/cashier/tickets/${startedBet.id}/sell`, { method: 'POST', token: tokA1 });
    check('copy of a STARTED match is refused (400, "do not collect a stake")', copyStarted.status === 400 && /started/i.test(String(copyStarted.json?.message ?? '')), `status=${copyStarted.status} ${JSON.stringify(copyStarted.json)?.slice(0, 200)}`);

    // Real legs (when sports data exists): the copy must clone them.
    const futSel = await pool.query(
      `SELECT s.id FROM sports_selections s
         JOIN sports_markets m ON m.id = s.market_id
         JOIN sports_events ev ON ev.id = m.event_id
        WHERE ev.starts_at > now() + interval '2 hours' LIMIT 1`);
    if (futSel.rows[0]) {
      const legBet = await insertBet({ userId: walkinId });
      await pool.query(
        `INSERT INTO sportsbook_bet_legs (tenant_id, bet_id, selection_id, odds_at_placement, status)
         VALUES ($1, $2, $3, 2.5, 'pending')`, [TENANT, legBet.id, futSel.rows[0].id]);
      await api(`/api/cashier/tickets/${legBet.id}/sell`, { method: 'POST', token: tokA1 });
      const legCopy = await api(`/api/cashier/tickets/${legBet.id}/sell`, { method: 'POST', token: tokA1 });
      const legCopyId = legCopy.json?.ticket?.bet_id;
      const legN = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sportsbook_bet_legs WHERE bet_id = $1`, [legCopyId]);
      check('copy CLONES the bet legs (settles independently)', legCopy.status === 200 && legN.rows[0].n === 1, `status=${legCopy.status} legs=${legN.rows[0]?.n}`);
      await pool.query(`DELETE FROM sportsbook_bet_legs WHERE bet_id IN ($1, $2)`, [legBet.id, legCopyId]);
    } else {
      console.log('SKIP  legs-clone check (no future sports selection in DB)');
    }

    // Toggle OFF → the old reprint behavior is fully preserved.
    await setDupCfg(false, 2);
    const reprintOff = await api(`/api/cashier/tickets/${startedBet.id}/sell`, { method: 'POST', token: tokA1 });
    check('duplicate slip OFF → plain reprint (already_sold, same code)', reprintOff.status === 200 && reprintOff.json?.already_sold === true, `status=${reprintOff.status} ${JSON.stringify(reprintOff.json)?.slice(0, 200)}`);
  } finally {
    await restoreDupCfg();
  }

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
