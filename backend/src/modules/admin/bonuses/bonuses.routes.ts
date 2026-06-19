import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import * as service from './bonuses.service';
// Section 25 — per-ticket loss cashback defaults shared with the
// promotions/loss-cashback evaluator so admin settings stay in lockstep.
import { DEFAULT_PER_TICKET_CASHBACK } from '../../promotions/loss-cashback';
import {
  assignBonusSchema,
  createBonusSchema,
  internalEvaluateSchema,
  listBonusClaimsSchema,
  listBonusesSchema,
  manualAwardSchema,
  patchBonusStatusSchema,
  updateBonusSchema,
} from './bonuses.dto';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import * as swagger from '../../../swagger/registry';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';
import { tryAudit } from '../../audit/audit.service';

const router = Router();

const BONUS_SETTINGS_KEY = 'promotions.bonus_settings';
const CASHBACK_RULES_KEY = 'promotions.cashback_rules';

const DEFAULT_BONUS_SETTINGS = {
  global_enabled: true,
  default_wagering_multiplier: 5,
  default_expiry_days: 7,
  default_min_odds: 1.5,
  cashback: {
    schedule: 'weekly',
    payout_as: 'bonus',
    per_ticket: DEFAULT_PER_TICKET_CASHBACK,
  },
  deposit_match: { stack_with_promo: false },
};

const cashbackTierSchema = z.object({
  min_odds: z.number().nonnegative(),
  max_odds: z.number().nonnegative().nullable(),
  pct: z.number().nonnegative(),
});

const lossSlotSchema = z.object({
  enabled: z.boolean().default(true),
  min_legs: z.number().int().nonnegative().default(0),
  min_leg_odds: z.number().nonnegative().default(0),
  min_stake: z.number().nonnegative().default(0),
  max_cashback: z.number().nonnegative().default(0),
  tiers: z.array(cashbackTierSchema).default([]),
});

const ruleConfigSchema = z.object({
  loss_one: lossSlotSchema,
  loss_two: lossSlotSchema,
  loss_three: lossSlotSchema.optional(),
});

const perTicketCashbackSchema = z.object({
  enabled: z.boolean().default(false),
  active_rule: z.enum(['rule_one', 'rule_two']).default('rule_one'),
  payout_as: z.enum(['bonus', 'cash']).default('bonus'),
  exclude_live: z.boolean().default(true),
  exclude_virtual: z.boolean().default(true),
  rule_one: ruleConfigSchema,
  rule_two: ruleConfigSchema,
});

const bonusSettingsSchema = z.object({
  global_enabled: z.boolean().default(true),
  default_wagering_multiplier: z.number().nonnegative().default(5),
  default_expiry_days: z.number().int().nonnegative().default(7),
  default_min_odds: z.number().nonnegative().default(1.5),
  cashback: z
    .object({
      schedule: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('weekly'),
      payout_as: z.enum(['bonus', 'cash']).default('bonus'),
      min_loss: z.number().nonnegative().default(100),
      pct: z.number().min(0).max(100).default(10),
      max_cap: z.number().nonnegative().optional(),
      vip_multipliers: z.record(z.string(), z.number().positive()).optional(),
      per_ticket: perTicketCashbackSchema.default(DEFAULT_PER_TICKET_CASHBACK),
    })
    .default({}),
  deposit_match: z
    .object({
      stack_with_promo: z.boolean().default(false),
    })
    .default({}),
});

const cashbackRuleStatusSchema = z.enum(['active', 'inactive', 'draft']);

const cashbackRuleConfigSchema = z.object({
  schedule: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('weekly'),
  payout_as: z.enum(['bonus', 'cash']).default('bonus'),
  min_loss: z.number().nonnegative().default(100),
  pct: z.number().min(0).max(100).default(10),
  max_cap: z.number().nonnegative().optional(),
  vip_multipliers: z.record(z.string(), z.number().positive()).optional(),
  per_ticket: perTicketCashbackSchema.default(DEFAULT_PER_TICKET_CASHBACK),
});

const cashbackRuleRowSchema = z.object({
  id: z.string().trim().min(1),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(160),
  status: cashbackRuleStatusSchema,
  is_active: z.boolean().default(false),
  config: cashbackRuleConfigSchema,
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
});

