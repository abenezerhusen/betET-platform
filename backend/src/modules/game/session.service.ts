import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { signLaunchToken } from './game-shared';
import * as repo from './game.repository';
import { ensureWalletForUpdate } from './game.repository';
import type { CreateSessionInput } from './game.dto';

interface UserScope {
  tenantId: string;
  userId: string;
  role: string;
}

const PLAYER_ROLES = new Set(['user', 'affiliate']);

function getPlayerScope(req: Request): UserScope {
  if (!req.user) throw new ForbiddenError('Authentication required');
  if (!PLAYER_ROLES.has(req.user.role)) {
    throw new ForbiddenError('Player role required');
  }
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
  };
}

function getDefaultCurrencyKey(): string {
  return 'general';
}

async function resolveDefaultCurrency(
  client: import('pg').PoolClient,
  tenantId: string
): Promise<string> {
  const r = await client.query<{ value: { currency?: string } | null }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, getDefaultCurrencyKey()]
  );
  return r.rows[0]?.value?.currency ?? 'ETB';
}

function buildLaunchUrl(
  iframeUrl: string,
  params: { token: string; tenantSlug: string; currency: string; lang?: string; returnUrl?: string }
): string {
  const url = new URL(iframeUrl);
  url.searchParams.set('token', params.token);
  url.searchParams.set('tenant', params.tenantSlug);
  url.searchParams.set('currency', params.currency);
  if (params.lang) url.searchParams.set('lang', params.lang);
  if (params.returnUrl) url.searchParams.set('return_url', params.returnUrl);
  return url.toString();
}

/**
 * POST /api/game/session/create
 *
 * - Validates the game is enabled (admin disable/enable affects this).
 * - Resolves the user's wallet (auto-created if missing).
 * - Inserts a `game_sessions` row in status='active' so subsequent
 *   webhooks can be authorized.
 * - Mints a 15-minute RS256 launch token containing
 *   { user_id, tenant_id, wallet_id, session_id, game_id, currency }.
 * - Builds the launch URL = game.iframe_url?token=...&tenant=SLUG&currency=...
 */
export async function createSession(req: Request, body: CreateSessionInput) {
  const scope = getPlayerScope(req);

  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const tenant = await repo.findTenantById(client, scope.tenantId);
      if (!tenant) throw new NotFoundError('Tenant not found');
      if (tenant.status !== 'active') {
        throw new BadRequestError(`Tenant is ${tenant.status}`, {
          tenant_status: tenant.status,
        });
      }

      const game = await repo.findGameById(client, scope.tenantId, body.game_id);
      if (!game) throw new NotFoundError('Game not found');
      if (!game.is_iframe || !game.iframe_url) {
        throw new BadRequestError('Game is not an iframe game', {
          game_id: game.id,
        });
      }
      if (!game.is_active || game.status !== 'available') {
        throw new BadRequestError('Game is not currently available', {
          is_active: game.is_active,
          status: game.status,
        });
      }

      const currency =
        body.currency ?? (await resolveDefaultCurrency(client, scope.tenantId));

      // Auto-create wallet for this currency if the user doesn't have one yet,
      // then capture its id for the launch token.
      const wallet = await ensureWalletForUpdate(
        client,
        scope.tenantId,
        scope.userId,
        currency
      );
      if (wallet.status !== 'active') {
        throw new BadRequestError(`Wallet is ${wallet.status}`, {
          wallet_status: wallet.status,
        });
      }

      // Insert the session first with a placeholder token; we then sign the
      // token using the real session id and patch the row.
      // To keep it single-INSERT we generate the session id client-side.
      const sessionRow = await client.query<{ id: string }>(
        `SELECT gen_random_uuid() AS id`
      );
      const sessionId = sessionRow.rows[0].id;

      const token = signLaunchToken({
        sub: scope.userId,
        tid: scope.tenantId,
        role: scope.role as 'user' | 'affiliate',
        sid: sessionId,
        wid: wallet.id,
        gid: game.id,
        cur: wallet.currency,
        typ: 'game_launch',
      });

      // Insert the session pinned to the pre-allocated id.
      const r = await client.query<repo.GameSessionRow>(
        `INSERT INTO game_sessions
           (id, tenant_id, user_id, game_id, token, status, ip, user_agent,
            expires_at, metadata)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9::jsonb)
         RETURNING id, tenant_id, user_id, game_id, token, status, ip,
                   user_agent, started_at, ended_at, expires_at, metadata,
                   created_at`,
        [
          sessionId,
          scope.tenantId,
          scope.userId,
          game.id,
          token.jti,
          req.ip ?? null,
          req.header('user-agent') ?? null,
          token.expiresAt,
          JSON.stringify({
            currency: wallet.currency,
            wallet_id: wallet.id,
            provider: game.provider,
            language: body.language,
            return_url: body.return_url,
            client_metadata: body.metadata ?? null,
          }),
        ]
      );
      const session = r.rows[0];

      const launchUrl = buildLaunchUrl(game.iframe_url, {
        token: token.token,
        tenantSlug: tenant.slug,
        currency: wallet.currency,
        lang: body.language,
        returnUrl: body.return_url,
      });

      return { session, game, tenant, wallet, token, launchUrl };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: 'game.session.create',
    resource: 'game_session',
    resourceId: data.session.id,
    payload: {
      game_id: data.game.id,
      provider: data.game.provider,
      wallet_id: data.wallet.id,
      currency: data.wallet.currency,
      expires_at: data.token.expiresAt,
    },
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    status: 'success',
  });

  return {
    session_id: data.session.id,
    launch_url: data.launchUrl,
    token: data.token.token,
    expires_at: data.token.expiresAt,
    game: {
      id: data.game.id,
      name: data.game.name,
      provider: data.game.provider,
      type: data.game.type,
    },
    tenant: { id: data.tenant.id, slug: data.tenant.slug },
    wallet: {
      id: data.wallet.id,
      currency: data.wallet.currency,
      balance: data.wallet.balance,
      bonus_balance: data.wallet.bonus_balance,
    },
  };
}

/**
 * POST /api/game/session/:id/end
 *
 * Caller (the iframe host page) marks the session ended. Subsequent webhooks
 * for this session will be rejected because the row is no longer 'active'.
 */
export async function endSession(req: Request, sessionId: string) {
  const scope = getPlayerScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const session = await repo.findGameSessionByIdInTenant(
        client,
        scope.tenantId,
        sessionId
      );
      if (!session) throw new NotFoundError('Session not found');
      if (session.user_id !== scope.userId) {
        throw new ForbiddenError('You do not own this session');
      }
      if (session.status !== 'active') {
        return { session, alreadyEnded: true as const };
      }
      const ended = await repo.endGameSession(client, sessionId, 'ended');
      return { session: ended ?? session, alreadyEnded: false as const };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: 'game.session.end',
    resource: 'game_session',
    resourceId: sessionId,
    payload: { already_ended: result.alreadyEnded },
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    status: 'success',
  });

  return { session: result.session, already_ended: result.alreadyEnded };
}
