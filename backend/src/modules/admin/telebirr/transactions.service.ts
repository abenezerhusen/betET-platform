import type { Request } from 'express';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import * as telebirrRepo from '../../telebirr/telebirr.repository';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

import type {
  DisputeTransactionInput,
  ListAdminTransactionsQuery,
  ListRawSmsQuery,
} from './admin.telebirr.dto';

/* ------------------------------------------------------------------------- */
/* Transactions list                                                         */
/* ------------------------------------------------------------------------- */

export async function listTransactions(
  req: Request,
  params: ListAdminTransactionsQuery
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      telebirrRepo.listTelebirrTransactions(client, {
        tenantId,
        status: params.status ?? null,
        agentId: params.agent_id ?? null,
        userId: params.user_id ?? null,
        from: params.from ?? null,
        to: params.to ?? null,
        search: params.search ?? null,
        limit: params.limit,
        offset,
      })
  );

  return {
    items: data.rows,
    total: data.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.total / params.limit)),
  };
}

/* ------------------------------------------------------------------------- */
/* Raw SMS log                                                               */
/* ------------------------------------------------------------------------- */

export async function listRawSms(req: Request, params: ListRawSmsQuery) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      telebirrRepo.listRawSms(client, {
        tenantId,
        agentId: params.agent_id ?? null,
        processed:
          typeof params.processed === 'boolean' ? params.processed : null,
        from: params.from ?? null,
        to: params.to ?? null,
        search: params.search ?? null,
        limit: params.limit,
        offset,
      })
  );

  return {
    items: data.rows,
    total: data.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.total / params.limit)),
  };
}

/* ------------------------------------------------------------------------- */
/* Dispute                                                                   */
/* ------------------------------------------------------------------------- */

export async function disputeTransaction(
  req: Request,
  id: string,
  body: DisputeTransactionInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const out = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await telebirrRepo.findTelebirrTxByIdInTenant(
        client,
        tenantId,
        id
      );
      if (!existing) throw new NotFoundError('Telebirr transaction not found');
      // Pretty much any state can be moved to `disputed` for
      // investigation, EXCEPT a row that is already disputed (idempotent
      // no-op surfaced as 400 to avoid silently swallowing the call).
      if (existing.status === 'disputed') {
        throw new BadRequestError('Transaction is already disputed', {
          reason: 'already_disputed',
        });
      }
      const updated = await telebirrRepo.setTelebirrTxStatus(
        client,
        id,
        'disputed'
      );
      if (!updated) throw new NotFoundError('Telebirr transaction not found');
      return { existing, updated };
    }
  );

  // Dispute reason lives in audit_logs.payload — we deliberately don't
  // add a column to telebirr_transactions yet (see migration notes).
  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.transaction.dispute',
      resource: 'telebirr_transaction',
      resourceId: id,
      payload: {
        reason: body.reason,
        previous_status: out.existing.status,
        amount: out.existing.amount,
        telebirr_ref: out.existing.telebirr_ref,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return {
    id,
    previous_status: out.existing.status,
    status: out.updated.status,
    reason: body.reason,
  };
}
