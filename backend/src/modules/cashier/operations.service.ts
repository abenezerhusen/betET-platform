import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import {
  getCashierScope,
  getIdempotencyKey,
  getIp,
  getUa,
} from './cashier-shared';
import * as repo from './cashier.repository';
import type { DepositInput, WithdrawalInput } from './cashier.dto';
import {
  sendEmailBestEffort,
  sendSmsBestEffort,
} from '../notifications/notifications.service';

/**
 * Resolve the target user id from whatever combination of identifiers
 * the cashier panel submitted: `user_id` (legacy), `phone` (Section 16
 * spec), or `email`. We perform a tenant-scoped lookup so a cashier in
 * one tenant can never reach a customer in another.
 */
async function resolveTargetUserId(
  client: import('pg').PoolClient,
  tenantId: string,
  body: Pick<DepositInput, 'user_id' | 'phone' | 'email'>
): Promise<string> {
  if (body.user_id) return body.user_id;
  const ident = body.phone?.trim() || body.email?.trim()?.toLowerCase() || '';
  if (!ident) {
    throw new BadRequestError(
      'One of user_id, phone, or email is required',
      { reason: 'missing_user_identifier' }
    );
  }
  const rows = await repo.searchUsers(client, tenantId, {
    query: null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    userId: null,
    limit: 1,
  });
  if (!rows[0]) {
    throw new NotFoundError(`No user matches '${ident}'`);
  }
  return rows[0].id;
}

interface OperationResult {
  wallet: repo.WalletRow;
  transaction: repo.TransactionRow;
  cashier_transaction: repo.CashierTransactionRow;
  idempotent: boolean;
  shift_id: string;
  user_id: string;
}

/**
 * Validate that the target user is in the cashier's tenant and active. The
 * cashier may only operate on real users in their own tenant.
 */
function ensureUserOperable(user: repo.UserSummaryRow, tenantId: string) {
  if (user.tenant_id !== tenantId) {
    throw new ForbiddenError('User belongs to a different tenant');
  }
  if (user.status !== 'active') {
    throw new BadRequestError(`User account is ${user.status}`, {
      reason: 'user_not_active',
      status: user.status,
    });
  }
  if (user.role !== 'user' && user.role !== 'affiliate') {
    throw new BadRequestError('Cashier operations are only allowed on customer accounts', {
      reason: 'invalid_target_role',
      role: user.role,
    });
  }
}

/**
 * Look up an existing operation by idempotency key. When found, returns the
 * fully assembled response so the caller can short-circuit without doing any
 * mutating work.
 */
async function findIdempotent(
  client: import('pg').PoolClient,
  tenantId: string,
  reference: string
): Promise<{
  transaction: repo.TransactionRow;
  cashier_transaction: repo.CashierTransactionRow;
  wallet: repo.WalletRow;
} | null> {
  const tx = await repo.findTransactionByReference(client, tenantId, reference);
  if (!tx) return null;
  const ct = await repo.findCashierTxByReference(client, tenantId, reference);
  if (!ct) return null;
  // Refetch wallet (latest balance after subsequent ops, if any).
  const wRes = await client.query<repo.WalletRow>(
    `SELECT id, tenant_id, user_id, currency, balance, bonus_balance,
            locked_balance, status, version, created_at, updated_at
       FROM wallets WHERE id = $1 LIMIT 1`,
    [tx.wallet_id]
  );
  const wallet = wRes.rows[0];
  if (!wallet) return null;
  return { transaction: tx, cashier_transaction: ct, wallet };
}

/* ------------------------------------------------------------------------- */
/* Deposit                                                                    */
/* ------------------------------------------------------------------------- */

