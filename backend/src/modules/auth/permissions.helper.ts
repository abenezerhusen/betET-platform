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

/**
 * Agents operate the Admin Panel but must only ever see and manage their OWN
 * sub-tree (their branches + sales staff). The Admin Panel pages / routes /
 * backend API gate on the *admin* permission catalog (`users.branches.*`,
 * `users.sales.*`), whereas the agent Role Settings modal grants *agent*-scope
 * IDs (`list_sales`, `agent.branches.manage`, …). Those two catalogs don't
 * line up, so an agent would otherwise be locked out of every page.
 *
 * We reconcile this by granting every `agent` a fixed baseline of admin-catalog
 * permissions that unlock exactly the two pages they need — Branches and Sales.
 * This baseline is SAFE because the data itself is scoped to the agent's
 * sub-tree in `admin/users.service.ts` (list is filtered by `metadata.agent_id
 * = <agent>`, creation forces `agent_id = <agent>`, and every single-record
 * action is guarded to the agent's own branches/sales). The baseline grants no
 * access to global dashboards, other agents, admins, reports, settings, etc.
 */
export const AGENT_ADMIN_BASELINE: string[] = [
  'users.branches.view',
  'users.branches.manage',
  'users.sales.view',
  'users.sales.manage',
  // Agent-scoped shop dashboard (read-only KPIs for the agent's own sub-tree).
  'dashboard.agent.view',
];

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

  // Agents always receive the sub-tree management baseline (see
  // AGENT_ADMIN_BASELINE) in ADDITION to any per-user override / role row,
  // so they can always reach their own Branches + Sales pages. The data
  // they see through those pages is scoped to their own agent id server-side.
  const withAgentBaseline = (perms: string[]): string[] =>
    user.role === 'agent'
      ? Array.from(new Set([...perms, ...AGENT_ADMIN_BASELINE]))
      : perms;

  const md = (user.metadata ?? {}) as Record<string, unknown>;
  const override = md.permissions;
  if (Array.isArray(override)) {
    const filtered = override.filter((p): p is string => typeof p === 'string');
    // An explicit empty array is also a valid override — it means "this
    // user has no admin-panel surface area". We only fall back to the
    // role row when the override is absent altogether.
    if (filtered.length > 0 || md.permissions !== undefined) {
      return withAgentBaseline(filtered);
    }
  }

  const rolePerms = await loadPermissionsForRole(client, tenantId, user.role);
  if (rolePerms.length > 0) return withAgentBaseline(rolePerms);

  // `tenant_admin` is a FULL administrator by default. Unless the operator
  // explicitly restricts it (via a `roles` row or a per-user override handled
  // above), it receives the wildcard so it keeps unrestricted access on both
  // the frontend and the backend permission gate. This mirrors the documented
  // intent in ROLE_FALLBACKS and keeps frontend/backend gating consistent.
  if (user.role === 'tenant_admin') return [SUPERADMIN_WILDCARD];

  // Agent created without any role row / override still gets the baseline so
  // they can manage their own sub-tree out of the box.
  return withAgentBaseline(rolePerms);
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
