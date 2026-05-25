import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import * as service from './bonuses.service';
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
const DEFAULT_BONUS_SETTINGS = {
  global_enabled: true,
  default_wagering_multiplier: 5,
  default_expiry_days: 7,
  default_min_odds: 1.5,
  cashback: { schedule: 'weekly', payout_as: 'bonus' },
  deposit_match: { stack_with_promo: false },
};

const bonusSettingsSchema = z.object({
  global_enabled: z.boolean().default(true),
  default_wagering_multiplier: z.number().nonnegative().default(5),
  default_expiry_days: z.number().int().nonnegative().default(7),
  default_min_odds: z.number().nonnegative().default(1.5),
  cashback: z
    .object({
      schedule: z.enum(['weekly', 'monthly']).default('weekly'),
      payout_as: z.enum(['bonus', 'cash']).default('bonus'),
      min_loss: z.number().nonnegative().default(100),
      pct: z.number().min(0).max(100).default(10),
    })
    .default({}),
  deposit_match: z
    .object({
      stack_with_promo: z.boolean().default(false),
    })
    .default({}),
});

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
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = bonusSettingsSchema.parse(req.body);
    await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        await client.query(
          `INSERT INTO settings (tenant_id, key, value)
             VALUES ($1,$2,$3::jsonb)
           ON CONFLICT (tenant_id, key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = now()`,
          [tenantId, BONUS_SETTINGS_KEY, JSON.stringify(body)]
        );
      }
    );
    void tryAudit(
      {
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.bonus.settings.update',
        resource: 'settings',
        resourceId: BONUS_SETTINGS_KEY,
        payload: { value: body },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );
    res.json(body);
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
