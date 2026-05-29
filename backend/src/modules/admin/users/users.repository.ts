import type { PoolClient } from 'pg';

export interface AdminUserRow {
  id: string;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  kyc_status: string;
  metadata: Record<string, unknown>;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** Optional: only present when listUsers is called with `withBalance=true`. */
  balance?: string;
  bonus_balance?: string;
  locked_balance?: string;
  currency?: string | null;
  /** Optional: only present when listUsers is called with `withActivity=true`. */
  total_won?: string;
  last_bet_at?: Date | null;
}

const SELECT_USER_COLUMNS = `
  id, tenant_id, email, phone, role, status, kyc_status, metadata,
  failed_login_attempts, locked_until, last_login_at, created_at, updated_at
`;

const SELECT_USER_COLUMNS_PREFIXED = `
  u.id, u.tenant_id, u.email, u.phone, u.role, u.status, u.kyc_status, u.metadata,
  u.failed_login_attempts, u.locked_until, u.last_login_at, u.created_at, u.updated_at
`;

const WALLET_AGGREGATE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT SUM(w.balance)::numeric        AS balance,
           SUM(w.bonus_balance)::numeric  AS bonus_balance,
           SUM(w.locked_balance)::numeric AS locked_balance,
           MIN(w.currency)                AS currency
      FROM wallets w
     WHERE w.user_id = u.id
       AND w.status  = 'active'
  ) wagg ON TRUE
`;

const ACTIVITY_AGGREGATE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      (
        COALESCE(
          (SELECT SUM(b.payout)::numeric
             FROM bets b
            WHERE b.user_id = u.id AND b.status = 'won'),
          0
        ) +
        COALESCE(
          (SELECT SUM(sb.payout)::numeric
             FROM sportsbook_bets sb
            WHERE sb.user_id = u.id AND sb.status = 'won'),
          0
        )
      ) AS total_won,
      GREATEST(
        COALESCE(
          (SELECT MAX(b.placed_at) FROM bets b WHERE b.user_id = u.id),
          'epoch'::timestamptz
        ),
        COALESCE(
          (SELECT MAX(sb.placed_at) FROM sportsbook_bets sb WHERE sb.user_id = u.id),
          'epoch'::timestamptz
        )
      ) AS last_bet_at
  ) aagg ON TRUE
`;

/**
 * Roles that represent offline / shop-based staff (Agent, Branch, Sales,
 * Cashier and the admin tiers). When the Online Users page calls listUsers
 * with the `online_user` alias we layer this denylist on top of the
 * `role='user'` equality check so a malformed row with shop-hierarchy
 * metadata can never accidentally surface in the Online Users list.
 */
const OFFLINE_STAFF_ROLES = [
  'superadmin',
  'tenant_admin',
  'admin',
  'agent',
  'branch',
  'cashier',
  'sales',
  'operator',
];

