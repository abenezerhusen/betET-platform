import type { Request } from 'express';

import { NotFoundError } from '../../../http/errors/http-error';
import * as withdrawalService from '../../telebirr/telebirr.withdrawal.service';

import { getAdminScope, requireScopedTenantId } from '../admin-shared';
import type {
  AdminCancelWithdrawalInput,
  ListWithdrawalsQuery,
} from './withdrawals.dto';

export async function listWithdrawals(req: Request, query: ListWithdrawalsQuery) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  const offset = (query.page - 1) * query.limit;
  const result = await withdrawalService.listWithdrawals({
    tenantId,
    userId: query.user_id ?? null,
    status: query.status ?? null,
    cashierId: query.cashier_id ?? null,
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

export async function getWithdrawal(req: Request, id: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  const row = await withdrawalService.getWithdrawal({ tenantId, requestId: id });
  if (!row) throw new NotFoundError('Withdrawal request not found');
  return {
    id: row.id,
    user_id: row.user_id,
    cashier_id: row.cashier_id,
    amount: row.amount,
    currency: row.currency,
    telebirr_number: row.telebirr_number,
    account_name: row.account_name,
    telebirr_ref: row.telebirr_ref,
    status: row.status,
    notes: row.notes,
    debit_transaction_id: row.debit_transaction_id,
    reversal_transaction_id: row.reversal_transaction_id,
    requested_at: row.requested_at.toISOString(),
    processed_at: row.processed_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

export async function adminCancel(
  req: Request,
  id: string,
  body: AdminCancelWithdrawalInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withdrawalService.adminCancelWithdrawal({
    tenantId,
    actorId: scope.actorId,
    requestId: id,
    reason: body.reason,
  });
}
