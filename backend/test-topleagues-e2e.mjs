/**
 * E2E check for the Top Leagues (renamed Top Bets) config flow:
 *   docker cp backend/test-topleagues-e2e.mjs playcore_backend:/app/
 *   docker exec playcore_backend node test-topleagues-e2e.mjs
 *
 * Verifies the exact API sequence used by the updated panels:
 *   1. admin dropdown source:  GET /api/admin/game-picks/top-leagues/available
 *   2. admin save:             POST /api/admin/settings/top-bets
 *   3. user panel read:        GET /api/public/top-bets
 *   4. upcoming matches:       GET /api/sports/matches?league=<exact>&status=upcoming
 *   5. removal round-trip:     save a smaller list → public list shrinks
 * Cleans up (restores an empty list) at the end.
 */
const TENANT = '1c7764a5-a7cf-41af-a570-3562d51442ad';
const API = 'http://localhost:4000';
let failures = 0;
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

async function main() {
  const login = await api('/api/auth/admin/login', {
    method: 'POST',
    body: { email: 'superadmin@playcore.local', password: 'Admin@123456' },
  });
  const tok = login.json?.access_token;
  check('admin login', !!tok);

  // Preserve whatever is currently configured so the test is non-destructive.
  const before = await api('/api/admin/settings/top-bets', { token: tok });
  const originalItems = before.json?.items ?? [];

  // 1. Dropdown source (the tab requests all leagues with a high limit)
  const avail = await api('/api/admin/game-picks/top-leagues/available?limit=5000', { token: tok });
  check('available-leagues endpoint returns leagues', avail.status === 200 && Array.isArray(avail.json) && avail.json.length > 0,
    `status=${avail.status} n=${Array.isArray(avail.json) ? avail.json.length : 'x'}`);
  const hasEredivisie = (avail.json ?? []).some((a) => a.league === 'Netherlands - Eredivisie');
  check('dropdown contains "Netherlands - Eredivisie"', hasEredivisie);
  const availDefault = await api('/api/admin/game-picks/top-leagues/available', { token: tok });
  check('default limit stays 100 (Game Picks page unchanged)',
    availDefault.status === 200 && (availDefault.json ?? []).length === 100,
    `n=${(availDefault.json ?? []).length}`);

  // 2. Admin saves two leagues (what the renamed tab sends)
  const save = await api('/api/admin/settings/top-bets', {
    method: 'POST', token: tok,
    body: {
      items: [
        { id: 'e2e-1', league: 'Netherlands - Eredivisie', league_group: 'Netherlands', sport_type: 'Football' },
        { id: 'e2e-2', league: 'Sweden - Superettan', league_group: 'Sweden', sport_type: 'Football' },
      ],
    },
  });
  check('admin save (add leagues) succeeds', save.status === 200, `status=${save.status} ${JSON.stringify(save.json)?.slice(0, 150)}`);

  // 3. Public read (what all three user-panel components call, no auth)
  const pub = await api('/api/public/top-bets');
  const pubLeagues = (pub.json?.items ?? []).map((i) => i.league);
  check('public top-bets returns the saved leagues', pub.status === 200 &&
    pubLeagues.includes('Netherlands - Eredivisie') && pubLeagues.includes('Sweden - Superettan'),
    JSON.stringify(pub.json)?.slice(0, 200));

  // 4. Upcoming matches for a configured league (exact-name filter)
  const matches = await api(`/api/sports/matches?league=${encodeURIComponent('Sweden - Superettan')}&status=upcoming&limit=5`);
  check('upcoming matches load for a configured league', matches.status === 200 && Array.isArray(matches.json?.items),
    `status=${matches.status}`);
  const allMatchLeague = (matches.json?.items ?? []).every((m) => m.league === 'Sweden - Superettan');
  check('returned matches belong to the exact league', allMatchLeague,
    JSON.stringify((matches.json?.items ?? []).map((m) => m.league)));

  // 5. Removal: save a 1-item list → public list shrinks accordingly
  const shrink = await api('/api/admin/settings/top-bets', {
    method: 'POST', token: tok,
    body: { items: [{ id: 'e2e-1', league: 'Netherlands - Eredivisie', league_group: 'Netherlands', sport_type: 'Football' }] },
  });
  const pub2 = await api('/api/public/top-bets');
  const pub2Leagues = (pub2.json?.items ?? []).map((i) => i.league);
  check('removing a league is reflected publicly', shrink.status === 200 &&
    pub2Leagues.includes('Netherlands - Eredivisie') && !pub2Leagues.includes('Sweden - Superettan'),
    JSON.stringify(pub2Leagues));

  // Restore the original configuration (empty list on this environment).
  const restore = await api('/api/admin/settings/top-bets', {
    method: 'POST', token: tok, body: { items: originalItems },
  });
  const pub3 = await api('/api/public/top-bets');
  check('original configuration restored', restore.status === 200 &&
    (pub3.json?.items ?? []).length === originalItems.length,
    `restored n=${(pub3.json?.items ?? []).length} expected=${originalItems.length}`);

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E error:', err);
  process.exit(1);
});
