/**
 * Section 19 — public read-only endpoints for the General Config block.
 *
 *   GET /api/public/general          → user-safe subset of general.config
 *                                       (platform name, currency, country,
 *                                        social links, contact info,
 *                                        disclaimers, about, language
 *                                        toggle).
 *   GET /api/public/top-bets         → flat array (general.top_bets).
 *   GET /api/public/top-matches      → flat array (general.top_matches).
 *   GET /api/public/promotions       → flat array (general.promotions).
 *   GET /api/public/operation-hours  → operation hours window so the
 *                                       user-panel can disable the
 *                                       "Place Bet" button outside hours.
 *
 * These endpoints DO NOT require an authenticated session — only the
 * tenant header (which the user panel attaches on every request). They
 * never expose admin-only fields (cashier_*, sms_max_win_limit, etc.).
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError } from '../../http/errors/http-error';
import {
  isWithinOperationHours,
  loadGeneralConfig,
} from '../admin/settings/general-config';
import * as swagger from '../../swagger/registry';

const router = Router();

function requireTenantId(req: Request): string {
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
  if (!tenantId) throw new BadRequestError('Tenant context required');
  return tenantId;
}

swagger.registerPath({
  method: 'get',
  path: '/api/public/general',
  summary: 'Public-safe general configuration (Section 19)',
  tags: ['Public'],
  responses: { '200': { description: 'Public general config' } },
});

router.get('/general', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const tenantId = requireTenantId(req);
    const cfg = await withTenantClient({ tenantId }, async (client) =>
      loadGeneralConfig(client, tenantId)
    );
    res.json({
      platform_name: cfg.platform_name,
      logo_url: cfg.logo_url,
      currency: cfg.currency,
      country: cfg.country,
      country_code: cfg.country_code,
      timezone: cfg.timezone,
      website_url: cfg.website_url,
      offline_bet_support: cfg.offline_bet_support,
      offline_payout: cfg.offline_payout,
      enable_language_selection: cfg.enable_language_selection,
      social: {
        facebook: cfg.social_facebook,
        telegram: cfg.social_telegram,
        tiktok: cfg.social_tiktok,
        instagram: cfg.social_instagram,
        twitter: cfg.social_twitter,
      },
      contact: {
        email: cfg.contact_email,
        phone: cfg.contact_phone,
      },
      support: {
        phone: cfg.support_phone,
        email: cfg.support_email,
      },
      underage_disclaimer: cfg.underage_disclaimer,
      about_us: cfg.about_us,
      terms_and_conditions: cfg.terms_and_conditions,
      footer_text: cfg.footer_text,
    });
  } catch (err) {
    next(err);
  }
});

async function readListSetting(
  tenantId: string,
  key: string
): Promise<unknown[]> {
  return withTenantClient({ tenantId }, async (client) => {
    const r = await client.query<{ value: unknown }>(
      `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
      [tenantId, key]
    );
    const v = r.rows[0]?.value;
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray((v as { items?: unknown[] }).items)) {
      return (v as { items: unknown[] }).items;
    }
    return [];
  });
}

swagger.registerPath({
  method: 'get',
  path: '/api/public/top-bets',
  summary: 'Public top-bets list (leagues featured on the lobby)',
  tags: ['Public'],
  responses: { '200': { description: 'Top bets list' } },
});

router.get('/top-bets', async (req, res, next) => {
  try {
    const tenantId = requireTenantId(req);
    const items = await readListSetting(tenantId, 'general.top_bets');
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

swagger.registerPath({
  method: 'get',
  path: '/api/public/top-matches',
  summary: 'Public top-matches list (featured matches on the home page)',
  tags: ['Public'],
  responses: { '200': { description: 'Top matches list' } },
});

router.get('/top-matches', async (req, res, next) => {
  try {
    const tenantId = requireTenantId(req);
    const items = await readListSetting(tenantId, 'general.top_matches');
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

swagger.registerPath({
  method: 'get',
  path: '/api/public/promotions',
  summary: 'Public promotions banners (hero carousel)',
  tags: ['Public'],
  responses: { '200': { description: 'Promotion banners' } },
});

router.get('/promotions', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const tenantId = requireTenantId(req);
    const items = await readListSetting(tenantId, 'general.promotions');
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

swagger.registerPath({
  method: 'get',
  path: '/api/public/operation-hours',
  summary: 'Current open/closed status + configured window per day',
  tags: ['Public'],
  responses: { '200': { description: 'Operation hours' } },
});

router.get('/operation-hours', async (req, res, next) => {
  try {
    const tenantId = requireTenantId(req);
    const cfg = await withTenantClient({ tenantId }, async (client) =>
      loadGeneralConfig(client, tenantId)
    );
    res.json({
      open_now: isWithinOperationHours(cfg),
      enforce_bets: cfg.operation_hours_enforce_bets,
      timezone: cfg.timezone,
      hours: cfg.operation_hours,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/footer-links
 * Returns the admin-managed footer link groups (company, legal, sports) plus
 * copyright text and company description. Defaults to an empty object so the
 * user panel falls back to its built-in static lists gracefully.
 */
router.get('/footer-links', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const tenantId = requireTenantId(req);
    const result = await withTenantClient({ tenantId }, async (client) => {
      const r = await client.query<{ value: unknown }>(
        `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
        [tenantId, 'general.footer_links']
      );
      return r.rows[0]?.value ?? {};
    });
    res.json(result && typeof result === 'object' ? result : {});
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/game-thumbnails
 * Returns the admin-managed game thumbnail overrides so the user panel can
 * replace default engine thumbnails without a code deploy.
 */
router.get('/game-thumbnails', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const tenantId = requireTenantId(req);
    const items = await readListSetting(tenantId, 'general.game_thumbnails');
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

export default router;
