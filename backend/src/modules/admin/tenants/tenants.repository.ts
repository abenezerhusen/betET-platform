import type { PoolClient } from 'pg';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  config: Record<string, unknown>;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface TenantWithStats extends TenantRow {
  user_count: number;
  wallet_count: number;
  total_balance: string;
  bet_count: number;
}

export async function listTenantsWithStats(
  client: PoolClient,
  params: {
    status: string | null;
    search: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: TenantWithStats[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (params.status) {
    filters.push(`t.status = $${i++}`);
    values.push(params.status);
  }
  if (params.search) {
    filters.push(`(t.name ILIKE $${i} OR t.slug::text ILIKE $${i})`);
    values.push(`%${params.search}%`);
    i++;
  }
  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const totalResult = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM tenants t ${whereClause}`,
    values
  );
  const total = totalResult.rows[0].count;

  const sql = `
    SELECT t.id,
           t.name,
           t.slug::text       AS slug,
           t.config,
           t.status,
           t.created_at,
           t.updated_at,
           COALESCE(uc.user_count, 0)::int   AS user_count,
           COALESCE(wc.wallet_count, 0)::int AS wallet_count,
           COALESCE(wc.total_balance, 0)     AS total_balance,
           COALESCE(bc.bet_count, 0)::int    AS bet_count
      FROM tenants t
      LEFT JOIN (
        SELECT tenant_id, COUNT(*) AS user_count
          FROM users
         GROUP BY tenant_id
      ) uc ON uc.tenant_id = t.id
      LEFT JOIN (
        SELECT tenant_id,
               COUNT(*)     AS wallet_count,
               SUM(balance) AS total_balance
          FROM wallets
         GROUP BY tenant_id
      ) wc ON wc.tenant_id = t.id
      LEFT JOIN (
        SELECT tenant_id, COUNT(*) AS bet_count
          FROM bets
         GROUP BY tenant_id
      ) bc ON bc.tenant_id = t.id
      ${whereClause}
     ORDER BY t.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`;

  values.push(params.limit, params.offset);
  const r = await client.query<TenantWithStats>(sql, values);
  return { rows: r.rows, total };
}

export async function findTenantById(
  client: PoolClient,
  id: string
): Promise<TenantRow | null> {
  const r = await client.query<TenantRow>(
    `SELECT id, name, slug::text AS slug, config, status, created_at, updated_at
       FROM tenants
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function findTenantBySlug(
  client: PoolClient,
  slug: string
): Promise<TenantRow | null> {
  const r = await client.query<TenantRow>(
    `SELECT id, name, slug::text AS slug, config, status, created_at, updated_at
       FROM tenants
      WHERE slug = $1::citext
      LIMIT 1`,
    [slug]
  );
  return r.rows[0] ?? null;
}

export async function insertTenant(
  client: PoolClient,
  params: {
    name: string;
    slug: string;
    config: Record<string, unknown>;
    status: string;
  }
): Promise<TenantRow> {
  const r = await client.query<TenantRow>(
    `INSERT INTO tenants (name, slug, config, status)
     VALUES ($1, $2::citext, $3::jsonb, $4)
     RETURNING id, name, slug::text AS slug, config, status, created_at, updated_at`,
    [params.name, params.slug, JSON.stringify(params.config), params.status]
  );
  return r.rows[0];
}

export async function updateTenant(
  client: PoolClient,
  id: string,
  fields: {
    name?: string;
    slug?: string;
    config?: Record<string, unknown>;
    status?: string;
  }
): Promise<TenantRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  let i = 2;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(fields.name);
  }
  if (fields.slug !== undefined) {
    sets.push(`slug = $${i++}::citext`);
    values.push(fields.slug);
  }
  if (fields.config !== undefined) {
    sets.push(`config = $${i++}::jsonb`);
    values.push(JSON.stringify(fields.config));
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(fields.status);
  }
  if (sets.length === 0) return null;

  const r = await client.query<TenantRow>(
    `UPDATE tenants
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING id, name, slug::text AS slug, config, status, created_at, updated_at`,
    values
  );
  return r.rows[0] ?? null;
}

export async function softDeleteTenant(
  client: PoolClient,
  id: string
): Promise<TenantRow | null> {
  const r = await client.query<TenantRow>(
    `UPDATE tenants
        SET status = 'disabled',
            updated_at = now()
      WHERE id = $1
      RETURNING id, name, slug::text AS slug, config, status, created_at, updated_at`,
    [id]
  );
  return r.rows[0] ?? null;
}

type SettingValue =
  | string
  | number
  | boolean
  | null
  | SettingValue[]
  | { [k: string]: SettingValue };

const DEFAULT_SETTINGS: Array<{ key: string; category: string; value: SettingValue }> = [
  {
    key: 'general',
    category: 'general',
    value: {
      brand_name: '',
      currency: 'ETB',
      timezone: 'Africa/Addis_Ababa',
      language: 'en',
    },
  },
  {
    key: 'security',
    category: 'security',
    value: {
      require_mfa_admin: true,
      password_min_length: 8,
      session_timeout_minutes: 60,
      max_failed_login_attempts: 10,
    },
  },
  {
    key: 'payment',
    category: 'payment',
    value: {
      min_deposit: 10,
      max_deposit: 100000,
      min_withdrawal: 50,
      max_withdrawal: 100000,
    },
  },
  {
    key: 'limits',
    category: 'limits',
    value: {
      max_bet: 100000,
      max_payout: 1000000,
      daily_loss_limit: null,
    },
  },
  {
    key: 'features',
    category: 'features',
    value: {
      sports: true,
      casino: true,
      virtual: true,
      p2p: true,
    },
  },
  {
    key: 'maintenance_mode',
    category: 'system',
    value: { enabled: false, message: 'We will be back shortly.' },
  },
  {
    key: 'odds_format',
    category: 'general',
    value: 'decimal',
  },
  {
    key: 'allowed_payment_methods',
    category: 'payment',
    value: ['card', 'bank_transfer', 'mobile_money'],
  },
];

export async function insertDefaultSettings(
  client: PoolClient,
  tenantId: string,
  actorId: string | null
): Promise<void> {
  for (const s of DEFAULT_SETTINGS) {
    await client.query(
      `INSERT INTO settings (tenant_id, key, value, category, updated_by)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, s.key, JSON.stringify(s.value), s.category, actorId]
    );
  }
}
