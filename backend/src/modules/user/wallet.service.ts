import type { Request } from 'express';
import crypto from 'node:crypto';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import {
  getIdempotencyKey,
  getIp,
  getUa,
  getUserScope,
} from './user-shared';
import * as repo from './user.repository';
import { emitNewWithdrawal, emitWalletUpdated } from '../../realtime/socket';
import type {
  WalletQuery,
  WalletTransferInput,
  WithdrawalRequestInput,
} from './user.dto';

export async function getMyWallet(req: Request, query: WalletQuery) {
  const scope = getUserScope(req);

  const wallets = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const all = await repo.listUserWallets(
        client,
        scope.tenantId,
        scope.userId
      );
      const wanted = query.currency;
      if (wanted) {
        const upper = wanted.toUpperCase();
        return all.filter((w) => w.currency === wanted || w.currency === upper);
      }
      return all;
    }
  );

  return {
    items: wallets,
    summary: wallets.map((w) => ({
      currency: w.currency,
      balance: w.balance,
      bonus_balance: w.bonus_balance,
      locked_balance: w.locked_balance,
      total: (
        Number(w.balance) +
        Number(w.bonus_balance) +
        Number(w.locked_balance)
      ).toFixed(4),
    })),
  };
}

export async function submitWithdrawalRequest(
  req: Request,
  body: WithdrawalRequestInput
) {
  const scope = getUserScope(req);
  const idempotencyKey = getIdempotencyKey(req, body.idempotency_key);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      // Idempotency: short-circuit if a request with this key already exists.
      if (idempotencyKey) {
        const existing = await repo.findTransactionByReference(
          client,
          scope.tenantId,
          idempotencyKey
        );
        if (existing) {
          const wallet = await repo.findUserWalletForUpdate(
            client,
            scope.tenantId,
            scope.userId,
            existing.currency
          );
          return { transaction: existing, wallet, idempotent: true };
        }
      }

      // Eligibility checks.
      const user = await repo.findFullUserById(client, scope.userId);
      if (!user) throw new NotFoundError('User not found');
      if (user.status !== 'active') {
        throw new BadRequestError(`Account is ${user.status}`, {
          reason: 'user_not_active',
        });
      }
      const security = await repo.getSecuritySettings(client, scope.tenantId);
      if (security.require_kyc_for_withdrawal && user.kyc_status !== 'verified') {
        throw new BadRequestError('KYC verification required for withdrawals', {
          reason: 'kyc_not_verified',
          kyc_status: user.kyc_status,
        });
      }

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

      // Lock the wallet row, move funds from balance -> locked_balance.
      const before = await repo.findUserWalletForUpdate(
        client,
        scope.tenantId,
        scope.userId,
        currency
      );
      if (!before) {
        throw new NotFoundError('No wallet for the requested currency');
      }
      if (before.status !== 'active') {
        throw new BadRequestError(`Wallet is ${before.status}`, {
          wallet_status: before.status,
        });
      }
      const after = await repo.lockWalletFunds(client, before.id, body.amount);
      if (!after) {
        throw new BadRequestError('Insufficient balance', {
          reason: 'insufficient_balance',
          balance: before.balance,
          requested: body.amount,
        });
      }

      // Append a PENDING withdrawal entry to the wallet ledger. A cashier or
      // payments worker will later transition it to 'completed' (and decrement
      // locked_balance) or 'cancelled' (and refund balance).
      const tx = await repo.insertTransaction(client, {
        tenantId: scope.tenantId,
        walletId: before.id,
        userId: scope.userId,
        type: 'withdrawal',
        amount: `-${body.amount}`,
        beforeBalance: before.balance,
        afterBalance: after.balance,
        currency: before.currency,
        reference: idempotencyKey,
        status: 'pending',
        metadata: {
          source: 'user_request',
          requested_by: scope.userId,
          payment_method: body.payment_method,
          payment_details: body.payment_details ?? null,
          notes: body.notes ?? null,
          locked_into_locked_balance: body.amount,
        },
      });

      return { transaction: tx, wallet: after, idempotent: false };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: 'user.withdrawal.request',
    resource: 'transaction',
    resourceId: result.transaction.id,
    payload: {
      idempotent: result.idempotent,
      idempotency_key: idempotencyKey,
      amount: body.amount,
      currency: result.transaction.currency,
      payment_method: body.payment_method,
      transaction_id: result.transaction.id,
      wallet_id: result.transaction.wallet_id,
    },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  // Notify any other live sessions of this user that their wallet changed.
  if (result.wallet) {
    emitWalletUpdated(scope.tenantId, scope.userId, {
      reason: 'withdrawal_requested',
      wallet: result.wallet,
      transaction_id: result.transaction.id,
    });
  }

  // Push to cashier + admin rooms so a fresh request shows up live in the
  // cashier dashboard (NEW_WITHDRAWAL is the spec'd event for this).
  emitNewWithdrawal(scope.tenantId, {
    transaction_id: result.transaction.id,
    user_id: scope.userId,
    amount: body.amount,
    currency: result.transaction.currency,
    payment_method: body.payment_method,
    requested_at: result.transaction.created_at.toISOString(),
  });

  return result;
}

