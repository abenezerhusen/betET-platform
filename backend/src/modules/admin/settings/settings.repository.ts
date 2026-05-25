import type { PoolClient } from 'pg';

export interface SettingRow {
  id: string;
  tenant_id: string;
  key: string;
  value: unknown;
  description: string | null;
  category: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_SETTING = `
  id, tenant_id, key, value, description, category, updated_by,
  created_at, updated_at
`;

export async function listSettings(
  client: PoolClient,
  scopeTenantId: string,
  params: { category: string | null; keyPrefix: string | null }
): Promise<SettingRow[]> {
  const filters: string[] = [`tenant_id = $1`];
  const values: unknown[] = [scopeTenantId];
  let i = 2;

  if (params.category) {
    filters.push(`category = $${i++}`);
    values.push(params.category);
  }
  if (params.keyPrefix) {
    filters.push(`key LIKE $${i++}`);
    values.push(`${params.keyPrefix}%`);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const r = await client.query<SettingRow>(
    `SELECT ${SELECT_SETTING}
       FROM settings
       ${where}
      ORDER BY category NULLS LAST, key`,
    values
  );
  return r.rows;
}

export async function findSetting(
  client: PoolClient,
  tenantId: string,
  key: string
): Promise<SettingRow | null> {
  const r = await client.query<SettingRow>(
    `SELECT ${SELECT_SETTING}
       FROM settings
      WHERE tenant_id = $1 AND key = $2
      LIMIT 1`,
    [tenantId, key]
  );
  return r.rows[0] ?? null;
}

export async function upsertSetting(
  client: PoolClient,
  params: {
    tenantId: string;
    key: string;
    value: unknown;
    description: string | null | undefined;
    category: string | null | undefined;
    updatedBy: string;
  }
): Promise<SettingRow> {
  // For UPSERT, COALESCE keeps existing description/category when caller did
  // not pass them (undefined → null in JS). When caller explicitly passes
  // null, that nulls the column out.
  const r = await client.query<SettingRow>(
    `INSERT INTO settings (tenant_id, key, value, description, category, updated_by)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     ON CONFLICT (tenant_id, key) DO UPDATE
        SET value       = EXCLUDED.value,
            description = COALESCE($4, settings.description),
            category    = COALESCE($5, settings.category),
            updated_by  = EXCLUDED.updated_by,
            updated_at  = now()
     RETURNING ${SELECT_SETTING}`,
    [
      params.tenantId,
      params.key,
      JSON.stringify(params.value ?? null),
      params.description ?? null,
      params.category ?? null,
      params.updatedBy,
    ]
  );
  return r.rows[0];
}

export async function deleteSetting(
  client: PoolClient,
  tenantId: string,
  key: string
): Promise<SettingRow | null> {
  const r = await client.query<SettingRow>(
    `DELETE FROM settings
      WHERE tenant_id = $1 AND key = $2
      RETURNING ${SELECT_SETTING}`,
    [tenantId, key]
  );
  return r.rows[0] ?? null;
}
