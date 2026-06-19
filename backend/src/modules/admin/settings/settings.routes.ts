import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import * as service from './settings.service';
import * as swagger from '../../../swagger/registry';
import {
  bulkUpdateSettingsSchema,
  listSettingsSchema,
  upsertSettingSchema,
} from './settings.dto';
import * as paymentMethodsService from '../payment-methods/payment-methods.service';
import {
  createPaymentMethodSchema,
  idParamSchema,
  listPaymentMethodsQuerySchema,
  testPaymentMethodSchema,
  updatePaymentMethodSchema,
} from '../payment-methods/payment-methods.dto';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/settings',
  summary: 'List admin settings',
  tags: ['Admin Settings'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Settings list' } },
});

swagger.registerPath({
  method: 'put',
  path: '/api/admin/settings',
  summary: 'Bulk update settings',
  tags: ['Admin Settings'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Settings updated' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/settings/security',
  summary: 'Get security settings',
  tags: ['Admin Settings'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Security settings' } },
});

swagger.registerPath({
  method: 'put',
  path: '/api/admin/settings/security',
  summary: 'Update security settings',
  tags: ['Admin Settings'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Security settings updated' } },
});

const securityConfigSchema = z.object({
  password_min_length: z.number().int().min(6).max(128).optional(),
  password_require_uppercase: z.boolean().optional(),
  password_require_number: z.boolean().optional(),
  password_require_symbol: z.boolean().optional(),
  password_expiry_days: z.number().int().nonnegative().optional(),
  session_timeout_minutes: z.number().int().positive().optional(),
  session_duration_hours: z.number().int().positive().optional(),
  mfa_required_for_admins: z.boolean().optional(),
  require_2fa_admin: z.boolean().optional(),
  require_2fa_cashier: z.boolean().optional(),
  require_2fa_users: z.boolean().optional(),
  ip_allowlist: z.array(z.string().min(2).max(64)).optional(),
  ip_blocklist: z.array(z.string().min(2).max(64)).optional(),
  ip_whitelist_enabled: z.boolean().optional(),
  max_failed_logins: z.number().int().positive().optional(),
  max_login_attempts: z.number().int().positive().optional(),
  lockout_minutes: z.number().int().positive().optional(),
  lockout_duration_minutes: z.number().int().positive().optional(),
});

/* -------------------------------------------------------------------------- */
/* Section 14 — typed wrappers for /general /main /payment /sms.              */
/*                                                                            */
/* These each persist a single JSONB row under settings(key=<section>.config) */
/* so the admin panel can fetch/update the whole block in one shot, without   */
/* losing backwards-compat with the existing fine-grained settings keys.      */
/* -------------------------------------------------------------------------- */

/* Section 19 — General Config (Company Info, SMS, Cashier, Operation Hours).
 * Every field is optional so the admin can save individual tabs without
 * resending the whole block. `passthrough` preserves forward-compat for
 * any spec keys we haven't typed here yet. */
const dayHoursSchema = z.object({
  open: z.string().trim().regex(/^\d{2}:\d{2}$/),
  close: z.string().trim().regex(/^\d{2}:\d{2}$/),
  closed: z.boolean().optional(),
});

const generalConfigSchema = z
  .object({
    // Company Info
    platform_name: z.string().trim().max(160).optional(),
    logo_url: z.string().trim().optional(),   // may be a base64 data URL
    currency: z.string().trim().max(8).optional(),
    country: z.string().trim().max(80).optional(),
    country_code: z.string().trim().max(8).optional(),
    timezone: z.string().trim().max(64).optional(),
    website_url: z.string().trim().max(2048).optional(),
    offline_bet_support: z.boolean().optional(),
    offline_payout: z.boolean().optional(),
    enable_language_selection: z.boolean().optional(),
    /* Social links */
    social_facebook: z.string().trim().max(2048).optional(),
    social_telegram: z.string().trim().max(2048).optional(),
    social_tiktok: z.string().trim().max(2048).optional(),
    social_instagram: z.string().trim().max(2048).optional(),
    social_twitter: z.string().trim().max(2048).optional(),
    /* Contacts */
    contact_email: z.string().trim().max(160).optional(),
    contact_phone: z.string().trim().max(40).optional(),
    support_phone: z.string().trim().max(40).optional(),
    support_email: z.string().trim().max(160).optional(),
    /* Copy */
    underage_disclaimer: z.string().trim().max(2000).optional(),
    about_us: z.string().trim().max(10_000).optional(),
    terms_and_conditions: z.string().trim().max(50_000).optional(),
    footer_text: z.string().trim().max(5000).optional(),
    /* Legacy fields the user panel/cashier still consume */
    vip_threshold: z.number().nonnegative().optional(),
    min_withdrawal: z.number().nonnegative().optional(),
    max_withdrawal: z.number().nonnegative().optional(),
    /* SMS — per-event toggles (Section 19) */
    sms_events: z.array(z.string().min(1).max(80)).optional(),
    sms_max_win_limit: z.number().nonnegative().optional(),
    /* Cashier Config (Section 19) */
    cashier_max_daily_cancel_volume: z.number().nonnegative().optional(),
    cashier_max_stake_cancel: z.number().nonnegative().optional(),
    cashier_cancel_window_minutes: z.number().int().nonnegative().optional(),
    cashier_enable_withdraw_request: z.boolean().optional(),
    cashier_enable_duplicate_slip: z.boolean().optional(),
    cashier_max_daily_cancel_count: z.number().int().nonnegative().optional(),
    /* Operation Hours — per day-of-week (mon..sun) */
    operation_hours: z
      .object({
        mon: dayHoursSchema.optional(),
        tue: dayHoursSchema.optional(),
        wed: dayHoursSchema.optional(),
        thu: dayHoursSchema.optional(),
        fri: dayHoursSchema.optional(),
        sat: dayHoursSchema.optional(),
        sun: dayHoursSchema.optional(),
      })
      .partial()
      .optional(),
    operation_hours_enforce_bets: z.boolean().optional(),
  })
  .passthrough();

/* Section 20 — Main Configuration (Transaction, Mobile App, Referral,
 * Bonus, Slip, Virtual Casino, Loyalty, Streak). Many sub-blocks are
 * still saved separately under main.<tab>.* keys (e.g. main.referral,
 * main.bonus, main.slip), but the top-level main.config row carries the
 * unified spec-aligned values that bet placement, settlement, and
 * cashout read directly. */
const mainConfigSchema = z
  .object({
    // Stake limits
    min_bet_stake: z.number().nonnegative().optional(),
    max_bet_stake: z.number().nonnegative().optional(),
    max_accumulator_legs: z.number().int().nonnegative().optional(),
    max_total_odds: z.number().nonnegative().optional(),
    /* Taxation */
    tax_on_winnings_pct: z.number().min(0).max(100).optional(),
    winning_tax_rate: z.number().min(0).max(100).optional(),
    winning_tax_threshold: z.number().nonnegative().optional(),
    /* Feature toggles */
    cashout_enabled: z.boolean().optional(),
    live_betting_enabled: z.boolean().optional(),
    /* Caps */
    max_payout_per_slip: z.number().nonnegative().optional(),
    /* Deposits (Transaction tab) */
    min_deposit_amount: z.number().nonnegative().optional(),
    max_deposit_amount: z.number().nonnegative().optional(),
    branch_max_single_deposit: z.number().nonnegative().optional(),
    enable_online_deposit: z.boolean().optional(),
    enable_user_identifier: z.boolean().optional(),
    /* Transfers (Transaction tab) */
    min_transfer_amount: z.number().nonnegative().optional(),
    max_transfer_amount: z.number().nonnegative().optional(),
    max_daily_transfer_amount: z.number().nonnegative().optional(),
    enable_transfer: z.boolean().optional(),
    transfer_contact_confirmation: z.boolean().optional(),
    /* Withdrawals (Transaction tab) */
    min_withdrawal_amount: z.number().nonnegative().optional(),
    max_daily_withdrawal_amount: z.number().nonnegative().optional(),
    branch_max_daily_withdrawal: z.number().nonnegative().optional(),
    online_max_single_withdrawal: z.number().nonnegative().optional(),
    branch_max_single_withdrawal: z.number().nonnegative().optional(),
    branch_withdrawal_rule: z.string().trim().max(80).optional(),
    enable_branch_withdrawal: z.boolean().optional(),
    enable_online_withdrawal: z.boolean().optional(),
    withdrawal_contact_confirmation: z.boolean().optional(),
    allow_full_balance_withdrawal: z.boolean().optional(),
    /* Wallet */
    deposit_limit: z.number().nonnegative().optional(),
    /* Mobile App */
    android_app_store_url: z.string().trim().max(2048).optional(),
    ios_app_store_url: z.string().trim().max(2048).optional(),
  })
  .passthrough();


const paymentConfigSchema = z
  .object({
    min_deposit_amount: z.number().nonnegative().optional(),
    max_deposit_amount: z.number().nonnegative().optional(),
    min_withdrawal_amount: z.number().nonnegative().optional(),
    max_withdrawal_amount: z.number().nonnegative().optional(),
    withdrawal_processing_hours: z.number().nonnegative().optional(),
    require_id_verification_above: z.number().nonnegative().optional(),
  })
  .passthrough();

const smsConfigAliasSchema = z
  .object({
    provider: z.string().trim().min(1).max(80).optional(),
    api_key: z.string().trim().min(1).optional(),
    username: z.string().trim().min(1).optional(),
    sender_id: z.string().trim().min(1).max(80).optional(),
    api_url: z.string().trim().url().optional(),
    email_provider: z.string().trim().max(80).optional(),
    smtp_host: z.string().trim().max(160).optional(),
    smtp_port: z.number().int().positive().optional(),
    smtp_user: z.string().trim().max(160).optional(),
    smtp_password: z.string().trim().max(200).optional(),
    sms_events: z.array(z.string().min(1)).optional(),
    email_events: z.array(z.string().min(1)).optional(),
    default_language: z.string().trim().max(8).optional(),
    features: z.record(z.boolean()).optional(),
  })
  .passthrough();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listSettingsSchema.parse(req.query);
    const out = await service.listSettings(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// Bulk update by passing { key1: value1, key2: value2 } in the body.
// Spec uses PATCH; we expose both verbs against the same handler so old
// clients (PUT) and Section 14/16-aligned clients (PATCH) both work.
const bulkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const body = bulkUpdateSettingsSchema.parse(req.body);
    const out = await service.bulkUpdateSettings(req, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
};
router.put('/', bulkHandler);
router.patch('/', bulkHandler);

/* ---- spec-aligned typed config blocks (Section 14) ----------------------- */

function readBlockHandler(key: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await service.getSetting(req, key).catch(() => null);
      res.json(out?.value ?? {});
    } catch (err) {
      next(err);
    }
  };
}

function writeBlockHandler<S extends z.ZodTypeAny>(key: string, schema: S) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const value = schema.parse(req.body);
      const out = await service.upsertSetting(req, key, { value });
      res.json(out.value);
    } catch (err) {
      next(err);
    }
  };
}

