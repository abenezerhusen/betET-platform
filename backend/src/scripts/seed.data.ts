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

async function seedSports(client: PoolClient, tenantId: string): Promise<void> {
  const now = Date.now();
  const events = [
    {
      sport: 'football',
      league: 'Ethiopian Premier League',
      home_team: 'St. George FC',
      away_team: 'Fasil Kenema',
      starts_at: new Date(now + 60 * 60 * 1000).toISOString(),
      status: 'scheduled',
    },
    {
      sport: 'football',
      league: 'Ethiopian Premier League',
      home_team: 'Ethiopian Coffee FC',
      away_team: 'Adama City',
      starts_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      status: 'scheduled',
    },
    {
      sport: 'football',
      league: 'English Premier League',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      starts_at: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
      status: 'live',
    },
  ];

  for (const e of events) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM sports_events
       WHERE tenant_id = $1 AND sport = $2 AND league = $3 AND home_team = $4 AND away_team = $5
       LIMIT 1`,
      [tenantId, e.sport, e.league, e.home_team, e.away_team]
    );
    if (existing.rows[0]) continue;

    const created = await client.query<{ id: string }>(
      `INSERT INTO sports_events (tenant_id, sport, league, home_team, away_team, starts_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [tenantId, e.sport, e.league, e.home_team, e.away_team, e.starts_at, e.status]
    );

    const market = await client.query<{ id: string }>(
      `INSERT INTO sports_markets (tenant_id, event_id, market_type, label, status)
       VALUES ($1, $2, '1x2', 'Full Time Result', 'open')
       RETURNING id`,
      [tenantId, created.rows[0].id]
    );

    await client.query(
      `INSERT INTO sports_selections (tenant_id, market_id, label, odds_decimal)
       VALUES ($1, $2, 'Home', 2.10), ($1, $2, 'Draw', 3.20), ($1, $2, 'Away', 3.50)`,
      [tenantId, market.rows[0].id]
    );
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
