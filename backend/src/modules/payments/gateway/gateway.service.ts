/**
 * Online Payment Gateway service.
 *
 * Orchestrates the admin-configured gateway methods (Telebirr, CBE Birr,
 * M-Pesa) for user deposits and withdrawals. Fully independent of the
 * Telebirr P2P, admin P2P and branch-withdrawal systems.
 *
 * Current behaviour (no live provider API yet):
 *   - deposit:    creates a `pending` request; the wallet is NOT credited
 *                 until a gateway confirmation arrives (future webhook or
 *                 admin action). `provider_ref` / `metadata` are ready for
 *                 that integration.
 *   - withdrawal: creates a `pending` request AND reserves the funds
 *                 (balance -> locked_balance) with a pending ledger row so
 *                 the user cannot double-spend. Cancelling refunds them.
 *
 * The seam for a real gateway is intentionally narrow: swap the stubbed
 * `initiate*` provider adapters for real API calls returning a
 * `redirect_url` / `provider_ref`, and add a webhook that flips status to
 * `completed` and credits the wallet. No schema change required.
 */

import crypto from 'node:crypto';
import type { PoolClient } from 'pg';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { BadRequestError, NotFoundError } from '../../../http/errors/http-error';
import { emitWalletUpdated } from '../../../realtime/socket';
import { tryAudit } from '../../audit/audit.service';
import { assertWithdrawalAllowed } from '../../../services/deposit-wagering.service';
import * as userRepo from '../../user/user.repository';
import * as pmRepo from '../payment-method.repository';
import * as gwRepo from './gateway.repository';
import { PAYMENT_SETTINGS_KEY, isGatewaySlug } from './gateway.constants';

/* -------------------------------------------------------------------------- */
/* Views                                                                      */
/* -------------------------------------------------------------------------- */

export interface GatewayMethodView {
  id: string;
  provider_slug: string;
  name: string;
  logo_url: string | null;
  min_amount: string | null;
  max_amount: string | null;
  supports_deposit: boolean;
  supports_withdrawal: boolean;
}

export interface GatewayConfigView {
  methods: GatewayMethodView[];
  allow_phone_number_editing: boolean;
  phone: string | null;
}

export interface GatewayRequestView {
  id: string;
  direction: 'deposit' | 'withdrawal';
  provider_slug: string;
  method_name: string;
  amount: string;
  currency: string;
  phone: string;
  status: string;
  reference: string | null;
  redirect_url: string | null;
  expires_at: string | null;
  created_at: string;
}

