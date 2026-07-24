/**
 * Business logic for the Bulk SMS marketing module.
 *
 * Completely isolated from the OTP SMS/Telegram pipeline: this service only
 * ever talks to `bulk_sms_*` tables and the TextBee phone-gateway client.
 * Gateway credentials are sealed (AES-256-GCM) at rest and never echoed back
 * to the frontend in plaintext.
 */

import type { Request } from 'express';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import {
  sealSecret,
  openSecret,
  maskSecretSummary,
} from '../../../infrastructure/crypto/secret-cipher';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';
import * as repo from './bulk-sms.repository';
import * as textbee from './textbee.service';
import { normalizePhone, normalizePhoneList, renderMessage } from './phone';
import type {
  GatewaySettingsInput,
  TestSmsInput,
  TemplateCreateInput,
  TemplateUpdateInput,
  CampaignCreateInput,
  ListQuery,
} from './bulk-sms.dto';

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */
function scopeOf(req: Request) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return { scope, tenantId };
}

/** Shape returned to the UI — never includes the sealed key. */
function presentSettings(row: repo.GatewaySettingsRow | null) {
  if (!row) {
    return {
      configured: false,
      enabled: false,
      gateway_name: 'TextBee',
      api_url: 'https://api.textbee.dev/api/v1',
      api_key_masked: null as string | null,
      has_api_key: false,
      device_id: '',
      sender_number: '',
      default_country_code: '+251',
      max_sms_per_day: 1000,
      delay_ms: 1000,
      updated_at: null as string | null,
    };
  }
  return {
    configured: true,
    enabled: row.enabled,
    gateway_name: row.gateway_name,
    api_url: row.api_url,
    api_key_masked: maskSecretSummary(row.api_key_sealed),
    has_api_key: Boolean(row.api_key_sealed),
    device_id: row.device_id ?? '',
    sender_number: row.sender_number ?? '',
    default_country_code: row.default_country_code,
    max_sms_per_day: row.max_sms_per_day,
    delay_ms: row.delay_ms,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/** Resolve a ready-to-use TextBee config from stored settings. */
function resolveTextBeeConfig(
  row: repo.GatewaySettingsRow | null
): textbee.TextBeeConfig {
  return {
    apiUrl: row?.api_url ?? '',
    apiKey: row?.api_key_sealed ? openSecret(row.api_key_sealed) : '',
    deviceId: row?.device_id ?? '',
  };
}

/* -------------------------------------------------------------------------- */
/*  Gateway settings                                                          */
/* -------------------------------------------------------------------------- */
export async function getGatewaySettings(req: Request) {
  const { scope, tenantId } = scopeOf(req);
  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) => repo.getGatewaySettings(client, tenantId)
  );
  return presentSettings(row);
}

export async function saveGatewaySettings(
  req: Request,
  input: GatewaySettingsInput
) {
  const { scope, tenantId } = scopeOf(req);

  const saved = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await repo.getGatewaySettings(client, tenantId);

      // Seal a freshly provided key; otherwise keep the stored one (repo
      // COALESCEs a null through to the existing sealed value).
      const apiKeySealed =
        input.api_key && input.api_key.length > 0
          ? sealSecret(input.api_key)
          : null;

      return repo.upsertGatewaySettings(client, {
        tenantId,
        enabled: input.enabled ?? existing?.enabled ?? false,
        gatewayName: input.gateway_name ?? existing?.gateway_name ?? 'TextBee',
        apiUrl:
          input.api_url ??
          existing?.api_url ??
          'https://api.textbee.dev/api/v1',
        apiKeySealed,
        deviceId: input.device_id ?? existing?.device_id ?? null,
        senderNumber: input.sender_number ?? existing?.sender_number ?? null,
        defaultCountryCode:
          input.default_country_code ??
          existing?.default_country_code ??
          '+251',
        maxSmsPerDay: input.max_sms_per_day ?? existing?.max_sms_per_day ?? 1000,
        delayMs: input.delay_ms ?? existing?.delay_ms ?? 1000,
        updatedBy: scope.actorId,
      });
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bulk_sms.gateway.update',
      resource: 'bulk_sms_gateway',
      resourceId: saved.id,
      payload: {
        enabled: saved.enabled,
        gateway_name: saved.gateway_name,
        api_url: saved.api_url,
        device_id: saved.device_id,
        sender_number: saved.sender_number,
        default_country_code: saved.default_country_code,
        max_sms_per_day: saved.max_sms_per_day,
        delay_ms: saved.delay_ms,
        api_key_rotated: Boolean(input.api_key && input.api_key.length > 0),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return presentSettings(saved);
}

export async function testConnection(req: Request) {
  const { scope, tenantId } = scopeOf(req);
  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) => repo.getGatewaySettings(client, tenantId)
  );
  const config = resolveTextBeeConfig(row);
  if (!config.apiKey || !config.deviceId) {
    throw new BadRequestError(
      'Set the API key and Device ID before testing the connection',
      { reason: 'gateway_not_configured' }
    );
  }
  const result = await textbee.testConnection(config);
  return {
    ok: result.ok,
    status: result.status,
    response: result.response,
    error: result.error ?? null,
  };
}

