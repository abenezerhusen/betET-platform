/**
 * Telebirr withdrawal flow.
 *
 * Lifecycle:
 *   pending     – created by user; wallet has been debited; awaiting cashier pickup.
 *   processing  – cashier claimed it; opening Telebirr app to send the payout.
 *   completed   – cashier marked the outgoing transfer done; telebirr_ref recorded.
 *   rejected    – cashier (or admin) refused the request; wallet credit reversal posted.
 *   cancelled   – user cancelled before pickup, or admin cancelled; wallet credit reversal posted.
 *   failed      – terminal error; wallet credit reversal posted.
 *
 * Money model:
 *   - The wallet is debited at REQUEST TIME (initiate) so a user can't
 *     stack multiple withdrawals beyond their balance. The cashier's
 *     "complete" action records the Telebirr ref but does NOT touch
 *     the wallet again.
 *   - Any non-terminal-success outcome (rejected/cancelled/failed)
 *     posts a reversal credit; a unique reference key
 *     `tw_revrev:<id>` ensures the reversal is idempotent under retry.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { assertWithdrawalAllowed } from '../../services/deposit-wagering.service';
import { logger } from '../../infrastructure/logger';
import { openSecret } from '../../infrastructure/crypto/secret-cipher';
import {
  loadTelebirrSettings,
  buildWithdrawalUssd,
  buildWithdrawalUssdFlow,
} from './telebirr.settings';
import * as withdrawalRepo from './telebirr.withdrawal.repository';
import * as telebirrRepo from './telebirr.repository';
import * as p2pRepo from '../admin/p2p/p2p.repository';

// An agent must have sent a heartbeat within this window to be considered
// online and eligible to receive an auto-dispatched USSD withdrawal command.
const AGENT_ONLINE_WINDOW_MS = 3 * 60 * 1000;

/* ------------------------------------------------------------------------- */
/* Types                                                                     */
/* ------------------------------------------------------------------------- */

