import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError } from '../../http/errors/http-error';
import { Keys, withCache } from '../../infrastructure/cache';
import type { MobileConfigQuery } from './mobile.dto';

interface MobileAppSettings {
  app_name?: string;
  primary_color?: string;
  accent_color?: string;
  background_color?: string;
  text_color?: string;
  logo_url?: string;
  splash_url?: string;
  icon_url?: string;
  features?: Record<string, boolean>;
  support_email?: string;
  support_phone?: string;
  privacy_url?: string;
  terms_url?: string;
  store_links?: { ios?: string; android?: string; huawei?: string };
  min_app_version?: string;
  force_update_below?: string;
}

interface GeneralSettings {
  currency?: string;
  language?: string;
  timezone?: string;
  country?: string;
}

interface BrandingSettings {
  display_name?: string;
  logo_url?: string;
  favicon_url?: string;
  primary_color?: string;
  accent_color?: string;
}

interface MobileConfigResponse {
  tenant: { id: string; slug: string; name: string };
  app: {
    name: string;
    colors: {
      primary: string;
      accent: string;
      background: string;
      text: string;
    };
    logo_url: string | null;
    splash_url: string | null;
    icon_url: string | null;
    min_app_version: string | null;
    force_update_below: string | null;
  };
  features: Record<string, boolean>;
  general: {
    currency: string;
    language: string;
    timezone: string | null;
    country: string | null;
  };
  support: {
    email: string | null;
    phone: string | null;
    privacy_url: string | null;
    terms_url: string | null;
  };
  store_links: { ios: string | null; android: string | null; huawei: string | null };
  generated_at: string;
}

async function loadConfig(
  client: PoolClient,
  tenantId: string
): Promise<MobileConfigResponse> {
  const tenantRow = await client.query<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId]
  );
  if (tenantRow.rowCount === 0) {
    throw new BadRequestError('Tenant not found');
  }
  const tenant = tenantRow.rows[0];

  // Pull a small set of keys in one round-trip.
  const settings = await client.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM settings
      WHERE tenant_id = $1 AND key IN ('mobile_app','general','branding','features')`,
    [tenantId]
  );
  const map = new Map<string, unknown>(settings.rows.map((r) => [r.key, r.value]));

  const mobileApp = (map.get('mobile_app') as MobileAppSettings | undefined) ?? {};
  const general = (map.get('general') as GeneralSettings | undefined) ?? {};
  const branding = (map.get('branding') as BrandingSettings | undefined) ?? {};
  const featuresSetting = (map.get('features') as Record<string, boolean> | undefined) ?? {};

  // Branding wins over per-app overrides for things like logo/colors so a
  // tenant can keep one source of truth across web + mobile.
  return {
    tenant,
    app: {
      name: mobileApp.app_name ?? branding.display_name ?? tenant.name,
      colors: {
        primary:
          mobileApp.primary_color ?? branding.primary_color ?? '#1a73e8',
        accent: mobileApp.accent_color ?? branding.accent_color ?? '#ff9800',
        background: mobileApp.background_color ?? '#ffffff',
        text: mobileApp.text_color ?? '#0f172a',
      },
      logo_url: mobileApp.logo_url ?? branding.logo_url ?? null,
      splash_url: mobileApp.splash_url ?? null,
      icon_url: mobileApp.icon_url ?? branding.favicon_url ?? null,
      min_app_version: mobileApp.min_app_version ?? null,
      force_update_below: mobileApp.force_update_below ?? null,
    },
    features: { ...featuresSetting, ...(mobileApp.features ?? {}) },
    general: {
      currency: general.currency ?? 'ETB',
      language: general.language ?? 'en',
      timezone: general.timezone ?? null,
      country: general.country ?? null,
    },
    support: {
      email: mobileApp.support_email ?? null,
      phone: mobileApp.support_phone ?? null,
      privacy_url: mobileApp.privacy_url ?? null,
      terms_url: mobileApp.terms_url ?? null,
    },
    store_links: {
      ios: mobileApp.store_links?.ios ?? null,
      android: mobileApp.store_links?.android ?? null,
      huawei: mobileApp.store_links?.huawei ?? null,
    },
    generated_at: new Date().toISOString(),
  };
}

/**
 * GET /api/mobile/config
 *
 * Public for an authenticated user (any role) — the mobile app fetches this
 * before login as well, so we also accept the `x-tenant-id` header (or
 * subdomain) for unauthenticated requests. The config is cached per tenant
 * for 60s; cache is busted by admin settings updates.
 */
export async function getMobileConfig(
  req: Request,
  res: Response,
  query: MobileConfigQuery
): Promise<MobileConfigResponse> {
  const tenantId = req.user?.tenantId ?? req.tenant?.id;
  if (!tenantId) {
    throw new BadRequestError(
      'tenant context required (Authorization or x-tenant-id header)'
    );
  }

  const config = await withCache(
    Keys.tenantSettingsMap(tenantId) + ':mobile_config',
    () =>
      withTenantClient({ tenantId }, async (client) => loadConfig(client, tenantId)),
    { ttl: 60, scope: `tenant_settings:${tenantId}` }
  );

  // Surface a hint when the requesting app version is below min_app_version.
  if (
    query.app_version &&
    config.app.min_app_version &&
    query.app_version < config.app.min_app_version
  ) {
    res.setHeader('x-update-required', 'true');
  }

  return config;
}
