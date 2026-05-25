import type { PoolClient } from 'pg';

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

const SELECT_GAME = `
  id, tenant_id, provider, name, type, config, is_active, is_iframe,
  iframe_url, rtp, status, created_at, updated_at
`;

export async function listGames(
  client: PoolClient,
  scopeTenantId: string | null,
  params: {
    provider: string | null;
    type: string | null;
    status: string | null;
    isActive: boolean | null;
    isIframe: boolean | null;
    search: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: GameRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (scopeTenantId) {
    filters.push(`g.tenant_id = $${i++}`);
    values.push(scopeTenantId);
  }
  if (params.provider) {
    filters.push(`g.provider = $${i++}`);
    values.push(params.provider);
  }
  if (params.type) {
    filters.push(`g.type = $${i++}`);
    values.push(params.type);
  }
  if (params.status) {
    filters.push(`g.status = $${i++}`);
    values.push(params.status);
  }
  if (params.isActive !== null) {
    filters.push(`g.is_active = $${i++}`);
    values.push(params.isActive);
  }
  if (params.isIframe !== null) {
    filters.push(`g.is_iframe = $${i++}`);
    values.push(params.isIframe);
  }
  if (params.search) {
    filters.push(`(g.name ILIKE $${i} OR g.provider ILIKE $${i})`);
    values.push(`%${params.search}%`);
    i++;
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM games g ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<GameRow>(
    `SELECT ${SELECT_GAME}
       FROM games g
       ${where}
      ORDER BY g.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

export async function findGameById(
  client: PoolClient,
  id: string
): Promise<GameRow | null> {
  const r = await client.query<GameRow>(
    `SELECT ${SELECT_GAME} FROM games WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function findGameByProviderAndName(
  client: PoolClient,
  tenantId: string,
  provider: string,
  name: string
): Promise<GameRow | null> {
  const r = await client.query<GameRow>(
    `SELECT ${SELECT_GAME}
       FROM games
      WHERE tenant_id = $1 AND provider = $2 AND name = $3
      LIMIT 1`,
    [tenantId, provider, name]
  );
  return r.rows[0] ?? null;
}

export async function insertGame(
  client: PoolClient,
  params: {
    tenantId: string;
    provider: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    isActive: boolean;
    isIframe: boolean;
    iframeUrl: string | null;
    rtp: number | null;
    status: string;
  }
): Promise<GameRow> {
  const r = await client.query<GameRow>(
    `INSERT INTO games
       (tenant_id, provider, name, type, config, is_active, is_iframe,
        iframe_url, rtp, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
     RETURNING ${SELECT_GAME}`,
    [
      params.tenantId,
      params.provider,
      params.name,
      params.type,
      JSON.stringify(params.config),
      params.isActive,
      params.isIframe,
      params.iframeUrl,
      params.rtp,
      params.status,
    ]
  );
  return r.rows[0];
}

export async function updateGame(
  client: PoolClient,
  id: string,
  fields: {
    provider?: string;
    name?: string;
    type?: string;
    config?: Record<string, unknown>;
    is_active?: boolean;
    is_iframe?: boolean;
    iframe_url?: string | null;
    rtp?: number | null;
    status?: string;
  }
): Promise<GameRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  let i = 2;

  if (fields.provider !== undefined) {
    sets.push(`provider = $${i++}`);
    values.push(fields.provider);
  }
  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(fields.name);
  }
  if (fields.type !== undefined) {
    sets.push(`type = $${i++}`);
    values.push(fields.type);
  }
  if (fields.config !== undefined) {
    sets.push(`config = $${i++}::jsonb`);
    values.push(JSON.stringify(fields.config));
  }
  if (fields.is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    values.push(fields.is_active);
  }
  if (fields.is_iframe !== undefined) {
    sets.push(`is_iframe = $${i++}`);
    values.push(fields.is_iframe);
  }
  if (fields.iframe_url !== undefined) {
    sets.push(`iframe_url = $${i++}`);
    values.push(fields.iframe_url);
  }
  if (fields.rtp !== undefined) {
    sets.push(`rtp = $${i++}`);
    values.push(fields.rtp);
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(fields.status);
  }
  if (sets.length === 0) return null;

  const r = await client.query<GameRow>(
    `UPDATE games
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_GAME}`,
    values
  );
  return r.rows[0] ?? null;
}

export async function deleteGame(
  client: PoolClient,
  id: string
): Promise<GameRow | null> {
  const r = await client.query<GameRow>(
    `DELETE FROM games WHERE id = $1 RETURNING ${SELECT_GAME}`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function listGameSessions(
  client: PoolClient,
  scopeTenantId: string | null,
  params: {
    gameId: string;
    status: string | 'all';
    userId: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: GameSessionRow[]; total: number }> {
  const filters: string[] = [`s.game_id = $1`];
  const values: unknown[] = [params.gameId];
  let i = 2;

  if (scopeTenantId) {
    filters.push(`s.tenant_id = $${i++}`);
    values.push(scopeTenantId);
  }
  if (params.userId) {
    filters.push(`s.user_id = $${i++}`);
    values.push(params.userId);
  }
  if (params.status !== 'all') {
    filters.push(`s.status = $${i++}`);
    values.push(params.status);
    if (params.status === 'active') {
      filters.push(`(s.expires_at IS NULL OR s.expires_at > now())`);
      filters.push(`s.ended_at IS NULL`);
    }
  }

  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM game_sessions s ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<GameSessionRow>(
    `SELECT s.id, s.tenant_id, s.user_id, s.game_id, s.token, s.status,
            host(s.ip) AS ip, s.user_agent, s.started_at, s.ended_at,
            s.expires_at, s.metadata, s.created_at
       FROM game_sessions s
       ${where}
      ORDER BY s.started_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}
