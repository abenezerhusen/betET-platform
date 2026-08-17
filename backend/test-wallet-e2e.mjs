/**
 * E2E test for the Agent Wallet / Branch Management wallet fixes:
 *   docker cp backend/test-wallet-e2e.mjs playcore_backend:/app/
 *   docker exec playcore_backend node test-wallet-e2e.mjs
 *
 * Replays the exact API sequence the fixed admin-panel modals use:
 *   - agent with NO wallet row: ensure -> credit (Top Up) -> debit (Deduct)
 *   - branch with NO wallet row: ensure -> credit (Add Money) -> debit (Withdraw)
 *   - branch Settings tab save (updateUser with operating hours/limits)
 */
import pg from 'pg';

const TENANT = '1c7764a5-a7cf-41af-a570-3562d51442ad';
const API = 'http://localhost:4000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

async function cleanup() {
  await pool.query(`DELETE FROM transactions WHERE tenant_id = $1 AND wallet_id IN (SELECT id FROM wallets WHERE user_id IN (SELECT id FROM users WHERE email::text LIKE '%@wallete2e.local'))`, [TENANT]).catch(() => {});
  await pool.query(`DELETE FROM wallets WHERE tenant_id = $1 AND user_id IN (SELECT id FROM users WHERE email::text LIKE '%@wallete2e.local')`, [TENANT]);
  await pool.query(`DELETE FROM users WHERE tenant_id = $1 AND email::text LIKE '%@wallete2e.local'`, [TENANT]);
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

async function main() {
  await cleanup();

  const agent = (await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, role, status, kyc_status, metadata)
     VALUES ($1, 'agent@wallete2e.local'::citext, '!e2e', 'agent', 'active', 'verified', '{"full_name":"E2E Agent"}'::jsonb)
     RETURNING id`, [TENANT])).rows[0].id;
  const branch = (await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, role, status, kyc_status, metadata)
     VALUES ($1, 'branch@wallete2e.local'::citext, '!e2e', 'branch', 'active', 'verified',
             jsonb_build_object('branch_id', 'WE2E01', 'name', 'E2E Branch', 'agent_id', $2::text, 'city', 'Addis'))
     RETURNING id`, [TENANT, agent])).rows[0].id;

  const login = await api('/api/auth/admin/login', {
    method: 'POST',
    body: { email: 'superadmin@playcore.local', password: 'Admin@123456' },
  });
  const tok = login.json?.access_token;
  check('admin login', !!tok, JSON.stringify(login.json)?.slice(0, 120));

  /* ---------- Agent Wallet modal flow ---------- */
  const ensured = await api('/api/admin/wallets/ensure', { method: 'POST', token: tok, body: { user_id: agent } });
  check('agent with no wallet: ensure creates one', ensured.status === 200 && !!ensured.json?.id, `status=${ensured.status} ${JSON.stringify(ensured.json)?.slice(0, 150)}`);
  const agentWallet = ensured.json;

  const ensuredAgain = await api('/api/admin/wallets/ensure', { method: 'POST', token: tok, body: { user_id: agent } });
  check('ensure is idempotent (same wallet id)', ensuredAgain.json?.id === agentWallet.id);

  // Exactly the AgentWalletModal Top Up payload.
  const topup = await api(`/api/admin/wallets/${agentWallet.id}/credit`, {
    method: 'POST', token: tok,
    body: { amount: '100.00', reason: 'fixed', metadata: { payment_method: 'bank_transfer', remark: 'fexed', target: 'agent_prepaid_wallet' } },
  });
  check('agent Top Up (credit) succeeds', topup.status === 200, `status=${topup.status} ${JSON.stringify(topup.json)?.slice(0, 150)}`);

  const deduct = await api(`/api/admin/wallets/${agentWallet.id}/debit`, {
    method: 'POST', token: tok,
    body: { amount: '40.00', reason: 'adjust', metadata: { payment_method: 'cash', remark: null, target: 'agent_prepaid_wallet' } },
  });
  check('agent Deduct (debit) succeeds', deduct.status === 200, `status=${deduct.status} ${JSON.stringify(deduct.json)?.slice(0, 150)}`);

  const agentBal = (await pool.query(`SELECT balance::text AS b FROM wallets WHERE id = $1`, [agentWallet.id])).rows[0]?.b;
  check('agent wallet balance is 60.00 after 100 - 40', Number(agentBal) === 60, `balance=${agentBal}`);

  /* ---------- Branch Management modal flow ---------- */
  const bEnsured = await api('/api/admin/wallets/ensure', { method: 'POST', token: tok, body: { user_id: branch } });
  check('branch with no wallet: ensure creates one', bEnsured.status === 200 && !!bEnsured.json?.id, `status=${bEnsured.status}`);
  const branchWallet = bEnsured.json;

  const add = await api(`/api/admin/wallets/${branchWallet.id}/credit`, {
    method: 'POST', token: tok,
    body: { amount: 250, reason: 'float top-up', metadata: { source: 'branch_wallet_modal', branch_id: 'WE2E01', target: 'branch_prepaid_wallet' } },
  });
  check('branch Add Money (credit) succeeds', add.status === 200, `status=${add.status} ${JSON.stringify(add.json)?.slice(0, 150)}`);

  const withdraw = await api(`/api/admin/wallets/${branchWallet.id}/debit`, {
    method: 'POST', token: tok,
    body: { amount: 50, reason: 'cash out', metadata: { source: 'branch_wallet_modal', branch_id: 'WE2E01', target: 'branch_prepaid_wallet' } },
  });
  check('branch Withdraw (debit) succeeds', withdraw.status === 200, `status=${withdraw.status}`);

  const branchBal = (await pool.query(`SELECT balance::text AS b FROM wallets WHERE id = $1`, [branchWallet.id])).rows[0]?.b;
  check('branch wallet balance is 200.00 after 250 - 50', Number(branchBal) === 200, `balance=${branchBal}`);

  // The OLD buggy call: credit by the branch USER id must fail (this is what
  // the modal used to do) — proves the fix addressed the real failure.
  const oldBug = await api(`/api/admin/wallets/${branch}/credit`, {
    method: 'POST', token: tok, body: { amount: 10, reason: 'old bug repro' },
  });
  check('crediting by USER id (old modal behaviour) correctly fails', oldBug.status >= 400, `status=${oldBug.status}`);

  /* ---------- Branch Settings tab save (fixed flow: GET, merge, PUT) ---------- */
  // The OLD modal behaviour: send ONLY the settings keys — must fail validation.
  const oldSave = await api(`/api/admin/users/${branch}`, {
    method: 'PUT', token: tok,
    body: {
      status: 'active',
      metadata: { operating_hours: { start: '08:00', end: '20:00' }, limits: {}, min_stake: 10 },
    },
  });
  check('old Settings payload (no agent_id) correctly fails', oldSave.status >= 400, `status=${oldSave.status}`);

  const current = await api(`/api/admin/users/${branch}`, { token: tok });
  check('fetch current branch user for merge', current.status === 200 && !!current.json?.metadata, `status=${current.status}`);
  const mergedMeta = {
    ...(current.json?.metadata ?? {}),
    operating_hours: { start: '08:00', end: '20:00' },
    limits: { ...((current.json?.metadata?.limits ?? {})), offline_bet: 2000, deposit: 5000, duplicate_bet: 1000 },
    min_stake: 10,
  };
  const save = await api(`/api/admin/users/${branch}`, {
    method: 'PUT', token: tok,
    body: { status: 'active', metadata: mergedMeta },
  });
  check('branch Settings save (merged metadata) succeeds', save.status === 200, `status=${save.status} ${JSON.stringify(save.json)?.slice(0, 200)}`);
  const savedMeta = (await pool.query(`SELECT metadata FROM users WHERE id = $1`, [branch])).rows[0]?.metadata ?? {};
  check('operating hours persisted', savedMeta?.operating_hours?.start === '08:00' && savedMeta?.operating_hours?.end === '20:00', JSON.stringify(savedMeta?.operating_hours));
  check('agent_id / branch_id / city preserved after save', savedMeta?.agent_id === agent && savedMeta?.branch_id === 'WE2E01' && savedMeta?.city === 'Addis', JSON.stringify(savedMeta));

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