export async function processDeposit(
  req: Request,
  body: DepositInput
): Promise<OperationResult> {
  const scope = getCashierScope(req);
  const idempotencyKey = getIdempotencyKey(req, body.idempotency_key);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      // 1. Idempotency: short-circuit if this key already produced a tx.
      const existing = await findIdempotent(
        client,
        scope.tenantId,
        idempotencyKey
      );
      if (existing) {
        const shift = await repo.findOpenShiftForCashier(
          client,
          scope.tenantId,
          scope.cashierId
        );
        return {
          ...existing,
          idempotent: true,
          shift_id: existing.cashier_transaction.shift_id ?? shift?.id ?? '',
          user_id: existing.wallet.user_id,
        };
      }

      // 2. Cashier must have an open shift to take any cash operation.
      const shift = await repo.findOpenShiftForCashier(
        client,
        scope.tenantId,
        scope.cashierId
      );
      if (!shift) {
        throw new BadRequestError(
          'Open a shift before recording cash operations',
          { reason: 'no_open_shift' }
        );
      }

      // 3. Resolve and validate target user. Section 16 spec sends
      // `phone`, the legacy callers send `user_id` — both work.
      const userId = await resolveTargetUserId(client, scope.tenantId, body);
      const user = await repo.findUserById(client, userId);
      if (!user) throw new NotFoundError('User not found');
      ensureUserOperable(user, scope.tenantId);

      // 4. Resolve currency + tenant payment limits.
      const defaultCurrency = await repo.getDefaultCurrency(
        client,
        scope.tenantId
      );
      const currency = body.currency ?? defaultCurrency;
      const limits = await repo.getPaymentLimits(client, scope.tenantId);
      const amountNum = Number(body.amount);
      if (amountNum < limits.min_deposit) {
        throw new BadRequestError(
          `Amount below minimum deposit (${limits.min_deposit})`,
          { reason: 'below_min_deposit', min: limits.min_deposit }
        );
      }
      if (amountNum > limits.max_deposit) {
        throw new BadRequestError(
          `Amount exceeds maximum deposit (${limits.max_deposit})`,
          { reason: 'exceeds_max_deposit', max: limits.max_deposit }
        );
      }

      // 5. Acquire wallet (auto-create on first deposit) with row lock.
      const before = await repo.ensureWalletForUpdate(
        client,
        scope.tenantId,
        userId,
        currency
      );
      if (before.status !== 'active') {
        throw new BadRequestError(`Wallet is ${before.status}`, {
          wallet_status: before.status,
        });
      }

      // 6. Atomic balance update + ledger insert.
      const after = await repo.applyWalletCredit(client, before.id, body.amount);
      const tx = await repo.insertWalletTransaction(client, {
        tenantId: before.tenant_id,
        walletId: before.id,
        userId: before.user_id,
        type: 'cashier_deposit',
        amount: body.amount,
        beforeBalance: before.balance,
        afterBalance: after.balance,
        currency: before.currency,
        reference: idempotencyKey,
        metadata: {
          source: 'cashier',
          cashier_id: scope.cashierId,
          shift_id: shift.id,
          payment_method: body.payment_method,
          external_reference: body.reference ?? null,
          notes: body.notes ?? null,
        },
      });

      // 7. Cashier business event (links to wallet tx via reference + metadata).
      const ct = await repo.insertCashierTransaction(client, {
        tenantId: before.tenant_id,
        cashierId: scope.cashierId,
        userId: before.user_id,
        shiftId: shift.id,
        branchId: shift.branch_id,
        type: 'deposit',
        amount: body.amount,
        currency: before.currency,
        reference: idempotencyKey,
        notes: body.notes ?? null,
        metadata: {
          payment_method: body.payment_method,
          external_reference: body.reference ?? null,
          wallet_transaction_id: tx.id,
          wallet_id: before.id,
        },
      });

      return {
        wallet: after,
        transaction: tx,
        cashier_transaction: ct,
        idempotent: false,
        shift_id: shift.id,
        user_id: userId,
      };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.cashierId,
    actorType: 'cashier',
    action: 'cashier.deposit',
    resource: 'wallet',
    resourceId: result.wallet.id,
    payload: {
      idempotent: result.idempotent,
      idempotency_key: idempotencyKey,
      user_id: result.user_id,
      shift_id: result.shift_id,
      amount: body.amount,
      currency: result.wallet.currency,
      payment_method: body.payment_method,
      transaction_id: result.transaction.id,
      cashier_transaction_id: result.cashier_transaction.id,
      before_balance: result.transaction.before_balance,
      after_balance: result.transaction.after_balance,
    },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  if (!result.idempotent) {
    const user = await withTenantClient(
      { tenantId: scope.tenantId },
      async (client) => repo.findUserById(client, result.user_id)
    );
    await Promise.all([
      sendSmsBestEffort({
        tenantId: scope.tenantId,
        to: user?.phone ?? null,
        templateCode: 'cashier_deposit_success',
        message: 'Deposit confirmed: {amount} {currency}. Ref: {reference}',
        variables: {
          amount: body.amount,
          currency: result.wallet.currency,
          reference: result.transaction.reference ?? result.transaction.id,
        },
      }),
      sendEmailBestEffort({
        tenantId: scope.tenantId,
        to: user?.email ?? null,
        subject: 'Deposit confirmed',
        body: `Your account was credited with ${body.amount} ${result.wallet.currency}. Reference: ${result.transaction.reference ?? result.transaction.id}.`,
      }),
    ]);
  }

  return result;
}

/* ------------------------------------------------------------------------- */
/* Withdrawal                                                                 */
/* ------------------------------------------------------------------------- */

