import type { Request } from 'express';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ForbiddenError } from '../../../http/errors/http-error';
import { getAdminScope, type AdminScope } from '../admin-shared';
import { buildKey, withCache } from '../reports/reports.cache';
import {
  resolveDashboardRange,
  type DashboardStatsQuery,
  type DashboardTab,
} from './dashboard.dto';
import {
  getDashboardByBranch,
  getDashboardStats,
  type DashboardBranchRow,
  type DashboardStats,
} from './dashboard.repository';

const DASHBOARD_CACHE_TTL_SECONDS = 30;

export interface DashboardResponse {
  tab: DashboardTab;
  range: { from: string; to: string };
  tenant_id: string | null;
  stats: DashboardStats;
  by_branch?: DashboardBranchRow[];
  cached_for_seconds: number;
}

/**
 * Resolve the effective tenant filter for the dashboard query.
 *  - tenant_admin / admin / agent / branch  → pinned to their tenant.
 *  - superadmin → may pass `tenant_id` to scope, or leave empty for cross-tenant
 *    aggregation (only useful in multi-tenant deployments).
 */
function resolveTenantFilter(scope: AdminScope, queryTenantId?: string): string | null {
  if (!scope.isSuperadmin) {
    if (queryTenantId && queryTenantId !== scope.tenantId) {
      throw new ForbiddenError('Cannot query dashboard for a different tenant');
    }
    return scope.tenantId;
  }
  return queryTenantId ?? scope.tenantId ?? null;
}

export async function dashboardStats(
  req: Request,
  query: DashboardStatsQuery
): Promise<DashboardResponse> {
  const scope = getAdminScope(req);
  const tenantId = resolveTenantFilter(scope, query.tenant_id);
  const { from, to } = resolveDashboardRange(query);
  const tab = query.tab;

  const key = buildKey('dashboard.stats', {
    tenantId,
    tab,
    from: from.toISOString(),
    to: to.toISOString(),
  });

  return withCache(key, DASHBOARD_CACHE_TTL_SECONDS, async () =>
    withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
      async (client) => {
        const stats = await getDashboardStats(client, {
          tenantId,
          from,
          to,
          tab,
        });
        const byBranch =
          tab === 'detailed'
            ? await getDashboardByBranch(client, { tenantId, from, to, tab })
            : undefined;
        return {
          tab,
          range: { from: from.toISOString(), to: to.toISOString() },
          tenant_id: tenantId,
          stats,
          ...(byBranch ? { by_branch: byBranch } : {}),
          cached_for_seconds: DASHBOARD_CACHE_TTL_SECONDS,
        };
      }
    )
  );
}
