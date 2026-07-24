/**
 * Admin Notifications Center — bulk broadcasts + system announcements.
 *
 * Endpoints (mounted at /api/admin/notifications-center):
 *   POST   /bulk            → create a broadcast campaign (queued)
 *   GET    /bulk            → list campaigns
 *   GET    /bulk/:id        → campaign detail + progress counts
 *   POST   /bulk/:id/cancel → cancel a queued/sending campaign
 *   POST   /system          → system announcement (category=system)
 *   GET    /logs            → delivery log (notification_logs)
 *
 * Campaigns are queue-based: recipients are materialized into
 * `bulk_notification_recipients` at creation time and dispatched by the
 * notification worker in batches, so the request returns immediately and
 * the design scales to large audiences. Delivery uses the tenant's active
 * provider (SMS / Telegram) via the central notification service.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { BadRequestError } from '../../../http/errors/http-error';

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

function ctx(req: Request): { tenantId: string; actorId: string | null } {
  const tenantId = req.user?.tenantId ?? req.tenant?.id ?? null;
  if (!tenantId) throw new BadRequestError('Tenant context required');
  return { tenantId, actorId: req.user?.id ?? null };
}

const audienceEnum = z.enum(['all', 'active', 'vip', 'selected']);
const channelEnum = z.enum(['sms', 'telegram', 'default']);

const createBulkSchema = z.object({
  title: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(2000),
  audience: audienceEnum.default('all'),
  user_ids: z.array(z.string().uuid()).max(100000).optional(),
  channel: channelEnum.default('default'),
  category: z.enum(['system', 'marketing']).default('marketing'),
  /** Optional fine-grained event key stored for the worker/logs. */
  event: z.string().trim().max(80).optional(),
});

const createSystemSchema = z.object({
  title: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(2000),
  audience: audienceEnum.default('all'),
  user_ids: z.array(z.string().uuid()).max(100000).optional(),
  channel: channelEnum.default('default'),
  event: z.string().trim().max(80).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().trim().max(40).optional(),
});

const logsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  channel: z.string().trim().max(40).optional(),
  status: z.string().trim().max(40).optional(),
  category: z.string().trim().max(40).optional(),
});

/** Resolve candidate recipients (id + phone) for an audience. */
async function resolveRecipients(
  client: import('pg').PoolClient,
  tenantId: string,
  audience: z.infer<typeof audienceEnum>,
  userIds: string[] | undefined
): Promise<Array<{ id: string; phone: string | null }>> {
  const base = `FROM users
    WHERE tenant_id = $1
      AND role IN ('user','affiliate')
      AND status = 'active'
      AND phone IS NOT NULL`;

  if (audience === 'selected') {
    if (!userIds || userIds.length === 0) {
      throw new BadRequestError('user_ids required for a selected audience');
    }
    const r = await client.query<{ id: string; phone: string | null }>(
      `SELECT id, phone ${base} AND id = ANY($2::uuid[])`,
      [tenantId, userIds]
    );
    return r.rows;
  }

  if (audience === 'active') {
    const r = await client.query<{ id: string; phone: string | null }>(
      `SELECT id, phone ${base} AND last_login_at >= now() - interval '30 days'`,
      [tenantId]
    );
    return r.rows;
  }

  if (audience === 'vip') {
    // VIP membership is read from users.metadata.is_vip (boolean). Tenants
    // that don't tag VIPs simply get an empty audience.
    const r = await client.query<{ id: string; phone: string | null }>(
      `SELECT id, phone ${base} AND COALESCE((metadata->>'is_vip')::boolean, false) = true`,
      [tenantId]
    );
    return r.rows;
  }

  const r = await client.query<{ id: string; phone: string | null }>(
    `SELECT id, phone ${base}`,
    [tenantId]
  );
  return r.rows;
}

