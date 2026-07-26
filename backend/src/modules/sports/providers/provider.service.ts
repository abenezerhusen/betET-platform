/**
 * Admin-facing service for the sports data provider (Odds-API.io) integration.
 *
 * Powers the admin control surface required by the spec: view status, enter /
 * rotate the API key (sealed at rest, never echoed), enable/disable, tune the
 * bookmaker + sports + sync intervals + request budget, run a manual sync, and
 * see the last sync time / errors. Mirrors the Bulk SMS service conventions
 * (scopeOf + withTenantClient + tryAudit + secret sealing).
 */

import type { Request } from 'express';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { tryAudit } from '../../audit/audit.service';
import {
  sealSecret,
  openSecret,
} from '../../../infrastructure/crypto/secret-cipher';
import { env } from '../../../config/env';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../../admin/admin-shared';
import * as repo from './provider.repository';
import { presentConfig } from './provider.config';
import { runSync, testConnection as probe } from './sync.service';
import type { ProviderConfigInput } from './provider.dto';

function scopeOf(req: Request) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return { scope, tenantId };
}

export async function getStatus(req: Request) {
  const { scope, tenantId } = scopeOf(req);
  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) => repo.getConfig(client, tenantId)
  );
  return presentConfig(row);
}

export async function saveConfig(req: Request, input: ProviderConfigInput) {
  const { scope, tenantId } = scopeOf(req);

  const saved = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await repo.getConfig(client, tenantId);
      // Seal a freshly provided key; null keeps the stored one (repo COALESCEs).
      const apiKeySealed =
        input.api_key && input.api_key.length > 0
          ? sealSecret(input.api_key)
          : null;

      return repo.upsertConfig(client, {
        tenantId,
        enabled: input.enabled ?? existing?.enabled ?? false,
        apiUrl: input.api_url ?? existing?.api_url ?? env.ODDS_API_URL,
        apiKeySealed,
        bookmaker: input.bookmaker ?? existing?.bookmaker ?? 'Bet365',
        sports: input.sports ?? existing?.sports ?? ['football', 'basketball'],
        leagues: input.leagues ?? existing?.leagues ?? null,
        prematchIntervalSeconds:
          input.prematch_interval_seconds ??
          existing?.prematch_interval_seconds ??
          900,
        liveIntervalSeconds:
          input.live_interval_seconds ?? existing?.live_interval_seconds ?? 120,
        maxRequestsPerHour:
          input.max_requests_per_hour ?? existing?.max_requests_per_hour ?? 100,
        syncWindowHours:
          input.sync_window_hours ?? existing?.sync_window_hours ?? 72,
        updatedBy: scope.actorId,
      });
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.sports_provider.update',
      resource: 'sports_data_provider',
      resourceId: saved.id,
      payload: {
        enabled: saved.enabled,
        api_url: saved.api_url,
        bookmaker: saved.bookmaker,
        sports: saved.sports,
        leagues: saved.leagues,
        max_requests_per_hour: saved.max_requests_per_hour,
        api_key_rotated: Boolean(input.api_key && input.api_key.length > 0),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return presentConfig(saved);
}

export async function testConnection(req: Request) {
  const { scope, tenantId } = scopeOf(req);
  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) => repo.getConfig(client, tenantId)
  );
  const apiUrl = row?.api_url || env.ODDS_API_URL;
  const apiKey =
    (row?.api_key_sealed ? safeOpen(row.api_key_sealed) : '') ||
    (env.ODDS_API_KEY ?? '');
  const result = await probe(apiUrl, apiKey);
  return result;
}

export async function syncNow(req: Request) {
  const { tenantId } = scopeOf(req);
  // `force` lets the admin pull data on demand even while the env master
  // switch is still `mock`, provided the row is enabled and a key exists.
  const prematch = await runSync(tenantId, { phase: 'prematch', force: true });
  const live = await runSync(tenantId, { phase: 'live', force: true });
  const status = await getStatus(req);
  return {
    prematch,
    live,
    events_upserted: prematch.eventsUpserted + live.eventsUpserted,
    odds_upserted: prematch.oddsUpserted + live.oddsUpserted,
    status,
  };
}

function safeOpen(sealed: string): string {
  try {
    return openSecret(sealed);
  } catch {
    return '';
  }
}
