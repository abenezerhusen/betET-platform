import type { Request } from 'express';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import {
  initiateTelebirrDeposit,
  getTelebirrDepositStatus,
} from '../telebirr/telebirr.deposit-flow';
import { confirmManualMatch } from '../telebirr/telebirr.matching.service';
import * as telebirrRepo from '../telebirr/telebirr.repository';

import { getIp, getUa, getUserScope } from './user-shared';
import type {
  DepositHistoryQuery,
  InitiateDepositInput,
} from './deposits-telebirr.dto';

/* ------------------------------------------------------------------------- */
/* Initiate                                                                  */
/* ------------------------------------------------------------------------- */

export interface InitiateDepositResult {
  request_id: string;
  reference_code: string;
  telebirr_number: string;
  agent_name: string;
  amount: string;
  currency: 'ETB';
  expires_at: string;
  instructions: string;
  /**
   * True when the user supplied a Telebirr reference AND the matching SMS had
   * already been received, so the deposit was credited immediately.
   */
  confirmed: boolean;
}

export async function initiateDeposit(
  req: Request,
  body: InitiateDepositInput
): Promise<InitiateDepositResult> {
  const scope = getUserScope(req);
  const ip = getIp(req);
  const ua = getUa(req);

  const out = await initiateTelebirrDeposit({
    tenantId: scope.tenantId,
    userId: scope.userId,
    amount: body.amount,
    claimedTelebirrRef: body.telebirr_reference ?? null,
    screenshotUrl: body.screenshot_url ?? null,
    ip,
    userAgent: ua,
  });

  // If the user gave a real Telebirr reference, the agent SMS may already
  // have arrived and been stored uncredited. Reconcile immediately so the
  // deposit confirms without waiting for the next SMS batch. If the SMS has
  // NOT arrived yet, this is a no-op and the matcher's Strategy 0 will
  // confirm the request when the SMS is reported.
  let confirmed = false;
  if (body.telebirr_reference) {
    try {
      const credit = await confirmManualMatch(
        scope.tenantId,
        body.telebirr_reference,
        scope.userId,
        { actorType: 'user', actorId: scope.userId, ip, userAgent: ua }
      );
      if (credit.outcome === 'credited') {
        confirmed = true;
        await withTenantClient({ tenantId: scope.tenantId }, (client) =>
          telebirrRepo.markDepositRequestConfirmed(
            client,
            out.request_id,
            credit.telebirrTransactionId
          )
        );
      }
    } catch {
      // Reconciliation is best-effort; the async matcher remains the
      // authoritative path if this immediate attempt fails.
    }
  }

  await tryAudit(
    {
      tenantId: scope.tenantId,
      actorId: scope.userId,
      actorType: 'user',
      action: 'user.telebirr.deposit.initiate',
      resource: 'telebirr_deposit_request',
      resourceId: out.request_id,
      payload: {
        amount: out.amount,
        reference_code: out.reference_code,
        telebirr_number: out.telebirr_number,
        agent_id: out.agent_id,
        expires_at: out.expires_at,
      },
      ip,
      userAgent: ua,
      status: 'success',
    },
    { bypassRls: true }
  );

  return {
    request_id: out.request_id,
    reference_code: out.reference_code,
    telebirr_number: out.telebirr_number,
    agent_name: out.agent_name,
    amount: out.amount,
    currency: out.currency,
    expires_at: out.expires_at,
    instructions: out.instructions,
    confirmed,
  };
}

/* ------------------------------------------------------------------------- */
/* Status                                                                    */
/* ------------------------------------------------------------------------- */

export interface DepositStatusResult {
  request_id: string;
  status: 'waiting' | 'confirmed' | 'expired' | 'cancelled';
  amount: string;
  reference_code: string;
  telebirr_number: string;
  expires_at: string;
  credited_amount: string | null;
  telebirr_ref: string | null;
  matched_transaction_id: string | null;
  /** Server-side seconds until expiry; negative when already past expires_at. */
  seconds_until_expiry: number;
}

export async function getDepositStatus(
  req: Request,
  requestId: string
): Promise<DepositStatusResult> {
  const scope = getUserScope(req);

  const status = await getTelebirrDepositStatus({
    tenantId: scope.tenantId,
    requestId,
    expectUserId: scope.userId,
  });
  if (!status) throw new NotFoundError('Deposit request not found');

  return {
    request_id: status.request_id,
    status: status.status,
    amount: status.amount,
    reference_code: status.reference_code,
    telebirr_number: status.telebirr_number,
    expires_at: status.expires_at,
    credited_amount: status.credited_amount,
    telebirr_ref: status.telebirr_ref,
    matched_transaction_id: status.matched_transaction_id,
    seconds_until_expiry: status.seconds_until_expiry,
  };
}

/* ------------------------------------------------------------------------- */
/* Cancel                                                                    */
/* ------------------------------------------------------------------------- */

export async function cancelDeposit(
  req: Request,
  requestId: string
): Promise<{ request_id: string; status: 'cancelled' }> {
  const scope = getUserScope(req);

  const cancelled = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      // Confirm ownership before mutating, so we can return a precise
      // 404/409 rather than the silent no-op the UPDATE would yield.
      const existing = await telebirrRepo.findDepositRequestById(
        client,
        scope.tenantId,
        requestId
      );
      if (!existing) throw new NotFoundError('Deposit request not found');
      if (existing.user_id !== scope.userId) {
        throw new ForbiddenError('Cannot cancel another user\'s request');
      }
      if (existing.status !== 'waiting') {
        throw new BadRequestError(
          `Cannot cancel a request in status ${existing.status}`,
          { reason: 'not_cancellable', status: existing.status }
        );
      }
      const out = await telebirrRepo.cancelDepositRequest(
        client,
        scope.tenantId,
        scope.userId,
        requestId
      );
      if (!out) {
        // Race: someone else (a sweep, expiry, match) flipped status
        // between our read and update.
        throw new BadRequestError('Request is no longer cancellable', {
          reason: 'state_changed',
        });
      }
      return out;
    }
  );

  await tryAudit(
    {
      tenantId: scope.tenantId,
      actorId: scope.userId,
      actorType: 'user',
      action: 'user.telebirr.deposit.cancel',
      resource: 'telebirr_deposit_request',
      resourceId: cancelled.id,
      payload: {
        amount: cancelled.amount,
        reference_code: cancelled.reference_code,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { request_id: cancelled.id, status: 'cancelled' };
}

/* ------------------------------------------------------------------------- */
/* History                                                                   */
/* ------------------------------------------------------------------------- */

export async function getDepositHistory(
  req: Request,
  query: DepositHistoryQuery
) {
  const scope = getUserScope(req);
  const offset = (query.page - 1) * query.limit;

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      telebirrRepo.listUserDepositRequests(client, scope.tenantId, scope.userId, {
        limit: query.limit,
        offset,
      })
  );

  return {
    items: result.rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      reference_code: r.reference_code,
      telebirr_number: r.telebirr_number,
      status: r.status,
      expires_at: r.expires_at.toISOString(),
      matched_transaction_id: r.matched_transaction_id,
      created_at: r.created_at.toISOString(),
    })),
    total: result.total,
    page: query.page,
    limit: query.limit,
    pages: Math.max(1, Math.ceil(result.total / query.limit)),
  };
}