async function createCampaign(
  req: Request,
  input: z.infer<typeof createBulkSchema>
) {
  const { tenantId, actorId } = ctx(req);
  return withTenantClient({ tenantId }, async (client) => {
    const recipients = await resolveRecipients(
      client,
      tenantId,
      input.audience,
      input.user_ids
    );

    const filter: Record<string, unknown> = {};
    if (input.audience === 'selected') filter.user_ids = input.user_ids ?? [];
    if (input.event) filter.event = input.event;

    const campaignRes = await client.query<{ id: string }>(
      `INSERT INTO bulk_notifications
         (tenant_id, title, message, audience, audience_filter, channel,
          category, status, total_recipients, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        tenantId,
        input.title ?? '',
        input.message,
        input.audience,
        JSON.stringify(filter),
        input.channel,
        input.category,
        recipients.length > 0 ? 'queued' : 'completed',
        recipients.length,
        actorId,
      ]
    );
    const bulkId = campaignRes.rows[0].id;

    // Materialize the queue. Batched multi-row insert keeps it fast for
    // large audiences.
    const BATCH = 500;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const slice = recipients.slice(i, i + BATCH);
      const values: string[] = [];
      const args: unknown[] = [tenantId, bulkId];
      let p = 3;
      for (const rcpt of slice) {
        values.push(`($1,$2,$${p++},$${p++})`);
        args.push(rcpt.id, rcpt.phone);
      }
      await client.query(
        `INSERT INTO bulk_notification_recipients
           (tenant_id, bulk_id, user_id, recipient)
         VALUES ${values.join(',')}`,
        args
      );
    }

    return {
      id: bulkId,
      audience: input.audience,
      channel: input.channel,
      category: input.category,
      total_recipients: recipients.length,
      status: recipients.length > 0 ? 'queued' : 'completed',
    };
  });
}

async function listCampaigns(
  req: Request,
  query: z.infer<typeof listQuerySchema>
) {
  const { tenantId } = ctx(req);
  const offset = (query.page - 1) * query.limit;
  return withTenantClient({ tenantId }, async (client) => {
    const where = ['tenant_id = $1'];
    const args: unknown[] = [tenantId];
    if (query.status) {
      args.push(query.status);
      where.push(`status = $${args.length}`);
    }
    const totalRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bulk_notifications WHERE ${where.join(' AND ')}`,
      args
    );
    args.push(query.limit, offset);
    const rows = await client.query(
      `SELECT id, title, message, audience, channel, category, status,
              total_recipients, sent_count, failed_count, created_at,
              started_at, completed_at
         FROM bulk_notifications
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args
    );
    return {
      items: rows.rows,
      page: query.page,
      limit: query.limit,
      total: Number(totalRes.rows[0]?.count ?? 0),
    };
  });
}

async function getCampaign(req: Request, id: string) {
  const { tenantId } = ctx(req);
  return withTenantClient({ tenantId }, async (client) => {
    const r = await client.query(
      `SELECT id, title, message, audience, audience_filter, channel, category,
              status, total_recipients, sent_count, failed_count, created_at,
              started_at, completed_at
         FROM bulk_notifications
        WHERE tenant_id = $1 AND id = $2
        LIMIT 1`,
      [tenantId, id]
    );
    if (!r.rows[0]) throw new BadRequestError('Campaign not found');
    return r.rows[0];
  });
}

async function cancelCampaign(req: Request, id: string) {
  const { tenantId } = ctx(req);
  return withTenantClient({ tenantId }, async (client) => {
    const r = await client.query<{ id: string }>(
      `UPDATE bulk_notifications
          SET status = 'cancelled'
        WHERE tenant_id = $1 AND id = $2
          AND status IN ('queued','sending')
        RETURNING id`,
      [tenantId, id]
    );
    if (!r.rows[0]) {
      throw new BadRequestError('Campaign not found or not cancellable');
    }
    await client.query(
      `UPDATE bulk_notification_recipients
          SET status = 'skipped'
        WHERE tenant_id = $1 AND bulk_id = $2 AND status = 'pending'`,
      [tenantId, id]
    );
    return { id, status: 'cancelled' };
  });
}

async function listLogs(req: Request, query: z.infer<typeof logsQuerySchema>) {
  const { tenantId } = ctx(req);
  const offset = (query.page - 1) * query.limit;
  return withTenantClient({ tenantId }, async (client) => {
    const where = ['tenant_id = $1'];
    const args: unknown[] = [tenantId];
    for (const [col, val] of [
      ['channel', query.channel],
      ['status', query.status],
      ['category', query.category],
    ] as const) {
      if (val) {
        args.push(val);
        where.push(`${col} = $${args.length}`);
      }
    }
    const totalRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notification_logs WHERE ${where.join(' AND ')}`,
      args
    );
    args.push(query.limit, offset);
    const rows = await client.query(
      `SELECT id, user_id, channel, provider, category, event_type, recipient,
              message, status, error, created_at, sent_at
         FROM notification_logs
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args
    );
    return {
      items: rows.rows,
      page: query.page,
      limit: query.limit,
      total: Number(totalRes.rows[0]?.count ?? 0),
    };
  });
}

const idParam = z.object({ id: z.string().uuid() });
const router = Router();

router.post('/bulk', wrapStatus(201, (req) => createCampaign(req, createBulkSchema.parse(req.body))));
router.get('/bulk', wrap((req) => listCampaigns(req, listQuerySchema.parse(req.query))));
router.get('/bulk/:id', wrap((req) => getCampaign(req, idParam.parse(req.params).id)));
router.post('/bulk/:id/cancel', wrap((req) => cancelCampaign(req, idParam.parse(req.params).id)));
router.post(
  '/system',
  wrapStatus(201, (req) => {
    const body = createSystemSchema.parse(req.body);
    return createCampaign(req, { ...body, category: 'system' });
  })
);
router.get('/logs', wrap((req) => listLogs(req, logsQuerySchema.parse(req.query))));

export default router;
