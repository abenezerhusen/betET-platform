import type { PoolClient } from 'pg';
import bcrypt from 'bcrypt';

interface TenantRow {
  id: string;
  slug: string;
}

async function ensureDefaultTenant(client: PoolClient): Promise<TenantRow> {
  const existing = await client.query<TenantRow>(
    `SELECT id, slug FROM tenants WHERE slug = 'default' LIMIT 1`
  );
  if (existing.rows[0]) return existing.rows[0];
  const created = await client.query<TenantRow>(
    `INSERT INTO tenants (name, slug, status)
     VALUES ('PlayCore Local', 'default', 'active')
     RETURNING id, slug`
  );
  return created.rows[0];
}

// Default Sales Operations permissions granted to the seeded cashier so the
// Cashier Panel works out of the box for local testing. These IDs match the
// admin-panel "Sales Operations" catalog (admin-panel-main/src/lib/permissions.ts)
// and the `requirePermission(...)` gates on the cashier routes. In production an
// administrator manages this exact list per cashier via the Admin Panel
// (Users → Sales Staff → Role Settings), which writes `users.metadata.permissions`.
const DEFAULT_CASHIER_PERMISSIONS = [
  'deposit',
  'withdraw',
  'sell_tickets',
  'sell_jackpots',
  'can_payout',
  'cancel_tickets',
  'cancel_jackpots',
  'cancel_deposit',
  'date_filter_dashboard',
  'request_withdrawal',
];

