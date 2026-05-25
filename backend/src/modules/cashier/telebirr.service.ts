import type { Request } from 'express';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import {
  confirmManualMatch,
  loadTelebirrSettings,
  voidCreditedTransaction,
} from '../telebirr';
import * as telebirrRepo from '../telebirr/telebirr.repository';

import { getCashierScope, getIp, getUa } from './cashier-shared';
import type {
  ListTransactionsQuery,
  ListUnmatchedQuery,
  MatchTransactionInput,
  VoidTransactionInput,
} from './telebirr.dto';

/* ------------------------------------------------------------------------- */
/* Unmatched list                                                            */
/* ------------------------------------------------------------------------- */

export async function listUnmatched(req: Request, query: ListUnmatchedQuery) {
  const scope = getCashierScope(req);
  const offset = (query.page - 1) * query.limit;

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      telebirrRepo.listTelebirrTransactions(client, {
        tenantId: scope.tenantId,
        status: 'unmatched',
        agentId: query.agent_id ?? null,
        userId: null,
        from: null,
        to: null,
        search: query.search ?? null,
        limit: query.limit,
        offset,
      })
  );

  return paginate(result, query.page, query.limit);
}

/* ------------------------------------------------------------------------- */
/* Transactions list                                                         */
/* ------------------------------------------------------------------------- */

export async function listTransactions(
  req: Request,
  query: ListTransactionsQuery
) {
  const scope = getCashierScope(req);
  const offset = (query.page - 1) * query.limit;

  // Default the listing to "today" so the cashier dashboard stays
  // performant on tables that grow indefinitely. Callers can widen
  // with explicit from/to params.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = query.from ?? today;
  const to = query.to ?? null;

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      telebirrRepo.listTelebirrTransactions(client, {
        tenantId: scope.tenantId,
        status: query.status ?? null,
        agentId: query.agent_id ?? null,
        userId: query.user_id ?? null,
        from,
        to,
        search: query.search ?? null,
        limit: query.limit,
        offset,
      })
  );

  return paginate(result, query.page, query.limit);
}

/* ------------------------------------------------------------------------- */
/* Match (manual)                                                            */
/* ------------------------------------------------------------------------- */

export async function matchTransaction(
  req: Request,
  transactionId: string,
  body: MatchTransactionInput
) {
  const scope = getCashierScope(req);

  // Resolve the row inside the cashier's tenant first; this also
  // guarantees they cannot manipulate rows belonging to a different
  // tenant via a guessed UUID (RLS enforces it; we surface a precise
  // 404 instead of an opaque empty result).
  const tx = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) =>
      telebirrRepo.findTelebirrTxByIdInTenant(
        client,
        scope.tenantId,
        transactionId
      )
  );
  if (!tx) throw new NotFoundError('Telebirr transaction not found');

  if (
    tx.status !== 'pending' &&
    tx.status !== 'unmatched'
  ) {
    throw new BadRequestError(
      `Cannot match a transaction in status ${tx.status}`,
      { reason: 'invalid_status_for_match', status: tx.status }
    );
  }

  // Verify the target user belongs to this tenant.
  await assertUserBelongsToTenant(scope.tenantId, body.user_id);

  // PIN verification is intentionally a no-op for now (see DTO).
  void body.pin;

  const result = await confirmManualMatch(
    scope.tenantId,
    tx.telebirr_ref,
    body.user_id,
    {
      actorType: 'cashier',
      actorId: scope.cashierId,
      ip: getIp(req),
      userAgent: getUa(req),
    }
  );

  if (result.outcome === 'rejected') {
    throw new BadRequestError(result.reason, {
      reason: 'manual_match_rejected',
    });
  }
  if (result.outcome === 'duplicate') {
    return {
      outcome: result.outcome,
      reason: result.reason,
      telebirr_transaction_id: result.telebirrTransactionId,
      credit_transaction_id: result.creditTransactionId,
      user_id: result.matchedUserId,
    };
  }
  return {
    outcome: result.outcome,
    reason: result.reason,
    telebirr_transaction_id: result.telebirrTransactionId,
    credit_transaction_id: result.creditTransactionId,
    user_id: result.matchedUserId,
  };
}

/* ------------------------------------------------------------------------- */
/* Void                                                                      */
/* ------------------------------------------------------------------------- */

export async function voidTransaction(
  req: Request,
  transactionId: string,
  body: VoidTransactionInput
) {
  const scope = getCashierScope(req);

  const { tx, threshold } = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const row = await telebirrRepo.findTelebirrTxByIdInTenant(
        client,
        scope.tenantId,
        transactionId
      );
      if (!row) throw new NotFoundError('Telebirr transaction not found');
      if (row.status !== 'credited') {
        throw new BadRequestError(
          `Cannot void a transaction in status ${row.status}`,
          { reason: 'not_credited', status: row.status }
        );
      }
      const settings = await loadTelebirrSettings(client, scope.tenantId);
      return { tx: row, threshold: settings.void_admin_approval_threshold };
    }
  );

  if (Number(tx.amount) > threshold && !body.admin_approval_token) {
    throw new BadRequestError(
      `Voids over ETB ${threshold} require admin approval`,
      {
        reason: 'admin_approval_required',
        threshold,
        amount: tx.amount,
      }
    );
  }

  // PIN verification is intentionally a no-op for now (see DTO).
  void body.pin;

  const result = await voidCreditedTransaction(scope.tenantId, tx.id, {
    actorType: 'cashier',
    actorId: scope.cashierId,
    reason: body.reason,
    ip: getIp(req),
    userAgent: getUa(req),
  });
  if (result.outcome === 'rejected') {
    throw new BadRequestError(result.reason, { reason: 'void_rejected' });
  }
  return {
    outcome: result.outcome,
    telebirr_transaction_id: result.telebirrTransactionId,
    reversal_transaction_id: result.reversalTransactionId,
    affected_user_id: result.affectedUserId,
  };
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

async function assertUserBelongsToTenant(
  tenantId: string,
  userId: string
): Promise<void> {
  const row = await withTenantClient(
    { tenantId },
    async (client) => {
      const r = await client.query<{ id: string; status: string; role: string }>(
        `SELECT id, status, role FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      return r.rows[0] ?? null;
    }
  );
  if (!row) throw new NotFoundError('Target user not found in this tenant');
  if (row.status !== 'active') {
    throw new BadRequestError(`Target user is ${row.status}`, {
      reason: 'user_not_active',
      status: row.status,
    });
  }
  if (row.role !== 'user' && row.role !== 'affiliate') {
    throw new ForbiddenError(
      'Telebirr deposits can only be matched to customer accounts',
      { reason: 'invalid_target_role', role: row.role }
    );
  }
}

function paginate<T>(
  result: { rows: T[]; total: number },
  page: number,
  limit: number
) {
  return {
    items: result.rows,
    total: result.total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(result.total / limit)),
  };
}