function toView(row: gwRepo.GatewayRequestRow): GatewayRequestView {
  const meta = row.metadata ?? {};
  return {
    id: row.id,
    direction: row.direction,
    provider_slug: row.provider_slug,
    method_name: row.method_name,
    amount: row.amount,
    currency: row.currency,
    phone: row.phone,
    status: row.status,
    reference: row.reference,
    redirect_url:
      typeof meta.redirect_url === 'string' ? (meta.redirect_url as string) : null,
    expires_at:
      typeof meta.expires_at === 'string' ? (meta.expires_at as string) : null,
    created_at: row.created_at.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normaliseAmount(input: string | number): string {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestError('Enter a valid amount greater than zero.', {
      reason: 'invalid_amount',
    });
  }
  return n.toFixed(2);
}

function assertWithinLimits(
  amount: number,
  min: string | null,
  max: string | null
): void {
  const minNum = min === null ? null : Number(min);
  const maxNum = max === null ? null : Number(max);
  if (minNum !== null && amount < minNum) {
    throw new BadRequestError(`Minimum amount is ${minNum} ETB.`, {
      reason: 'below_min',
      min: minNum,
    });
  }
  if (maxNum !== null && amount > maxNum) {
    throw new BadRequestError(`Maximum amount is ${maxNum} ETB.`, {
      reason: 'exceeds_max',
      max: maxNum,
    });
  }
}

async function resolvePhone(
  client: PoolClient,
  tenantId: string,
  userId: string,
  requestedPhone: string | null | undefined,
  allowEdit: boolean
): Promise<string> {
  const profilePhone = await gwRepo.findUserPhone(client, tenantId, userId);
  const requested = requestedPhone?.trim() || null;
  if (allowEdit && requested) return requested;
  if (profilePhone) return profilePhone;
  if (requested) return requested;
  throw new BadRequestError(
    'No phone number on file. Add a phone number to your profile first.',
    { reason: 'missing_phone' }
  );
}

async function readAllowPhoneEdit(
  client: PoolClient,
  tenantId: string
): Promise<boolean> {
  const cfg = await userRepo.getSettingValue<{
    allow_phone_number_editing?: boolean;
  }>(client, tenantId, PAYMENT_SETTINGS_KEY);
  return Boolean(cfg?.allow_phone_number_editing);
}

/* -------------------------------------------------------------------------- */
/* Config (methods enabled by admin + phone-edit flag)                        */
/* -------------------------------------------------------------------------- */

export interface GetGatewayConfigArgs {
  tenantId: string;
  userId: string;
  channel: 'deposit' | 'withdrawal' | null;
}

export async function getGatewayConfig(
  args: GetGatewayConfigArgs
): Promise<GatewayConfigView> {
  return withTenantClient({ tenantId: args.tenantId }, async (client) => {
    const rows = await pmRepo.listPaymentMethods(client, {
      tenantId: args.tenantId,
      activeOnly: true,
      channel: args.channel ?? null,
    });
    const methods: GatewayMethodView[] = rows
      .filter((r) => isGatewaySlug(r.provider_slug))
      .map((r) => ({
        id: r.id,
        provider_slug: r.provider_slug,
        name: r.name,
        logo_url: r.logo_url,
        min_amount: r.min_amount,
        max_amount: r.max_amount,
        supports_deposit: r.supports_deposit,
        supports_withdrawal: r.supports_withdrawal,
      }));
    const allowEdit = await readAllowPhoneEdit(client, args.tenantId);
    const phone = await gwRepo.findUserPhone(client, args.tenantId, args.userId);
    return {
      methods,
      allow_phone_number_editing: allowEdit,
      phone,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Initiate deposit                                                           */
/* -------------------------------------------------------------------------- */

export interface InitiateGatewayArgs {
  tenantId: string;
  userId: string;
  providerSlug: string;
  amount: string | number;
  requestedPhone?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export async function initiateGatewayDeposit(
  args: InitiateGatewayArgs
): Promise<GatewayRequestView> {
  if (!isGatewaySlug(args.providerSlug)) {
    throw new BadRequestError('Unknown online payment method.', {
      reason: 'unknown_method',
    });
  }
  const amount = normaliseAmount(args.amount);

  const row = await withTenantClient(
    { tenantId: args.tenantId },
    async (client) => {
      const method = await pmRepo.findPaymentMethodBySlug(
        client,
        args.tenantId,
        args.providerSlug
      );
      if (!method || !method.is_active || !method.supports_deposit) {
        throw new BadRequestError(
          'This online payment method is not available for deposits.',
          { reason: 'method_unavailable' }
        );
      }
      assertWithinLimits(Number(amount), method.min_amount, method.max_amount);

      const allowEdit = await readAllowPhoneEdit(client, args.tenantId);
      const phone = await resolvePhone(
        client,
        args.tenantId,
        args.userId,
        args.requestedPhone,
        allowEdit
      );
      const currency = method.currencies[0] ?? 'ETB';
      const reference = `gwd_${crypto.randomUUID()}`;
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

      return gwRepo.insertGatewayRequest(client, {
        tenantId: args.tenantId,
        userId: args.userId,
        direction: 'deposit',
        providerSlug: args.providerSlug,
        methodName: method.name,
        amount,
        currency,
        phone,
        status: 'pending',
        reference,
        providerRef: null,
        metadata: {
          ...(args.metadata ?? {}),
          expires_at: expiresAt,
          note: 'Awaiting gateway confirmation.',
          ip: args.ip ?? null,
          user_agent: args.userAgent ?? null,
        },
      });
    }
  );

  await tryAudit({
    tenantId: args.tenantId,
    actorId: args.userId,
    actorType: 'user',
    action: 'user.payments.gateway.deposit',
    resource: 'gateway_payment_request',
    resourceId: row.id,
    payload: { provider_slug: row.provider_slug, amount: row.amount },
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
    status: 'success',
  });

  return toView(row);
}

/* -------------------------------------------------------------------------- */
/* Initiate withdrawal (reserves funds)                                       */
/* -------------------------------------------------------------------------- */

export async function initiateGatewayWithdrawal(
  args: InitiateGatewayArgs
): Promise<GatewayRequestView> {
  if (!isGatewaySlug(args.providerSlug)) {
    throw new BadRequestError('Unknown online payment method.', {
      reason: 'unknown_method',
    });
  }
  const amount = normaliseAmount(args.amount);

  const result = await withTenantClient(
    { tenantId: args.tenantId },
    async (client) => {
      const method = await pmRepo.findPaymentMethodBySlug(
        client,
        args.tenantId,
        args.providerSlug
      );
      if (!method || !method.is_active || !method.supports_withdrawal) {
        throw new BadRequestError(
          'This online payment method is not available for withdrawals.',
          { reason: 'method_unavailable' }
        );
      }
      assertWithinLimits(Number(amount), method.min_amount, method.max_amount);

      const allowEdit = await readAllowPhoneEdit(client, args.tenantId);
      const phone = await resolvePhone(
        client,
        args.tenantId,
        args.userId,
        args.requestedPhone,
        allowEdit
      );
      const currency = method.currencies[0] ?? 'ETB';

      // Reserve funds: lock the wallet row and move balance -> locked_balance.
      const before = await userRepo.findUserWalletForUpdate(
        client,
        args.tenantId,
        args.userId,
        currency
      );
      if (!before) {
        throw new NotFoundError('No wallet for the requested currency.');
      }
      if (before.status !== 'active') {
        throw new BadRequestError(`Wallet is ${before.status}.`, {
          wallet_status: before.status,
        });
      }
      // Deposit-wagering rule: deposited funds must be wagered first.
      await assertWithdrawalAllowed(
        client,
        before.id,
        Number(before.balance),
        Number(amount)
      );
      const after = await userRepo.lockWalletFunds(client, before.id, amount);
      if (!after) {
        throw new BadRequestError('Insufficient balance.', {
          reason: 'insufficient_balance',
          balance: before.balance,
          requested: amount,
        });
      }

      const reference = `gww_${crypto.randomUUID()}`;
      const tx = await userRepo.insertTransaction(client, {
        tenantId: args.tenantId,
        walletId: before.id,
        userId: args.userId,
        type: 'withdrawal',
        amount: `-${amount}`,
        beforeBalance: before.balance,
        afterBalance: after.balance,
        currency: before.currency,
        reference,
        status: 'pending',
        metadata: {
          source: 'online_payment_gateway',
          provider_slug: args.providerSlug,
          phone,
        },
      });

      const row = await gwRepo.insertGatewayRequest(client, {
        tenantId: args.tenantId,
        userId: args.userId,
        direction: 'withdrawal',
        providerSlug: args.providerSlug,
        methodName: method.name,
        amount,
        currency,
        phone,
        status: 'pending',
        reference,
        providerRef: null,
        debitTransactionId: tx.id,
        metadata: {
          ...(args.metadata ?? {}),
          note: 'Awaiting gateway payout.',
          ip: args.ip ?? null,
          user_agent: args.userAgent ?? null,
        },
      });

      return { row, wallet: after, txId: tx.id };
    }
  );

  emitWalletUpdated(args.tenantId, args.userId, {
    reason: 'gateway_withdrawal_requested',
    wallet: result.wallet,
    transaction_id: result.txId,
  });

  await tryAudit({
    tenantId: args.tenantId,
    actorId: args.userId,
    actorType: 'user',
    action: 'user.payments.gateway.withdrawal',
    resource: 'gateway_payment_request',
    resourceId: result.row.id,
    payload: { provider_slug: result.row.provider_slug, amount: result.row.amount },
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
    status: 'success',
  });

  return toView(result.row);
}

/* -------------------------------------------------------------------------- */
/* History / status / cancel                                                  */
/* -------------------------------------------------------------------------- */

export interface ListGatewayRequestsArgs {
  tenantId: string;
  userId: string;
  direction?: 'deposit' | 'withdrawal' | null;
  page: number;
  limit: number;
}

export async function listGatewayRequests(args: ListGatewayRequestsArgs): Promise<{
  items: GatewayRequestView[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}> {
  const offset = (args.page - 1) * args.limit;
  const { rows, total } = await withTenantClient(
    { tenantId: args.tenantId },
    async (client) =>
      gwRepo.listGatewayRequests(client, {
        tenantId: args.tenantId,
        userId: args.userId,
        direction: args.direction ?? null,
        limit: args.limit,
        offset,
      })
  );
  return {
    items: rows.map(toView),
    total,
    page: args.page,
    limit: args.limit,
    pages: Math.max(1, Math.ceil(total / args.limit)),
  };
}

export async function getGatewayRequest(args: {
  tenantId: string;
  userId: string;
  id: string;
}): Promise<GatewayRequestView> {
  const row = await withTenantClient(
    { tenantId: args.tenantId },
    async (client) =>
      gwRepo.findGatewayRequestById(client, args.tenantId, args.userId, args.id)
  );
  if (!row) throw new NotFoundError('Payment request not found.');
  return toView(row);
}

export async function cancelGatewayRequest(args: {
  tenantId: string;
  userId: string;
  id: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<GatewayRequestView> {
  const result = await withTenantClient(
    { tenantId: args.tenantId },
    async (client) => {
      const row = await gwRepo.findGatewayRequestById(
        client,
        args.tenantId,
        args.userId,
        args.id
      );
      if (!row) throw new NotFoundError('Payment request not found.');
      if (row.status !== 'pending') {
        throw new BadRequestError('Only pending requests can be cancelled.', {
          reason: 'not_pending',
          status: row.status,
        });
      }

      let wallet: { balance: string; locked_balance: string } | null = null;
      if (row.direction === 'withdrawal' && row.debit_transaction_id) {
        const w = await userRepo.findUserWalletForUpdate(
          client,
          args.tenantId,
          args.userId,
          row.currency
        );
        if (w) {
          wallet = await gwRepo.unlockWalletFunds(client, w.id, row.amount);
          await gwRepo.markTransactionStatus(
            client,
            args.tenantId,
            row.debit_transaction_id,
            'cancelled'
          );
        }
      }

      const updated = await gwRepo.updateGatewayStatus(
        client,
        args.tenantId,
        args.id,
        { status: 'cancelled' }
      );
      return { updated: updated ?? row, walletChanged: Boolean(wallet) };
    }
  );

  if (result.walletChanged) {
    const fresh = await withTenantClient(
      { tenantId: args.tenantId },
      async (client) => {
        const wallets = await userRepo.listUserWallets(
          client,
          args.tenantId,
          args.userId
        );
        return wallets[0] ?? null;
      }
    );
    if (fresh) {
      emitWalletUpdated(args.tenantId, args.userId, {
        reason: 'gateway_withdrawal_cancelled',
        wallet: fresh,
        transaction_id: result.updated.debit_transaction_id,
      });
    }
  }

  return toView(result.updated);
}
