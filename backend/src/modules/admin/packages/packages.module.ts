import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
  type AdminScope,
} from '../admin-shared';

const router = Router();

const idParam = z.object({ id: z.string().uuid() });
const assignIdParam = z.object({ assignId: z.string().uuid() });

const packageSchema = z.object({
  name: z.string().trim().min(1).max(100),
  tier: z.enum(['Starter', 'Premium', 'VIP']).default('Starter'),
  color: z.string().trim().min(1).max(20).default('gray'),
  game_ids: z.array(z.string().trim().min(1)).default([]),
});
const updatePackageSchema = packageSchema.partial();
const assignSchema = z.object({
  client_name: z.string().trim().min(1).max(100),
  /** Preferred: link the package to a real tenant (white-label client). */
  client_tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
});

/** Spec § Packages → "Who uses it: Super Admin". Mutations are restricted
 *  to superadmin; tenant_admin may still read their own assignments so the
 *  client portal can render the right gates. */
function ensureSuperadminMutation(scope: AdminScope): void {
  if (!scope.isSuperadmin) {
    throw new ForbiddenError('Only super admin can modify packages');
  }
}

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };
const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.get(
  '/',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const packages = await client.query(
        `SELECT id, name, tier, color, game_ids, created_at, updated_at
           FROM packages
          WHERE tenant_id = $1
          ORDER BY created_at DESC`,
        [tenantId]
      );
      // Include the readable tenant name when a client_tenant_id is set
      // so the admin panel can show "Acme Inc." instead of the bare uuid.
      const assignments = await client.query(
        `SELECT pa.id, pa.package_id, pa.client_name, pa.client_tenant_id,
                pa.user_id, pa.assigned_at,
                t.name AS client_tenant_name, t.slug AS client_tenant_slug
           FROM package_assignments pa
           LEFT JOIN tenants t ON t.id = pa.client_tenant_id
          WHERE pa.tenant_id = $1
          ORDER BY pa.assigned_at DESC`,
        [tenantId]
      );
      const byPackage = new Map<string, unknown[]>();
      for (const a of assignments.rows) {
        const prev = byPackage.get(a.package_id) ?? [];
        prev.push(a);
        byPackage.set(a.package_id, prev);
      }
      return packages.rows.map((p) => ({
        ...p,
        assignments: byPackage.get(p.id) ?? [],
      }));
    });
  })
);

/**
 * GET /api/admin/packages/clients
 *
 * Returns every tenant the superadmin can assign a package to, along with
 * the package they're currently on (if any). Tenant admins see only their
 * own tenant for read-only context.
 */
router.get(
  '/clients',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: null, bypassRls: true },
      async (client) => {
        const filters: string[] = ["status != 'deleted'"];
        const values: unknown[] = [];
        if (!scope.isSuperadmin) {
          filters.push(`id = $${values.length + 1}`);
          values.push(scope.tenantId);
        }
        const tenants = await client.query<{
          id: string;
          name: string;
          slug: string;
          status: string;
        }>(
          `SELECT id, name, slug, status
             FROM tenants
            WHERE ${filters.join(' AND ')}
            ORDER BY name ASC`,
          values
        );

        // Best-effort: enrich with current package (if any).
        const operatorTenantId = scope.tenantId;
        let current: Record<string, { package_id: string; package_name: string }> = {};
        if (operatorTenantId) {
          const cur = await client.query<{
            client_tenant_id: string;
            package_id: string;
            package_name: string;
          }>(
            `SELECT pa.client_tenant_id, pa.package_id, p.name AS package_name
               FROM package_assignments pa
               JOIN packages p ON p.id = pa.package_id
              WHERE pa.tenant_id = $1
                AND pa.client_tenant_id IS NOT NULL`,
            [operatorTenantId]
          );
          current = Object.fromEntries(
            cur.rows.map((r) => [
              r.client_tenant_id,
              { package_id: r.package_id, package_name: r.package_name },
            ])
          );
        }

        return {
          items: tenants.rows.map((t) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            status: t.status,
            current_package: current[t.id] ?? null,
          })),
        };
      }
    );
  })
);

router.post(
  '/',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    ensureSuperadminMutation(scope);
    const tenantId = requireScopedTenantId(scope);
    const body = packageSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const row = await client.query(
        `INSERT INTO packages (tenant_id, name, tier, color, game_ids)
         VALUES ($1,$2,$3,$4,$5::text[])
         RETURNING id, name, tier, color, game_ids, created_at, updated_at`,
        [tenantId, body.name, body.tier, body.color, body.game_ids]
      );
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.package.create',
          resource: 'packages',
          resourceId: row.rows[0].id,
          payload: { after: row.rows[0] },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return row.rows[0];
    });
  })
);