/**
 * Peer-to-peer wallet transfer. Atomically debits the sender and credits the
 * receiver, writing one paired entry to the wallet ledger (transfer_out +
 * transfer_in). Both rows share the same `transfer_id` in metadata so the
 * admin "Wallet Transactions" report can pivot on it.
 *
 * Idempotency: if `idempotency_key` (or the Idempotency-Key header) is
 * already present on a sender-side ledger row, the original transfer is
 * returned unchanged.
 */
export async function transferWalletFunds(
  req: Request,
  body: WalletTransferInput
) {
  const scope = getUserScope(req);
  const idempotencyKey = getIdempotencyKey(req, body.idempotency_key);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      // Idempotency short-circuit: same key = same transfer.
      if (idempotencyKey) {
        const existing = await repo.findTransactionByReference(
          client,
          scope.tenantId,
          idempotencyKey
        );
        if (existing) {
          const senderWallet = await repo.findUserWalletForUpdate(
            client,
            scope.tenantId,
            scope.userId,
            existing.currency
          );
          return {
            transferId:
              (existing.metadata?.transfer_id as string | undefined) ??
              existing.id,
            sender_transaction: existing,
            receiver_transaction: null,
            sender_wallet: senderWallet,
            idempotent: true,
          };
        }
      }

      // Resolve receiver inside the same tenant.
      const receiver = await repo.findUserByContact(client, scope.tenantId, {
        user_id: body.receiver_user_id,
        phone: body.receiver_phone,
        email: body.receiver_email,
      });
      if (!receiver) {
        throw new NotFoundError('Receiver not found in this tenant');
      }
      if (receiver.id === scope.userId) {
        throw new BadRequestError('Cannot transfer to yourself', {
          reason: 'self_transfer',
        });
      }
      if (receiver.status !== 'active') {
        throw new ForbiddenError(`Receiver account is ${receiver.status}`);
      }

      const sender = await repo.findFullUserById(client, scope.userId);
      if (!sender) throw new NotFoundError('User not found');
      if (sender.status !== 'active') {
        throw new ForbiddenError(`Account is ${sender.status}`);
      }

      const defaultCurrency = await repo.getDefaultCurrency(
        client,
        scope.tenantId
      );
      const currency = body.currency ?? defaultCurrency;

      // Acquire BOTH wallet rows in a deterministic order to avoid deadlocks
      // (lower user_id first); ensure the receiver wallet exists.
      const [firstUserId, secondUserId] = [scope.userId, receiver.id].sort();
      let firstWallet = await repo.ensureWalletForUpdate(
        client,
        scope.tenantId,
        firstUserId,
        currency
      );
      let secondWallet = await repo.ensureWalletForUpdate(
        client,
        scope.tenantId,
        secondUserId,
        currency
      );

      const senderWalletBefore =
        firstUserId === scope.userId ? firstWallet : secondWallet;
      const receiverWalletBefore =
        firstUserId === scope.userId ? secondWallet : firstWallet;

      if (senderWalletBefore.status !== 'active') {
        throw new BadRequestError('Sender wallet not active', {
          wallet_status: senderWalletBefore.status,
        });
      }
      if (receiverWalletBefore.status !== 'active') {
        throw new BadRequestError('Receiver wallet not active', {
          wallet_status: receiverWalletBefore.status,
        });
      }

      // Debit sender first (with non-negative guard), then credit receiver.
      const senderWalletAfter = await repo.debitWalletBalance(
        client,
        senderWalletBefore.id,
        body.amount
      );
      if (!senderWalletAfter) {
        throw new BadRequestError('Insufficient balance', {
          reason: 'insufficient_balance',
          balance: senderWalletBefore.balance,
          requested: body.amount,
        });
      }
      const receiverWalletAfter = await repo.creditWalletBalance(
        client,
        receiverWalletBefore.id,
        body.amount
      );

      const transferId = crypto.randomUUID();
      const senderRef = idempotencyKey ?? `transfer_out:${transferId}`;
      const receiverRef = `transfer_in:${transferId}`;

      const senderTx = await repo.insertTransaction(client, {
        tenantId: scope.tenantId,
        walletId: senderWalletBefore.id,
        userId: scope.userId,
        type: 'transfer_out',
        amount: `-${body.amount}`,
        beforeBalance: senderWalletBefore.balance,
        afterBalance: senderWalletAfter.balance,
        currency,
        reference: senderRef,
        status: 'completed',
        metadata: {
          transfer_id: transferId,
          counterparty_user_id: receiver.id,
          counterparty_phone: receiver.phone,
          counterparty_email: receiver.email,
          note: body.note ?? null,
          source: 'user_transfer',
        },
      });

      const receiverTx = await repo.insertTransaction(client, {
        tenantId: scope.tenantId,
        walletId: receiverWalletBefore.id,
        userId: receiver.id,
        type: 'transfer_in',
        amount: body.amount,
        beforeBalance: receiverWalletBefore.balance,
        afterBalance: receiverWalletAfter.balance,
        currency,
        reference: receiverRef,
        status: 'completed',
        metadata: {
          transfer_id: transferId,
          counterparty_user_id: scope.userId,
          counterparty_phone: sender.phone,
          counterparty_email: sender.email,
          note: body.note ?? null,
          source: 'user_transfer',
        },
      });

      return {
        transferId,
        sender_transaction: senderTx,
        receiver_transaction: receiverTx,
        sender_wallet: senderWalletAfter,
        receiver_wallet: receiverWalletAfter,
        receiver,
        idempotent: false,
      };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: 'user.wallet.transfer',
    resource: 'transaction',
    resourceId: result.sender_transaction.id,
    payload: {
      idempotent: result.idempotent,
      idempotency_key: idempotencyKey,
      transfer_id: result.transferId,
      amount: body.amount,
      currency: result.sender_transaction.currency,
      receiver_transaction_id: result.receiver_transaction?.id ?? null,
    },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  if (!result.idempotent && result.sender_wallet && result.receiver_wallet) {
    emitWalletUpdated(scope.tenantId, scope.userId, {
      reason: 'transfer_out',
      wallet: result.sender_wallet,
      transaction_id: result.sender_transaction.id,
    });
    emitWalletUpdated(scope.tenantId, result.receiver!.id, {
      reason: 'transfer_in',
      wallet: result.receiver_wallet,
      transaction_id: result.receiver_transaction!.id,
    });
  }

  return result;
}