const cashbackRulesStoreSchema = z.object({
  active_rule_id: z.string().trim().min(1).nullable().optional(),
  multi_rule_enabled: z.boolean().default(false),
  rules: z.array(cashbackRuleRowSchema).default([]),
});

const cashbackRuleCreateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  status: cashbackRuleStatusSchema.default('draft'),
  is_active: z.boolean().optional(),
  config: cashbackRuleConfigSchema,
});

const cashbackRuleUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  status: cashbackRuleStatusSchema.optional(),
  is_active: z.boolean().optional(),
  config: cashbackRuleConfigSchema.optional(),
});

type CashbackRuleRow = z.infer<typeof cashbackRuleRowSchema>;
type CashbackRulesStore = z.infer<typeof cashbackRulesStoreSchema>;

function nowIso() {
  return new Date().toISOString();
}

function sanitizeRuleStore(input: unknown): CashbackRulesStore {
  const parsed = cashbackRulesStoreSchema.safeParse(input);
  if (parsed.success) {
    const dedupedRules: CashbackRuleRow[] = [];
    const seen = new Set<string>();
    for (const row of parsed.data.rules) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      dedupedRules.push(row);
    }
    const activeRule = dedupedRules.find((r) => r.is_active && r.status === 'active');
    return {
      ...parsed.data,
      rules: dedupedRules,
      active_rule_id: activeRule?.id ?? null,
    };
  }
  return { active_rule_id: null, multi_rule_enabled: false, rules: [] };
}

