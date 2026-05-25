import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { getTenantAllowedGameIds } from '../admin/packages/packages.module';
import { getUserScope } from './user-shared';
import * as repo from './user.repository';
import type { ListGamesQuery } from './user.dto';

export async function listGames(req: Request, params: ListGamesQuery) {
  const scope = getUserScope(req);
  const offset = (params.page - 1) * params.limit;

  // Section 13 — Packages enforcement: when this tenant has been assigned
  // a package, restrict the visible games to that package's allow-list.
  // `null` from the helper means "no package assigned → no restriction".
  const allowList = await getTenantAllowedGameIds(scope.tenantId);

  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      repo.listAvailableGames(client, scope.tenantId, {
        type: params.type ?? null,
        provider: params.provider ?? null,
        search: params.search ?? null,
        limit: params.limit,
        offset,
        allowIds: allowList,
      })
  );

  return {
    items: data.rows,
    total: data.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.total / params.limit)),
  };
}
