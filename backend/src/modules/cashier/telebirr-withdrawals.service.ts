import type { Request } from 'express';

import * as withdrawalService from '../telebirr/telebirr.withdrawal.service';

import { getCashierScope } from './cashier-shared';
import type {
  CompleteWithdrawalInput,
  ListPendingQuery,
  RejectWithdrawalInput,
} from './telebirr-withdrawals.dto';

export async function listPending(req: Request, query: ListPendingQuery) {
  const scope = getCashierScope(req);
  const offset = (query.page - 1) * query.limit;
  const result = await withdrawalService.listWithdrawals({
    tenantId: scope.tenantId,
    userId: null,
    status: query.status ?? 'pending',
    cashierId: query.mine ? scope.cashierId : null,
    from: query.from ?? null,
    to: query.to ?? null,
    search: query.search ?? null,
    limit: query.limit,
    offset,
  });
  return {
    items: result.rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      user_email: row.user_email,
      user_phone: row.user_phone,
      cashier_id: row.cashier_id,
      cashier_email: row.cashier_email,
      amount: row.amount,
      currency: row.currency,
      telebirr_number: row.telebirr_number,
      account_name: row.account_name,
      telebirr_ref: row.telebirr_ref,
      status: row.status,
      notes: row.notes,
      requested_at: row.requested_at.toISOString(),
      processed_at: row.processed_at?.toISOString() ?? null,
      completed_at: row.completed_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
    })),
    total: result.total,
    page: query.page,
    limit: query.limit,
    pages: Math.max(1, Math.ceil(result.total / query.limit)),
  };
}

export async function claim(req: Request, requestId: string) {
  const scope = getCashierScope(req);
  return withdrawalService.claimWithdrawalAsCashier({
    tenantId: scope.tenantId,
    cashierId: scope.cashierId,
    requestId,
  });
}

export async function complete(
  req: Request,
  requestId: string,
  body: CompleteWithdrawalInput
) {
  const scope = getCashierScope(req);
  return withdrawalService.completeWithdrawalAsCashier({
    tenantId: scope.tenantId,
    cashierId: scope.cashierId,
    requestId,
    telebirrRef: body.telebirr_ref,
    notes: body.notes ?? null,
  });
}

export async function reject(
  req: Request,
  requestId: string,
  body: RejectWithdrawalInput
) {
  const scope = getCashierScope(req);
  return withdrawalService.rejectWithdrawalAsCashier({
    tenantId: scope.tenantId,
    cashierId: scope.cashierId,
    requestId,
    reason: body.reason,
  });
}