router.get('/security', readBlockHandler('security.config'));
router.get('/general', readBlockHandler('general.config'));
router.get('/main', readBlockHandler('main.config'));
router.get('/payment', readBlockHandler('payment.config'));
router.get('/sms', readBlockHandler('sms.provider.config'));

router.put('/security', writeBlockHandler('security.config', securityConfigSchema));
router.put('/general', writeBlockHandler('general.config', generalConfigSchema));
router.put('/main', writeBlockHandler('main.config', mainConfigSchema));
router.put('/payment', writeBlockHandler('payment.config', paymentConfigSchema));
router.put('/sms', writeBlockHandler('sms.provider.config', smsConfigAliasSchema));

/* -------------------------------------------------------------------------- */
/* Section 19 — Top Bets / Top Matches / Promotions                            */
/*                                                                            */
/* The spec exposes these as dedicated POST endpoints; we accept both GET     */
/* (read the current list) and POST/PUT (replace) so the admin UI can fetch   */
/* the saved list on page load and overwrite it on save with one round-trip. */
/* The data is persisted under settings keys                                  */
/*    general.top_bets, general.top_matches, general.promotions               */
/* which are also exposed via the public /api/public/general endpoint so      */
/* the user/cashier panels can render them without admin privileges.          */
/* -------------------------------------------------------------------------- */

const topBetEntrySchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  league: z.string().trim().min(1).max(160),
  league_group: z.string().trim().max(160).optional(),
  leagueGroup: z.string().trim().max(160).optional(),
  sport_type: z.string().trim().max(80).optional(),
  sportType: z.string().trim().max(80).optional(),
});

const topMatchEntrySchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  match: z.string().trim().min(1).max(240).optional(),
  match_id: z.string().trim().max(120).optional(),
  home_team: z.string().trim().max(160).optional(),
  away_team: z.string().trim().max(160).optional(),
  league: z.string().trim().max(160).optional(),
  country: z.string().trim().max(80).optional(),
  sport_type: z.string().trim().max(80).optional(),
  sportType: z.string().trim().max(80).optional(),
  schedule: z.string().trim().max(80).optional(),
  starts_at: z.string().trim().max(80).optional(),
});

const promotionBannerSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  image_url: z.string().trim().min(1),  // may be a base64 data URL
  bonus_type: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2000).optional(),
  cta_url: z.string().trim().max(2048).optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().nonnegative().optional(),
});

const topBetsBodySchema = z.union([
  z.array(topBetEntrySchema),
  z.object({ items: z.array(topBetEntrySchema) }),
]);
const topMatchesBodySchema = z.union([
  z.array(topMatchEntrySchema),
  z.object({ items: z.array(topMatchEntrySchema) }),
]);
const promotionsBodySchema = z.union([
  z.array(promotionBannerSchema),
  z.object({ items: z.array(promotionBannerSchema) }),
]);