async function seedUsers(client: PoolClient, tenantId: string): Promise<void> {
  const passwordHash = await bcrypt.hash('Admin@123456', 12);
  // Each row carries a stable `username` in metadata so the spec-mandated
  // username + password admin login works against the seeded users.
  const users = [
    {
      email: 'superadmin@playcore.local',
      role: 'superadmin',
      full_name: 'Super Admin',
      username: 'superadmin',
      metadata: { full_name: 'Super Admin', username: 'superadmin' } as Record<string, unknown>,
    },
    {
      email: 'admin@playcore.local',
      role: 'admin',
      full_name: 'Admin User',
      username: 'admin',
      metadata: { full_name: 'Admin User', username: 'admin' } as Record<string, unknown>,
    },
    {
      email: 'cashier@playcore.local',
      role: 'cashier',
      full_name: 'Cashier User',
      username: 'cashier',
      // A branch label (human code shown on printed receipts) plus the
      // default permission set so deposit/withdraw/sell/cancel/payout all
      // work immediately. Admins can tighten/loosen this per cashier.
      metadata: {
        full_name: 'Cashier User',
        username: 'cashier',
        branch_id: 'PC001',
        branch_label: 'PC001',
        permissions: DEFAULT_CASHIER_PERMISSIONS,
      } as Record<string, unknown>,
    },
    {
      email: 'user@playcore.local',
      role: 'user',
      full_name: 'Test User',
      username: 'testuser',
      metadata: { full_name: 'Test User', username: 'testuser' } as Record<string, unknown>,
    },
    {
      email: 'agent@playcore.local',
      role: 'agent',
      full_name: 'Agent User',
      username: 'agent',
      metadata: { full_name: 'Agent User', username: 'agent' } as Record<string, unknown>,
    },
  ];

  for (const u of users) {
    await client.query(
      `WITH updated AS (
         UPDATE users
            SET password_hash = $3,
                role = $4,
                status = 'active',
                kyc_status = 'verified',
                metadata = $5::jsonb,
                updated_at = now()
          WHERE tenant_id = $1
            AND email = $2::citext
          RETURNING id
       )
       INSERT INTO users (tenant_id, email, phone, password_hash, role, status, kyc_status, metadata)
       SELECT $1, $2::citext, NULL, $3, $4, 'active', 'verified', $5::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM updated)`,
      [
        tenantId,
        u.email,
        passwordHash,
        u.role,
        JSON.stringify(u.metadata),
      ]
    );
  }

  const testUser = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 AND email = 'user@playcore.local' LIMIT 1`,
    [tenantId]
  );
  if (testUser.rows[0]) {
    await client.query(
      `INSERT INTO wallets (tenant_id, user_id, currency, balance)
       VALUES ($1, $2, 'ETB', 5000)
       ON CONFLICT ON CONSTRAINT wallets_user_currency_unique
       DO UPDATE SET balance = 5000`,
      [tenantId, testUser.rows[0].id]
    );
  }
}

async function seedGames(client: PoolClient, tenantId: string): Promise<void> {
  const baseEngineUrl = process.env.GAME_ENGINE_BASE_URL ?? 'http://localhost:3002';
  const games = [
    {
      provider: 'playcore',
      name: 'Aviator',
      type: 'crash',
      rtp: 97.0,
      iframeUrl: `${baseEngineUrl}/games/aviator`,
    },
    {
      provider: 'playcore',
      name: 'Fast Keno',
      type: 'keno',
      rtp: 95.0,
      iframeUrl: `${baseEngineUrl}/games/fast-keno`,
    },
    {
      provider: 'playcore',
      name: 'Multi Hot 5',
      type: 'slot',
      rtp: 96.5,
      iframeUrl: `${baseEngineUrl}/games/multi-hot-5`,
    },
  ];
  for (const g of games) {
    await client.query(
      `INSERT INTO games (
         tenant_id, provider, name, type, is_active, status, is_iframe, iframe_url, rtp, config
       )
       VALUES ($1, $2, $3, $4, true, 'available', true, $5, $6, '{}'::jsonb)
       ON CONFLICT (tenant_id, provider, name)
       DO UPDATE SET
         type = EXCLUDED.type,
         is_active = true,
         status = 'available',
         is_iframe = true,
         iframe_url = EXCLUDED.iframe_url,
         rtp = EXCLUDED.rtp`,
      [tenantId, g.provider, g.name, g.type, g.iframeUrl, g.rtp]
    );
  }
}

/**
 * Permanent local fixture catalog.
 *
 * Hand-curated list of leagues × team pairs so a fresh local environment
 * has plenty of pre-match fixtures to bet on without depending on the
 * real odds provider. Every run distributes kickoffs across the next
 * `SCHEDULE_WINDOW_HOURS` so matches stay "upcoming" no matter when the
 * seed script is invoked — and existing events are recycled (matched on
 * team names) so re-seeding never produces duplicates and never wipes
 * markets that the cashier / public reservation flow already created
 * on the fly.
 *
 * Replace this seed with the real odds-provider integration when it
 * goes live; the schema is identical.
 */
const SCHEDULE_WINDOW_HOURS = 24 * 5; // spread fixtures over the next 5 days

interface FixtureSpec {
  league: string;
  home_team: string;
  away_team: string;
  home_odds: number;
  draw_odds: number;
  away_odds: number;
  live?: boolean;
}

const FOOTBALL_FIXTURES: FixtureSpec[] = [
  // Ethiopian Premier League
  { league: 'Ethiopian Premier League', home_team: 'St. George FC',       away_team: 'Fasil Kenema',         home_odds: 1.95, draw_odds: 3.20, away_odds: 3.80 },
  { league: 'Ethiopian Premier League', home_team: 'Ethiopian Coffee FC', away_team: 'Adama City',           home_odds: 2.10, draw_odds: 3.10, away_odds: 3.40 },
  { league: 'Ethiopian Premier League', home_team: 'Bahir Dar Kenema',    away_team: 'Hawassa City',         home_odds: 2.40, draw_odds: 3.05, away_odds: 2.80 },
  { league: 'Ethiopian Premier League', home_team: 'Wolaita Dicha',       away_team: 'Sidama Coffee',        home_odds: 2.75, draw_odds: 3.00, away_odds: 2.45 },
  { league: 'Ethiopian Premier League', home_team: 'Mekelle 70 Enderta',  away_team: 'Dire Dawa City',       home_odds: 1.85, draw_odds: 3.30, away_odds: 4.10 },
  // English Premier League
  { league: 'English Premier League',   home_team: 'Arsenal',             away_team: 'Chelsea',              home_odds: 1.92, draw_odds: 3.55, away_odds: 3.95, live: true },
  { league: 'English Premier League',   home_team: 'Liverpool',           away_team: 'Manchester City',      home_odds: 2.10, draw_odds: 3.50, away_odds: 3.20 },
  { league: 'English Premier League',   home_team: 'Manchester United',   away_team: 'Tottenham Hotspur',    home_odds: 2.45, draw_odds: 3.30, away_odds: 2.85 },
  { league: 'English Premier League',   home_team: 'Newcastle United',    away_team: 'Aston Villa',          home_odds: 2.20, draw_odds: 3.20, away_odds: 3.25 },
  { league: 'English Premier League',   home_team: 'Burton Albion',       away_team: 'West Ham United',      home_odds: 4.60, draw_odds: 3.65, away_odds: 1.70 },
  { league: 'English Premier League',   home_team: 'Brighton',            away_team: 'Crystal Palace',       home_odds: 2.05, draw_odds: 3.35, away_odds: 3.65 },
  // La Liga
  { league: 'Spanish La Liga',          home_team: 'Real Madrid',         away_team: 'Barcelona',            home_odds: 2.15, draw_odds: 3.60, away_odds: 3.05 },
  { league: 'Spanish La Liga',          home_team: 'Atletico Madrid',     away_team: 'Sevilla',              home_odds: 1.78, draw_odds: 3.50, away_odds: 4.30 },
  { league: 'Spanish La Liga',          home_team: 'Real Sociedad',       away_team: 'Real Betis',           home_odds: 2.30, draw_odds: 3.10, away_odds: 3.05 },
  { league: 'Spanish La Liga',          home_team: 'Villarreal',          away_team: 'Valencia',             home_odds: 2.05, draw_odds: 3.20, away_odds: 3.55 },
  // Serie A
  { league: 'Italian Serie A',          home_team: 'Inter Milan',         away_team: 'Juventus',             home_odds: 2.00, draw_odds: 3.30, away_odds: 3.65 },
  { league: 'Italian Serie A',          home_team: 'AC Milan',            away_team: 'Napoli',               home_odds: 2.30, draw_odds: 3.25, away_odds: 2.95 },
  { league: 'Italian Serie A',          home_team: 'AS Roma',             away_team: 'Lazio',                home_odds: 2.20, draw_odds: 3.15, away_odds: 3.20 },
  { league: 'Italian Serie A',          home_team: 'Atalanta',            away_team: 'Fiorentina',           home_odds: 1.95, draw_odds: 3.45, away_odds: 3.80 },
  // Bundesliga
  { league: 'German Bundesliga',        home_team: 'Bayern Munich',       away_team: 'Borussia Dortmund',    home_odds: 1.65, draw_odds: 4.10, away_odds: 4.50 },
  { league: 'German Bundesliga',        home_team: 'RB Leipzig',          away_team: 'Bayer Leverkusen',     home_odds: 2.50, draw_odds: 3.40, away_odds: 2.65 },
  { league: 'German Bundesliga',        home_team: 'Eintracht Frankfurt', away_team: 'VfB Stuttgart',        home_odds: 2.20, draw_odds: 3.30, away_odds: 3.10 },
  // Ligue 1
  { league: 'French Ligue 1',           home_team: 'Paris Saint-Germain', away_team: 'Marseille',            home_odds: 1.55, draw_odds: 4.20, away_odds: 5.50 },
  { league: 'French Ligue 1',           home_team: 'AS Monaco',           away_team: 'Lyon',                 home_odds: 2.05, draw_odds: 3.40, away_odds: 3.50 },
  { league: 'French Ligue 1',           home_team: 'Lille',               away_team: 'Nice',                 home_odds: 2.15, draw_odds: 3.20, away_odds: 3.30 },
  // UEFA Champions League
  { league: 'UEFA Champions League',    home_team: 'Manchester City',     away_team: 'Real Madrid',          home_odds: 2.30, draw_odds: 3.45, away_odds: 2.95 },
  { league: 'UEFA Champions League',    home_team: 'Bayern Munich',       away_team: 'Paris Saint-Germain',  home_odds: 2.10, draw_odds: 3.55, away_odds: 3.20, live: true },
  { league: 'UEFA Champions League',    home_team: 'Arsenal',             away_team: 'Inter Milan',          home_odds: 2.40, draw_odds: 3.30, away_odds: 2.90 },
  // CAF Champions League
  { league: 'CAF Champions League',     home_team: 'Al Ahly',             away_team: 'Mamelodi Sundowns',    home_odds: 2.10, draw_odds: 3.20, away_odds: 3.30 },
  { league: 'CAF Champions League',     home_team: 'Wydad Casablanca',    away_team: 'Esperance Tunis',      home_odds: 2.50, draw_odds: 3.10, away_odds: 2.75 },
  // South African Premier League
  { league: 'South African PSL',        home_team: 'Kaizer Chiefs',       away_team: 'Orlando Pirates',      home_odds: 2.20, draw_odds: 3.10, away_odds: 3.15 },
  { league: 'South African PSL',        home_team: 'Mamelodi Sundowns',   away_team: 'SuperSport United',    home_odds: 1.55, draw_odds: 4.10, away_odds: 5.20 },
];

const BASKETBALL_FIXTURES: FixtureSpec[] = [
  { league: 'NBA',                home_team: 'Los Angeles Lakers',  away_team: 'Golden State Warriors', home_odds: 2.10, draw_odds: 15.0, away_odds: 1.75 },
  { league: 'NBA',                home_team: 'Boston Celtics',      away_team: 'Miami Heat',            home_odds: 1.65, draw_odds: 15.0, away_odds: 2.30 },
  { league: 'NBA',                home_team: 'Denver Nuggets',      away_team: 'Phoenix Suns',          home_odds: 1.80, draw_odds: 15.0, away_odds: 2.10 },
  { league: 'EuroLeague',         home_team: 'Real Madrid',         away_team: 'Olympiacos',            home_odds: 1.85, draw_odds: 15.0, away_odds: 2.05 },
  { league: 'EuroLeague',         home_team: 'Panathinaikos',       away_team: 'Fenerbahce',            home_odds: 1.95, draw_odds: 15.0, away_odds: 1.95 },
];

async function seedSports(client: PoolClient, tenantId: string): Promise<void> {
  const allFixtures: Array<FixtureSpec & { sport: string }> = [
    ...FOOTBALL_FIXTURES.map((f) => ({ ...f, sport: 'football' })),
    ...BASKETBALL_FIXTURES.map((f) => ({ ...f, sport: 'basketball' })),
  ];

  // Spread kickoffs evenly across the visibility window so the lobby shows
  // fixtures kicking off at varied times instead of all at once.
  const now = Date.now();
  const windowMs = SCHEDULE_WINDOW_HOURS * 60 * 60 * 1000;
  const step = Math.max(1, Math.floor(windowMs / allFixtures.length));

  for (let i = 0; i < allFixtures.length; i++) {
    const f = allFixtures[i];
    // Live matches: kicked off 5-25 min ago. Scheduled: distributed.
    const startsAt = f.live
      ? new Date(now - (5 + (i % 20)) * 60 * 1000)
      : new Date(now + 30 * 60 * 1000 + step * i);
    const status = f.live ? 'live' : 'scheduled';

    // Idempotent upsert: same teams + same league = same event row, with
    // its kickoff / status refreshed so re-running the seed pushes old
    // matches forward into the future without orphaning their markets.
    const upserted = await client.query<{ id: string }>(
      `WITH updated AS (
         UPDATE sports_events
            SET starts_at = $6,
                status = $7,
                updated_at = now()
          WHERE tenant_id = $1
            AND sport = $2
            AND league = $3
            AND home_team = $4
            AND away_team = $5
          RETURNING id
       ), inserted AS (
         INSERT INTO sports_events (tenant_id, sport, league, home_team, away_team, starts_at, status)
         SELECT $1, $2, $3, $4, $5, $6, $7
          WHERE NOT EXISTS (SELECT 1 FROM updated)
          RETURNING id
       )
       SELECT id FROM updated UNION ALL SELECT id FROM inserted`,
      [tenantId, f.sport, f.league, f.home_team, f.away_team, startsAt.toISOString(), status]
    );
    const eventId = upserted.rows[0].id;

    // Ensure the 1x2 / Match Result market exists and is open.
    const market = await client.query<{ id: string }>(
      `WITH updated AS (
         UPDATE sports_markets
            SET status = 'open', updated_at = now()
          WHERE tenant_id = $1 AND event_id = $2
            AND (LOWER(market_type) LIKE '%1x2%' OR LOWER(label) LIKE '%match result%')
          RETURNING id
       ), inserted AS (
         INSERT INTO sports_markets (tenant_id, event_id, market_type, label, status)
         SELECT $1, $2, '1x2', 'Full Time Result', 'open'
          WHERE NOT EXISTS (SELECT 1 FROM updated)
          RETURNING id
       )
       SELECT id FROM updated UNION ALL SELECT id FROM inserted
        LIMIT 1`,
      [tenantId, eventId]
    );
    const marketId = market.rows[0].id;

    // Upsert each of Home / Draw / Away with the curated odds.
    const outcomes: Array<{ label: string; odds: number }> = [
      { label: 'Home', odds: f.home_odds },
      { label: 'Draw', odds: f.draw_odds },
      { label: 'Away', odds: f.away_odds },
    ];
    for (const o of outcomes) {
      await client.query(
        `WITH updated AS (
           UPDATE sports_selections
              SET odds_decimal = $4, updated_at = now()
            WHERE tenant_id = $1 AND market_id = $2 AND lower(label) = lower($3)
            RETURNING id
         )
         INSERT INTO sports_selections (tenant_id, market_id, label, odds_decimal)
         SELECT $1, $2, $3, $4
          WHERE NOT EXISTS (SELECT 1 FROM updated)`,
        [tenantId, marketId, o.label, o.odds]
      );
    }
  }
}

async function seedTelebirrAgent(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `INSERT INTO telebirr_agents (
      tenant_id, agent_name, telebirr_number, device_id, device_name, status, balance
    ) VALUES (
      $1, 'Test Wallet 1', '+251912345678', 'dev_token_test_wallet_1', 'Android Wallet 1', 'active', 50000
    )
    ON CONFLICT (tenant_id, device_id)
    DO UPDATE SET status = 'active', balance = 50000, telebirr_number = EXCLUDED.telebirr_number`,
    [tenantId]
  );
}

async function seedSecuritySettings(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `INSERT INTO settings (tenant_id, key, value, category)
     VALUES ($1, 'security.config', $2::jsonb, 'security')
     ON CONFLICT (tenant_id, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [
      tenantId,
      JSON.stringify({
        mfa_required_for_admins: false,
        session_timeout_minutes: 60,
        max_failed_logins: 5,
        lockout_minutes: 15,
        ip_allowlist: [],
        ip_blocklist: [],
      }),
    ]
  );
}

