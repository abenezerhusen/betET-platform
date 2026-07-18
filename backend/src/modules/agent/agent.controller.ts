import type { NextFunction, Request, Response } from 'express';

import {
  agentConfirmTransactionSchema,
  agentHeartbeatSchema,
  agentLoginSchema,
  agentRefreshSchema,
  agentSmsBatchSchema,
  agentSmsReportSchema,
  telebirrRefParamSchema,
} from './agent.dto';
import * as service from './agent.service';
import { getAgentScope, getIp, getUa } from './agent-shared';
import { BadRequestError } from '../../http/errors/http-error';
import { withTenantClient } from '../../infrastructure/db/tenant-client';

/* ------------------------------------------------------------------------- */
/* Auth                                                                      */
/* ------------------------------------------------------------------------- */

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const aliasedBody = req.body ?? {};
    const body = agentLoginSchema.parse(aliasedBody);
    const telebirrNumber = body.telebirrNumber ?? body.telebirr_phone;
    if (!telebirrNumber) {
      throw new BadRequestError('telebirr_phone is required');
    }
    const suppliedDeviceToken = body.device_token ?? null;
    const resolvedDeviceId =
      body.deviceId ??
      body.device_id ??
      body.device_token ??
      (suppliedDeviceToken
        ? (
            await withTenantClient(
              { tenantId: req.tenant?.id ?? null, bypassRls: true },
              async (client) => {
                const r = await client.query<{ id: string }>(
                  `SELECT id
                     FROM p2p_devices
                    WHERE device_token = $1
                      AND ($2::uuid IS NULL OR tenant_id = $2::uuid)
                    LIMIT 1`,
                  [suppliedDeviceToken, req.tenant?.id ?? null]
                );
                return r.rows[0]?.id ?? null;
              }
            )
          )
        : null);
    if (!resolvedDeviceId) {
      throw new BadRequestError('device_id or device_token is required');
    }
    const out = await service.login({
      telebirrNumber,
      password: body.password,
      deviceId: resolvedDeviceId,
      deviceName: body.deviceName ?? body.device_name ?? null,
      appVersion: body.appVersion ?? body.app_version ?? null,
      ip: getIp(req),
      userAgent: getUa(req),
      tenantHint: req.tenant?.id ?? null,
    });
    let responsePayload = {
      token: out.token,
      device_token: out.deviceToken,
      device_id: out.deviceRecordId ?? out.agentId,
      autostart: out.autostart,
      token_expires_at: out.tokenExpiresAt,
      agent_id: out.agentId,
      agent_name: out.agentName,
      telebirr_number: out.telebirrNumber,
      tenant: out.tenant,
      config: out.config,
    };
    // Prompt-2 compatibility: allow telebirr_phone style clients.
    if (!out.deviceToken && out.telebirrNumber) {
      await withTenantClient(
        { tenantId: req.tenant?.id ?? null, bypassRls: true },
        async (client) => {
          const match = await client.query<{
            id: string;
            device_token: string;
            autostart: boolean;
          }>(
            `SELECT id, device_token, autostart
               FROM p2p_devices
              WHERE telebirr_phone = $1
                AND ($2::uuid IS NULL OR tenant_id = $2::uuid)
              LIMIT 1`,
            [out.telebirrNumber, out.tenant.id]
          );
          if (match.rows[0]) {
            responsePayload = {
              token: out.token,
              device_token: match.rows[0].device_token,
              device_id: match.rows[0].id,
              autostart: match.rows[0].autostart,
              token_expires_at: out.tokenExpiresAt,
              agent_id: out.agentId,
              agent_name: out.agentName,
              telebirr_number: out.telebirrNumber,
              tenant: out.tenant,
              config: out.config,
            };
          }
        }
      );
    }
    res.json(responsePayload);
  } catch (err) {
    next(err);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = agentRefreshSchema.parse(req.body);
    const out = await service.refresh(body.token, getIp(req), getUa(req));
    res.json({ token: out.token, token_expires_at: out.tokenExpiresAt });
  } catch (err) {
    next(err);
  }
}

export async function heartbeat(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = agentHeartbeatSchema.parse(req.body);
    const scope = getAgentScope(req);
    if (body.agentId && body.agentId !== scope.id) {
      // Don't leak why; 400 with a generic message.
      throw new BadRequestError('agentId mismatch with token');
    }
    const out = await service.heartbeat(
      scope.id,
      scope.tenantId,
      body.appVersion ?? null,
      {
        batteryPct: body.battery_pct ?? body.deviceStatus?.battery_level,
        signalStrength: body.signal_strength,
        status: body.status,
      }
    );
    res.json({
      ok: out.ok,
      pendingRequests: out.pendingRequests,
      commands: out.commands,
      serverTime: out.serverTime,
    });
  } catch (err) {
    next(err);
  }
}