function asItems<T>(body: T[] | { items: T[] }): T[] {
  return Array.isArray(body) ? body : (body.items ?? []);
}

function listBlockHandler(key: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await service.getSetting(req, key).catch(() => null);
      const value = out?.value;
      if (Array.isArray(value)) {
        res.json({ items: value });
      } else if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown[] }).items)) {
        res.json(value);
      } else {
        res.json({ items: [] });
      }
    } catch (err) {
      next(err);
    }
  };
}

function writeListBlockHandler<S extends z.ZodTypeAny>(key: string, schema: S) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req.body);
      const items = asItems(parsed as never);
      const out = await service.upsertSetting(req, key, { value: items });
      res.json({ items: out.value ?? [] });
    } catch (err) {
      next(err);
    }
  };
}

router.get('/top-bets', listBlockHandler('general.top_bets'));
router.post('/top-bets', writeListBlockHandler('general.top_bets', topBetsBodySchema));
router.put('/top-bets', writeListBlockHandler('general.top_bets', topBetsBodySchema));

router.get('/top-matches', listBlockHandler('general.top_matches'));
router.post('/top-matches', writeListBlockHandler('general.top_matches', topMatchesBodySchema));
router.put('/top-matches', writeListBlockHandler('general.top_matches', topMatchesBodySchema));

router.get('/promotions', listBlockHandler('general.promotions'));
router.post('/promotions', writeListBlockHandler('general.promotions', promotionsBodySchema));
router.put('/promotions', writeListBlockHandler('general.promotions', promotionsBodySchema));

/* -------------------------------------------------------------------------- */
/* Footer Links — admin-managed link groups shown in the user-panel footer.   */
/* -------------------------------------------------------------------------- */

const footerLinkItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  href: z.string().trim().max(2048),
});

const footerLinksObjectSchema = z.object({
  company_links: z.array(footerLinkItemSchema).optional(),
  legal_links: z.array(footerLinkItemSchema).optional(),
  sports_links: z.array(footerLinkItemSchema).optional(),
  copyright_text: z.string().trim().max(500).optional(),
  company_description: z.string().trim().max(2000).optional(),
  live_chat_text: z.string().trim().max(500).optional(),
});

router.get('/footer-links', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.getSetting(req, 'general.footer_links').catch(() => null);
    const value = out?.value;
    res.json(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  } catch (err) {
    next(err);
  }
});

