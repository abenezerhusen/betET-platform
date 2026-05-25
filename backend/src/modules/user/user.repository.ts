import type { PoolClient } from 'pg';

/* ------------------------------------------------------------------------- */
/* Types                                                                     */
/* ------------------------------------------------------------------------- */

export interface UserRow {
  id: string;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  role: string;
  status: string;
  kyc_status: string;
  metadata: Record<string, unknown>;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PublicUserRow {
  id: string;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  kyc_status: string;
  metadata: Record<string, unknown>;
  last_login_at: Date | null;
  created_at: Date;
}

export interface WalletRow {
  id: string;
  tenant_id: string;
  user_id: string;
  currency: string;
  balance: string;
  bonus_balance: string;
  locked_balance: string;
  status: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface TransactionRow {
  id: string;
  tenant_id: string;
  wallet_id: string;
  user_id: string | null;
  type: string;
  amount: string;
  before_balance: string;
  after_balance: string;
  currency: string;
  reference: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface GameRow {
  id: string;
  tenant_id: string;
  provider: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  is_active: boolean;
  is_iframe: boolean;
  iframe_url: string | null;
  rtp: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface BetRow {
  id: string;
  tenant_id: string;
  user_id: string;
  game_id: string | null;
  session_id: string | null;
  stake: string;
  potential_win: string;
  payout: string | null;
  currency: string;
  status: string;
  result: Record<string, unknown> | null;
  placed_at: Date;
  settled_at: Date | null;
  metadata: Record<string, unknown>;
  idempotency_key?: string | null;
  created_at: Date;
}

export interface BonusRuleRow {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  is_active: boolean;
  valid_from: Date | null;
  valid_to: Date | null;
  priority: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface BonusAssignmentRow {
  id: string;
  tenant_id: string;
  bonus_rule_id: string;
  user_id: string;
  awarded_by: string | null;
  awarded_amount: string;
  wagering_required: string;
  wagering_progress: string;
  status: string;
  awarded_at: Date;
  expires_at: Date | null;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

const SELECT_USER_FULL = `
  id, tenant_id, email, phone, password_hash, role, status, kyc_status, metadata,
  last_login_at, created_at, updated_at
`;
const SELECT_USER_PUBLIC = `
  id, tenant_id, email, phone, role, status, kyc_status, metadata,
  last_login_at, created_at
`;
const SELECT_WALLET = `
  id, tenant_id, user_id, currency, balance, bonus_balance, locked_balance,
  status, version, created_at, updated_at
`;
const SELECT_TX = `
  id, tenant_id, wallet_id, user_id, type, amount, before_balance,
  after_balance, currency, reference, status, metadata, created_at
`;
const SELECT_GAME = `
  id, tenant_id, provider, name, type, config, is_active, is_iframe,
  iframe_url, rtp, status, created_at, updated_at
`;
const SELECT_BET = `
  id, tenant_id, user_id, game_id, session_id, stake, potential_win, payout,
  currency, status, result, placed_at, settled_at, metadata, idempotency_key, created_at
`;
const SELECT_BONUS = `
  id, tenant_id, name, type, config, is_active, valid_from, valid_to,
  priority, status, created_at, updated_at
`;
const SELECT_ASSIGNMENT = `
  id, tenant_id, bonus_rule_id, user_id, awarded_by, awarded_amount,
  wagering_required, wagering_progress, status, awarded_at, expires_at,
  completed_at, metadata, created_at
`;

/* ------------------------------------------------------------------------- */
/* Settings (read helpers)                                                   */
/* ------------------------------------------------------------------------- */

export async function getSettingValue<T = unknown>(
  client: PoolClient,
  tenantId: string,
  key: string
): Promise<T | null> {
  const r = await client.query<{ value: T }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, key]
  );
  return r.rows[0]?.value ?? null;
}

interface PaymentLimits {
  min_deposit?: number;
  max_deposit?: number;
  min_withdrawal?: number;
  max_withdrawal?: number;
}
interface BetLimits {
  max_bet?: number;
  max_payout?: number;
  daily_loss_limit?: number;
}
interface SecuritySettings {
  require_kyc_for_bet?: boolean;
  require_kyc_for_withdrawal?: boolean;
}
interface GeneralSettings {
  currency?: string;
}

export async function getDefaultCurrency(
  client: PoolClient,
  tenantId: string
): Promise<string> {
  const v = await getSettingValue<GeneralSettings>(client, tenantId, 'general');
  return v?.currency ?? 'ETB';
}

export async function getPaymentLimits(
  client: PoolClient,
  tenantId: string
): Promise<Required<PaymentLimits>> {
  const v = (await getSettingValue<PaymentLimits>(client, tenantId, 'payment')) ?? {};
  return {
    min_deposit: v.min_deposit ?? 0,
    max_deposit: v.max_deposit ?? Number.POSITIVE_INFINITY,
    min_withdrawal: v.min_withdrawal ?? 0,
    max_withdrawal: v.max_withdrawal ?? Number.POSITIVE_INFINITY,
  };
}

export async function getBetLimits(
  client: PoolClient,
  tenantId: string
): Promise<Required<BetLimits>> {
  const v = (await getSettingValue<BetLimits>(client, tenantId, 'limits')) ?? {};
  return {
    max_bet: v.max_bet ?? Number.POSITIVE_INFINITY,
    max_payout: v.max_payout ?? Number.POSITIVE_INFINITY,
    daily_loss_limit: v.daily_loss_limit ?? Number.POSITIVE_INFINITY,
  };
}

export async function getSecuritySettings(
  client: PoolClient,
  tenantId: string
): Promise<{ require_kyc_for_bet: boolean; require_kyc_for_withdrawal: boolean }> {
  const v =
    (await getSettingValue<SecuritySettings>(client, tenantId, 'security')) ?? {};
  return {
    require_kyc_for_bet: v.require_kyc_for_bet ?? false,
    require_kyc_for_withdrawal: v.require_kyc_for_withdrawal ?? true,
  };
}

/* ------------------------------------------------------------------------- */
/* Users                                                                     */
/* ------------------------------------------------------------------------- */

export async function findFullUserById(
  client: PoolClient,
  id: string
): Promise<UserRow | null> {
  const r = await client.query<UserRow>(
    `SELECT ${SELECT_USER_FULL} FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function findPublicUserById(
  client: PoolClient,
  id: string
): Promise<PublicUserRow | null> {
  const r = await client.query<PublicUserRow>(
    `SELECT ${SELECT_USER_PUBLIC} FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function updateUserProfile(
  client: PoolClient,
  id: string,
  fields: {
    email?: string;
    phone?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<PublicUserRow | null> {
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
  if (fields.metadata !== undefined) {
    // Merge into existing metadata jsonb so partial profile updates don't
    // erase unrelated keys (e.g. country).
    sets.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${i++}::jsonb`);
    values.push(JSON.stringify(fields.metadata));
  }
  if (sets.length === 0) return null;

  const r = await client.query<PublicUserRow>(
    `UPDATE users
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_USER_PUBLIC}`,
    values
  );
  return r.rows[0] ?? null;
}

export async function setUserPasswordHash(
  client: PoolClient,
  id: string,
  passwordHash: string
): Promise<void> {
  await client.query(
    `UPDATE users
        SET password_hash         = $2,
            failed_login_attempts = 0,
            locked_until          = NULL,
            updated_at            = now()
      WHERE id = $1`,
    [id, passwordHash]
  );
}

/* ------------------------------------------------------------------------- */
/* Wallets                                                                   */
/* ------------------------------------------------------------------------- */

export async function listUserWallets(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<WalletRow[]> {
  const r = await client.query<WalletRow>(
    `SELECT ${SELECT_WALLET}
       FROM wallets
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY currency`,
    [tenantId, userId]
  );
  return r.rows;
}

export async function findUserWalletForUpdate(
  client: PoolClient,
  tenantId: string,
  userId: string,
  currency: string
): Promise<WalletRow | null> {
  const r = await client.query<WalletRow>(
    `SELECT ${SELECT_WALLET}
       FROM wallets
      WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
      FOR UPDATE`,
    [tenantId, userId, currency]
  );
  return r.rows[0] ?? null;
}

/**
 * Atomic move from `balance` into `locked_balance`. Used when placing a bet
 * or submitting a withdrawal request.
 *
 * The WHERE balance >= amount guard combined with the wallets_balance_nonneg
 * CHECK constraint guarantees we never go negative even under concurrency.
 */
export async function lockWalletFunds(
  client: PoolClient,
  walletId: string,
  amount: string
): Promise<WalletRow | null> {
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET balance        = balance - $2::numeric,
            locked_balance = locked_balance + $2::numeric,
            version        = version + 1,
            updated_at     = now()
      WHERE id = $1
        AND balance >= $2::numeric
      RETURNING ${SELECT_WALLET}`,
    [walletId, amount]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Transactions                                                              */
/* ------------------------------------------------------------------------- */

export async function findTransactionByReference(
  client: PoolClient,
  tenantId: string,
  reference: string
): Promise<TransactionRow | null> {
  const r = await client.query<TransactionRow>(
    `SELECT ${SELECT_TX}
       FROM transactions
      WHERE tenant_id = $1 AND reference = $2
      LIMIT 1`,
    [tenantId, reference]
  );
  return r.rows[0] ?? null;
}

export async function insertTransaction(
  client: PoolClient,
  params: {
    tenantId: string;
    walletId: string;
    userId: string;
    type: string;
    amount: string;
    beforeBalance: string;
    afterBalance: string;
    currency: string;
    reference: string | null;
    status: string;
    metadata: Record<string, unknown>;
  }
): Promise<TransactionRow> {
  const r = await client.query<TransactionRow>(
    `INSERT INTO transactions
       (tenant_id, wallet_id, user_id, type, amount, before_balance,
        after_balance, currency, reference, status, metadata)
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric,
             $8, $9, $10, $11::jsonb)
     RETURNING ${SELECT_TX}`,
    [
      params.tenantId,
      params.walletId,
      params.userId,
      params.type,
      params.amount,
      params.beforeBalance,
      params.afterBalance,
      params.currency,
      params.reference,
      params.status,
      JSON.stringify(params.metadata),
    ]
  );
  return r.rows[0];
}

export async function listUserTransactions(
  client: PoolClient,
  tenantId: string,
  userId: string,
  params: {
    type: string | null;
    status: string | null;
    from: Date | null;
    to: Date | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: TransactionRow[]; total: number }> {
  const filters: string[] = [`tenant_id = $1`, `user_id = $2`];
  const values: unknown[] = [tenantId, userId];
  let i = 3;

  if (params.type) {
    filters.push(`type = $${i++}`);
    values.push(params.type);
  }
  if (params.status) {
    filters.push(`status = $${i++}`);
    values.push(params.status);
  }
  if (params.from) {
    filters.push(`created_at >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    filters.push(`created_at <= $${i++}`);
    values.push(params.to);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM transactions ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<TransactionRow>(
    `SELECT ${SELECT_TX}
       FROM transactions
       ${where}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

/* ------------------------------------------------------------------------- */
/* Games                                                                     */
/* ------------------------------------------------------------------------- */

export async function listAvailableGames(
  client: PoolClient,
  tenantId: string,
  params: {
    type: string | null;
    provider: string | null;
    search: string | null;
    limit: number;
    offset: number;
    /** When non-null, restrict to these game ids (Section 13 packages). */
    allowIds?: string[] | null;
  }
): Promise<{ rows: GameRow[]; total: number }> {
  // When the tenant is on a package with an empty allow-list, short-circuit
  // to an empty page instead of building a SQL `IN ()` (which is invalid).
  if (params.allowIds !== undefined && params.allowIds !== null) {
    if (params.allowIds.length === 0) {
      return { rows: [], total: 0 };
    }
  }

  const filters: string[] = [
    `tenant_id = $1`,
    `is_active = true`,
    `status = 'available'`,
  ];
  const values: unknown[] = [tenantId];
  let i = 2;

  if (params.type) {
    filters.push(`type = $${i++}`);
    values.push(params.type);
  }
  if (params.provider) {
    filters.push(`provider = $${i++}`);
    values.push(params.provider);
  }
  if (params.search) {
    filters.push(`(name ILIKE $${i} OR provider ILIKE $${i})`);
    values.push(`%${params.search}%`);
    i++;
  }
  if (params.allowIds && params.allowIds.length > 0) {
    filters.push(`id = ANY($${i++}::uuid[])`);
    values.push(params.allowIds);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM games ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<GameRow>(
    `SELECT ${SELECT_GAME}
       FROM games
       ${where}
      ORDER BY name
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

export async function findActiveGameById(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<GameRow | null> {
  const r = await client.query<GameRow>(
    `SELECT ${SELECT_GAME}
       FROM games
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Bets                                                                      */
/* ------------------------------------------------------------------------- */

export async function insertBet(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    gameId: string;
    sessionId: string | null;
    idempotencyKey: string | null;
    stake: string;
    potentialWin: string;
    currency: string;
    metadata: Record<string, unknown>;
  }
): Promise<BetRow> {
  const r = await client.query<BetRow>(
    `INSERT INTO bets
       (tenant_id, user_id, game_id, session_id, idempotency_key, stake, potential_win,
        currency, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, 'pending', $9::jsonb)
     RETURNING ${SELECT_BET}`,
    [
      params.tenantId,
      params.userId,
      params.gameId,
      params.sessionId,
      params.idempotencyKey,
      params.stake,
      params.potentialWin,
      params.currency,
      JSON.stringify(params.metadata),
    ]
  );
  return r.rows[0];
}

export async function findBetByIdempotencyKey(
  client: PoolClient,
  tenantId: string,
  userId: string,
  key: string
): Promise<BetRow | null> {
  const r = await client.query<BetRow>(
    `SELECT ${SELECT_BET}
       FROM bets
      WHERE tenant_id = $1
        AND user_id = $2
        AND idempotency_key = $3
      ORDER BY placed_at DESC
      LIMIT 1`,
    [tenantId, userId, key]
  );
  return r.rows[0] ?? null;
}

export async function findBetById(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<BetRow | null> {
  const r = await client.query<BetRow>(
    `SELECT ${SELECT_BET}
       FROM bets
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function listUserBets(
  client: PoolClient,
  tenantId: string,
  userId: string,
  params: {
    status: string | null;
    gameId: string | null;
    from: Date | null;
    to: Date | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: BetRow[]; total: number }> {
  const filters: string[] = [`tenant_id = $1`, `user_id = $2`];
  const values: unknown[] = [tenantId, userId];
  let i = 3;

  if (params.status) {
    filters.push(`status = $${i++}`);
    values.push(params.status);
  }
  if (params.gameId) {
    filters.push(`game_id = $${i++}`);
    values.push(params.gameId);
  }
  if (params.from) {
    filters.push(`placed_at >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    filters.push(`placed_at <= $${i++}`);
    values.push(params.to);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM bets ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<BetRow>(
    `SELECT ${SELECT_BET}
       FROM bets
       ${where}
      ORDER BY placed_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

/* ------------------------------------------------------------------------- */
/* Bonuses                                                                   */
/* ------------------------------------------------------------------------- */

export async function listAvailableBonusRules(
  client: PoolClient,
  tenantId: string
): Promise<BonusRuleRow[]> {
  const r = await client.query<BonusRuleRow>(
    `SELECT ${SELECT_BONUS}
       FROM bonus_rules
      WHERE tenant_id = $1
        AND is_active = true
        AND status = 'active'
        AND (valid_from IS NULL OR valid_from <= now())
        AND (valid_to   IS NULL OR valid_to   >  now())
      ORDER BY priority DESC, created_at DESC`,
    [tenantId]
  );
  return r.rows;
}

export async function findBonusRuleById(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<BonusRuleRow | null> {
  const r = await client.query<BonusRuleRow>(
    `SELECT ${SELECT_BONUS}
       FROM bonus_rules
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function listUserBonusAssignments(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<BonusAssignmentRow[]> {
  const r = await client.query<BonusAssignmentRow>(
    `SELECT ${SELECT_ASSIGNMENT}
       FROM bonus_assignments
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY awarded_at DESC`,
    [tenantId, userId]
  );
  return r.rows;
}

export async function findExistingAssignment(
  client: PoolClient,
  tenantId: string,
  bonusRuleId: string,
  userId: string
): Promise<BonusAssignmentRow | null> {
  const r = await client.query<BonusAssignmentRow>(
    `SELECT ${SELECT_ASSIGNMENT}
       FROM bonus_assignments
      WHERE tenant_id = $1
        AND bonus_rule_id = $2
        AND user_id = $3
        AND status IN ('active','completed')
      ORDER BY awarded_at DESC
      LIMIT 1`,
    [tenantId, bonusRuleId, userId]
  );
  return r.rows[0] ?? null;
}

export async function insertBonusAssignment(
  client: PoolClient,
  params: {
    tenantId: string;
    bonusRuleId: string;
    userId: string;
    awardedBy: string | null;
    awardedAmount: string;
    wageringRequired: string;
    expiresAt: Date | null;
    metadata: Record<string, unknown>;
  }
): Promise<BonusAssignmentRow> {
  const r = await client.query<BonusAssignmentRow>(
    `INSERT INTO bonus_assignments
       (tenant_id, bonus_rule_id, user_id, awarded_by,
        awarded_amount, wagering_required, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8::jsonb)
     RETURNING ${SELECT_ASSIGNMENT}`,
    [
      params.tenantId,
      params.bonusRuleId,
      params.userId,
      params.awardedBy,
      params.awardedAmount,
      params.wageringRequired,
      params.expiresAt,
      JSON.stringify(params.metadata),
    ]
  );
  return r.rows[0];
}

/**
 * Credit a bonus into the user's bonus_balance and append a ledger entry.
 * Caller must already hold the wallet row lock (FOR UPDATE).
 */
export async function creditBonusBalance(
  client: PoolClient,
  walletId: string,
  amount: string
): Promise<WalletRow> {
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET bonus_balance = bonus_balance + $2::numeric,
            version       = version + 1,
            updated_at    = now()
      WHERE id = $1
      RETURNING ${SELECT_WALLET}`,
    [walletId, amount]
  );
  return r.rows[0];
}

export async function ensureWalletForUpdate(
  client: PoolClient,
  tenantId: string,
  userId: string,
  currency: string
): Promise<WalletRow> {
  await client.query(
    `INSERT INTO wallets (tenant_id, user_id, currency, balance)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT ON CONSTRAINT wallets_user_currency_unique DO NOTHING`,
    [tenantId, userId, currency]
  );
  const wallet = await findUserWalletForUpdate(client, tenantId, userId, currency);
  if (!wallet) throw new Error('failed to acquire wallet row');
  return wallet;
}

/**
 * Lookup a user inside the same tenant by phone, email, or id. Returns the
 * minimum surface needed to render a transfer receipt (no password hash).
 */
export async function findUserByContact(
  client: PoolClient,
  tenantId: string,
  by: { user_id?: string; phone?: string; email?: string }
): Promise<PublicUserRow | null> {
  if (by.user_id) {
    const r = await client.query<PublicUserRow>(
      `SELECT ${SELECT_USER_PUBLIC} FROM users
        WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, by.user_id]
    );
    return r.rows[0] ?? null;
  }
  if (by.phone) {
    const r = await client.query<PublicUserRow>(
      `SELECT ${SELECT_USER_PUBLIC} FROM users
        WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
      [tenantId, by.phone]
    );
    return r.rows[0] ?? null;
  }
  if (by.email) {
    const r = await client.query<PublicUserRow>(
      `SELECT ${SELECT_USER_PUBLIC} FROM users
        WHERE tenant_id = $1 AND email = $2::citext LIMIT 1`,
      [tenantId, by.email]
    );
    return r.rows[0] ?? null;
  }
  return null;
}

/**
 * Atomic credit into the unlocked balance. Used by the receiver leg of a
 * peer-to-peer transfer. Caller must already hold the wallet row lock.
 */
export async function creditWalletBalance(
  client: PoolClient,
  walletId: string,
  amount: string
): Promise<WalletRow> {
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET balance    = balance + $2::numeric,
            version    = version + 1,
            updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_WALLET}`,
    [walletId, amount]
  );
  return r.rows[0];
}

/**
 * Atomic debit out of the unlocked balance with a non-negative guard. Used
 * by the sender leg of a peer-to-peer transfer. Returns null if the row's
 * balance is below `amount`.
 */
export async function debitWalletBalance(
  client: PoolClient,
  walletId: string,
  amount: string
): Promise<WalletRow | null> {
  const r = await client.query<WalletRow>(
    `UPDATE wallets
        SET balance    = balance - $2::numeric,
            version    = version + 1,
            updated_at = now()
      WHERE id = $1
        AND balance >= $2::numeric
      RETURNING ${SELECT_WALLET}`,
    [walletId, amount]
  );
  return r.rows[0] ?? null;
}
