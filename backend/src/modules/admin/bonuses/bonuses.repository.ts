import type { PoolClient } from 'pg';
import type { Segment } from './bonuses.dto';

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

export interface BonusClaimRow extends BonusAssignmentRow {
  user_email: string | null;
  user_phone: string | null;
}

const SELECT_BONUS = `
  id, tenant_id, name, type, config, is_active, valid_from, valid_to,
  priority, status, created_at, updated_at
`;

export async function listBonuses(
  client: PoolClient,
  scopeTenantId: string | null,
  params: {
    type: string | null;
    status: string | null;
    isActive: boolean | null;
    search: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: BonusRuleRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (scopeTenantId) {
    filters.push(`tenant_id = $${i++}`);
    values.push(scopeTenantId);
  }
  if (params.type) {
    filters.push(`type = $${i++}`);
    values.push(params.type);
  }
  if (params.status) {
    filters.push(`status = $${i++}`);
    values.push(params.status);
  }
  if (params.isActive !== null) {
    filters.push(`is_active = $${i++}`);
    values.push(params.isActive);
  }
  if (params.search) {
    filters.push(`name ILIKE $${i++}`);
    values.push(`%${params.search}%`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM bonus_rules ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<BonusRuleRow>(
    `SELECT ${SELECT_BONUS}
       FROM bonus_rules
       ${where}
      ORDER BY priority DESC, created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

export async function findBonusById(
  client: PoolClient,
  id: string
): Promise<BonusRuleRow | null> {
  const r = await client.query<BonusRuleRow>(
    `SELECT ${SELECT_BONUS} FROM bonus_rules WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function findBonusByName(
  client: PoolClient,
  tenantId: string,
  name: string
): Promise<BonusRuleRow | null> {
  const r = await client.query<BonusRuleRow>(
    `SELECT ${SELECT_BONUS}
       FROM bonus_rules
      WHERE tenant_id = $1 AND name = $2
      LIMIT 1`,
    [tenantId, name]
  );
  return r.rows[0] ?? null;
}

export async function insertBonus(
  client: PoolClient,
  params: {
    tenantId: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    isActive: boolean;
    validFrom: Date | null;
    validTo: Date | null;
    priority: number;
    status: string;
  }
): Promise<BonusRuleRow> {
  const r = await client.query<BonusRuleRow>(
    `INSERT INTO bonus_rules
       (tenant_id, name, type, config, is_active, valid_from, valid_to, priority, status)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
     RETURNING ${SELECT_BONUS}`,
    [
      params.tenantId,
      params.name,
      params.type,
      JSON.stringify(params.config),
      params.isActive,
      params.validFrom,
      params.validTo,
      params.priority,
      params.status,
    ]
  );
  return r.rows[0];
}

export async function updateBonus(
  client: PoolClient,
  id: string,
  fields: {
    name?: string;
    type?: string;
    config?: Record<string, unknown>;
    is_active?: boolean;
    valid_from?: Date | null;
    valid_to?: Date | null;
    priority?: number;
    status?: string;
  }
): Promise<BonusRuleRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  let i = 2;

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
  if (fields.valid_from !== undefined) {
    sets.push(`valid_from = $${i++}`);
    values.push(fields.valid_from);
  }
  if (fields.valid_to !== undefined) {
    sets.push(`valid_to = $${i++}`);
    values.push(fields.valid_to);
  }
  if (fields.priority !== undefined) {
    sets.push(`priority = $${i++}`);
    values.push(fields.priority);
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(fields.status);
  }
  if (sets.length === 0) return null;

  const r = await client.query<BonusRuleRow>(
    `UPDATE bonus_rules
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_BONUS}`,
    values
  );
  return r.rows[0] ?? null;
}

export async function deleteBonus(
  client: PoolClient,
  id: string
): Promise<BonusRuleRow | null> {
  const r = await client.query<BonusRuleRow>(
    `DELETE FROM bonus_rules WHERE id = $1 RETURNING ${SELECT_BONUS}`,
    [id]
  );
  return r.rows[0] ?? null;
}

/**
 * Resolve segment name to user ids inside the tenant. Returns up to `limit`
 * matching users to bound the assignment job.
 */
export async function resolveSegment(
  client: PoolClient,
  tenantId: string,
  segment: Segment,
  limit: number
): Promise<string[]> {
  switch (segment) {
    case 'all': {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM users
          WHERE tenant_id = $1
          LIMIT $2`,
        [tenantId, limit]
      );
      return r.rows.map((x) => x.id);
    }
    case 'all_active': {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM users
          WHERE tenant_id = $1 AND status = 'active'
          LIMIT $2`,
        [tenantId, limit]
      );
      return r.rows.map((x) => x.id);
    }
    case 'kyc_verified': {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM users
          WHERE tenant_id = $1 AND kyc_status = 'verified' AND status = 'active'
          LIMIT $2`,
        [tenantId, limit]
      );
      return r.rows.map((x) => x.id);
    }
    case 'kyc_pending': {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM users
          WHERE tenant_id = $1 AND kyc_status IN ('pending','submitted')
          LIMIT $2`,
        [tenantId, limit]
      );
      return r.rows.map((x) => x.id);
    }
    case 'new_users': {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM users
          WHERE tenant_id = $1
            AND status = 'active'
            AND created_at >= now() - interval '7 days'
          LIMIT $2`,
        [tenantId, limit]
      );
      return r.rows.map((x) => x.id);
    }
    case 'active_30d': {
      const r = await client.query<{ id: string }>(
        `SELECT DISTINCT b.user_id AS id
           FROM bets b
          WHERE b.tenant_id = $1
            AND b.placed_at >= now() - interval '30 days'
          LIMIT $2`,
        [tenantId, limit]
      );
      return r.rows.map((x) => x.id);
    }
    case 'inactive_30d': {
      const r = await client.query<{ id: string }>(
        `SELECT u.id
           FROM users u
          WHERE u.tenant_id = $1
            AND u.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM bets b
               WHERE b.user_id = u.id
                 AND b.placed_at >= now() - interval '30 days'
            )
          LIMIT $2`,
        [tenantId, limit]
      );
      return r.rows.map((x) => x.id);
    }
    default: {
      const _exhaustive: never = segment;
      throw new Error(`Unknown segment: ${_exhaustive}`);
    }
  }
}

export async function filterValidUserIds(
  client: PoolClient,
  tenantId: string,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const r = await client.query<{ id: string }>(
    `SELECT id FROM users
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, ids]
  );
  return r.rows.map((x) => x.id);
}

export async function bulkInsertAssignments(
  client: PoolClient,
  params: {
    tenantId: string;
    bonusRuleId: string;
    awardedBy: string;
    userIds: string[];
    awardedAmount: number;
    wageringRequired: number;
    expiresAt: Date | null;
    metadata: Record<string, unknown>;
  }
): Promise<BonusAssignmentRow[]> {
  if (params.userIds.length === 0) return [];

  const r = await client.query<BonusAssignmentRow>(
    `INSERT INTO bonus_assignments
       (tenant_id, bonus_rule_id, user_id, awarded_by,
        awarded_amount, wagering_required, expires_at, metadata)
     SELECT $1::uuid, $2::uuid, uid::uuid, $3::uuid,
            $4::numeric, $5::numeric, $6::timestamptz, $7::jsonb
       FROM unnest($8::uuid[]) AS uid
     RETURNING id, tenant_id, bonus_rule_id, user_id, awarded_by,
               awarded_amount, wagering_required, wagering_progress,
               status, awarded_at, expires_at, completed_at,
               metadata, created_at`,
    [
      params.tenantId,
      params.bonusRuleId,
      params.awardedBy,
      params.awardedAmount,
      params.wageringRequired,
      params.expiresAt,
      JSON.stringify(params.metadata),
      params.userIds,
    ]
  );
  return r.rows;
}

export async function listBonusClaims(
  client: PoolClient,
  params: {
    bonusRuleId: string;
    status: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: BonusClaimRow[]; total: number }> {
  const filters = ['ba.bonus_rule_id = $1'];
  const values: unknown[] = [params.bonusRuleId];
  let i = 2;
  if (params.status) {
    filters.push(`ba.status = $${i++}`);
    values.push(params.status);
  }
  const where = `WHERE ${filters.join(' AND ')}`;
  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM bonus_assignments ba
       ${where}`,
    values
  );
  const total = totalRes.rows[0]?.count ?? 0;
  const r = await client.query<BonusClaimRow>(
    `SELECT ba.id, ba.tenant_id, ba.bonus_rule_id, ba.user_id, ba.awarded_by,
            ba.awarded_amount, ba.wagering_required, ba.wagering_progress,
            ba.status, ba.awarded_at, ba.expires_at, ba.completed_at,
            ba.metadata, ba.created_at,
            u.email AS user_email, u.phone AS user_phone
       FROM bonus_assignments ba
       LEFT JOIN users u ON u.id = ba.user_id
       ${where}
      ORDER BY ba.awarded_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

export async function evaluateAndAwardForEvent(
  client: PoolClient,
  params: {
    tenantId: string;
    userId: string;
    eventType: 'deposit' | 'registration';
    amount: number;
    metadata: Record<string, unknown>;
  }
): Promise<BonusAssignmentRow[]> {
  const now = new Date();
  const rulesQ = await client.query<BonusRuleRow>(
    `SELECT ${SELECT_BONUS}
       FROM bonus_rules
      WHERE tenant_id = $1
        AND is_active = true
        AND status = 'active'
        AND (
          ($2 = 'deposit' AND type IN ('deposit', 'free_bet', 'cashback'))
          OR ($2 = 'registration' AND type IN ('signup', 'referral', 'free_bet'))
        )
        AND (valid_from IS NULL OR valid_from <= $3)
        AND (valid_to IS NULL OR valid_to >= $3)
      ORDER BY priority DESC, created_at DESC`,
    [params.tenantId, params.eventType, now]
  );

  const awarded: BonusAssignmentRow[] = [];
  for (const rule of rulesQ.rows) {
    const exists = await client.query<{ id: string }>(
      `SELECT id
         FROM bonus_assignments
        WHERE tenant_id = $1
          AND bonus_rule_id = $2
          AND user_id = $3
        LIMIT 1`,
      [params.tenantId, rule.id, params.userId]
    );
    if (exists.rows[0]) continue;

    const cfg = rule.config as Record<string, unknown>;
    const minDeposit =
      typeof cfg.min_deposit === 'number' ? (cfg.min_deposit as number) : 0;
    if (params.eventType === 'deposit' && params.amount < minDeposit) continue;

    const explicitAmount =
      typeof cfg.amount === 'number' ? (cfg.amount as number) : null;
    const percentage =
      typeof cfg.percentage === 'number'
        ? (cfg.percentage as number)
        : typeof cfg.match_pct === 'number'
          ? (cfg.match_pct as number)
          : 0;
    const maxAmount =
      typeof cfg.max_amount === 'number'
        ? (cfg.max_amount as number)
        : typeof cfg.max_bonus === 'number'
          ? (cfg.max_bonus as number)
          : null;
    let resolvedAmount =
      explicitAmount ?? (params.amount * Math.max(percentage, 0)) / 100;
    if (maxAmount !== null) resolvedAmount = Math.min(resolvedAmount, maxAmount);
    if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) continue;

    const wageringMultiplier =
      typeof cfg.wagering_multiplier === 'number'
        ? (cfg.wagering_multiplier as number)
        : typeof cfg.wagering_req === 'number'
          ? (cfg.wagering_req as number)
          : 0;
    const wageringRequired = resolvedAmount * Math.max(wageringMultiplier, 0);
    const expiresInDays =
      typeof cfg.expires_in_days === 'number'
        ? (cfg.expires_in_days as number)
        : 7;
    const expiresAt =
      expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const inserted = await bulkInsertAssignments(client, {
      tenantId: params.tenantId,
      bonusRuleId: rule.id,
      awardedBy: params.userId,
      userIds: [params.userId],
      awardedAmount: resolvedAmount,
      wageringRequired,
      expiresAt,
      metadata: {
        trigger: params.eventType,
        source: 'internal_evaluator',
        ...params.metadata,
      },
    });
    awarded.push(...inserted);
  }
  return awarded;
}
