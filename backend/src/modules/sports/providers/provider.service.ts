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

  // Live pipeline health counts — lets the admin see AT A GLANCE where the
  // provider → events → odds → results → settlement chain is stuck instead
  // of only cumulative sync counters. Cheap indexed aggregates; best-effort
  // (a stats failure never breaks the settings page).
  let stats: Record<string, number | string | null> = {};
  try {
    stats = await withTenantClient({ tenantId, bypassRls: true }, async (c) => {
      const ev = await c.query<{
        total: string;
        leagues: string;
        upcoming: string;
        live: string;
        finished: string;
        awaiting_results: string;
      }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(DISTINCT league)::text AS leagues,
                COUNT(*) FILTER (WHERE status = 'scheduled' AND starts_at > now())::text AS upcoming,
                COUNT(*) FILTER (WHERE status = 'live')::text AS live,
                COUNT(*) FILTER (WHERE status = 'finished')::text AS finished,
                COUNT(*) FILTER (
                  WHERE status IN ('scheduled','live') AND starts_at < now()
                )::text AS awaiting_results
           FROM sports_events
          WHERE tenant_id = $1`,
        [tenantId]
      );
      const withOdds = await c.query<{ n: string }>(
        `SELECT COUNT(DISTINCT event_id)::text AS n
           FROM sports_markets
          WHERE tenant_id = $1 AND status = 'open'`,
        [tenantId]
      );
      const tickets = await c.query<{ unsettled: string; review: string; last_settled: Date | null }>(
        `SELECT COUNT(*) FILTER (WHERE status = 'pending')::text AS unsettled,
                COUNT(*) FILTER (WHERE review_required = true AND status = 'pending')::text AS review,
                MAX(settled_at) AS last_settled
           FROM sportsbook_bets
          WHERE tenant_id = $1`,
        [tenantId]
      );
      const e = ev.rows[0];
      const t = tickets.rows[0];
      return {
        events_total: Number(e?.total ?? 0),
        leagues_total: Number(e?.leagues ?? 0),
        events_upcoming: Number(e?.upcoming ?? 0),
        events_live: Number(e?.live ?? 0),
        events_completed: Number(e?.finished ?? 0),
        events_awaiting_results: Number(e?.awaiting_results ?? 0),
        events_with_odds: Number(withOdds.rows[0]?.n ?? 0),
        unsettled_tickets: Number(t?.unsettled ?? 0),
        tickets_needing_review: Number(t?.review ?? 0),
        last_settlement_at: t?.last_settled
          ? new Date(t.last_settled).toISOString()
          : null,
      };
    });
  } catch {
    stats = {};
  }

  return { ...presentConfig(row), stats };
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
  // Results run FIRST so settling real tickets gets budget priority.
  const results = await runSync(tenantId, { phase: 'results', force: true });
  const prematch = await runSync(tenantId, { phase: 'prematch', force: true });
  const live = await runSync(tenantId, { phase: 'live', force: true });
  const status = await getStatus(req);
  return {
    results,
    prematch,
    live,
    events_upserted: prematch.eventsUpserted + live.eventsUpserted,
    odds_upserted: prematch.oddsUpserted + live.oddsUpserted,
    results_finalized: results.resultsFinalized ?? 0,
    tickets_settled: results.ticketsSettled ?? 0,
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
