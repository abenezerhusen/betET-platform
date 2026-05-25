import type { Request } from 'express';

import { NotFoundError } from '../../http/errors/http-error';
import * as withdrawalService from '../telebirr/telebirr.withdrawal.service';

import { getIp, getUa, getUserScope } from './user-shared';
import type {
  InitiateWithdrawalInput,
  WithdrawalHistoryQuery,
} from './withdrawals-telebirr.dto';

export async function initiate(
  req: Request,
  body: InitiateWithdrawalInput
) {
  const scope = getUserScope(req);
  return withdrawalService.initiateWithdrawal({
    tenantId: scope.tenantId,
    userId: scope.userId,
    amount: body.amount,
    currency: 'ETB',
    telebirrNumber: body.telebirr_number,
    accountName: body.account_name,
    ip: getIp(req),
    userAgent: getUa(req),
  });
}

export async function getStatus(req: Request, requestId: string) {
  const scope = getUserScope(req);
  const row = await withdrawalService.getWithdrawal({
    tenantId: scope.tenantId,
    requestId,
    userId: scope.userId,
  });
  if (!row) throw new NotFoundError('Withdrawal request not found');
  return {
    request_id: row.id,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    telebirr_number: row.telebirr_number,
    account_name: row.account_name,
    telebirr_ref: row.telebirr_ref,
    created_at: row.created_at.toISOString(),
    processed_at: row.processed_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
  };
}

export async function cancel(req: Request, requestId: string) {
  const scope = getUserScope(req);
  return withdrawalService.cancelWithdrawalAsUser({
    tenantId: scope.tenantId,
    userId: scope.userId,
    requestId,
    ip: getIp(req),
    userAgent: getUa(req),
  });
}

export async function history(req: Request, query: WithdrawalHistoryQuery) {
  const scope = getUserScope(req);
  const offset = (query.page - 1) * query.limit;
  const result = await withdrawalService.listWithdrawals({
    tenantId: scope.tenantId,
    userId: scope.userId,
    status: query.status ?? null,
    cashierId: null,
    from: null,
    to: null,
    search: null,
    limit: query.limit,
    offset,
  });
  return {
    items: result.rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      currency: row.currency,
      telebirr_number: row.telebirr_number,
      account_name: row.account_name,
      telebirr_ref: row.telebirr_ref,
      status: row.status,
      created_at: row.created_at.toISOString(),
      processed_at: row.processed_at?.toISOString() ?? null,
      completed_at: row.completed_at?.toISOString() ?? null,
    })),
    total: result.total,
    page: query.page,
    limit: query.limit,
    pages: Math.max(1, Math.ceil(result.total / query.limit)),
  };
}