async function seedP2pDevice(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `INSERT INTO p2p_devices (
        id,
        tenant_id,
        label,
        telebirr_phone,
        device_token,
        status,
        pre_deposit,
        commission_rate,
        daily_limit
      ) VALUES (
        '00000000-0000-0000-0001-000000000001',
        $1,
        'Main Agent Wallet',
        '+251912345678',
        'dev_token_change_this_in_production',
        'offline',
        50000,
        0.02,
        100000
      )
      ON CONFLICT (id) DO UPDATE
        SET tenant_id = EXCLUDED.tenant_id,
            label = EXCLUDED.label,
            telebirr_phone = EXCLUDED.telebirr_phone,
            device_token = EXCLUDED.device_token,
            status = EXCLUDED.status,
            pre_deposit = EXCLUDED.pre_deposit,
            commission_rate = EXCLUDED.commission_rate,
            daily_limit = EXCLUDED.daily_limit,
            updated_at = now()`
    ,
    [tenantId]
  );
}

/**
 * Seed a `cashier` role row carrying the default Sales Operations permission
 * set. This backs the role-level fallback in `loadPermissionsForRole` so any
 * cashier that does NOT have a per-user override still inherits a sensible
 * default — and gives the Admin Panel a concrete role to manage.
 */
async function seedRoles(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `INSERT INTO roles (tenant_id, name, description, permissions, is_system, status)
     VALUES ($1, 'cashier', 'Default cashier / sales staff role', $2::jsonb, true, 'active')
     ON CONFLICT ON CONSTRAINT roles_tenant_name_unique
     DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now()`,
    [tenantId, JSON.stringify(DEFAULT_CASHIER_PERMISSIONS)]
  );
}

export async function runSeed(client: PoolClient): Promise<void> {
  const tenant = await ensureDefaultTenant(client);
  await seedUsers(client, tenant.id);
  await seedRoles(client, tenant.id);
  await seedGames(client, tenant.id);
  await seedSports(client, tenant.id);
  await seedTelebirrAgent(client, tenant.id);
  await seedSecuritySettings(client, tenant.id);
  await seedP2pDevice(client, tenant.id);
}