router.put(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    ensureSuperadminMutation(scope);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    const body = updatePackageSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        if (k === 'game_ids') {
          sets.push(`${k} = $${i++}::text[]`);
          values.push(v);
        } else {
          sets.push(`${k} = $${i++}`);
          values.push(v);
        }
      }
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      values.push(tenantId);
      const row = await client.query(
        `UPDATE packages SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${i++} AND tenant_id = $${i}
         RETURNING id, name, tier, color, game_ids, created_at, updated_at`,
        values
      );
      if (!row.rows[0]) throw new NotFoundError('Package not found');
      return row.rows[0];
    });
  })
);

router.delete(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    ensureSuperadminMutation(scope);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const cnt = await client.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM package_assignments WHERE package_id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if ((cnt.rows[0]?.c ?? 0) > 0) {
        throw new ConflictError('Cannot delete package with active assignments');
      }
      const del = await client.query(
        `DELETE FROM packages WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (!del.rows[0]) throw new NotFoundError('Package not found');
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.package.delete',
          resource: 'packages',
          resourceId: id,
          payload: { id },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return { id };
    });
  })
);

router.get(
  '/:id/assignments',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const rows = await client.query(
        `SELECT id, package_id, client_name, user_id, assigned_at
           FROM package_assignments
          WHERE tenant_id = $1 AND package_id = $2
          ORDER BY assigned_at DESC`,
        [tenantId, id]
      );
      return rows.rows;
    });
  })
);

router.post(
  '/:id/assign',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    ensureSuperadminMutation(scope);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    const body = assignSchema.parse(req.body);

    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      // Resolve client_tenant_id when we can (looks up by exact name).
      let clientTenantId = body.client_tenant_id ?? null;
      let clientName = body.client_name;
      if (!clientTenantId) {
        const t = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM tenants WHERE name = $1 LIMIT 1`,
          [body.client_name]
        );
        if (t.rows[0]) {
          clientTenantId = t.rows[0].id;
        }
      } else {
        const t = await client.query<{ name: string }>(
          `SELECT name FROM tenants WHERE id = $1`,
          [clientTenantId]
        );
        if (!t.rows[0]) throw new NotFoundError('Client tenant not found');
        clientName = clientName || t.rows[0].name;
      }

      // A given client tenant can be on only one package per operator
      // tenant at a time — drop any prior assignment first.
      if (clientTenantId) {
        await client.query(
          `DELETE FROM package_assignments
             WHERE tenant_id = $1 AND client_tenant_id = $2`,
          [tenantId, clientTenantId]
        );
      } else {
        await client.query(
          `DELETE FROM package_assignments
             WHERE tenant_id = $1 AND client_name = $2 AND client_tenant_id IS NULL`,
          [tenantId, clientName]
        );
      }

      const row = await client.query(
        `INSERT INTO package_assignments
           (tenant_id, package_id, client_name, client_tenant_id, user_id)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, package_id, client_name, client_tenant_id, user_id,
                   assigned_at`,
        [tenantId, id, clientName, clientTenantId, body.user_id ?? null]
      );
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.package.assign',
          resource: 'package_assignments',
          resourceId: row.rows[0].id,
          payload: { after: row.rows[0] },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return row.rows[0];
    });
  })
);

router.delete(
  '/:id/assign/:assignId',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    ensureSuperadminMutation(scope);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    const { assignId } = assignIdParam.parse(req.params);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const del = await client.query(
        `DELETE FROM package_assignments
          WHERE tenant_id = $1 AND package_id = $2 AND id = $3
         RETURNING id`,
        [tenantId, id, assignId]
      );
      if (!del.rows[0]) throw new NotFoundError('Assignment not found');
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.package.unassign',
          resource: 'package_assignments',
          resourceId: assignId,
          payload: { package_id: id },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return { id: assignId };
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Shared helper                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the casino-games allow-list for a given client tenant.
 *
 * Returns `null` when no package is assigned (no restriction) and `string[]`
 * when a package is assigned (caller must restrict casino game listings to
 * those ids). The lookup intentionally bypasses RLS because client tenants
 * never have visibility on the operator tenant's `packages` row directly.
 *
 * Cached call-sites should treat `null` and `[]` differently:
 *   - `null` → no package assigned → show every casino game
 *   - `[]`   → package with empty allow-list → show nothing
 */
export async function getTenantAllowedGameIds(
  clientTenantId: string
): Promise<string[] | null> {
  return withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client: PoolClient) => {
      const r = await client.query<{ game_ids: string[] }>(
        `SELECT p.game_ids
           FROM package_assignments pa
           JOIN packages p ON p.id = pa.package_id
          WHERE pa.client_tenant_id = $1
          ORDER BY pa.assigned_at DESC
          LIMIT 1`,
        [clientTenantId]
      );
      if (!r.rows[0]) return null;
      return Array.isArray(r.rows[0].game_ids) ? r.rows[0].game_ids : [];
    }
  );
}

export default router;