export async function listUsers(
  client: PoolClient,
  scopeTenantId: string | null,
  params: {
    role: string | null;
    status: string | null;
    kycStatus: string | null;
    search: string | null;
    limit: number;
    offset: number;
    withBalance?: boolean;
    withActivity?: boolean;
    /**
     * Defensive guard: when true, the query also excludes every role in
     * OFFLINE_STAFF_ROLES even if `params.role` is set to 'user'. Set by
     * the admin Online Users page so shop accounts never leak in.
     */
    excludeOfflineStaffRoles?: boolean;
  }
): Promise<{ rows: AdminUserRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (scopeTenantId) {
    filters.push(`u.tenant_id = $${i++}`);
    values.push(scopeTenantId);
  }
  if (params.role) {
    filters.push(`u.role = $${i++}`);
    values.push(params.role);
  }
  if (params.excludeOfflineStaffRoles) {
    const placeholders = OFFLINE_STAFF_ROLES.map(() => `$${i++}`);
    filters.push(`u.role NOT IN (${placeholders.join(',')})`);
    values.push(...OFFLINE_STAFF_ROLES);
  }
  if (params.status) {
    filters.push(`u.status = $${i++}`);
    values.push(params.status);
  }
  if (params.kycStatus) {
    filters.push(`u.kyc_status = $${i++}`);
    values.push(params.kycStatus);
  }
  if (params.search) {
    filters.push(
      `(u.email::text ILIKE $${i} OR u.phone ILIKE $${i} OR u.metadata->>'username' ILIKE $${i} OR u.metadata->>'full_name' ILIKE $${i})`
    );
    values.push(`%${params.search}%`);
    i++;
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM users u ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const extraSelects: string[] = [];
  let joins = '';
  if (params.withBalance) {
    extraSelects.push(
      `COALESCE(wagg.balance, 0)::text        AS balance`,
      `COALESCE(wagg.bonus_balance, 0)::text  AS bonus_balance`,
      `COALESCE(wagg.locked_balance, 0)::text AS locked_balance`,
      `wagg.currency                          AS currency`
    );
    joins += WALLET_AGGREGATE_JOIN;
  }
  if (params.withActivity) {
    extraSelects.push(
      `COALESCE(aagg.total_won, 0)::text  AS total_won`,
      `NULLIF(aagg.last_bet_at, 'epoch'::timestamptz) AS last_bet_at`
    );
    joins += ACTIVITY_AGGREGATE_JOIN;
  }

  const selectExtra = extraSelects.length ? `, ${extraSelects.join(', ')}` : '';

  const r = await client.query<AdminUserRow>(
    `SELECT ${SELECT_USER_COLUMNS_PREFIXED}${selectExtra}
       FROM users u
       ${joins}
       ${where}
      ORDER BY u.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

export async function findUserById(
  client: PoolClient,
  id: string
): Promise<AdminUserRow | null> {
  const r = await client.query<AdminUserRow>(
    `SELECT ${SELECT_USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function findUserByIdInTenantAndRole(
  client: PoolClient,
  tenantId: string,
  id: string,
  role: string
): Promise<AdminUserRow | null> {
  const r = await client.query<AdminUserRow>(
    `SELECT ${SELECT_USER_COLUMNS}
       FROM users
      WHERE id = $1
        AND tenant_id = $2
        AND role = $3
      LIMIT 1`,
    [id, tenantId, role]
  );
  return r.rows[0] ?? null;
}

export async function insertUser(
  client: PoolClient,
  params: {
    tenantId: string;
    email: string | null;
    phone: string | null;
    passwordHash: string | null;
    role: string;
    status: string;
    kycStatus: string;
    metadata: Record<string, unknown>;
  }
): Promise<AdminUserRow> {
  const r = await client.query<AdminUserRow>(
    `INSERT INTO users
       (tenant_id, email, phone, password_hash, role, status, kyc_status, metadata)
     VALUES ($1, $2::citext, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING ${SELECT_USER_COLUMNS}`,
    [
      params.tenantId,
      params.email,
      params.phone,
      params.passwordHash,
      params.role,
      params.status,
      params.kycStatus,
      JSON.stringify(params.metadata),
    ]
  );
  return r.rows[0];
}

export async function updateUser(
  client: PoolClient,
  id: string,
  fields: {
    email?: string | null;
    phone?: string | null;
    role?: string;
    status?: string;
    kyc_status?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<AdminUserRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  let i = 2;

  if (fields.email !== undefined) {
    sets.push(`email = $${i++}::citext`);
    values.push(fields.email);
  }
  if (fields.phone !== undefined) {
    sets.push(`phone = $${i++}`);
    values.push(fields.phone);
  }
  if (fields.role !== undefined) {
    sets.push(`role = $${i++}`);
    values.push(fields.role);
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(fields.status);
  }
  if (fields.kyc_status !== undefined) {
    sets.push(`kyc_status = $${i++}`);
    values.push(fields.kyc_status);
  }
  if (fields.metadata !== undefined) {
    sets.push(`metadata = $${i++}::jsonb`);
    values.push(JSON.stringify(fields.metadata));
  }
  if (sets.length === 0) return null;

  const r = await client.query<AdminUserRow>(
    `UPDATE users
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_USER_COLUMNS}`,
    values
  );
  return r.rows[0] ?? null;
}

export async function setUserStatus(
  client: PoolClient,
  id: string,
  status: string
): Promise<AdminUserRow | null> {
  const r = await client.query<AdminUserRow>(
    `UPDATE users
        SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_USER_COLUMNS}`,
    [id, status]
  );
  return r.rows[0] ?? null;
}

export async function setUserPasswordHash(
  client: PoolClient,
  id: string,
  passwordHash: string
): Promise<AdminUserRow | null> {
  const r = await client.query<AdminUserRow>(
    `UPDATE users
        SET password_hash = $2,
            updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_USER_COLUMNS}`,
    [id, passwordHash]
  );
  return r.rows[0] ?? null;
}

export async function setUserKyc(
  client: PoolClient,
  id: string,
  kycStatus: string
): Promise<AdminUserRow | null> {
  const r = await client.query<AdminUserRow>(
    `UPDATE users
        SET kyc_status = $2, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_USER_COLUMNS}`,
    [id, kycStatus]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* User details (Section 23 — UserDetailsModal)                              */
/* ------------------------------------------------------------------------- */

export interface UserDetailsAggregates {
  total_deposits: string;
  total_withdrawals: string;
  total_bets: string;
  total_won: string;
  bet_count: string;
}

export interface UserDetailsBet {
  id: string;
  source: 'sportsbook' | 'bets';
  stake: string;
  potential_payout: string | null;
  actual_payout: string | null;
  status: string;
  placed_at: Date;
}

export interface UserDetailsTransaction {
  id: string;
  amount: string;
  status: string;
  reference: string | null;
  created_at: Date;
  metadata: Record<string, unknown>;
}

export interface UserDetailsBalance {
  currency: string;
  balance: string;
  bonus_balance: string;
  locked_balance: string;
}

export interface UserDetailsBundle {
  user: AdminUserRow;
  aggregates: UserDetailsAggregates;
  balances: UserDetailsBalance[];
  recent_bets: UserDetailsBet[];
  recent_deposits: UserDetailsTransaction[];
  recent_withdrawals: UserDetailsTransaction[];
}

/**
 * Section 23 — fetch every dataset the UserDetailsModal needs in a single
 * round trip. Reading from `bets` + `sportsbook_bets` and `transactions`
 * to keep parity with the rest of the admin panel.
 */
export async function getUserDetails(
  client: PoolClient,
  userId: string,
  recentLimit: number
): Promise<UserDetailsBundle | null> {
  const user = await findUserById(client, userId);
  if (!user) return null;

  const aggSql = `
    WITH agg AS (
      SELECT
        COALESCE((SELECT SUM(amount)::text FROM transactions
          WHERE user_id = $1 AND type = 'deposit' AND status = 'completed'), '0')
            AS total_deposits,
        COALESCE((SELECT SUM(amount)::text FROM transactions
          WHERE user_id = $1 AND type = 'withdrawal' AND status = 'completed'), '0')
            AS total_withdrawals,
        COALESCE(
          (SELECT (
            COALESCE((SELECT SUM(stake) FROM bets             WHERE user_id = $1), 0) +
            COALESCE((SELECT SUM(stake) FROM sportsbook_bets  WHERE user_id = $1), 0)
          )::text), '0'
        ) AS total_bets,
        COALESCE(
          (SELECT (
            COALESCE((SELECT SUM(payout) FROM bets            WHERE user_id = $1 AND status = 'won'), 0) +
            COALESCE((SELECT SUM(actual_payout) FROM sportsbook_bets WHERE user_id = $1 AND status = 'won'), 0)
          )::text), '0'
        ) AS total_won,
        COALESCE(
          (SELECT (
            COALESCE((SELECT COUNT(*) FROM bets            WHERE user_id = $1), 0) +
            COALESCE((SELECT COUNT(*) FROM sportsbook_bets WHERE user_id = $1), 0)
          )::text), '0'
        ) AS bet_count
    )
    SELECT * FROM agg
  `;
  const aggRes = await client.query<UserDetailsAggregates>(aggSql, [userId]);
  const aggregates: UserDetailsAggregates = aggRes.rows[0] ?? {
    total_deposits: '0',
    total_withdrawals: '0',
    total_bets: '0',
    total_won: '0',
    bet_count: '0',
  };

  const balancesRes = await client.query<UserDetailsBalance>(
    `SELECT currency,
            COALESCE(balance, 0)::text         AS balance,
            COALESCE(bonus_balance, 0)::text   AS bonus_balance,
            COALESCE(locked_balance, 0)::text  AS locked_balance
       FROM wallets
      WHERE user_id = $1 AND status = 'active'
      ORDER BY currency`,
    [userId]
  );

  const betsRes = await client.query<UserDetailsBet>(
    `SELECT id::text                                          AS id,
            'sportsbook'::text                                AS source,
            stake::text                                       AS stake,
            potential_payout::text                            AS potential_payout,
            actual_payout::text                               AS actual_payout,
            status::text                                      AS status,
            placed_at
       FROM sportsbook_bets
      WHERE user_id = $1
      UNION ALL
     SELECT id::text                                          AS id,
            'bets'::text                                      AS source,
            stake::text                                       AS stake,
            potential_win::text                               AS potential_payout,
            payout::text                                      AS actual_payout,
            status::text                                      AS status,
            placed_at
       FROM bets
      WHERE user_id = $1
      ORDER BY placed_at DESC
      LIMIT $2`,
    [userId, recentLimit]
  );

  const depositsRes = await client.query<UserDetailsTransaction>(
    `SELECT id::text         AS id,
            amount::text      AS amount,
            status,
            reference,
            created_at,
            metadata
       FROM transactions
      WHERE user_id = $1
        AND type = 'deposit'
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, recentLimit]
  );

  const withdrawalsRes = await client.query<UserDetailsTransaction>(
    `SELECT id::text         AS id,
            amount::text      AS amount,
            status,
            reference,
            created_at,
            metadata
       FROM transactions
      WHERE user_id = $1
        AND type = 'withdrawal'
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, recentLimit]
  );

  return {
    user,
    aggregates,
    balances: balancesRes.rows,
    recent_bets: betsRes.rows,
    recent_deposits: depositsRes.rows,
    recent_withdrawals: withdrawalsRes.rows,
  };
}

export interface ActivityRow {
  type: 'bet' | 'transaction';
  id: string;
  amount: string;
  status: string;
  created_at: Date;
  details: Record<string, unknown>;
}

export async function listUserActivity(
  client: PoolClient,
  userId: string,
  params: {
    type: 'bets' | 'transactions' | 'all';
    from: Date | null;
    to: Date | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: ActivityRow[]; total: number }> {
  const dateFilter = (col: string) => {
    const parts: string[] = [];
    if (params.from) parts.push(`${col} >= $FROM`);
    if (params.to) parts.push(`${col} <= $TO`);
    return parts.length ? ` AND ${parts.join(' AND ')}` : '';
  };

  const includeBets = params.type === 'bets' || params.type === 'all';
  const includeTx = params.type === 'transactions' || params.type === 'all';

  const segments: string[] = [];
  if (includeBets) {
    segments.push(`
      SELECT 'bet'::text AS type,
             b.id::text  AS id,
             b.stake     AS amount,
             b.status,
             b.placed_at AS created_at,
             jsonb_build_object(
               'game_id', b.game_id,
               'session_id', b.session_id,
               'currency', b.currency,
               'potential_win', b.potential_win,
               'payout', b.payout,
               'settled_at', b.settled_at,
               'result', b.result,
               'metadata', b.metadata
             ) AS details
        FROM bets b
       WHERE b.user_id = $1${dateFilter('b.placed_at')}
    `);
  }
  if (includeTx) {
    segments.push(`
      SELECT 'transaction'::text AS type,
             t.id::text          AS id,
             t.amount            AS amount,
             t.status,
             t.created_at        AS created_at,
             jsonb_build_object(
               'wallet_id', t.wallet_id,
               'tx_type', t.type,
               'currency', t.currency,
               'before_balance', t.before_balance,
               'after_balance', t.after_balance,
               'reference', t.reference,
               'metadata', t.metadata
             ) AS details
        FROM transactions t
       WHERE t.user_id = $1${dateFilter('t.created_at')}
    `);
  }

  const values: unknown[] = [userId];
  let i = 2;
  let combined = segments.join(' UNION ALL ');
  if (params.from) {
    combined = combined.replace(/\$FROM/g, `$${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    combined = combined.replace(/\$TO/g, `$${i++}`);
    values.push(params.to);
  }

  const totalSql = `SELECT COUNT(*)::int AS count FROM (${combined}) sub`;
  const totalRes = await client.query<{ count: number }>(totalSql, values);
  const total = totalRes.rows[0].count;

  const sql = `
    ${combined}
    ORDER BY created_at DESC
    LIMIT $${i++} OFFSET $${i++}
  `;
  const r = await client.query<ActivityRow>(sql, [
    ...values,
    params.limit,
    params.offset,
  ]);
  return { rows: r.rows, total };
}