function sortRulesDesc(rules: CashbackRuleRow[]): CashbackRuleRow[] {
  return [...rules].sort((a, b) => {
    if (b.version !== a.version) return b.version - a.version;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function deactivateRule(row: CashbackRuleRow): CashbackRuleRow {
  return {
    ...row,
    is_active: false,
    status: row.status === 'draft' ? 'draft' : 'inactive',
  };
}

function activateRule(row: CashbackRuleRow, actorId: string | null, ts: string): CashbackRuleRow {
  return {
    ...row,
    is_active: true,
    status: 'active',
    updated_at: ts,
    updated_by: actorId,
  };
}

function applyActiveRuleToSettings(
  settings: z.infer<typeof bonusSettingsSchema>,
  store: CashbackRulesStore
) {
  const active = store.rules.find((r) => r.id === store.active_rule_id && r.is_active);
  if (!active) return settings;
  return {
    ...settings,
    cashback: {
      ...settings.cashback,
      ...active.config,
    },
  };
}

async function loadCashbackRuleStore(
  tenantId: string,
  bypassRls: boolean
): Promise<CashbackRulesStore> {
  return withTenantClient({ tenantId, bypassRls }, async (client) => {
    const row = await client.query<{ value: unknown }>(
      `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
      [tenantId, CASHBACK_RULES_KEY]
    );
    return sanitizeRuleStore(row.rows[0]?.value);
  });
}

async function saveCashbackRuleStore(
  tenantId: string,
  bypassRls: boolean,
  store: CashbackRulesStore
) {
  await withTenantClient({ tenantId, bypassRls }, async (client) => {
    await client.query(
      `INSERT INTO settings (tenant_id, key, value)
         VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (tenant_id, key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now()`,
      [tenantId, CASHBACK_RULES_KEY, JSON.stringify(store)]
    );
  });
}

function bootstrapRuleFromSettings(
  settings: z.infer<typeof bonusSettingsSchema>,
  actorId: string | null
): CashbackRulesStore {
  const ts = nowIso();
  const row: CashbackRuleRow = {
    id: `cb-${Date.now()}`,
    version: 1,
    name: 'Initial Cashback Rule',
    status: 'active',
    is_active: true,
    config: {
      schedule: settings.cashback.schedule,
      payout_as: settings.cashback.payout_as,
      min_loss: settings.cashback.min_loss,
      pct: settings.cashback.pct,
      max_cap: settings.cashback.max_cap,
      vip_multipliers: settings.cashback.vip_multipliers,
      per_ticket: settings.cashback.per_ticket,
    },
    created_at: ts,
    updated_at: ts,
    created_by: actorId,
    updated_by: actorId,
  };
  return { active_rule_id: row.id, multi_rule_enabled: false, rules: [row] };
}

const freebetCreateSchema = z.object({
  user_id: z.string().uuid().optional(),
  user_ids: z.array(z.string().uuid()).max(5000).optional(),
  segment: z
    .enum([
      'all',
      'all_active',
      'kyc_verified',
      'kyc_pending',
      'active_30d',
      'new_users',
      'inactive_30d',
    ])
    .optional(),
  amount: z.number().positive(),
  min_odds: z.number().nonnegative().default(1.5),
  expires_in_days: z.number().int().positive().default(7),
  name: z.string().trim().max(160).optional(),
});

const freebetsListQuery = z.object({
  status: z
    .enum(['active', 'completed', 'forfeited', 'expired', 'cancelled'])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/bonuses',
  summary: 'List bonus rules',
  tags: ['Admin Bonuses'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Bonus list' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/bonuses',
  summary: 'Create bonus rule',
  tags: ['Admin Bonuses'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['name', 'type'],
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            status: { type: 'string' },
            is_active: { type: 'boolean' },
            valid_from: { type: 'string', format: 'date-time', nullable: true },
            valid_to: { type: 'string', format: 'date-time', nullable: true },
            priority: { type: 'number' },
            config: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Bonus created' },
    '400': { description: 'Validation error' },
  },
});

swagger.registerPath({
  method: 'patch',
  path: '/api/admin/bonuses/{id}/status',
  summary: 'Patch bonus status',
  tags: ['Admin Bonuses'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string' },
            is_active: { type: 'boolean' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Status updated' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/bonuses/{id}/award',
  summary: 'Manual bonus award',
  tags: ['Admin Bonuses'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['user_id'],
          properties: {
            user_id: { type: 'string', format: 'uuid' },
            amount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
            reason: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Awarded' },
    '400': { description: 'Award rejected' },
  },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/bonuses/{id}',
  summary: 'Get bonus rule by id',
  tags: ['Admin Bonuses'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Bonus details' },
  },
});

swagger.registerPath({
  method: 'put',
  path: '/api/admin/bonuses/{id}',
  summary: 'Update bonus rule',
  tags: ['Admin Bonuses'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
            is_active: { type: 'boolean' },
            valid_from: { type: 'string', format: 'date-time', nullable: true },
            valid_to: { type: 'string', format: 'date-time', nullable: true },
            priority: { type: 'number' },
            config: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Bonus updated' },
  },
});

swagger.registerPath({
  method: 'delete',
  path: '/api/admin/bonuses/{id}',
  summary: 'Delete bonus rule',
  tags: ['Admin Bonuses'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Bonus deleted' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/bonuses/{id}/assign',
  summary: 'Assign bonus to user(s)',
  tags: ['Admin Bonuses'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string', format: 'uuid' },
            user_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
            expires_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Bonus assigned' },
  },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listBonusesSchema.parse(req.query);
    const out = await service.listBonuses(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

/* -------------------- Bonus engine settings (Tab 2) -------------------- */
router.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const out = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const row = await client.query<{ value: Record<string, unknown> }>(
          `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2`,
          [tenantId, BONUS_SETTINGS_KEY]
        );
        return row.rows[0]?.value ?? DEFAULT_BONUS_SETTINGS;
      }
    );
    const parsed = bonusSettingsSchema.parse(out);
    const store = await loadCashbackRuleStore(tenantId, scope.bypassRls);
    const effectiveSettings = applyActiveRuleToSettings(parsed, store);
    res.json({ ...effectiveSettings, cashback_rule_store: store });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = bonusSettingsSchema.parse(req.body);
    const perTicket = body.cashback.per_ticket;
    const ruleOneEnabled = Boolean(
      perTicket.rule_one.loss_one.enabled || perTicket.rule_one.loss_two.enabled
    );
    const ruleTwoEnabled = Boolean(
      perTicket.rule_two.loss_one.enabled ||
        perTicket.rule_two.loss_two.enabled ||
        perTicket.rule_two.loss_three?.enabled
    );
    const normalizedActiveRule =
      !ruleOneEnabled && ruleTwoEnabled
        ? 'rule_two'
        : ruleOneEnabled && !ruleTwoEnabled
          ? 'rule_one'
          : perTicket.active_rule;
    const normalizedBody = {
      ...body,
      cashback: {
        ...body.cashback,
        per_ticket: {
          ...perTicket,
          active_rule: normalizedActiveRule,
        },
      },
    };
    const existingStore = await loadCashbackRuleStore(tenantId, scope.bypassRls);
    const nextStore = (() => {
      const base =
        existingStore.rules.length > 0
          ? { ...existingStore, rules: [...existingStore.rules] }
          : bootstrapRuleFromSettings(body, scope.actorId);

      const activeIdx = base.rules.findIndex(
        (r) => r.id === base.active_rule_id
      );
      const fallbackActiveIdx =
        activeIdx >= 0 ? activeIdx : base.rules.findIndex((r) => r.is_active === true);
      const targetIdx = fallbackActiveIdx >= 0 ? fallbackActiveIdx : 0;
      const ts = nowIso();

      if (base.rules[targetIdx]) {
        const target = base.rules[targetIdx];
        base.rules[targetIdx] = {
          ...target,
          status: 'active',
          is_active: true,
          config: {
            ...target.config,
            schedule: normalizedBody.cashback.schedule,
            payout_as: normalizedBody.cashback.payout_as,
            min_loss: normalizedBody.cashback.min_loss,
            pct: normalizedBody.cashback.pct,
            max_cap: normalizedBody.cashback.max_cap,
            vip_multipliers: normalizedBody.cashback.vip_multipliers,
            per_ticket: normalizedBody.cashback.per_ticket,
          },
          updated_at: ts,
          updated_by: scope.actorId,
        };
        base.active_rule_id = base.rules[targetIdx].id;
        base.rules = base.rules.map((r, idx) =>
          idx === targetIdx ? r : deactivateRule(r)
        );
      }

      return {
        ...base,
        rules: sortRulesDesc(base.rules),
      };
    })();

    await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        await client.query(
          `INSERT INTO settings (tenant_id, key, value)
             VALUES ($1,$2,$3::jsonb)
           ON CONFLICT (tenant_id, key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = now()`,
          [tenantId, BONUS_SETTINGS_KEY, JSON.stringify(normalizedBody)]
        );
      }
    );
    await saveCashbackRuleStore(tenantId, scope.bypassRls, nextStore);
    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.bonus.settings.update',
        resource: 'settings',
        resourceId: BONUS_SETTINGS_KEY,
        payload: { value: normalizedBody, cashback_rule_store: nextStore },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );
    res.json({ ...normalizedBody, cashback_rule_store: nextStore });
  } catch (err) {
    next(err);
  }
});

router.get('/settings/cashback-rules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const settings = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const row = await client.query<{ value: unknown }>(
          `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
          [tenantId, BONUS_SETTINGS_KEY]
        );
        return bonusSettingsSchema.parse(row.rows[0]?.value ?? DEFAULT_BONUS_SETTINGS);
      }
    );
    const store = await loadCashbackRuleStore(tenantId, scope.bypassRls);
    const bootstrapped =
      store.rules.length > 0 ? store : bootstrapRuleFromSettings(settings, scope.actorId);
    if (store.rules.length === 0) {
      await saveCashbackRuleStore(tenantId, scope.bypassRls, bootstrapped);
    }
    res.json(bootstrapped);
  } catch (err) {
    next(err);
  }
});

router.post('/settings/cashback-rules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = cashbackRuleCreateSchema.parse(req.body);
    const store = await loadCashbackRuleStore(tenantId, scope.bypassRls);
    const nextVersion = store.rules.reduce((max, rule) => Math.max(max, rule.version), 0) + 1;
    const ts = nowIso();
    const requestedActive = body.is_active === true || body.status === 'active';
    const rule: CashbackRuleRow = {
      id: `cb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: nextVersion,
      name: body.name?.trim() || `Cashback Rule v${nextVersion}`,
      status: requestedActive ? 'active' : body.status,
      is_active: requestedActive,
      config: body.config,
      created_at: ts,
      updated_at: ts,
      created_by: scope.actorId,
      updated_by: scope.actorId,
    };
    const rules = requestedActive
      ? store.rules.map((r) => deactivateRule(r)).concat(rule)
      : store.rules.concat(rule);
    const nextStore: CashbackRulesStore = {
      ...store,
      active_rule_id: requestedActive ? rule.id : store.active_rule_id,
      rules: sortRulesDesc(rules),
    };
    await saveCashbackRuleStore(tenantId, scope.bypassRls, nextStore);
    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.cashback.rule.create',
        resource: 'settings',
        resourceId: CASHBACK_RULES_KEY,
        payload: { rule, active_rule_id: nextStore.active_rule_id },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );
    res.status(201).json(nextStore);
  } catch (err) {
    next(err);
  }
});

router.put('/settings/cashback-rules/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = cashbackRuleUpdateSchema.parse(req.body);
    const store = await loadCashbackRuleStore(tenantId, scope.bypassRls);
    const idx = store.rules.findIndex((r) => r.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'not_found', message: 'Cashback rule not found' });
      return;
    }
    const prev = store.rules[idx];
    const requestedActive = body.is_active === true || body.status === 'active';
    const updated: CashbackRuleRow = {
      ...prev,
      name: body.name ?? prev.name,
      status: requestedActive ? 'active' : (body.status ?? prev.status),
      is_active: requestedActive ? true : (body.is_active ?? prev.is_active),
      config: body.config ?? prev.config,
      updated_at: nowIso(),
      updated_by: scope.actorId,
    };
    let rules = [...store.rules];
    rules[idx] = updated;
    if (requestedActive && !store.multi_rule_enabled) {
      rules = rules.map((r) =>
        r.id === updated.id ? r : deactivateRule(r)
      );
    }
    const nextStore: CashbackRulesStore = {
      ...store,
      active_rule_id:
        updated.is_active
          ? updated.id
          : store.active_rule_id === updated.id
            ? null
            : store.active_rule_id,
      rules: sortRulesDesc(rules),
    };
    await saveCashbackRuleStore(tenantId, scope.bypassRls, nextStore);
    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.cashback.rule.update',
        resource: 'settings',
        resourceId: CASHBACK_RULES_KEY,
        payload: { before: prev, after: updated },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );
    res.json(nextStore);
  } catch (err) {
    next(err);
  }
});

router.post('/settings/cashback-rules/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const store = await loadCashbackRuleStore(tenantId, scope.bypassRls);
    const idx = store.rules.findIndex((r) => r.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'not_found', message: 'Cashback rule not found' });
      return;
    }
    const ts = nowIso();
    const rules = store.rules.map((r) =>
      r.id === req.params.id
        ? activateRule(r, scope.actorId, ts)
        : { ...deactivateRule(r), updated_at: ts, updated_by: scope.actorId }
    );
    const nextStore: CashbackRulesStore = {
      ...store,
      active_rule_id: req.params.id,
      rules: sortRulesDesc(rules),
    };
    await saveCashbackRuleStore(tenantId, scope.bypassRls, nextStore);
    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.cashback.rule.activate',
        resource: 'settings',
        resourceId: CASHBACK_RULES_KEY,
        payload: { active_rule_id: req.params.id },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );
    res.json(nextStore);
  } catch (err) {
    next(err);
  }
});

/* -------------------- Free bets (Tab 3) -------------------- */
router.get('/freebets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const q = freebetsListQuery.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    const out = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const filters: string[] = [
          'ba.tenant_id = $1',
          "br.type = 'free_bet'",
        ];
        const values: unknown[] = [tenantId];
        let i = 2;
        if (q.status) {
          filters.push(`ba.status = $${i++}`);
          values.push(q.status);
        }
        const where = `WHERE ${filters.join(' AND ')}`;
        const total = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM bonus_assignments ba
             JOIN bonus_rules br ON br.id = ba.bonus_rule_id
             ${where}`,
          values
        );
        const rows = await client.query(
          `SELECT ba.id,
                  ba.bonus_rule_id,
                  br.name AS bonus_name,
                  ba.user_id,
                  ba.awarded_amount::text,
                  ba.wagering_required::text,
                  ba.wagering_progress::text,
                  ba.status,
                  ba.awarded_at,
                  ba.expires_at,
                  ba.completed_at,
                  ba.metadata,
                  u.email AS user_email,
                  u.phone AS user_phone
             FROM bonus_assignments ba
             JOIN bonus_rules br ON br.id = ba.bonus_rule_id
             LEFT JOIN users u ON u.id = ba.user_id
             ${where}
           ORDER BY ba.awarded_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
          [...values, q.limit, offset]
        );
        return {
          items: rows.rows,
          total: Number(total.rows[0]?.count ?? 0),
          page: q.page,
          limit: q.limit,
        };
      }
    );
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/freebets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = freebetCreateSchema.parse(req.body);
    const userIds = body.user_ids ?? (body.user_id ? [body.user_id] : []);
    if (userIds.length === 0 && !body.segment) {
      res.status(400).json({
        error: 'bad_request',
        message: 'Provide user_id, user_ids, or segment',
      });
      return;
    }

    const result = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        // Look up or create the "Manual Free Bet" container rule. Free bet
        // assignments hang off of a free_bet bonus_rule so the engine can
        // reuse the same wagering machinery (with a wagering_multiplier
        // of 0 since a freebet is one-shot).
        const ruleName = body.name?.trim() || 'Manual Free Bet';
        let rule = await client.query<{ id: string }>(
          `SELECT id FROM bonus_rules
            WHERE tenant_id = $1 AND name = $2 AND type = 'free_bet' LIMIT 1`,
          [tenantId, ruleName]
        );
        if (!rule.rows[0]) {
          rule = await client.query<{ id: string }>(
            `INSERT INTO bonus_rules (tenant_id, name, type, config, is_active, status, priority)
             VALUES ($1, $2, 'free_bet', $3::jsonb, true, 'active', 0)
             RETURNING id`,
            [
              tenantId,
              ruleName,
              JSON.stringify({
                amount: body.amount,
                free_bet_amount: body.amount,
                min_odds: body.min_odds,
                expires_in_days: body.expires_in_days,
                wagering_multiplier: 0,
                description: 'Auto-created from manual free bet award',
              }),
            ]
          );
        }
        const ruleId = rule.rows[0].id;

        let resolvedUserIds = userIds;
        if (resolvedUserIds.length === 0 && body.segment) {
          // Segment resolution duplicates a small bit of bonuses.repository
          // logic to keep this endpoint self-contained.
          const segQ = await client.query<{ id: string }>(
            `SELECT id FROM users
              WHERE tenant_id = $1
                ${body.segment === 'all_active' ? "AND status = 'active'" : ''}
                ${body.segment === 'kyc_verified' ? "AND kyc_status = 'verified' AND status = 'active'" : ''}
                ${body.segment === 'kyc_pending' ? "AND kyc_status IN ('pending','submitted')" : ''}
                ${body.segment === 'new_users' ? "AND status = 'active' AND created_at >= now() - interval '7 days'" : ''}
              LIMIT 5000`,
            [tenantId]
          );
          resolvedUserIds = segQ.rows.map((r) => r.id);
        }
        if (resolvedUserIds.length === 0) {
          return { ruleId, count: 0, assignments: [] };
        }
        const expiresAt = new Date(
          Date.now() + body.expires_in_days * 24 * 60 * 60 * 1000
        );
        const inserted = await client.query(
          `INSERT INTO bonus_assignments
             (tenant_id, bonus_rule_id, user_id, awarded_by,
              awarded_amount, wagering_required, expires_at, metadata)
           SELECT $1::uuid, $2::uuid, uid::uuid, $3::uuid,
                  $4::numeric, 0, $5::timestamptz, $6::jsonb
             FROM unnest($7::uuid[]) AS uid
           RETURNING id, user_id, awarded_amount::text, expires_at, status`,
          [
            tenantId,
            ruleId,
            scope.actorId,
            body.amount,
            expiresAt,
            JSON.stringify({
              source: 'freebet_admin',
              min_odds: body.min_odds,
              type: 'free_bet',
            }),
            resolvedUserIds,
          ]
        );
        return {
          ruleId,
          count: inserted.rows.length,
          assignments: inserted.rows,
        };
      }
    );
    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.bonus.freebet.award',
        resource: 'bonus_assignment',
        resourceId: result.ruleId,
        payload: {
          count: result.count,
          amount: body.amount,
        },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.getBonus(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createBonusSchema.parse(req.body);
    const out = await service.createBonus(req, body);
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateBonusSchema.parse(req.body);
    const out = await service.updateBonus(req, req.params.id, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.deleteBonus(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/assign',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = assignBonusSchema.parse(req.body);
      const out = await service.assignBonus(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = patchBonusStatusSchema.parse(req.body);
      const out = await service.patchBonusStatus(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/claims',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listBonusClaimsSchema.parse(req.query);
      const out = await service.listBonusClaims(req, req.params.id, query);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/award',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = manualAwardSchema.parse(req.body);
      const out = await service.manualAwardBonus(req, req.params.id, body);
      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/internal/evaluate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = internalEvaluateSchema.parse(req.body);
      const out = await service.evaluateInternalBonusEvent(body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
