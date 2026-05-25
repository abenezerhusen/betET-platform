import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError, ForbiddenError } from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { logger } from '../../infrastructure/logger';
import { Events, emitToUser } from '../../realtime/socket';
import * as repo from './mobile.repository';
import type { SendPushInput } from './mobile.dto';

interface AdminScope {
  tenantId: string;
  actorId: string;
  role: string;
  isSuperadmin: boolean;
}

function getPushScope(req: Request): AdminScope {
  if (!req.user) throw new ForbiddenError('Authentication required');
  if (req.user.role !== 'superadmin' && req.user.role !== 'tenant_admin') {
    throw new ForbiddenError('Admin role required');
  }
  return {
    tenantId: req.user.tenantId,
    actorId: req.user.id,
    role: req.user.role,
    isSuperadmin: req.user.role === 'superadmin',
  };
}

interface ProviderResult {
  sent: number;
  failed: number;
  skipped: number;
  failed_token_ids: string[];
}

/**
 * Stub for FCM/APNs/HMS dispatch. Real integration would batch by
 * platform and call the provider SDKs here. For now we log the intent
 * and return success. Replace this with actual provider calls and feed
 * the failed token ids back into repo.markDeviceFailed().
 */
async function dispatchToProvider(
  tokens: repo.MobileTokenRow[],
  message: { title: string; body: string; data?: Record<string, string>; image_url?: string; deeplink?: string }
): Promise<ProviderResult> {
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, skipped: 0, failed_token_ids: [] };
  }
  // Group by platform purely for logging; actual provider client would
  // use these groups for batch APIs (FCM multicast, APNs, etc.).
  const byPlatform = new Map<string, number>();
  for (const t of tokens) {
    byPlatform.set(t.platform, (byPlatform.get(t.platform) ?? 0) + 1);
  }
  logger.info(
    { count: tokens.length, byPlatform: Object.fromEntries(byPlatform), title: message.title },
    'mobile push dispatch (stub) — wire FCM/APNs/HMS clients here'
  );
  return { sent: tokens.length, failed: 0, skipped: 0, failed_token_ids: [] };
}

export async function sendPush(req: Request, body: SendPushInput) {
  const scope = getPushScope(req);

  // Resolve target tokens within the admin's tenant. (A separate flow could
  // allow superadmin to target a specific tenant via body.tenant_id.)
  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      let tokens: repo.MobileTokenRow[];
      let userCount: number;

      if (body.user_ids && body.user_ids.length > 0) {
        tokens = await repo.listActiveTokensForUsers(
          client,
          scope.tenantId,
          body.user_ids
        );
        userCount = new Set(tokens.map((t) => t.user_id)).size;
      } else if (body.segment) {
        const seg = await repo.listActiveTokensBySegment(
          client,
          scope.tenantId,
          body.segment
        );
        tokens = seg.tokens;
        userCount = seg.user_count;
      } else {
        throw new BadRequestError('targeting required');
      }
      return { tokens, userCount };
    }
  );

  if (data.tokens.length === 0) {
    await tryAudit({
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      actorType: scope.isSuperadmin ? 'superadmin' : 'admin',
      action: 'mobile.push.send',
      resource: 'mobile_push',
      resourceId: null,
      payload: {
        targets: body.user_ids ? 'user_ids' : `segment:${body.segment ?? 'unknown'}`,
        target_user_count: 0,
        device_count: 0,
        title: body.title,
        dry_run: body.dry_run,
        result: 'no_recipients',
      },
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
      status: 'warning',
    });
    return {
      dry_run: body.dry_run,
      target_user_count: 0,
      device_count: 0,
      sent: 0,
      failed: 0,
      result: 'no_recipients',
    };
  }

  let providerResult: ProviderResult = {
    sent: 0,
    failed: 0,
    skipped: data.tokens.length,
    failed_token_ids: [],
  };

  if (!body.dry_run) {
    providerResult = await dispatchToProvider(data.tokens, {
      title: body.title,
      body: body.body,
      data: body.data,
      image_url: body.image_url,
      deeplink: body.deeplink,
    });

    // Bookkeeping after the provider call.
    await withTenantClient(
      { tenantId: scope.tenantId },
      async (client) => {
        const successIds = data.tokens
          .filter((t) => !providerResult.failed_token_ids.includes(t.id))
          .map((t) => t.id);
        await repo.markDeviceSeen(client, successIds);
        await repo.markDeviceFailed(client, providerResult.failed_token_ids);
      }
    );

    // Mirror as an in-app notification through Socket.io. This way users
    // who happen to be online see the message even if their device push
    // isn't deliverable (silenced, no network, etc.).
    const userIds = new Set(data.tokens.map((t) => t.user_id));
    for (const userId of userIds) {
      emitToUser(scope.tenantId, userId, Events.PUSH_NOTIFICATION, {
        title: body.title,
        body: body.body,
        data: body.data ?? null,
        image_url: body.image_url ?? null,
        deeplink: body.deeplink ?? null,
        sent_at: new Date().toISOString(),
      });
    }
  }

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    actorType: scope.isSuperadmin ? 'superadmin' : 'admin',
    action: 'mobile.push.send',
    resource: 'mobile_push',
    resourceId: null,
    payload: {
      targets: body.user_ids ? 'user_ids' : `segment:${body.segment}`,
      target_user_count: data.userCount,
      device_count: data.tokens.length,
      title: body.title,
      dry_run: body.dry_run,
      sent: providerResult.sent,
      failed: providerResult.failed,
      skipped: providerResult.skipped,
    },
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    status: 'success',
  });

  return {
    dry_run: body.dry_run,
    target_user_count: data.userCount,
    device_count: data.tokens.length,
    sent: providerResult.sent,
    failed: providerResult.failed,
    skipped: providerResult.skipped,
  };
}
