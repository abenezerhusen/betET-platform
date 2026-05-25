import type { Request } from 'express';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import * as disputesRepo from '../telebirr/telebirr.disputes.repository';

import { getIp, getUa, getUserScope } from './user-shared';
import type {
  ListMyDisputesQuery,
  SubmitDisputeInput,
} from './disputes-telebirr.dto';

/**
 * Soft cap on how many open disputes a single user can have at once.
 * Stops a malicious or confused user from spamming the dispute queue
 * while still letting them re-submit if a previous dispute was
 * rejected.
 */
const MAX_OPEN_DISPUTES_PER_USER = 5;

export async function submitDispute(
  req: Request,
  body: SubmitDisputeInput
) {
  const scope = getUserScope(req);

  const dispute = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      // Enforce the soft cap.
      const open = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM telebirr_disputes
          WHERE tenant_id = $1
            AND user_id = $2
            AND status IN ('open', 'investigating')`,
        [scope.tenantId, scope.userId]
      );
      if ((open.rows[0]?.count ?? 0) >= MAX_OPEN_DISPUTES_PER_USER) {
        throw new BadRequestError(
          'You already have several open Telebirr disputes. Please wait for them to be reviewed.',
          { reason: 'too_many_open_disputes', max: MAX_OPEN_DISPUTES_PER_USER }
        );
      }

      return disputesRepo.insertDispute(client, {
        tenantId: scope.tenantId,
        userId: scope.userId,
        amount: body.amount,
        currency: 'ETB',
        claimedTelebirrRef: body.claimed_telebirr_ref ?? null,
        senderTelebirrNumber: body.sender_telebirr_number,
        paidAt: body.paid_at ?? null,
        screenshotUrl: body.screenshot_url ?? null,
        description: body.description ?? null,
      });
    }
  );

  await tryAudit(
    {
      tenantId: scope.tenantId,
      actorId: scope.userId,
      actorType: 'user',
      action: 'user.telebirr.dispute.submit',
      resource: 'telebirr_dispute',
      resourceId: dispute.id,
      payload: {
        amount: dispute.amount,
        sender_telebirr_number: dispute.sender_telebirr_number,
        claimed_telebirr_ref: dispute.claimed_telebirr_ref,
        paid_at: dispute.paid_at?.toISOString() ?? null,
        has_screenshot: Boolean(dispute.screenshot_url),
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return formatDispute(dispute);
}

export async function listMyDisputes(
  req: Request,
  query: ListMyDisputesQuery
) {
  const scope = getUserScope(req);
  const offset = (query.page - 1) * query.limit;

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      disputesRepo.listDisputes(client, {
        tenantId: scope.tenantId,
        userId: scope.userId,
        status: query.status ?? null,
        search: null,
        from: null,
        to: null,
        limit: query.limit,
        offset,
      })
  );

  return {
    items: result.rows.map(formatDispute),
    total: result.total,
    page: query.page,
    limit: query.limit,
    pages: Math.max(1, Math.ceil(result.total / query.limit)),
  };
}

export async function getMyDispute(req: Request, id: string) {
  const scope = getUserScope(req);
  const dispute = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => disputesRepo.findDisputeById(client, scope.tenantId, id)
  );
  if (!dispute || dispute.user_id !== scope.userId) {
    throw new NotFoundError('Dispute not found');
  }
  return formatDispute(dispute);
}

export async function cancelMyDispute(req: Request, id: string) {
  const scope = getUserScope(req);
  const cancelled = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const existing = await disputesRepo.findDisputeById(
        client,
        scope.tenantId,
        id
      );
      if (!existing || existing.user_id !== scope.userId) {
        throw new NotFoundError('Dispute not found');
      }
      // Once an admin starts investigating we no longer let the user
      // self-cancel — preserving the trail for the admin's response.
      if (existing.status !== 'open') {
        throw new BadRequestError(
          `Cannot cancel a dispute in status ${existing.status}`,
          { reason: 'not_cancellable', status: existing.status }
        );
      }
      const updated = await disputesRepo.setDisputeStatus(client, {
        id,
        status: 'cancelled',
        resolvedBy: null,
        resolvedTelebirrTxId: null,
        resolutionNotes: null,
      });
      return updated;
    }
  );
  if (!cancelled) throw new NotFoundError('Dispute not found');
  await tryAudit(
    {
      tenantId: scope.tenantId,
      actorId: scope.userId,
      actorType: 'user',
      action: 'user.telebirr.dispute.cancel',
      resource: 'telebirr_dispute',
      resourceId: id,
      payload: {},
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );
  return formatDispute(cancelled);
}

function formatDispute(d: disputesRepo.TelebirrDisputeRow) {
  return {
    id: d.id,
    amount: d.amount,
    currency: d.currency,
    sender_telebirr_number: d.sender_telebirr_number,
    claimed_telebirr_ref: d.claimed_telebirr_ref,
    paid_at: d.paid_at?.toISOString() ?? null,
    screenshot_url: d.screenshot_url,
    description: d.description,
    status: d.status,
    resolved_at: d.resolved_at?.toISOString() ?? null,
    resolution_notes: d.resolution_notes,
    created_at: d.created_at.toISOString(),
    updated_at: d.updated_at.toISOString(),
  };
}
