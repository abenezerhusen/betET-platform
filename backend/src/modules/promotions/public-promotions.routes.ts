import { Router, type NextFunction, type Request, type Response } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError } from '../../http/errors/http-error';
import * as swagger from '../../swagger/registry';
import { z } from 'zod';
import {
  computeLossCashback,
  DEFAULT_PER_TICKET_CASHBACK,
  type LegInput,
  type PerTicketCashbackConfig,
} from './loss-cashback';

const router = Router();

function requireTenantId(req: Request): string {
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
  if (!tenantId) throw new BadRequestError('Tenant context required');
  return tenantId;
}

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

type CashbackSlotKey = 'loss_one' | 'loss_two' | 'loss_three';

async function loadEffectiveCashbackConfig(
  tenantId: string
): Promise<PerTicketCashbackConfig> {
  return withTenantClient({ tenantId }, async (client) => {
    const storeRow = await client.query<{ value: unknown }>(
      `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'promotions.cashback_rules'`,
      [tenantId]
    );
    const store = storeRow.rows[0]?.value as
      | {
          active_rule_id?: string | null;
          rules?: Array<{
            id?: string;
            status?: string;
            is_active?: boolean;
            config?: { per_ticket?: PerTicketCashbackConfig };
          }>;
        }
      | null;
    const active =
      store?.rules?.find((r) => r.id === store.active_rule_id) ??
      store?.rules?.find((r) => r.is_active === true) ??
      null;
    if (active?.status === 'active' && active.config?.per_ticket) {
      return { ...active.config.per_ticket, enabled: true };
    }

    const settingsRow = await client.query<{ value: unknown }>(
      `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'promotions.bonus_settings'`,
      [tenantId]
    );
    const settings = settingsRow.rows[0]?.value as
      | { cashback?: { per_ticket?: PerTicketCashbackConfig } }
      | null;
    const fallback = settings?.cashback?.per_ticket ?? DEFAULT_PER_TICKET_CASHBACK;
    return { ...fallback, enabled: true };
  });
}

async function loadActiveCashbackProfile(tenantId: string): Promise<{
  rule_id: string | null;
  rule_name: string | null;
  version: number | null;
} | null> {
  return withTenantClient({ tenantId }, async (client) => {
    const storeRow = await client.query<{ value: unknown }>(
      `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'promotions.cashback_rules'`,
      [tenantId]
    );
    const store = storeRow.rows[0]?.value as
      | {
          active_rule_id?: string | null;
          rules?: Array<{
            id?: string;
            name?: string;
            version?: number;
            status?: string;
            is_active?: boolean;
          }>;
        }
      | null;
    const active =
      store?.rules?.find((r) => r.id === store.active_rule_id) ??
      store?.rules?.find((r) => r.is_active === true) ??
      null;
    if (!active || active.status !== 'active') return null;
    return {
      rule_id: active.id ?? null,
      rule_name: active.name ?? null,
      version: active.version ?? null,
    };
  });
}

function buildQualifiedLegs(
  slot: { min_legs: number; min_leg_odds: number; tiers: Array<{ min_odds: number; max_odds: number | null }> },
  lossCount: number
): LegInput[] {
  const totalLegs = Math.max(1, slot.min_legs);
  const firstTier = slot.tiers[0] ?? { min_odds: 1, max_odds: null };
  const low = Math.max(1, firstTier.min_odds || 1);
  const high =
    firstTier.max_odds && Number.isFinite(firstTier.max_odds)
      ? firstTier.max_odds
      : low + 20;
  const targetOdds = (low + high) / 2;
  const perLeg = Math.max(slot.min_leg_odds || 1.01, Math.pow(targetOdds, 1 / totalLegs));
  const legOdds = Math.round(perLeg * 100) / 100;
  return Array.from({ length: totalLegs }, (_v, idx) => ({
    status: idx < lossCount ? 'lost' : 'won',
    odds: legOdds,
    is_live: false,
    is_virtual: false,
  }));
}

