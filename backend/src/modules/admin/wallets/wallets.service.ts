import type { Request } from 'express';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';
import * as repo from './wallets.repository';
import type {
  CreditWalletInput,
  DebitWalletInput,
  ListWalletsQuery,
  WalletBucket,
} from './wallets.dto';

function pickAuditWallet(w: repo.WalletRow): Record<string, unknown> {
  return {
    id: w.id,
    tenant_id: w.tenant_id,
    user_id: w.user_id,
    currency: w.currency,
    balance: w.balance,
    bonus_balance: w.bonus_balance,
    locked_balance: w.locked_balance,
    withdrawable_balance: w.withdrawable_balance,
    payable_balance: w.payable_balance,
    status: w.status,
    version: w.version,
  };
}

export async function listWallets(req: Request, params: ListWalletsQuery) {
  const scope = getAdminScope(req);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listWallets(client, scope.tenantId, {
        userId: params.user_id ?? null,
        currency: params.currency ?? null,
        status: params.status ?? null,
        minBalance: params.min_balance ?? null,
        maxBalance: params.max_balance ?? null,
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

/**
 * Ensure a wallet exists for `userId`. Creates one (ETB, balance=0) if none is
 * found. Idempotent — safe to call multiple times. Returns the wallet row.
 */
export async function ensureWallet(req: Request, userId: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  // Resolve currency from tenant settings; fall back to ETB.
  const wallet = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      // Check tenant default currency.
      const cfg = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'main.config' LIMIT 1`,
        [tenantId]
      );
      const currency =
        String(cfg.rows[0]?.value?.currency ?? 'ETB');
      return repo.ensureWallet(client, tenantId, userId, currency);
    }
  );

  if (!wallet) throw new NotFoundError('User not found or wallet could not be created');

  await tryAudit(
    {
      tenantId: wallet.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.wallet.ensure',
      resource: 'wallet',
      resourceId: wallet.id,
      payload: { user_id: userId, currency: wallet.currency, created: true },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return wallet;
}

export async function getWallet(req: Request, id: string) {
  const scope = getAdminScope(req);
  const wallet = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.findWalletById(client, id)
  );
  if (!wallet) throw new NotFoundError('Wallet not found');
  if (!scope.isSuperadmin && wallet.tenant_id !== scope.tenantId) {
    throw new ForbiddenError('Wallet belongs to a different tenant');
  }
  return wallet;
}

/* ------------------------------------------------------------------------- */
/* Credit                                                                    */
/* ------------------------------------------------------------------------- */

export async function creditWallet(
  req: Request,
  id: string,
  body: CreditWalletInput
) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findWalletByIdForUpdate(client, id);
      if (!before) throw new NotFoundError('Wallet not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Wallet belongs to a different tenant');
      }
      if (before.status !== 'active') {
        throw new BadRequestError(`Wallet is ${before.status}`, {
          wallet_status: before.status,
        });
      }

      const bucket: WalletBucket = (body.bucket ?? 'deductable') as WalletBucket;
      const after = await repo.creditWalletBalance(client, id, body.amount, bucket);

      const tx = await repo.insertWalletTransaction(client, {
        tenantId: before.tenant_id,
        walletId: before.id,
        userId: before.user_id,
        type: 'adjustment',
        amount: body.amount,
        beforeBalance: before.balance,
        afterBalance: after.balance,
        currency: before.currency,
        reference: body.reference ?? null,
        metadata: {
          admin_action: 'credit',
          bucket,
          actor_id: scope.actorId,
          actor_role: scope.actorRole,
          reason: body.reason,
          ...(body.metadata ?? {}),
        },
      });

      return { before, after, transaction: tx };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.wallet.credit',
      resource: 'wallet',
      resourceId: id,
      payload: {
        before: pickAuditWallet(result.before),
        after: pickAuditWallet(result.after),
        amount: body.amount,
        bucket: (body.bucket ?? 'deductable'),
        reason: body.reason,
        reference: body.reference ?? null,
        transaction_id: result.transaction.id,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { wallet: result.after, transaction: result.transaction };
}

/* ------------------------------------------------------------------------- */
/* Debit                                                                     */
/* ------------------------------------------------------------------------- */

export async function debitWallet(
  req: Request,
  id: string,
  body: DebitWalletInput
) {
  const scope = getAdminScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findWalletByIdForUpdate(client, id);
      if (!before) throw new NotFoundError('Wallet not found');
      if (!scope.isSuperadmin && before.tenant_id !== scope.tenantId) {
        throw new ForbiddenError('Wallet belongs to a different tenant');
      }
      if (before.status !== 'active') {
        throw new BadRequestError(`Wallet is ${before.status}`, {
          wallet_status: before.status,
        });
      }

      const bucket: WalletBucket = (body.bucket ?? 'deductable') as WalletBucket;
      const after = await repo.debitWalletBalance(client, id, body.amount, bucket);
      if (!after) {
        throw new BadRequestError('Insufficient balance in selected bucket', {
          reason: 'insufficient_balance',
          bucket,
          balance: before.balance,
          amount: body.amount,
        });
      }

      const tx = await repo.insertWalletTransaction(client, {
        tenantId: before.tenant_id,
        walletId: before.id,
        userId: before.user_id,
        type: 'adjustment',
        // Debit recorded as a negative amount in the ledger so the sign
        // matches the direction of fund movement.
        amount: `-${body.amount}`,
        beforeBalance: before.balance,
        afterBalance: after.balance,
        currency: before.currency,
        reference: body.reference ?? null,
        metadata: {
          admin_action: 'debit',
          bucket,
          actor_id: scope.actorId,
          actor_role: scope.actorRole,
          reason: body.reason,
          ...(body.metadata ?? {}),
        },
      });

      return { before, after, transaction: tx };
    }
  );

  await tryAudit(
    {
      tenantId: result.after.tenant_id,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.wallet.debit',
      resource: 'wallet',
      resourceId: id,
      payload: {
        before: pickAuditWallet(result.before),
        after: pickAuditWallet(result.after),
        amount: body.amount,
        bucket: (body.bucket ?? 'deductable'),
        reason: body.reason,
        reference: body.reference ?? null,
        transaction_id: result.transaction.id,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { wallet: result.after, transaction: result.transaction };
}