export async function sendTestSms(req: Request, input: TestSmsInput) {
  const { scope, tenantId } = scopeOf(req);
  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) => repo.getGatewaySettings(client, tenantId)
  );
  const config = resolveTextBeeConfig(row);
  if (!config.apiKey || !config.deviceId) {
    throw new BadRequestError(
      'Set the API key and Device ID before sending a test SMS',
      { reason: 'gateway_not_configured' }
    );
  }

  const phone = normalizePhone(
    input.phone,
    row?.default_country_code ?? '+251'
  );
  if (!phone) {
    throw new BadRequestError('Invalid phone number', {
      reason: 'invalid_phone',
    });
  }
  const message =
    input.message?.trim() ||
    'Test message from your Bulk SMS gateway. Delivery is working.';

  const result = await textbee.sendSms(config, phone, message);

  // Test sends are recorded in the delivery log (no campaign) for the audit
  // trail — but they do NOT count against the daily campaign limit query,
  // which only counts rows with a campaign_id via the worker path... actually
  // countSentToday counts all sent rows, so keep test sends out of the log to
  // avoid skewing the daily limit; we log to audit instead.
  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bulk_sms.test_sms',
      resource: 'bulk_sms_gateway',
      resourceId: row?.id ?? null,
      payload: { phone, ok: result.ok, status: result.status },
      ip: getIp(req),
      userAgent: getUa(req),
      status: result.ok ? 'success' : 'failure',
    },
    { bypassRls: true }
  );

  return {
    ok: result.ok,
    status: result.status,
    response: result.response,
    error: result.error ?? null,
    phone,
  };
}

/* -------------------------------------------------------------------------- */
/*  Templates                                                                 */
/* -------------------------------------------------------------------------- */
function paging(query: ListQuery) {
  return { limit: query.limit, offset: (query.page - 1) * query.limit };
}

export async function listTemplates(req: Request, query: ListQuery) {
  const { scope, tenantId } = scopeOf(req);
  const { limit, offset } = paging(query);
  const res = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) =>
      repo.listTemplates(client, tenantId, {
        limit,
        offset,
        search: query.search ?? null,
      })
  );
  return { items: res.items, total: res.total, page: query.page, limit };
}

export async function createTemplate(req: Request, input: TemplateCreateInput) {
  const { scope, tenantId } = scopeOf(req);
  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) =>
      repo.createTemplate(client, {
        tenantId,
        name: input.name,
        body: input.body,
        createdBy: scope.actorId,
      })
  );
  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bulk_sms.template.create',
      resource: 'bulk_sms_template',
      resourceId: row.id,
      payload: { name: row.name },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );
  return row;
}

export async function updateTemplate(
  req: Request,
  id: string,
  input: TemplateUpdateInput
) {
  const { scope, tenantId } = scopeOf(req);
  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) =>
      repo.updateTemplate(client, {
        tenantId,
        id,
        name: input.name,
        body: input.body,
      })
  );
  if (!row) throw new NotFoundError('Template not found');
  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bulk_sms.template.update',
      resource: 'bulk_sms_template',
      resourceId: row.id,
      payload: { name: row.name },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );
  return row;
}

export async function deleteTemplate(req: Request, id: string) {
  const { scope, tenantId } = scopeOf(req);
  const ok = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) => repo.deleteTemplate(client, tenantId, id)
  );
  if (!ok) throw new NotFoundError('Template not found');
  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bulk_sms.template.delete',
      resource: 'bulk_sms_template',
      resourceId: id,
      payload: {},
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );
  return { success: true, id };
}

