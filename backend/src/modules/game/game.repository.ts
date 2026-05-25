import type { PoolClient } from 'pg';

/* ------------------------------------------------------------------------- */
/* Types                                                                     */
/* ------------------------------------------------------------------------- */

export interface GameSessionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  game_id: string;
  token: string;
  status: string;
  ip: string | null;
  user_agent: string | null;
  started_at: Date;
  ended_at: Date | null;
  expires_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface SessionMetadata {
  currency?: string;
  wallet_id?: string;
  provider?: string;
  game_provider_secret_hint?: string;
  language?: string;
  return_url?: string;
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

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
}

const SELECT_SESSION = `
  id, tenant_id, user_id, game_id, token, status, ip, user_agent,
  started_at, ended_at, expires_at, metadata, created_at
`;
const SELECT_GAME = `
  id, tenant_id, provider, name, type, config, is_active, is_iframe,
  iframe_url, rtp, status, created_at, updated_at
`;

/* ------------------------------------------------------------------------- */
/* Tenants                                                                   */
/* ------------------------------------------------------------------------- */

export async function findTenantById(
  client: PoolClient,
  id: string
): Promise<TenantRow | null> {
  const r = await client.query<TenantRow>(
    `SELECT id, slug, name, status FROM tenants WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Provider configuration (HMAC secret + IP allowlist)                       */
/* ------------------------------------------------------------------------- */

export interface ProviderConfig {
  webhook_secret: string;
  ip_allowlist: string[];
  outbound_signing_secret?: string;
}

interface ProvidersSetting {
  [providerName: string]: {
    webhook_secret?: string;
    ip_allowlist?: string[];
    outbound_signing_secret?: string;
  };
}

interface GameConfigWithProvider {
  provider?: {
    webhook_secret?: string;
    ip_allowlist?: string[];
    outbound_signing_secret?: string;
  };
}

/**
 * Resolve a provider's webhook configuration for a game. Lookup order:
 *   1. game.config.provider          (per-game override; secret rotation)
 *   2. settings('providers')[name]   (tenant-wide provider config)
 *
 * Both layers are merged so a game-level override only needs to specify
 * what differs (e.g. a rotated secret). Returns null when no secret is
 * available — the webhook MUST then be rejected (fail-closed).
 */
export async function resolveProviderConfig(
  client: PoolClient,
  tenantId: string,
  game: Pick<GameRow, 'config' | 'provider'>
): Promise<ProviderConfig | null> {
  const tenantWide = await client.query<{ value: ProvidersSetting | null }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'providers' LIMIT 1`,
    [tenantId]
  );
  const providersValue = tenantWide.rows[0]?.value ?? {};
  const tenantLevel = providersValue[game.provider] ?? {};

  const gameLevel =
    ((game.config ?? {}) as GameConfigWithProvider).provider ?? {};

  const merged = {
    webhook_secret: gameLevel.webhook_secret ?? tenantLevel.webhook_secret ?? null,
    ip_allowlist: Array.isArray(gameLevel.ip_allowlist)
      ? gameLevel.ip_allowlist
      : Array.isArray(tenantLevel.ip_allowlist)
        ? tenantLevel.ip_allowlist
        : [],
    outbound_signing_secret:
      gameLevel.outbound_signing_secret ??
      tenantLevel.outbound_signing_secret ??
      undefined,
  };

  if (!merged.webhook_secret) return null;
  return {
    webhook_secret: merged.webhook_secret,
    ip_allowlist: merged.ip_allowlist,
    outbound_signing_secret: merged.outbound_signing_secret,
  };
}

/* ------------------------------------------------------------------------- */
/* Games                                                                     */
/* ------------------------------------------------------------------------- */