router.put('/footer-links', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = footerLinksObjectSchema.parse(req.body);
    const out = await service.upsertSetting(req, 'general.footer_links', { value: body });
    res.json(out.value ?? {});
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Game Thumbnails — per-game thumbnail/promo image overrides.                */
/* -------------------------------------------------------------------------- */

const gameThumbnailSchema = z.object({
  id: z.string().trim().max(120).optional(),
  game_id: z.string().trim().min(1).max(120),
  game_name: z.string().trim().max(240).optional(),
  thumbnail_url: z.string().trim(),   // may be a base64 data URL
  promo_url: z.string().trim().optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().nonnegative().optional(),
});

const gameThumbnailsBodySchema = z.union([
  z.array(gameThumbnailSchema),
  z.object({ items: z.array(gameThumbnailSchema) }),
]);

router.get('/game-thumbnails', listBlockHandler('general.game_thumbnails'));
router.post('/game-thumbnails', writeListBlockHandler('general.game_thumbnails', gameThumbnailsBodySchema));
router.put('/game-thumbnails', writeListBlockHandler('general.game_thumbnails', gameThumbnailsBodySchema));

/* -------------------------------------------------------------------------- */
/* Section 21 — Payment Configuration                                          */
/*                                                                            */
/* These routes mirror the existing /api/admin/payment-methods CRUD but live  */
/* under /api/admin/settings/payment so the admin UI's "Payment              */
/* Configuration" page can keep a single base URL. Both surfaces hit the      */
/* same service so behaviour stays consistent across the two paths.           */
/* -------------------------------------------------------------------------- */

swagger.registerPath({
  method: 'get',
  path: '/api/admin/settings/payment/methods',
  summary: 'List payment methods (Section 21 Tab 1/2)',
  tags: ['Admin Settings', 'Admin Payment Methods'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Payment methods list' } },
});

router.get(
  '/payment/methods',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listPaymentMethodsQuerySchema.parse(req.query);
      res.json(await paymentMethodsService.listPaymentMethods(req, query));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/payment/methods/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      res.json(await paymentMethodsService.getPaymentMethod(req, id));
    } catch (err) {
      next(err);
    }
  }
);

swagger.registerPath({
  method: 'post',
  path: '/api/admin/settings/payment/methods',
  summary: 'Create a payment method (Section 21 Tab 3)',
  tags: ['Admin Settings', 'Admin Payment Methods'],
  security: [{ bearerAuth: [] }],
  responses: { '201': { description: 'Payment method created' } },
});

router.post(
  '/payment/methods',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createPaymentMethodSchema.parse(req.body);
      res.status(201).json(await paymentMethodsService.createPaymentMethod(req, body));
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/payment/methods/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const body = updatePaymentMethodSchema.parse(req.body);
      res.json(await paymentMethodsService.updatePaymentMethod(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/payment/methods/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const body = updatePaymentMethodSchema.parse(req.body);
      res.json(await paymentMethodsService.updatePaymentMethod(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/payment/methods/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      res.json(await paymentMethodsService.deletePaymentMethod(req, id));
    } catch (err) {
      next(err);
    }
  }
);

swagger.registerPath({
  method: 'post',
  path: '/api/admin/settings/payment/{id}/test',
  summary: 'Test the configured connection for a payment method',
  tags: ['Admin Settings', 'Admin Payment Methods'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Test result with per-check breakdown' } },
});

/* Spec endpoint is exactly /api/admin/settings/payment/:id/test — we
 * also accept .../methods/:id/test for symmetry with the other CRUD
 * verbs above. Both go through the same service call. */
router.post(
  '/payment/:id/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const body = testPaymentMethodSchema.parse(req.body);
      res.json(await paymentMethodsService.testPaymentMethod(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);
router.post(
  '/payment/methods/:id/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const body = testPaymentMethodSchema.parse(req.body);
      res.json(await paymentMethodsService.testPaymentMethod(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.getSetting(req, req.params.key);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.put('/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = upsertSettingSchema.parse(req.body);
    const out = await service.upsertSetting(req, req.params.key, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.delete(
  '/:key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await service.deleteSetting(req, req.params.key);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