/* -------------------------------------------------------------------------- */
/*  Campaigns                                                                 */
/* -------------------------------------------------------------------------- */
export async function createCampaign(req: Request, input: CampaignCreateInput) {
  const { scope, tenantId } = scopeOf(req);

  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const settings = await repo.getGatewaySettings(client, tenantId);
      if (!settings || !settings.enabled) {
        throw new BadRequestError(
          'The bulk SMS gateway is disabled. Enable it in Gateway Settings first.',
          { reason: 'gateway_disabled' }
        );
      }
      if (!settings.api_key_sealed || !settings.device_id) {
        throw new BadRequestError(
          'The bulk SMS gateway is not fully configured (API key / Device ID).',
          { reason: 'gateway_not_configured' }
        );
      }

      const cc = settings.default_country_code || '+251';
      // Normalize + de-duplicate recipients server-side (source of truth).
      const seen = new Set<string>();
      const queueItems: Array<{ phone: string; message: string }> = [];
      let invalid = 0;
      let duplicates = 0;
      for (const r of input.recipients) {
        const phone = normalizePhone(r.phone, cc);
        if (!phone) {
          invalid += 1;
          continue;
        }
        if (seen.has(phone)) {
          duplicates += 1;
          continue;
        }
        seen.add(phone);
        queueItems.push({
          phone,
          message: renderMessage(input.message, r.vars),
        });
      }

      if (queueItems.length === 0) {
        throw new BadRequestError(
          'No valid, unique recipients after validation',
          { reason: 'no_valid_recipients', invalid, duplicates }
        );
      }

      // Enforce the configured daily limit.
      const sentToday = await repo.countSentToday(client, tenantId);
      const remaining = Math.max(0, settings.max_sms_per_day - sentToday);
      if (input.start && remaining <= 0) {
        throw new BadRequestError(
          `Daily SMS limit reached (${settings.max_sms_per_day}/day). Try again tomorrow or raise the limit.`,
          { reason: 'daily_limit_reached', remaining: 0 }
        );
      }

      const status = input.start ? 'queued' : 'draft';
      const campaign = await repo.createCampaign(client, {
        tenantId,
        name: input.name,
        templateId: input.template_id ?? null,
        message: input.message,
        status,
        totalRecipients: queueItems.length,
        createdBy: scope.actorId,
      });

      // Only materialize the queue when the campaign is actually starting.
      if (input.start) {
        await repo.insertQueueBatch(client, tenantId, campaign.id, queueItems);
      }

      // Best-effort audit inside the same connection is fine; use tryAudit
      // after commit for consistency with the rest of the module.
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.bulk_sms.campaign.create',
          resource: 'bulk_sms_campaign',
          resourceId: campaign.id,
          payload: {
            name: campaign.name,
            total_recipients: queueItems.length,
            invalid,
            duplicates,
            status,
          },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );

      return {
        ...campaign,
        import: {
          total: input.recipients.length,
          valid: queueItems.length,
          invalid,
          duplicates,
        },
        remaining_daily: Math.max(0, remaining - queueItems.length),
      };
    }
  );
}

export async function listCampaigns(req: Request, query: ListQuery) {
  const { scope, tenantId } = scopeOf(req);
  const { limit, offset } = paging(query);
  const res = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) =>
      repo.listCampaigns(client, tenantId, {
        limit,
        offset,
        status: query.status ?? null,
        search: query.search ?? null,
      })
  );
  return { items: res.items, total: res.total, page: query.page, limit };
}

export async function getCampaign(req: Request, id: string) {
  const { scope, tenantId } = scopeOf(req);
  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) => repo.getCampaign(client, tenantId, id)
  );
  if (!row) throw new NotFoundError('Campaign not found');
  return row;
}

export async function cancelCampaign(req: Request, id: string) {
  const { scope, tenantId } = scopeOf(req);
  const ok = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) => repo.cancelCampaign(client, tenantId, id)
  );
  if (!ok) throw new BadRequestError('Campaign not found or not cancellable');
  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.bulk_sms.campaign.cancel',
      resource: 'bulk_sms_campaign',
      resourceId: id,
      payload: {},
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );
  return { id, status: 'cancelled' };
}

/* -------------------------------------------------------------------------- */
/*  Queue / logs / reports                                                    */
/* -------------------------------------------------------------------------- */
export async function listQueue(req: Request, query: ListQuery) {
  const { scope, tenantId } = scopeOf(req);
  const { limit, offset } = paging(query);
  const res = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) =>
      repo.listQueue(client, tenantId, {
        limit,
        offset,
        status: query.status ?? null,
        campaignId: query.campaign_id ?? null,
      })
  );
  return { items: res.items, total: res.total, page: query.page, limit };
}

export async function listLogs(req: Request, query: ListQuery) {
  const { scope, tenantId } = scopeOf(req);
  const { limit, offset } = paging(query);
  const res = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    (client) =>
      repo.listLogs(client, tenantId, {
        limit,
        offset,
        status: query.status ?? null,
        campaignId: query.campaign_id ?? null,
        search: query.search ?? null,
      })
  );
  return { items: res.items, total: res.total, page: query.page, limit };
}

export async function reports(req: Request) {
  const { scope, tenantId } = scopeOf(req);
  const [summary, settings] = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const s = await repo.reportSummary(client, tenantId);
      const gw = await repo.getGatewaySettings(client, tenantId);
      return [s, gw] as const;
    }
  );
  const maxPerDay = settings?.max_sms_per_day ?? 0;
  return {
    ...summary,
    daily_limit: maxPerDay,
    remaining_today: Math.max(0, maxPerDay - summary.totals.today),
    gateway_enabled: settings?.enabled ?? false,
  };
}