export async function processWithdrawal(
  req: Request,
  body: WithdrawalInput
): Promise<OperationResult> {
  const scope = getCashierScope(req);
  const idempotencyKey = getIdempotencyKey(req, body.idempotency_key);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const existing = await findIdempotent(
        client,
        scope.tenantId,
        idempotencyKey
      );
      if (existing) {
        const shift = await repo.findOpenShiftForCashier(
          client,
          scope.tenantId,
          scope.cashierId
        );
        return {
          ...existing,
          idempotent: true,
          shift_id: existing.cashier_transaction.shift_id ?? shift?.id ?? '',
          user_id: existing.wallet.user_id,
        };
      }

      const shift = await repo.findOpenShiftForCashier(
        client,
        scope.tenantId,
        scope.cashierId
      );
      if (!shift) {
        throw new BadRequestError(
          'Open a shift before recording cash operations',
          { reason: 'no_open_shift' }
        );
      }

      const userId = await resolveTargetUserId(client, scope.tenantId, body);
      const user = await repo.findUserById(client, userId);
      if (!user) throw new NotFoundError('User not found');
      ensureUserOperable(user, scope.tenantId);

      const defaultCurrency = await repo.getDefaultCurrency(
        client,
        scope.tenantId
      );
      const currency = body.currency ?? defaultCurrency;
      const limits = await repo.getPaymentLimits(client, scope.tenantId);
      const amountNum = Number(body.amount);
      if (amountNum < limits.min_withdrawal) {
        throw new BadRequestError(
          `Amount below minimum withdrawal (${limits.min_withdrawal})`,
          { reason: 'below_min_withdrawal', min: limits.min_withdrawal }
        );
      }
      if (amountNum > limits.max_withdrawal) {
        throw new BadRequestError(
          `Amount exceeds maximum withdrawal (${limits.max_withdrawal})`,
          { reason: 'exceeds_max_withdrawal', max: limits.max_withdrawal }
        );
      }

      // Withdrawals MUST NOT auto-create a wallet — the user has nothing
      // to withdraw if they don't have a wallet yet.
      const before = await repo.findWalletForUpdate(
        client,
        scope.tenantId,
        userId,
        currency
      );
      if (!before) {
        throw new NotFoundError('User has no wallet for the requested currency', {
          currency,
        } as unknown as Record<string, unknown>);
      }
      if (before.status !== 'active') {
        throw new BadRequestError(`Wallet is ${before.status}`, {
          wallet_status: before.status,
        });
      }

      // Atomic debit with balance guard.
      const after = await repo.applyWalletDebit(client, before.id, body.amount);
      if (!after) {
        throw new BadRequestError('Insufficient balance', {
          reason: 'insufficient_balance',
          balance: before.balance,
          requested: body.amount,
        });
      }

      // Wallet ledger entry — amount stored as negative (debit) for sign clarity.
      const tx = await repo.insertWalletTransaction(client, {
        tenantId: before.tenant_id,
        walletId: before.id,
        userId: before.user_id,
        type: 'cashier_withdrawal',
        amount: `-${body.amount}`,
        beforeBalance: before.balance,
        afterBalance: after.balance,
        currency: before.currency,
        reference: idempotencyKey,
        metadata: {
          source: 'cashier',
          cashier_id: scope.cashierId,
          shift_id: shift.id,
          payment_method: body.payment_method,
          external_reference: body.reference ?? null,
          notes: body.notes ?? null,
        },
      });

      // Cashier business event — amount kept positive (CHECK constraint).
      const ct = await repo.insertCashierTransaction(client, {
        tenantId: before.tenant_id,
        cashierId: scope.cashierId,
        userId: before.user_id,
        shiftId: shift.id,
        branchId: shift.branch_id,
        type: 'withdrawal',
        amount: body.amount,
        currency: before.currency,
        reference: idempotencyKey,
        notes: body.notes ?? null,
        metadata: {
          payment_method: body.payment_method,
          external_reference: body.reference ?? null,
          wallet_transaction_id: tx.id,
          wallet_id: before.id,
          paid_at: new Date().toISOString(),
        },
      });

      return {
        wallet: after,
        transaction: tx,
        cashier_transaction: ct,
        idempotent: false,
        shift_id: shift.id,
        user_id: userId,
      };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.cashierId,
    actorType: 'cashier',
    action: 'cashier.withdrawal',
    resource: 'wallet',
    resourceId: result.wallet.id,
    payload: {
      idempotent: result.idempotent,
      idempotency_key: idempotencyKey,
      user_id: result.user_id,
      shift_id: result.shift_id,
      amount: body.amount,
      currency: result.wallet.currency,
      payment_method: body.payment_method,
      transaction_id: result.transaction.id,
      cashier_transaction_id: result.cashier_transaction.id,
      before_balance: result.transaction.before_balance,
      after_balance: result.transaction.after_balance,
    },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  if (!result.idempotent) {
    const user = await withTenantClient(
      { tenantId: scope.tenantId },
      async (client) => repo.findUserById(client, result.user_id)
    );
    await Promise.all([
      sendSmsBestEffort({
        tenantId: scope.tenantId,
        to: user?.phone ?? null,
        templateCode: 'cashier_withdrawal_success',
        message: 'Withdrawal completed: {amount} {currency}. Ref: {reference}',
        variables: {
          amount: body.amount,
          currency: result.wallet.currency,
          reference: result.transaction.reference ?? result.transaction.id,
        },
      }),
      sendEmailBestEffort({
        tenantId: scope.tenantId,
        to: user?.email ?? null,
        subject: 'Withdrawal completed',
        body: `Your withdrawal of ${body.amount} ${result.wallet.currency} is completed. Reference: ${result.transaction.reference ?? result.transaction.id}.`,
      }),
    ]);
  }

  return result;
}
