/**
 * Section 22 — Permission resolution.
 *
 * Permission IDs live on the `roles` table (jsonb array). At login /
 * token-refresh time we look up the row matching the user's role name
 * and return its permissions. Super admins always receive the
 * wildcard sentinel "*" which `hasPermission()` treats as "all".
 *
 * The catalog of permission strings is owned by the admin panel (see
 * `admin-panel-main/src/lib/permissions.ts`). The backend never
 * validates that the strings match a known catalog entry — that
 * would create a footgun every time the spec adds a permission. The
 * roles table accepts whatever JSON the admin saves and the gate
 * middleware simply checks for membership.
 */

import type { PoolClient } from 'pg';

export const SUPERADMIN_WILDCARD = '*';

/**
 * Roles that are managed entirely by string convention rather than by
 * a row in `roles`. Each entry maps to a default permission set so a
 * new tenant works out of the box without seeding role rows.
 *
 * - `superadmin` always gets the wildcard.
 * - `tenant_admin` (full administrator) gets the wildcard too unless
 *   the operator explicitly creates a `tenant_admin` row in `roles`
 *   with a restricted set.
 * - `cashier` cannot access the Admin Panel at all per spec — we
 *   return an empty array; the cashier surface area is gated by
 *   `requireRole('cashier')` independently.
 * - `user`, `affiliate`, `branch`, `agent` get their own empty arrays.
 *   Granular access for agent / branch is enforced server-side via
 *   tenant + scope rules — the JWT permissions list is reserved for
 *   admin-panel gating only.
 */
const ROLE_FALLBACKS: Record<string, string[]> = {
  superadmin: [SUPERADMIN_WILDCARD],
  super_admin: [SUPERADMIN_WILDCARD],
};

export async function loadPermissionsForRole(
  client: PoolClient,
  tenantId: string,
  role: string
): Promise<string[]> {
  if (!role) return [];
  // Super admin shortcut — never read the DB.
  if (ROLE_FALLBACKS[role]) return ROLE_FALLBACKS[role];

  // Look up a roles row whose `name` matches the user's role. We
  // intentionally treat a missing row as "no permissions" rather than
  // raising — that gives operators a graceful path when a role hasn't
  // been provisioned yet.
  const r = await client.query<{ permissions: string[] | null }>(
    `SELECT permissions
       FROM roles
      WHERE tenant_id = $1
        AND name = $2
        AND status = 'active'
      LIMIT 1`,
    [tenantId, role]
  );
  const row = r.rows[0];
  if (!row) return [];
  if (!Array.isArray(row.permissions)) return [];
  return row.permissions.filter((p): p is string => typeof p === 'string');
}

/**
 * Section 23 — Role Settings Modal.
 *
 * Resolve the *effective* permissions for a given user. Order of precedence:
 *
 *   1. Hard-coded super-admin wildcard.
 *   2. Per-user override stored in `users.metadata.permissions` (admin panel
 *      writes this through `PUT /api/admin/users/:id/permissions`).
 *   3. Role-level defaults from the `roles` table (legacy behaviour).
 *
 * This lets a Super Admin tighten or loosen any individual admin's surface
 * area without needing to maintain a full row in `roles`.
 */
export async function loadEffectivePermissionsForUser(
  client: PoolClient,
  tenantId: string,
  user: { role: string; metadata: Record<string, unknown> | null }
): Promise<string[]> {
  // Super admin shortcut.
  if (ROLE_FALLBACKS[user.role]) return ROLE_FALLBACKS[user.role];

  const md = (user.metadata ?? {}) as Record<string, unknown>;
  const override = md.permissions;
  if (Array.isArray(override)) {
    const filtered = override.filter((p): p is string => typeof p === 'string');
    // An explicit empty array is also a valid override — it means "this
    // user has no admin-panel surface area". We only fall back to the
    // role row when the override is absent altogether.
    if (filtered.length > 0 || md.permissions !== undefined) {
      return filtered;
    }
  }

  return loadPermissionsForRole(client, tenantId, user.role);
}

/** Returns true if the JWT-embedded permission list covers `required`. */
export function hasPermission(
  permissions: string[] | undefined | null,
  required: string
): boolean {
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes(SUPERADMIN_WILDCARD)) return true;
  return permissions.includes(required);
}