export async function heartbeatCompat(
  req: Request,
  res: Response,
  next: NextFunction
) {
  return heartbeat(req, res, next);
}

/* ------------------------------------------------------------------------- */
/* SMS                                                                       */
/* ------------------------------------------------------------------------- */

export async function reportSms(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = agentSmsReportSchema.parse(req.body);
    const scope = getAgentScope(req);
    const out = await service.reportSms(scope.id, scope.tenantId, {
      smsBody: body.smsBody,
      senderNumber: body.senderNumber ?? null,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : null,
      deviceTimestamp: body.deviceTimestamp
        ? new Date(body.deviceTimestamp)
        : null,
    });
    res.json({ received: out.received, smsId: out.smsId });
  } catch (err) {
    next(err);
  }
}

export async function reportSmsBatch(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = agentSmsBatchSchema.parse(req.body);
    const scope = getAgentScope(req);
    const out = await service.reportSmsBatch(
      scope.id,
      scope.tenantId,
      body.messages.map((m) => {
        if ('smsBody' in m) {
          return {
            smsBody: m.smsBody,
            senderNumber: m.senderNumber ?? null,
            receivedAt: m.receivedAt ? new Date(m.receivedAt) : null,
            deviceTimestamp: m.deviceTimestamp
              ? new Date(m.deviceTimestamp)
              : null,
            dedupHash: null,
          };
        }
        return {
          smsBody: m.body,
          senderNumber: m.sender ?? null,
          receivedAt: m.received_at ? new Date(m.received_at) : null,
          deviceTimestamp: null,
          dedupHash: m.dedup_hash ?? null,
        };
      })
    );
    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function updateCommandResult(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const scope = getAgentScope(req);
    const commandId = req.params.id;
    const payload = z
      .object({
        status: z.enum(['success', 'failed']),
        result: z.record(z.unknown()).optional(),
      })
      .parse(req.body ?? {});
    const outcome = await service.recordCommandResult(
      scope.id,
      scope.tenantId,
      commandId,
      payload.status,
      payload.result
    );
    res.json(outcome);
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------------- */
/* Status                                                                    */
/* ------------------------------------------------------------------------- */

export async function status(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = getAgentScope(req);
    const out = await service.getStatus(scope.id, scope.tenantId);
    res.json(out);
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------------- */
/* Transactions log                                                          */
/* ------------------------------------------------------------------------- */

import { z } from 'zod';

const transactionsQuerySchema = z.object({
  status: z
    .enum(['pending', 'matched', 'credited', 'duplicate', 'unmatched', 'disputed'])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * GET /api/agent/transactions
 *
 * Returns the paged list of telebirr transactions reported by THIS agent
 * device. The Flutter `M-info-app` polls this to render its on-device
 * transactions log. Tenant + agent are both pinned from the bearer token,
 * never trusted from the request body.
 */
export async function listTransactions(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const scope = getAgentScope(req);
    const query = transactionsQuerySchema.parse(req.query);
    const data = await withTenantClient(
      { tenantId: scope.tenantId, bypassRls: false, readOnly: true },
      async (client) => {
        const filters: string[] = [`agent_id = $1`];
        const values: unknown[] = [scope.id];
        let i = 2;
        if (query.status) {
          filters.push(`status = $${i++}`);
          values.push(query.status);
        }
        if (query.from) {
          filters.push(`created_at >= $${i++}`);
          values.push(query.from);
        }
        if (query.to) {
          filters.push(`created_at <= $${i++}`);
          values.push(query.to);
        }
        if (query.q) {
          filters.push(
            `(telebirr_ref ILIKE $${i} OR sender_phone ILIKE $${i} OR sender_name ILIKE $${i})`
          );
          values.push(`%${query.q}%`);
          i++;
        }
        const where = `WHERE ${filters.join(' AND ')}`;
        const total = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM telebirr_transactions ${where}`,
          values
        );
        const rows = await client.query(
          `SELECT id, tenant_id, agent_id, user_id, wallet_id, telebirr_ref,
                  sender_phone, sender_name, amount, currency, sms_body,
                  status, matched_at, credited_at, credit_transaction_id, created_at
             FROM telebirr_transactions ${where}
             ORDER BY created_at DESC
             LIMIT $${i++} OFFSET $${i++}`,
          [...values, query.limit, query.offset]
        );
        return { items: rows.rows, total: Number(total.rows[0]?.count ?? 0) };
      }
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------------- */
/* Manual confirm                                                            */
/* ------------------------------------------------------------------------- */

export async function confirmTransaction(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const params = telebirrRefParamSchema.parse(req.params);
    const body = agentConfirmTransactionSchema.parse(req.body);
    const scope = getAgentScope(req);
    const out = await service.confirmTransaction(
      scope.id,
      scope.tenantId,
      params.telebirrRef,
      body.userId,
      getIp(req),
      getUa(req)
    );
    res.json(out);
  } catch (err) {
    next(err);
  }
}
