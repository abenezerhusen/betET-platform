import type { Request } from 'express';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';
import * as repo from './games.repository';
import type {
  CreateGameInput,
  ListGameSessionsQuery,
  ListGamesQuery,
  ToggleGameInput,
  UpdateGameInput,
} from './games.dto';

function pickAuditGame(g: repo.GameRow): Record<string, unknown> {
  return {
    id: g.id,
    tenant_id: g.tenant_id,
    provider: g.provider,
    name: g.name,
    type: g.type,
    is_active: g.is_active,
    is_iframe: g.is_iframe,
    iframe_url: g.iframe_url,
    rtp: g.rtp,
    status: g.status,
    config: g.config,
  };
}

export async function listGames(req: Request, params: ListGamesQuery) {
  const scope = getAdminScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listGames(client, scope.tenantId, {
        provider: params.provider ?? null,
        type: params.type ?? null,
        status: params.status ?? null,
        isActive: params.is_active ?? null,
        isIframe: params.is_iframe ?? null,
        search: params.search ?? null,
        limit: params.limit,
        offset,
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

export async function getGame(req: Request, id: string) {
  const scope = getAdminScope(req);
  const game = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.findGameById(client, id)
  );
  if (!game) throw new NotFoundError('Game not found');
  if (!scope.isSuperadmin && game.tenant_id !== scope.tenantId) {
    throw new ForbiddenError('Game belongs to a different tenant');
  }
  return game;
}

export async function createGame(req: Request, body: CreateGameInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const created = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const dup = await repo.findGameByProviderAndName(
        client,
        tenantId,
        body.provider,
        body.name
      );
      if (dup) {
        throw new BadRequestError(
          'A game with this provider and name already exists',
          { provider: body.provider, name: body.name }
        );
      }
      return repo.insertGame(client, {
        tenantId,
        provider: body.provider,
        name: body.name,
        type: body.type,
        config: body.config ?? {},
        isActive: body.is_active,
        isIframe: body.is_iframe,
        iframeUrl: body.iframe_url ?? null,
        rtp: body.rtp ?? null,
        status: body.status,
      });
    }
  );

  await tryAudit(
    {
      tenantId: created.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.game.create',
      resource: 'game',
      resourceId: created.id,
      payload: { after: pickAuditGame(created) },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return created;
}

export async function updateGame(req: Request, id: string, body: UpdateGameInput) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findGameById(client, id);
      if (!before) throw new NotFoundError('Game not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Game belongs to a different tenant');
      }
      const willBeIframe = body.is_iframe ?? before.is_iframe;
      const newIframeUrl =
        body.iframe_url === undefined ? before.iframe_url : body.iframe_url;
      if (willBeIframe && !newIframeUrl) {
        throw new BadRequestError(
          'iframe_url is required when is_iframe is true'
        );
      }
      const after = await repo.updateGame(client, id, body);
      if (!after) throw new BadRequestError('No fields to update');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.game.update',
      resource: 'game',
      resourceId: id,
      payload: {
        before: pickAuditGame(result.before),
        after: pickAuditGame(result.after),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}

export async function deleteGame(req: Request, id: string) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findGameById(client, id);
      if (!before) throw new NotFoundError('Game not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Game belongs to a different tenant');
      }
      const deleted = await repo.deleteGame(client, id);
      if (!deleted) throw new NotFoundError('Game not found');
      return { before };
    }
  );

  await tryAudit(
    {
      tenantId: result.before.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.game.delete',
      resource: 'game',
      resourceId: id,
      payload: { before: pickAuditGame(result.before) },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { success: true, id };
}

export async function toggleGame(req: Request, id: string, body: ToggleGameInput) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findGameById(client, id);
      if (!before) throw new NotFoundError('Game not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Game belongs to a different tenant');
      }
      const next = body.is_active ?? !before.is_active;
      const after = await repo.updateGame(client, id, { is_active: next });
      if (!after) throw new NotFoundError('Game not found');
      return { before, after };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.game.toggle',
      resource: 'game',
      resourceId: id,
      payload: {
        before: { is_active: result.before.is_active },
        after: { is_active: result.after.is_active },
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after;
}

export async function gameSessions(
  req: Request,
  id: string,
  params: ListGameSessionsQuery
) {
  const scope = getAdminScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const game = await repo.findGameById(client, id);
      if (!game) throw new NotFoundError('Game not found');
      if (!scope.isSuperadmin && game.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Game belongs to a different tenant');
      }
      const sessions = await repo.listGameSessions(client, scope.tenantId, {
        gameId: id,
        status: params.status,
        userId: params.user_id ?? null,
        limit: params.limit,
        offset,
      });
      return { game, sessions };
    }
  );

  return {
    game: { id: data.game.id, tenant_id: data.game.tenant_id, name: data.game.name },
    items: data.sessions.rows,
    total: data.sessions.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.sessions.total / params.limit)),
  };
}