swagger.registerPath({
  method: 'get',
  path: '/api/promotions/active',
  summary: 'List active public promotions',
  tags: ['Promotions'],
  security: [],
  responses: { '200': { description: 'Active promotions' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/promotions/cashback-notice',
  summary: 'Get active cashback rule summary for user notice board',
  tags: ['Promotions'],
  security: [],
  responses: { '200': { description: 'Active cashback rule' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/promotions/cashback-rules',
  summary: 'Get cashback rule mini-card payload',
  tags: ['Promotions'],
  security: [],
  responses: { '200': { description: 'Cashback rules' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/promotions/cashback-test-tickets',
  summary: 'Get generated cashback test tickets for each enabled rule slot',
  tags: ['Promotions'],
  security: [],
  responses: { '200': { description: 'Cashback test tickets' } },
});

router.get(
  '/active',
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    const userId = req.user?.id ?? null;
    return withTenantClient({ tenantId }, async (client) => {
      const bonuses = await client.query(
        `SELECT r.id,
                r.name AS title,
                COALESCE(r.config->>'description', '') AS description,
                CASE
                  WHEN r.type = 'cashback' THEN 'cashback_bonus'
                  WHEN r.type = 'loyalty' THEN 'loyalty_bonus'
                  WHEN r.type = 'signup' THEN 'welcome_bonus'
                  WHEN r.type = 'referral' THEN 'referral_bonus'
                  WHEN r.type = 'free_bet' THEN 'free_bet'
                  ELSE 'bonus'
                END::text AS type,
                NULLIF(COALESCE(r.config->>'image_url', r.config->>'banner_url', ''), '') AS image_url,
                COALESCE(r.config->>'terms', '') AS terms,
                r.valid_to AS valid_to,
                COALESCE(NULLIF(r.config->>'cta_label', ''), 'Open')::text AS cta_label,
                NULLIF(COALESCE(r.config->>'cta_url', ''), '')::text AS cta_url,
                CASE
                  WHEN $2::uuid IS NULL THEN false
                  ELSE EXISTS (
                    SELECT 1
                    FROM bonus_assignments ba
                    WHERE ba.tenant_id = r.tenant_id
                      AND ba.bonus_rule_id = r.id
                      AND ba.user_id = $2::uuid
                  )
                END AS is_claimed
           FROM bonus_rules r
          WHERE r.tenant_id = $1
            AND r.is_active = true
            AND r.status = 'active'
            AND (r.valid_from IS NULL OR r.valid_from <= now())
            AND (r.valid_to IS NULL OR r.valid_to >= now())
          ORDER BY r.created_at DESC
          LIMIT 50`,
        [tenantId, userId]
      );

      const raffles = await client.query(
        `SELECT pr.id,
                pr.name AS title,
                COALESCE(pr.description, '') AS description,
                'raffle'::text AS type,
                NULLIF(COALESCE(pr.rules->>'image_url', ''), '') AS image_url,
                COALESCE(pr.rules->>'terms', '') AS terms,
                pr.draw_at AS valid_to,
                COALESCE(NULLIF(pr.rules->>'cta_label', ''), 'Open')::text AS cta_label,
                NULLIF(COALESCE(pr.rules->>'cta_url', ''), '')::text AS cta_url,
                false AS is_claimed
           FROM promo_raffles pr
          WHERE pr.tenant_id = $1
            AND pr.status IN ('open', 'draft')
          ORDER BY pr.created_at DESC
          LIMIT 50`,
        [tenantId]
      );

      const tournaments = await client.query(
        `SELECT t.id,
                t.name AS title,
                COALESCE(t.description, '') AS description,
                'tournament'::text AS type,
                NULLIF(COALESCE(t.rules->>'image_url', ''), '') AS image_url,
                COALESCE(t.rules->>'terms', '') AS terms,
                t.ends_at AS valid_to,
                COALESCE(NULLIF(t.rules->>'cta_label', ''), 'Open')::text AS cta_label,
                NULLIF(COALESCE(t.rules->>'cta_url', ''), '')::text AS cta_url,
                CASE
                  WHEN $2::uuid IS NULL THEN false
                  ELSE EXISTS (
                    SELECT 1 FROM tournament_entries te
                    WHERE te.tournament_id = t.id AND te.user_id = $2::uuid
                  )
                END AS is_claimed
           FROM tournaments t
          WHERE t.tenant_id = $1
            AND t.status IN ('scheduled', 'running')
          ORDER BY t.created_at DESC
          LIMIT 50`,
        [tenantId, userId]
      );

      return {
        items: [...bonuses.rows, ...raffles.rows, ...tournaments.rows],
      };
    });
  })
);

router.get('/cashback-notice', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const tenantId = requireTenantId(req);
    const out = await withTenantClient({ tenantId }, async (client) => {
      const storeRow = await client.query<{ value: unknown }>(
        `SELECT value FROM settings
          WHERE tenant_id = $1 AND key = 'promotions.cashback_rules'`,
        [tenantId]
      );
      const store = storeRow.rows[0]?.value as
        | {
            active_rule_id?: string | null;
            rules?: Array<{
              id?: string;
              name?: string;
              version?: number;
              status?: string;
              is_active?: boolean;
              config?: {
                schedule?: 'daily' | 'weekly' | 'monthly' | 'yearly';
                payout_as?: 'bonus' | 'cash';
                min_loss?: number;
                pct?: number;
                max_cap?: number;
                vip_multipliers?: Record<string, number>;
              };
            }>;
          }
        | null;

      const activeRule =
        store?.rules?.find((r) => r.id === store.active_rule_id) ??
        store?.rules?.find((r) => r.is_active === true) ??
        null;

      if (activeRule && activeRule.status === 'active') {
        return {
          active: true,
          source: 'versioned_rule',
          rule_id: activeRule.id ?? null,
          rule_name: activeRule.name ?? 'Cashback Rule',
          version: activeRule.version ?? null,
          schedule: activeRule.config?.schedule ?? 'weekly',
          payout_as: activeRule.config?.payout_as ?? 'bonus',
          min_loss: activeRule.config?.min_loss ?? 0,
          pct: activeRule.config?.pct ?? 0,
          max_cap: activeRule.config?.max_cap ?? null,
          vip_multipliers: activeRule.config?.vip_multipliers ?? {},
        };
      }

      const settingsRow = await client.query<{ value: unknown }>(
        `SELECT value FROM settings
          WHERE tenant_id = $1 AND key = 'promotions.bonus_settings'`,
        [tenantId]
      );
      const settings = settingsRow.rows[0]?.value as
        | {
            cashback?: {
              schedule?: 'daily' | 'weekly' | 'monthly' | 'yearly';
              payout_as?: 'bonus' | 'cash';
              min_loss?: number;
              pct?: number;
              max_cap?: number;
              vip_multipliers?: Record<string, number>;
            };
          }
        | null;
      const fallback = settings?.cashback ?? null;
      if (!fallback) {
        return { active: false };
      }
      return {
        active: true,
        source: 'bonus_settings',
        rule_id: null,
        rule_name: 'Cashback Rule',
        version: null,
        schedule: fallback.schedule ?? 'weekly',
        payout_as: fallback.payout_as ?? 'bonus',
        min_loss: fallback.min_loss ?? 0,
        pct: fallback.pct ?? 0,
        max_cap: fallback.max_cap ?? null,
        vip_multipliers: fallback.vip_multipliers ?? {},
      };
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/cashback-rules', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const tenantId = requireTenantId(req);
    const cfg = await loadEffectiveCashbackConfig(tenantId);
    const profile = await loadActiveCashbackProfile(tenantId);
    const toCard = (
      ruleKey: 'rule_one' | 'rule_two',
      label: string,
      slots: Array<[CashbackSlotKey, { enabled: boolean; min_legs: number; min_leg_odds: number; min_stake: number; max_cashback: number; tiers: Array<{ min_odds: number; max_odds: number | null; pct: number }> } | undefined]>
    ) => ({
      rule_key: ruleKey,
      label,
      is_active: cfg.active_rule === ruleKey,
      slots: slots
        .filter(([, slot]) => Boolean(slot))
        .map(([slotKey, slot]) => ({
          slot_key: slotKey,
          label:
            slotKey === 'loss_one'
              ? 'Cashback for Losses on One Game'
              : slotKey === 'loss_two'
                ? 'Cashback for Losses on Two Games'
                : 'Cashback for Losses on Three Games',
          enabled: slot!.enabled,
          min_selections: slot!.min_legs,
          min_odds_per_leg: slot!.min_leg_odds,
          min_stake: slot!.min_stake,
          max_cashback: slot!.max_cashback,
          tiers: slot!.tiers,
        })),
    });
    res.json({
      active_rule: cfg.active_rule,
      payout_as: cfg.payout_as,
      active_profile: profile,
      rules: [
        toCard('rule_one', 'Rule One', [
          ['loss_one', cfg.rule_one.loss_one],
          ['loss_two', cfg.rule_one.loss_two],
        ]),
        toCard('rule_two', 'Rule Two', [
          ['loss_one', cfg.rule_two.loss_one],
          ['loss_two', cfg.rule_two.loss_two],
          ['loss_three', cfg.rule_two.loss_three],
        ]),
      ],
    });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/cashback-test-tickets',
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    const cfg = await loadEffectiveCashbackConfig(tenantId);
    const stake = 100;
    const makeForRule = (
      ruleKey: 'rule_one' | 'rule_two',
      slots: Array<[CashbackSlotKey, { enabled: boolean; min_legs: number; min_leg_odds: number; min_stake: number; max_cashback: number; tiers: Array<{ min_odds: number; max_odds: number | null; pct: number }> } | undefined]>
    ) =>
      slots
        .filter(([, slot]) => Boolean(slot?.enabled))
        .map(([slotKey, slot]) => {
          const lossCount = slotKey === 'loss_one' ? 1 : slotKey === 'loss_two' ? 2 : 3;
          const legs = buildQualifiedLegs(slot!, lossCount);
          const verdict = computeLossCashback(stake, legs, { ...cfg, enabled: true, active_rule: ruleKey });
          return {
            id: `${ruleKey}-${slotKey}`,
            title: `${ruleKey === 'rule_one' ? 'Rule One' : 'Rule Two'} - ${slotKey.replace('_', ' ')}`,
            rule_key: ruleKey,
            slot_key: slotKey,
            stake,
            legs,
            expected: verdict,
          };
        });
    return {
      items: [
        ...makeForRule('rule_one', [
          ['loss_one', cfg.rule_one.loss_one],
          ['loss_two', cfg.rule_one.loss_two],
        ]),
        ...makeForRule('rule_two', [
          ['loss_one', cfg.rule_two.loss_one],
          ['loss_two', cfg.rule_two.loss_two],
          ['loss_three', cfg.rule_two.loss_three],
        ]),
      ],
    };
  })
);

const cashbackTestEvaluateSchema = z.object({
  rule_key: z.enum(['rule_one', 'rule_two']),
  stake: z.number().positive(),
  legs: z.array(
    z.object({
      status: z.string(),
      odds: z.number().positive(),
      is_live: z.boolean().default(false),
      is_virtual: z.boolean().default(false),
    })
  ).min(1),
});

router.post(
  '/cashback-test/evaluate',
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    const body = cashbackTestEvaluateSchema.parse(req.body ?? {});
    const cfg = await loadEffectiveCashbackConfig(tenantId);
    const verdict = computeLossCashback(body.stake, body.legs, {
      ...cfg,
      enabled: true,
      active_rule: body.rule_key,
    });
    return { verdict };
  })
);

export default router;
