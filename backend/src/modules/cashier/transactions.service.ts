import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { NotFoundError } from '../../http/errors/http-error';
import { getCashierScope } from './cashier-shared';
import * as repo from './cashier.repository';
import type { CashierTransactionsQuery } from './cashier.dto';

export async function listOwnTransactions(
  req: Request,
  params: CashierTransactionsQuery
) {
  const scope = getCashierScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      repo.listCashierTransactionsForCashier(
        client,
        scope.tenantId,
        scope.cashierId,
        {
          type: params.type ?? null,
          status: params.status ?? null,
          shiftId: params.shift_id ?? null,
          from: params.from ?? null,
          to: params.to ?? null,
          limit: params.limit,
          offset,
        }
      )
  );

  return {
    items: data.rows,
    total: data.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.total / params.limit)),
  };
}

export async function getReceipt(req: Request, ticketId: string) {
  const scope = getCashierScope(req);

  const row = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      repo.findCashierTransactionById(
        client,
        scope.tenantId,
        scope.cashierId,
        ticketId
      )
  );

  if (!row) throw new NotFoundError('Ticket not found');

  const branchId =
    row.branch_id ??
    ((row.metadata as { branch_id?: string } | null)?.branch_id ?? null) ??
    'N/A';
  const cashierName = row.cashier_id;
  const ticketType =
    row.type === 'deposit' || row.type === 'withdrawal' ? row.type : 'bet';
  const amount = Number(row.amount || 0);
  const status = row.status;
  const betBy = row.user_username ?? row.user_full_name ?? row.user_phone ?? row.user_email ?? null;

  return {
    receipt_id: row.id,
    branch_id: branchId,
    cashier_name: cashierName,
    ticket_type: ticketType,
    items: [
      {
        description: `${row.type.toUpperCase()} (${status})`,
        amount: amount.toFixed(2),
      },
    ],
    total: amount.toFixed(2),
    currency: row.currency,
    timestamp: row.created_at,
    barcode_data: row.reference ?? row.id,
    qr_data: JSON.stringify({
      receipt_id: row.id,
      tenant_id: row.tenant_id,
      type: row.type,
      amount: amount.toFixed(2),
      currency: row.currency,
      user_id: row.user_id,
      at: row.created_at,
    }),
    meta: {
      user_username: row.user_username,
      user_full_name: row.user_full_name,
      bet_by: betBy,
      user_phone: row.user_phone,
      user_email: row.user_email,
      notes: row.notes,
      reference: row.reference,
      status,
    },
  };
}
