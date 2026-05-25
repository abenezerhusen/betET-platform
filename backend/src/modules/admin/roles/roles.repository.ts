import type { PoolClient } from 'pg';

export interface RoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

const SELECT_ROLE_COLUMNS = `
  id, tenant_id, name, description, permissions, is_system, status,
  created_at, updated_at
`;

export async function listRoles(
  client: PoolClient,
  scopeTenantId: string | null,
  params: {
    status: string | null;
    search: string | null;
    limit: number;
    offset: number;
  }
): Promise<{ rows: RoleRow[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (scopeTenantId) {
    filters.push(`r.tenant_id = $${i++}`);
    values.push(scopeTenantId);
  }
  if (params.status) {
    filters.push(`r.status = $${i++}`);
    values.push(params.status);
  }
  if (params.search) {
    filters.push(`r.name ILIKE $${i}`);
    values.push(`%${params.search}%`);
    i++;
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM roles r ${where}`,
    values
  );
  const total = totalRes.rows[0].count;

  const r = await client.query<RoleRow>(
    `SELECT ${SELECT_ROLE_COLUMNS}
       FROM roles r
       ${where}
      ORDER BY r.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, params.limit, params.offset]
  );
  return { rows: r.rows, total };
}

export async function findRoleById(
  client: PoolClient,
  id: string
): Promise<RoleRow | null> {
  const r = await client.query<RoleRow>(
    `SELECT ${SELECT_ROLE_COLUMNS} FROM roles WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function findRoleByName(
  client: PoolClient,
  tenantId: string,
  name: string
): Promise<RoleRow | null> {
  const r = await client.query<RoleRow>(
    `SELECT ${SELECT_ROLE_COLUMNS}
       FROM roles
      WHERE tenant_id = $1 AND name = $2
      LIMIT 1`,
    [tenantId, name]
  );
  return r.rows[0] ?? null;
}

export async function insertRole(
  client: PoolClient,
  params: {
    tenantId: string;
    name: string;
    description: string | null;
    permissions: string[];
    isSystem: boolean;
  }
): Promise<RoleRow> {
  const r = await client.query<RoleRow>(
    `INSERT INTO roles (tenant_id, name, description, permissions, is_system)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING ${SELECT_ROLE_COLUMNS}`,
    [
      params.tenantId,
      params.name,
      params.description,
      JSON.stringify(params.permissions),
      params.isSystem,
    ]
  );
  return r.rows[0];
}

export async function updateRole(
  client: PoolClient,
  id: string,
  fields: {
    name?: string;
    description?: string | null;
    permissions?: string[];
    status?: string;
  }
): Promise<RoleRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  let i = 2;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(fields.name);
  }
  if (fields.description !== undefined) {
    sets.push(`description = $${i++}`);
    values.push(fields.description);
  }
  if (fields.permissions !== undefined) {
    sets.push(`permissions = $${i++}::jsonb`);
    values.push(JSON.stringify(fields.permissions));
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(fields.status);
  }
  if (sets.length === 0) return null;

  const r = await client.query<RoleRow>(
    `UPDATE roles
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_ROLE_COLUMNS}`,
    values
  );
  return r.rows[0] ?? null;
}

export async function deleteRole(
  client: PoolClient,
  id: string
): Promise<RoleRow | null> {
  const r = await client.query<RoleRow>(
    `DELETE FROM roles
      WHERE id = $1
      RETURNING ${SELECT_ROLE_COLUMNS}`,
    [id]
  );
  return r.rows[0] ?? null;
}