export async function findGameById(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<GameRow | null> {
  const r = await client.query<GameRow>(
    `SELECT ${SELECT_GAME} FROM games WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function findGameByIdAnyTenant(
  client: PoolClient,
  id: string
): Promise<GameRow | null> {
  const r = await client.query<GameRow>(
    `SELECT ${SELECT_GAME} FROM games WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Sessions                                                                  */
/* ------------------------------------------------------------------------- */

export async function insertGameSession(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    gameId: string;
    tokenJti: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
    metadata: SessionMetadata;
  }
): Promise<GameSessionRow> {
  const r = await client.query<GameSessionRow>(
    `INSERT INTO game_sessions
       (tenant_id, user_id, game_id, token, status, ip, user_agent,
        expires_at, metadata)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8::jsonb)
     RETURNING ${SELECT_SESSION}`,
    [
      params.tenantId,
      params.userId,
      params.gameId,
      params.tokenJti,
      params.ip,
      params.userAgent,
      params.expiresAt,
      JSON.stringify(params.metadata),
    ]
  );
  return r.rows[0];
}

export async function findGameSessionById(
  client: PoolClient,
  id: string
): Promise<GameSessionRow | null> {
  const r = await client.query<GameSessionRow>(
    `SELECT ${SELECT_SESSION} FROM game_sessions WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function findGameSessionByIdInTenant(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<GameSessionRow | null> {
  const r = await client.query<GameSessionRow>(
    `SELECT ${SELECT_SESSION}
       FROM game_sessions
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    [id, tenantId]
  );
  return r.rows[0] ?? null;
}

export async function endGameSession(
  client: PoolClient,
  id: string,
  reason: 'ended' | 'expired' | 'revoked' = 'ended'
): Promise<GameSessionRow | null> {
  const r = await client.query<GameSessionRow>(
    `UPDATE game_sessions
        SET status = $2,
            ended_at = COALESCE(ended_at, now())
      WHERE id = $1 AND status = 'active'
      RETURNING ${SELECT_SESSION}`,
    [id, reason]
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------- */
/* Wallet movements (game-engine flavor: balance only, no locked_balance)    */
/* ------------------------------------------------------------------------- */

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

const SELECT_WALLET = `
  id, tenant_id, user_id, currency, balance, bonus_balance, locked_balance,
  status, version, created_at, updated_at
`;

export async function findWalletByIdForUpdate(
  client: PoolClient,
  walletId: string
): Promise<WalletRow | null> {
  const r = await client.query<WalletRow>(
    `SELECT ${SELECT_WALLET} FROM wallets WHERE id = $1 FOR UPDATE`,
    [walletId]
  );
  return r.rows[0] ?? null;
}

export async function findWalletByUserCurrencyForUpdate(
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
  const wallet = await findWalletByUserCurrencyForUpdate(
    client,
    tenantId,
    userId,
    currency
  );
  if (!wallet) throw new Error('failed to acquire wallet row');
  return wallet;
}

/**
 * Atomic balance debit. Combined with `wallets_balance_nonneg` CHECK and
 * the `WHERE balance >= amount` guard this cannot oversell under
 * concurrent webhook calls.
 */
export async function applyWalletBalanceDebit(
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

export async function applyWalletBalanceCredit(
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

/* ------------------------------------------------------------------------- */
/* Transactions                                                              */
/* ------------------------------------------------------------------------- */

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

const SELECT_TX = `
  id, tenant_id, wallet_id, user_id, type, amount, before_balance,
  after_balance, currency, reference, status, metadata, created_at
`;

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

export async function markTransactionReversed(
  client: PoolClient,
  id: string,
  reversalRef: string
): Promise<void> {
  await client.query(
    `UPDATE transactions
        SET status   = 'reversed',
            metadata = COALESCE(metadata, '{}'::jsonb) ||
                       jsonb_build_object('reversed_by', $2::text, 'reversed_at', now())
      WHERE id = $1`,
    [id, reversalRef]
  );
}

/* ------------------------------------------------------------------------- */
/* Bets                                                                      */
/* ------------------------------------------------------------------------- */

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
  created_at: Date;
}

const SELECT_BET = `
  id, tenant_id, user_id, game_id, session_id, stake, potential_win, payout,
  currency, status, result, placed_at, settled_at, metadata, created_at
`;

export async function insertBet(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    gameId: string;
    sessionId: string | null;
    stake: string;
    currency: string;
    metadata: Record<string, unknown>;
  }
): Promise<BetRow> {
  const r = await client.query<BetRow>(
    `INSERT INTO bets
       (tenant_id, user_id, game_id, session_id, stake, potential_win,
        currency, status, metadata)
     VALUES ($1, $2, $3, $4, $5::numeric, 0, $6, 'accepted', $7::jsonb)
     RETURNING ${SELECT_BET}`,
    [
      params.tenantId,
      params.userId,
      params.gameId,
      params.sessionId,
      params.stake,
      params.currency,
      JSON.stringify(params.metadata),
    ]
  );
  return r.rows[0];
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

export async function settleBetWon(
  client: PoolClient,
  betId: string,
  payout: string,
  result: Record<string, unknown> | null
): Promise<void> {
  await client.query(
    `UPDATE bets
        SET status     = 'won',
            payout     = $2::numeric,
            result     = $3::jsonb,
            settled_at = now()
      WHERE id = $1`,
    [betId, payout, result ? JSON.stringify(result) : null]
  );
}

export async function voidBet(
  client: PoolClient,
  betId: string,
  reason: string
): Promise<void> {
  await client.query(
    `UPDATE bets
        SET status     = 'void',
            settled_at = now(),
            metadata   = COALESCE(metadata, '{}'::jsonb) ||
                         jsonb_build_object('void_reason', $2::text)
      WHERE id = $1`,
    [betId, reason]
  );
}