export interface InitiateWithdrawalInput {
  tenantId: string;
  userId: string;
  amount: string;
  currency: string;
  telebirrNumber: string;
  /**
   * Optional. The payout UI only asks for phone + amount now; when omitted
   * we default the account holder name to the destination phone number.
   */
  accountName?: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface InitiateWithdrawalResult {
  request_id: string;
  status: 'pending' | 'processing';
  amount: string;
  currency: string;
  telebirr_number: string;
  account_name: string;
  estimated_completion: string;
  created_at: string;
  /** Set when the request was auto-dispatched to an agent for USSD payout. */
  routed_agent_id?: string | null;
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function normaliseEthiopianMobile(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  if (digits.length === 12 && digits.startsWith('251')) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 9 && digits.startsWith('9')) {
    return `0${digits}`;
  }
  return digits;
}

async function postReversal(
  client: PoolClient,
  params: {
    tenantId: string;
    walletId: string;
    userId: string;
    amount: string;
    currency: string;
    requestId: string;
    notes: string;
  }
): Promise<{ id: string; afterBalance: string }> {
  const wRes = await client.query<{ id: string; balance: string; version: number }>(
    `SELECT id, balance, version
       FROM wallets
      WHERE id = $1
      FOR UPDATE`,
    [params.walletId]
  );
  const wallet = wRes.rows[0];
  if (!wallet) throw new Error('wallet missing during reversal');
  const beforeBalance = wallet.balance;

  const credit = await client.query<{ balance: string }>(
    `UPDATE wallets
        SET balance    = balance + $2::numeric,
            version    = version + 1,
            updated_at = now()
      WHERE id = $1
      RETURNING balance`,
    [wallet.id, params.amount]
  );
  const afterBalance = credit.rows[0].balance;

  const ledger = await client.query<{ id: string }>(
    `INSERT INTO transactions
       (tenant_id, wallet_id, user_id, type, amount,
        before_balance, after_balance, currency, reference,
        metadata, status)
     VALUES ($1, $2, $3, 'adjustment', $4::numeric,
             $5::numeric, $6::numeric, $7,
             $8, $9::jsonb, 'completed')
     RETURNING id`,
    [
      params.tenantId,
      wallet.id,
      params.userId,
      params.amount,
      beforeBalance,
      afterBalance,
      params.currency,
      `tw_rev:${params.requestId}`,
      JSON.stringify({
        method: 'telebirr',
        kind: 'withdrawal_reversal',
        request_id: params.requestId,
        notes: params.notes,
      }),
    ]
  );
  return { id: ledger.rows[0].id, afterBalance };
}

/* ------------------------------------------------------------------------- */
/* Initiate                                                                  */
/* ------------------------------------------------------------------------- */

export async function initiateWithdrawal(
  input: InitiateWithdrawalInput
): Promise<InitiateWithdrawalResult> {
  const canonicalNumber = normaliseEthiopianMobile(input.telebirrNumber);
  if (!/^0\d{9}$/.test(canonicalNumber)) {
    throw new BadRequestError(
      'telebirrNumber must be a valid Ethiopian mobile (0XXXXXXXXX)',
      { reason: 'invalid_telebirr_number' }
    );
  }

  // Account name is optional now (UI collects phone + amount only). Default
  // it to the destination phone so downstream records and the NOT NULL
  // column stay populated.
  const accountName = input.accountName?.trim() || canonicalNumber;

  if (input.currency !== 'ETB') {
    throw new BadRequestError(
      `Unsupported currency for Telebirr P2P withdrawal: ${input.currency}`,
      { reason: 'unsupported_currency' }
    );
  }

  const out = await withTenantClient(
    { tenantId: input.tenantId },
    async (client) => {
      const settings = await loadTelebirrSettings(client, input.tenantId);
      if (!settings.withdrawal_enabled) {
        throw new BadRequestError(
          'Telebirr P2P withdrawals are disabled for this tenant.',
          { reason: 'withdrawal_disabled' }
        );
      }
      const amountNum = Number(input.amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new BadRequestError('Invalid amount', { reason: 'invalid_amount' });
      }
      if (amountNum < settings.min_deposit) {
        throw new BadRequestError(
          `Amount below minimum withdrawal (${settings.min_deposit} ETB)`,
          { reason: 'below_min_withdrawal', min: settings.min_deposit }
        );
      }
      if (amountNum > settings.max_deposit) {
        throw new BadRequestError(
          `Amount exceeds maximum withdrawal (${settings.max_deposit} ETB)`,
          { reason: 'exceeds_max_withdrawal', max: settings.max_deposit }
        );
      }

      const open = await withdrawalRepo.findUserOpenWithdrawal(
        client,
        input.tenantId,
        input.userId
      );
      if (open) {
        throw new ConflictError(
          'You already have an open Telebirr withdrawal request.',
          {
            reason: 'open_request_exists',
            request_id: open.id,
            status: open.status,
          }
        );
      }

      // Lock wallet, debit if balance covers, post ledger row.
      const wRes = await client.query<{
        id: string;
        balance: string;
        version: number;
        currency: string;
        status: string;
      }>(
        `SELECT id, balance, version, currency, status
           FROM wallets
          WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
          FOR UPDATE`,
        [input.tenantId, input.userId, input.currency]
      );
      const wallet = wRes.rows[0];
      if (!wallet) {
        throw new BadRequestError('Wallet not found', {
          reason: 'wallet_missing',
          currency: input.currency,
        });
      }
      if (wallet.status !== 'active') {
        throw new ForbiddenError('Wallet is not active', {
          reason: 'wallet_inactive',
          status: wallet.status,
        });
      }

      // Deposit wagering rule — deposited funds must be turned over
      // before they can be withdrawn.
      await assertWithdrawalAllowed(
        client,
        wallet.id,
        Number(wallet.balance),
        amountNum
      );

      const beforeBalance = wallet.balance;
      // Withdrawals must come from the Withdrawable bucket. If the wallet
      // predates the bucket split, we allow a fallback to the legacy
      // `balance` column so existing funds remain withdrawable.
      const debit = await client.query<{ balance: string; withdrawable_balance: string }>(
        `UPDATE wallets
            SET withdrawable_balance = withdrawable_balance - $2::numeric,
                version              = version + 1,
                updated_at           = now()
          WHERE id = $1 AND withdrawable_balance >= $2::numeric
          RETURNING balance, withdrawable_balance`,
        [wallet.id, input.amount]
      );
      if (!debit.rows[0]) {
        // Fallback: legacy wallets where withdrawable_balance is 0 but
        // the user still has funds in `balance` from before the split.
        const fallback = await client.query<{ balance: string; withdrawable_balance: string }>(
          `UPDATE wallets
              SET balance              = balance - $2::numeric,
                  version              = version + 1,
                  updated_at           = now()
            WHERE id = $1
              AND withdrawable_balance < $2::numeric
              AND balance >= $2::numeric
            RETURNING balance, withdrawable_balance`,
          [wallet.id, input.amount]
        );
        if (!fallback.rows[0]) {
          throw new BadRequestError('Insufficient withdrawable balance', {
            reason: 'insufficient_withdrawable_balance',
            available: beforeBalance,
            requested: input.amount,
          });
        }
        debit.rows[0] = fallback.rows[0];
      }
      const afterBalance = debit.rows[0].balance;

      const ledger = await client.query<{ id: string }>(
        `INSERT INTO transactions
           (tenant_id, wallet_id, user_id, type, amount,
            before_balance, after_balance, currency, reference,
            metadata, status)
         VALUES ($1, $2, $3, 'p2p_withdrawal', ('-' || $4)::numeric,
                 $5::numeric, $6::numeric, $7,
                 $8, $9::jsonb, 'pending')
         RETURNING id`,
        [
          input.tenantId,
          wallet.id,
          input.userId,
          input.amount,
          beforeBalance,
          afterBalance,
          wallet.currency,
          `tw:${randomUUID()}`,
          JSON.stringify({
            method: 'telebirr',
            telebirr_number: canonicalNumber,
            account_name: accountName,
          }),
        ]
      );
      const debitTransactionId = ledger.rows[0].id;

      const request = await withdrawalRepo.insertWithdrawal(client, {
        tenantId: input.tenantId,
        userId: input.userId,
        amount: input.amount,
        currency: input.currency,
        telebirrNumber: canonicalNumber,
        accountName,
        debitTransactionId,
      });

      return { request, debitTransactionId };
    }
  );

  // Auto-dispatch to an online agent wallet for USSD payout. Best-effort:
  // if no agent is online we leave the request 'pending' for manual
  // handling in the admin withdrawal queue. When an agent picks up the
  // command, runs the USSD, and reports success, `recordCommandResult`
  // auto-completes the withdrawal and books the capacity-restoring swap.
  // Auto-dispatch to a FREE online wallet. If every suitable wallet is busy
  // running another USSD (or none is online), the request stays 'pending' —
  // i.e. queued — and `drainWithdrawalQueue` dispatches it the moment a wallet
  // frees up. This gives parallelism across different wallets and a serial,
  // step-by-step queue per wallet.
  let routedAgentId: string | null = null;
  try {
    routedAgentId = await withTenantClient(
      { tenantId: input.tenantId, bypassRls: true },
      async (client) =>
        dispatchWithdrawalToAgent(client, input.tenantId, {
          id: out.request.id,
          amount: out.request.amount,
          telebirr_number: out.request.telebirr_number,
          account_name: out.request.account_name,
        })
    );
  } catch (err) {
    logger.warn(
      { err, requestId: out.request.id },
      'withdrawal auto-route to agent failed; left pending for manual handling'
    );
  }

  await tryAudit(
    {
      tenantId: input.tenantId,
      actorId: input.userId,
      actorType: 'user',
      action: 'user.telebirr.withdrawal.initiate',
      resource: 'telebirr_withdrawal_request',
      resourceId: out.request.id,
      payload: {
        amount: out.request.amount,
        telebirr_number: out.request.telebirr_number,
        account_name: out.request.account_name,
        routed_agent_id: routedAgentId,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'success',
    },
    { bypassRls: true }
  );

  return {
    request_id: out.request.id,
    status: routedAgentId ? 'processing' : 'pending',
    routed_agent_id: routedAgentId,
    amount: out.request.amount,
    currency: out.request.currency,
    telebirr_number: out.request.telebirr_number,
    account_name: out.request.account_name,
    estimated_completion: '15-30 minutes during business hours',
    created_at: out.request.created_at.toISOString(),
  };
}

/* ------------------------------------------------------------------------- */
/* Dispatch + queue                                                          */
/* ------------------------------------------------------------------------- */

interface DispatchableWithdrawal {
  id: string;
  amount: string;
  telebirr_number: string;
  account_name: string;
}

/**
 * Dispatch a single 'pending' withdrawal to a FREE online wallet: flips it to
 * 'processing' and enqueues the USSD `withdraw` command (with the interactive
 * menu flow + decrypted PIN). Returns the agent id when dispatched, or null
 * when no free wallet can currently cover it (the request stays queued).
 *
 * Must run inside a tenant transaction. Serial-per-wallet safety comes from
 * `pickAgentForWithdrawal`, which excludes wallets that already have an
 * in-flight withdraw command.
 */
export async function dispatchWithdrawalToAgent(
  client: import('pg').PoolClient,
  tenantId: string,
  w: DispatchableWithdrawal
): Promise<string | null> {
  const onlineAfter = new Date(Date.now() - AGENT_ONLINE_WINDOW_MS);
  const agent = await telebirrRepo.pickAgentForWithdrawal(
    client,
    tenantId,
    w.amount,
    onlineAfter
  );
  if (!agent) return null;

  const upd = await client.query<{ id: string }>(
    `UPDATE telebirr_withdrawal_requests
        SET status = 'processing', processed_at = now()
      WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
      RETURNING id`,
    [w.id, tenantId]
  );
  if (!upd.rows[0]) return null;

  // Decrypt the wallet's Telebirr PIN and pre-build the USSD the phone dials.
  let pin = '';
  try {
    const sealed = await p2pRepo.getAgentUssdPinEncrypted(client, agent.id);
    pin = sealed ? openSecret(sealed) : '';
  } catch (e) {
    logger.warn({ e, agentId: agent.id }, 'failed to open agent USSD PIN');
  }
  const routeSettings = await loadTelebirrSettings(client, tenantId);
  const ussd = buildWithdrawalUssd(routeSettings.withdrawal_ussd_template, {
    recipient: w.telebirr_number,
    amount: w.amount,
    pin,
  });
  const flow = buildWithdrawalUssdFlow(routeSettings, {
    recipient: w.telebirr_number,
    amount: w.amount,
    pin,
  });

  await p2pRepo.createCommand(client, tenantId, {
    agent_id: agent.id,
    kind: 'withdraw',
    payload: {
      withdrawal_id: w.id,
      amount: w.amount,
      telebirr_number: w.telebirr_number,
      recipient_phone: w.telebirr_number,
      account_name: w.account_name,
      ussd,
      ussd_initial: flow.initial,
      ussd_steps: flow.steps,
      has_pin: pin.length > 0,
    },
    reference: w.id,
    issued_by: null,
  });
  await telebirrRepo.markAgentAssigned(client, agent.id);
  return agent.id;
}

/**
 * Drain the withdrawal queue: dispatch the oldest 'pending' withdrawals to any
 * now-free online wallets (FIFO). Called after a withdrawal completes/fails so
 * a freed wallet immediately picks up the next queued payout. Best-effort and
 * safe to call concurrently (rows are locked FOR UPDATE SKIP LOCKED).
 */
export async function drainWithdrawalQueue(tenantId: string): Promise<void> {
  await withTenantClient(
    { tenantId, bypassRls: true },
    async (client) => {
      // Bounded loop so one drain can fill several freed wallets at once
      // without ever spinning forever.
      for (let i = 0; i < 25; i += 1) {
        const next = await client.query<DispatchableWithdrawal>(
          `SELECT id, amount::text AS amount, telebirr_number, account_name
             FROM telebirr_withdrawal_requests
            WHERE tenant_id = $1 AND status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [tenantId]
        );
        const w = next.rows[0];
        if (!w) break; // queue empty
        const agentId = await dispatchWithdrawalToAgent(client, tenantId, w);
        if (!agentId) break; // no free wallet for the head of the queue
      }
    }
  );
}

/* ------------------------------------------------------------------------- */
/* Cancel (user)                                                             */
/* ------------------------------------------------------------------------- */

export async function cancelWithdrawalAsUser(input: {
  tenantId: string;
  userId: string;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ request_id: string; status: 'cancelled' }> {
  const out = await withTenantClient(
    { tenantId: input.tenantId },
    async (client) => {
      const existing = await withdrawalRepo.findWithdrawalById(
        client,
        input.tenantId,
        input.requestId
      );
      if (!existing) throw new NotFoundError('Withdrawal request not found');
      if (existing.user_id !== input.userId) {
        // Hide existence of someone else's request.
        throw new NotFoundError('Withdrawal request not found');
      }
      if (existing.status !== 'pending') {
        throw new BadRequestError(
          `Cannot cancel a withdrawal in status ${existing.status}`,
          { reason: 'not_cancellable', status: existing.status }
        );
      }

      // Wallet credit reversal.
      const wRes = await client.query<{ id: string }>(
        `SELECT id FROM wallets
          WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
          LIMIT 1`,
        [input.tenantId, input.userId, existing.currency]
      );
      const walletId = wRes.rows[0]?.id;
      if (!walletId) throw new Error('wallet missing during cancel');
      const reversal = await postReversal(client, {
        tenantId: input.tenantId,
        walletId,
        userId: input.userId,
        amount: existing.amount,
        currency: existing.currency,
        requestId: existing.id,
        notes: 'user cancelled',
      });

      const updated = await withdrawalRepo.markWithdrawalReversed(
        client,
        input.tenantId,
        existing.id,
        'cancelled',
        reversal.id,
        'user cancelled'
      );
      if (!updated) {
        // Race: someone else (cashier claim, admin) flipped the row.
        throw new BadRequestError('Request is no longer cancellable', {
          reason: 'state_changed',
        });
      }
      return updated;
    }
  );

  await tryAudit(
    {
      tenantId: input.tenantId,
      actorId: input.userId,
      actorType: 'user',
      action: 'user.telebirr.withdrawal.cancel',
      resource: 'telebirr_withdrawal_request',
      resourceId: out.id,
      payload: { amount: out.amount },
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'success',
    },
    { bypassRls: true }
  );

  return { request_id: out.id, status: 'cancelled' };
}

/* ------------------------------------------------------------------------- */
/* Cashier flow                                                              */
/* ------------------------------------------------------------------------- */

export async function claimWithdrawalAsCashier(input: {
  tenantId: string;
  cashierId: string;
  requestId: string;
}) {
  const out = await withTenantClient(
    { tenantId: input.tenantId },
    async (client) => {
      const claimed = await withdrawalRepo.claimWithdrawalForCashier(
        client,
        input.tenantId,
        input.requestId,
        input.cashierId
      );
      if (!claimed) {
        // Either not found, or already claimed by someone else.
        const existing = await withdrawalRepo.findWithdrawalById(
          client,
          input.tenantId,
          input.requestId
        );
        if (!existing) throw new NotFoundError('Withdrawal request not found');
        throw new ConflictError(
          `Cannot claim a withdrawal in status ${existing.status}`,
          { reason: 'not_claimable', status: existing.status }
        );
      }
      return claimed;
    }
  );

  await tryAudit(
    {
      tenantId: input.tenantId,
      actorId: input.cashierId,
      actorType: 'cashier',
      action: 'cashier.telebirr.withdrawal.claim',
      resource: 'telebirr_withdrawal_request',
      resourceId: out.id,
      payload: { amount: out.amount, telebirr_number: out.telebirr_number },
      ip: null,
      userAgent: null,
      status: 'success',
    },
    { bypassRls: true }
  );

  return out;
}

export async function completeWithdrawalAsCashier(input: {
  tenantId: string;
  cashierId: string;
  requestId: string;
  telebirrRef: string;
  notes: string | null;
}) {
  const out = await withTenantClient(
    { tenantId: input.tenantId },
    async (client) => {
      const updated = await withdrawalRepo.markWithdrawalCompleted(
        client,
        input.tenantId,
        input.requestId,
        input.cashierId,
        input.telebirrRef,
        input.notes
      );
      if (!updated) {
        const existing = await withdrawalRepo.findWithdrawalById(
          client,
          input.tenantId,
          input.requestId
        );
        if (!existing) throw new NotFoundError('Withdrawal request not found');
        if (existing.cashier_id !== input.cashierId) {
          throw new ForbiddenError(
            'Only the cashier holding the request may complete it',
            { reason: 'not_holder' }
          );
        }
        throw new BadRequestError(
          `Cannot complete a withdrawal in status ${existing.status}`,
          { reason: 'not_completable', status: existing.status }
        );
      }

      // Flip the linked wallet ledger row from pending → completed so
      // reports treat the money as gone (we keep it 'pending' until
      // we have evidence the SIM transfer actually went through).
      if (updated.debit_transaction_id) {
        await client.query(
          `UPDATE transactions
              SET status = 'completed',
                  metadata = metadata || $2::jsonb
            WHERE id = $1`,
          [
            updated.debit_transaction_id,
            JSON.stringify({ telebirr_ref: input.telebirrRef }),
          ]
        );
      }
      return updated;
    }
  );

  await tryAudit(
    {
      tenantId: input.tenantId,
      actorId: input.cashierId,
      actorType: 'cashier',
      action: 'cashier.telebirr.withdrawal.complete',
      resource: 'telebirr_withdrawal_request',
      resourceId: out.id,
      payload: {
        amount: out.amount,
        telebirr_ref: input.telebirrRef,
        telebirr_number: out.telebirr_number,
      },
      ip: null,
      userAgent: null,
      status: 'success',
    },
    { bypassRls: true }
  );

  return out;
}

export async function rejectWithdrawalAsCashier(input: {
  tenantId: string;
  cashierId: string;
  requestId: string;
  reason: string;
}) {
  return rejectOrCancelWithdrawal({
    tenantId: input.tenantId,
    actorId: input.cashierId,
    actorType: 'cashier',
    requestId: input.requestId,
    newStatus: 'rejected',
    reason: input.reason,
  });
}

/* ------------------------------------------------------------------------- */
/* Admin force-cancel                                                        */
/* ------------------------------------------------------------------------- */

export async function adminCancelWithdrawal(input: {
  tenantId: string;
  actorId: string;
  requestId: string;
  reason: string;
}) {
  return rejectOrCancelWithdrawal({
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorType: 'admin',
    requestId: input.requestId,
    newStatus: 'cancelled',
    reason: input.reason,
  });
}

async function rejectOrCancelWithdrawal(input: {
  tenantId: string;
  actorId: string;
  actorType: 'cashier' | 'admin';
  requestId: string;
  newStatus: 'rejected' | 'cancelled' | 'failed';
  reason: string;
}) {
  const out = await withTenantClient(
    { tenantId: input.tenantId },
    async (client) => {
      const existing = await withdrawalRepo.findWithdrawalById(
        client,
        input.tenantId,
        input.requestId
      );
      if (!existing) throw new NotFoundError('Withdrawal request not found');
      if (!['pending', 'processing'].includes(existing.status)) {
        throw new BadRequestError(
          `Cannot transition a withdrawal in status ${existing.status} to ${input.newStatus}`,
          { reason: 'invalid_state', status: existing.status }
        );
      }

      // Wallet credit reversal — credits the user back the debited amount.
      const wRes = await client.query<{ id: string }>(
        `SELECT id FROM wallets
          WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
          LIMIT 1`,
        [input.tenantId, existing.user_id, existing.currency]
      );
      const walletId = wRes.rows[0]?.id;
      if (!walletId) throw new Error('wallet missing during reversal');
      const reversal = await postReversal(client, {
        tenantId: input.tenantId,
        walletId,
        userId: existing.user_id,
        amount: existing.amount,
        currency: existing.currency,
        requestId: existing.id,
        notes: input.reason,
      });

      const updated = await withdrawalRepo.markWithdrawalReversed(
        client,
        input.tenantId,
        existing.id,
        input.newStatus,
        reversal.id,
        input.reason
      );
      if (!updated) {
        throw new BadRequestError('Request state changed during reversal', {
          reason: 'state_changed',
        });
      }
      return updated;
    }
  );

  await tryAudit(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: `${input.actorType}.telebirr.withdrawal.${input.newStatus}`,
      resource: 'telebirr_withdrawal_request',
      resourceId: out.id,
      payload: {
        amount: out.amount,
        reason: input.reason,
      },
      ip: null,
      userAgent: null,
      status: 'success',
    },
    { bypassRls: true }
  );

  return out;
}

/* ------------------------------------------------------------------------- */
/* Read APIs                                                                 */
/* ------------------------------------------------------------------------- */

export async function listWithdrawals(input: {
  tenantId: string;
  userId: string | null;
  status: withdrawalRepo.TelebirrWithdrawalRow['status'] | null;
  cashierId: string | null;
  from: Date | null;
  to: Date | null;
  search: string | null;
  limit: number;
  offset: number;
}) {
  return withTenantClient({ tenantId: input.tenantId }, async (client) =>
    withdrawalRepo.listWithdrawals(client, {
      tenantId: input.tenantId,
      userId: input.userId,
      status: input.status,
      cashierId: input.cashierId,
      from: input.from,
      to: input.to,
      search: input.search,
      limit: input.limit,
      offset: input.offset,
    })
  );
}

export async function getWithdrawal(input: {
  tenantId: string;
  requestId: string;
  userId?: string | null;
}) {
  return withTenantClient({ tenantId: input.tenantId }, async (client) => {
    const row = await withdrawalRepo.findWithdrawalById(
      client,
      input.tenantId,
      input.requestId
    );
    if (!row) return null;
    if (input.userId && row.user_id !== input.userId) return null;
    return row;
  });
}
