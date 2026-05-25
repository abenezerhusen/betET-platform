import crypto from 'node:crypto';
import type { Request } from 'express';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ConflictError, NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { emitToAdmins, emitToUser, emitWalletUpdated } from '../../../realtime/socket';
import * as walletRepo from '../wallets/wallets.repository';
import { getAdminScope, getIp, getUa, requireScopedTenantId } from '../admin-shared';
import * as repo from './p2p.repository';
import {
  sendEmailBestEffort,
  sendSmsBestEffort,
} from '../../notifications/notifications.service';
import type {
  AddSubAccountInput,
  ApproveDepositInput,
  ApproveWithdrawalInput,
  BroadcastCommandInput,
  CreateOperatorInput,
  IssueAccessTokenInput,
  IssueCommandInput,
  ListCommandsQuery,
  ListDepositQueueQuery,
  ListEventLogsQuery,
  ListOperatorsQuery,
  ListSwapsQuery,
  ListWalletDevicesQuery,
  ListWithdrawalQueueQuery,
  RegisterWalletDeviceInput,
  RejectDepositInput,
  RejectWithdrawalInput,
  SetApprovalThresholdInput,
  SetOperatorAssignmentsInput,
  SetOperatorPermissionsInput,
  SetWalletPriorityInput,
  SwitchWithdrawalWalletInput,
  ToggleSubAccountInput,
  TopUpInput,
  UpdateCommandStatusInput,
  UpdateOperatorInput,
  UpdateP2pSettingsInput,
  UpdateWalletDeviceInput,
  UpsertClientCommissionInput,
  UpsertWalletCommissionInput,
  WithdrawalSwapInput,
} from './p2p.dto';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Thin wrapper over `tryAudit` that lets call sites pass the convenient
 * `before`/`after`/`meta` fields directly; we re-package them into the
 * canonical `payload` shape audit_logs expects.
 */
function audit(args: {
  tenantId: string | null;
  actorId: string | null;
  actorType: 'admin' | 'superadmin';
  action: string;
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  status?: 'success' | 'failure' | 'warning' | 'info';
  ip: string | null;
  userAgent: string | null;
}): void {
  const payload: Record<string, unknown> = {};
  if (args.before !== undefined) payload.before = args.before;
  if (args.after !== undefined) payload.after = args.after;
  if (args.meta !== undefined) Object.assign(payload, args.meta);
  void tryAudit(
    {
      tenantId: args.tenantId,
      actorId: args.actorId,
      actorType: args.actorType,
      action: args.action,
      resource: args.resource,
      resourceId: args.resourceId ?? null,
      payload,
      ip: args.ip,
      userAgent: args.userAgent,
      status: args.status ?? 'success',
    },
    { bypassRls: true }
  );
}

/* ========================================================================== */
/* Dashboard                                                                  */
/* ========================================================================== */

export async function getDashboard(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const [kpis, agents, priority, walletStatus, activity] = await Promise.all([
        repo.dashboardKpis(client, scope.tenantId),
        repo.listAgents(client, scope.tenantId, {
          status: null,
          search: null,
          limit: 50,
          offset: 0,
        }),
        repo.listWalletPriority(client, scope.tenantId),
        repo.dashboardWalletStatus(client, scope.tenantId),
        repo.dashboardActivityFeed(client, scope.tenantId, 20),
      ]);
      return {
        kpis,
        agents: agents.rows,
        priority,
        wallet_status: walletStatus,
        capacity: walletStatus.map((w) => ({
          agent_id: w.agent_id,
          agent_name: w.agent_name,
          pre_deposit: w.pre_deposit,
          commission_rate: w.commission_rate,
          total_capacity: w.total_capacity,
          available_capacity: w.available_capacity,
          used_today: w.used_today,
          earned_today: w.earned_today,
        })),
        activity_feed: activity,
      };
    }
  );
}

/* ========================================================================== */
/* Transactions (unified deposits + withdrawals)                              */
/* ========================================================================== */

export async function listTransactions(
  req: Request,
  q: {
    tab: 'all' | 'deposit' | 'withdrawal' | 'failed';
    status: string | null;
    agentId: string | null;
    search: string | null;
    from: Date | null;
    to: Date | null;
    page: number;
    limit: number;
  }
) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) =>
      repo.listUnifiedTransactions(client, scope.tenantId, {
        tab: q.tab,
        status: q.status,
        agentId: q.agentId,
        search: q.search,
        from: q.from,
        to: q.to,
        limit: q.limit,
        offset,
      })
  );
  return {
    items: data.rows,
    total: data.total,
    page: q.page,
    limit: q.limit,
  };
}

/* ========================================================================== */
/* Wallet devices                                                              */
/* ========================================================================== */

export async function listWalletDevices(req: Request, q: ListWalletDevicesQuery) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listAgents(client, scope.tenantId, {
        status: q.status ?? null,
        search: q.search ?? null,
        limit: q.limit,
        offset,
      })
  );
  return { items: data.rows, total: data.total, page: q.page, limit: q.limit };
}

export async function getWalletDevice(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const agent = await repo.getAgent(client, id);
      if (!agent) throw new NotFoundError('Wallet device not found');
      const [subAccounts, swaps] = await Promise.all([
        repo.listSubAccounts(client, id),
        repo.listSwaps(client, scope.tenantId, {
          agentId: id,
          source: null,
          status: null,
          limit: 50,
          offset: 0,
        }),
      ]);
      return { ...agent, sub_accounts: subAccounts, swaps: swaps.rows };
    }
  );
}

export async function registerWalletDevice(
  req: Request,
  input: RegisterWalletDeviceInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const deviceId = input.device_id?.trim() || `dev_${crypto.randomUUID()}`;

  const result = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const agent = await repo.createAgent(client, tenantId, {
        agent_name: input.name,
        telebirr_number: input.telebirr_number,
        device_id: deviceId,
      });
      // Initial pre-deposit booked as a "manual" swap row.
      const swap = await repo.createSwap(client, tenantId, {
        agent_id: agent.id,
        amount: input.pre_deposit,
        source: 'manual',
        status: 'added',
        operator_id: scope.actorId,
        note: 'Initial pre-deposit on registration',
      });
      // Default per-wallet commission.
      await repo.upsertWalletCommission(client, tenantId, {
        agent_id: agent.id,
        deposit_pct: input.commission_rate,
        withdrawal_pct: 1.0,
      });
      return { agent, swap };
    }
  );

  audit({
    tenantId,
    actorId: scope.actorId,
    actorType: scope.actorType,
    action: 'p2p.wallet_device.register',
    resource: 'telebirr_agents',
    resourceId: result.agent.id,
    after: result.agent,
    status: 'success',
    ip: getIp(req),
    userAgent: getUa(req),
  });
  emitToAdmins(tenantId, 'P2P_WALLET_DEVICE_REGISTERED', { agent: result.agent });

  return result;
}

export async function updateWalletDevice(
  req: Request,
  id: string,
  patch: UpdateWalletDeviceInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.getAgent(client, id);
      if (!before) throw new NotFoundError('Wallet device not found');
      const updated = await repo.updateAgent(client, id, {
        agent_name: patch.name,
        status: patch.enabled === false ? 'inactive' : patch.status,
      });
      audit({
        tenantId: before.tenant_id,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.wallet_device.update',
        resource: 'telebirr_agents',
        resourceId: id,
        before,
        after: updated,
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      return updated;
    }
  );
}

export async function topUpWalletDevice(
  req: Request,
  id: string,
  input: TopUpInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const agent = await repo.getAgent(client, id);
      if (!agent) throw new NotFoundError('Wallet device not found');
      const swap = await repo.createSwap(client, agent.tenant_id, {
        agent_id: agent.id,
        amount: input.amount,
        source: 'manual',
        status: 'added',
        operator_id: scope.actorId,
        note: input.note ?? 'Manual top-up',
      });
      if (input.re_enable_wallet && agent.status !== 'active') {
        await repo.updateAgent(client, id, { status: 'active' });
      }
      audit({
        tenantId: agent.tenant_id,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.wallet_device.topup',
        resource: 'p2p_swaps',
        resourceId: swap.id,
        after: swap,
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      emitToAdmins(agent.tenant_id, 'P2P_SWAP_ADDED', { swap, agent_id: id });
      return { swap };
    }
  );
}

export async function withdrawalSwap(
  req: Request,
  id: string,
  input: WithdrawalSwapInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const agent = await repo.getAgent(client, id);
      if (!agent) throw new NotFoundError('Wallet device not found');
      const swap = await repo.createSwap(client, agent.tenant_id, {
        agent_id: agent.id,
        amount: input.amount,
        source: 'withdrawal',
        status: 'pending',
        operator_id: scope.actorId,
        ref_user_id: input.ref_user_id ?? null,
        ref_withdrawal_id: input.ref_withdrawal_id ?? null,
        note: input.note ?? null,
      });
      emitToAdmins(agent.tenant_id, 'P2P_SWAP_CREATED', {
        swap,
        agent_id: id,
        source: 'withdrawal',
      });
      return { swap };
    }
  );
}

export async function listWalletSwaps(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const data = await repo.listSwaps(client, scope.tenantId, {
        agentId: id,
        source: null,
        status: null,
        limit: 200,
        offset: 0,
      });
      return { items: data.rows, total: data.total };
    }
  );
}

export async function listAllSwaps(req: Request, q: ListSwapsQuery) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listSwaps(client, scope.tenantId, {
        agentId: q.agent_id ?? null,
        source: q.source ?? null,
        status: q.status ?? null,
        limit: q.limit,
        offset,
      })
  );
  return { items: data.rows, total: data.total, page: q.page, limit: q.limit };
}

export async function confirmSwap(req: Request, swapId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const updated = await repo.updateSwapStatus(client, swapId, 'added');
      if (!updated) throw new NotFoundError('Swap not found');
      emitToAdmins(updated.tenant_id, 'P2P_SWAP_CONFIRMED', { swap: updated });
      return updated;
    }
  );
}

export async function failSwap(req: Request, swapId: string, reason?: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const updated = await repo.updateSwapStatus(client, swapId, 'failed', reason);
      if (!updated) throw new NotFoundError('Swap not found');
      emitToAdmins(updated.tenant_id, 'P2P_SWAP_FAILED', { swap: updated });
      return updated;
    }
  );
}

/* ========================================================================== */
/* Sub-accounts                                                                 */
/* ========================================================================== */

export async function listSubAccounts(req: Request, agentId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const items = await repo.listSubAccounts(client, agentId);
      return { items };
    }
  );
}

export async function addSubAccount(
  req: Request,
  agentId: string,
  input: AddSubAccountInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const agent = await repo.getAgent(client, agentId);
      if (!agent) throw new NotFoundError('Wallet device not found');
      try {
        const item = await repo.addSubAccount(client, agent.tenant_id, agentId, input);
        return item;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Phone already linked to this device');
        }
        throw err;
      }
    }
  );
}

export async function toggleSubAccount(
  req: Request,
  id: string,
  input: ToggleSubAccountInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const item = await repo.toggleSubAccount(client, id, input.enabled);
      if (!item) throw new NotFoundError('Sub-account not found');
      return item;
    }
  );
}

export async function removeSubAccount(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const ok = await repo.removeSubAccount(client, id);
      if (!ok) throw new NotFoundError('Sub-account not found');
      return { ok: true };
    }
  );
}

/* ========================================================================== */
/* Deposit queue (proxy to telebirr_transactions / deposit_requests)            */
/* ========================================================================== */

export async function listDepositQueue(req: Request, q: ListDepositQueueQuery) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`d.tenant_id = $${i}`);
        values.push(scope.tenantId);
        i++;
      }
      if (q.status) {
        const map: Record<string, string> = {
          pending: 'pending',
          approved: 'approved',
          rejected: 'rejected',
        };
        filters.push(`d.status = $${i++}`);
        values.push(map[q.status]);
      }
      if (q.agent_id) {
        filters.push(`d.device_id = $${i++}`);
        values.push(q.agent_id);
      }
      if (q.search) {
        filters.push(
          `(d.telebirr_ref ILIKE $${i} OR d.sender_phone ILIKE $${i} OR d.sender_name ILIKE $${i})`
        );
        values.push(`%${q.search}%`);
        i++;
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const totalRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM p2p_deposits d
           ${where}`,
        values
      );
      const rowsRes = await client.query(
        `SELECT d.id, d.tenant_id, d.amount, d.telebirr_ref AS reference, d.sender_phone,
                d.sender_name, d.status, d.created_at,
                d.device_id AS agent_id, pd.label AS wallet,
                d.user_id, u.email AS user_email, u.phone AS user_phone
           FROM p2p_deposits d
           LEFT JOIN p2p_devices pd ON pd.id = d.device_id
           LEFT JOIN users u ON u.id = d.user_id
           ${where}
         ORDER BY d.created_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      return {
        items: rowsRes.rows,
        total: Number(totalRes.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
      };
    }
  );
}

export async function approveDepositInQueue(
  req: Request,
  txId: string,
  input: ApproveDepositInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const scopedTenantId = requireScopedTenantId(scope);
      // Prompt-2 deposit queue is p2p_deposits; support optional explicit user_id.
      const p2pDeposit = await client.query<{
        id: string;
        tenant_id: string;
        user_id: string | null;
        amount: string;
        status: string;
        telebirr_ref: string | null;
      }>(
        `SELECT id, tenant_id, user_id, amount, status, telebirr_ref
           FROM p2p_deposits
          WHERE id = $1 AND tenant_id = $2
          FOR UPDATE`,
        [txId, scopedTenantId]
      );
      if (!p2pDeposit.rows[0]) {
        throw new NotFoundError('Deposit not found');
      }
      const p2p = p2pDeposit.rows[0];
      if (p2p.status !== 'pending') {
        throw new ConflictError(`Cannot approve a ${p2p.status} deposit`);
      }

      const targetUserId = input.user_id ?? p2p.user_id;
      if (!targetUserId) {
        throw new ConflictError('user_id is required to approve this deposit');
      }
      const userRes = await client.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM users WHERE id = $1 LIMIT 1`,
        [targetUserId]
      );
      const targetUser = userRes.rows[0];
      if (!targetUser) throw new NotFoundError('Target user not found');
      if (targetUser.tenant_id !== scopedTenantId) {
        throw new NotFoundError('Target user not found in admin tenant');
      }
      const resolvedTenantId = scopedTenantId;

      const wallet = await walletRepo.findWalletByIdForUpdate(
        client,
        (
          await client.query<{ id: string }>(
            `SELECT id
               FROM wallets
              WHERE tenant_id = $1 AND user_id = $2 AND currency = 'ETB'
              LIMIT 1`,
            [resolvedTenantId, targetUserId]
          )
        ).rows[0]?.id ??
          (
            await client.query<{ id: string }>(
              `INSERT INTO wallets (tenant_id, user_id, currency, balance)
               VALUES ($1, $2, 'ETB', 0)
               RETURNING id`,
              [resolvedTenantId, targetUserId]
            )
          ).rows[0].id
      );
      if (!wallet) {
        throw new NotFoundError('Target wallet not found');
      }
      const before = wallet.balance;
      const credited = await walletRepo.creditWalletBalance(client, wallet.id, p2p.amount);
      const ledger = await walletRepo.insertWalletTransaction(client, {
        tenantId: resolvedTenantId,
        walletId: wallet.id,
        userId: targetUserId,
        type: 'p2p_deposit',
        amount: p2p.amount,
        beforeBalance: before,
        afterBalance: credited.balance,
        currency: 'ETB',
        reference: p2p.telebirr_ref,
        metadata: {
          method: 'p2p',
          source: 'p2p_deposits_queue',
          p2p_deposit_id: p2p.id,
        },
      });

      await client.query(
        `UPDATE p2p_deposits
            SET status = 'approved',
                user_id = $2,
                approved_by = $3,
                approved_at = now()
          WHERE id = $1`,
        [p2p.id, targetUserId, scope.actorId]
      );

      audit({
        tenantId: resolvedTenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.deposit.approve',
        resource: 'p2p_deposits',
        resourceId: p2p.id,
        meta: {
          note: input.note ?? null,
          user_id: targetUserId,
          amount: p2p.amount,
          wallet_tx_id: ledger.id,
        },
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      emitToAdmins(resolvedTenantId, 'P2P_DEPOSIT_APPROVED', { deposit_id: p2p.id });
      emitWalletUpdated(resolvedTenantId, targetUserId, {
        reason: 'p2p_deposit_approved',
        wallet: credited,
        transaction_id: ledger.id,
      });
      emitToUser(resolvedTenantId, targetUserId, 'PUSH_NOTIFICATION', {
        title: 'Deposit Approved',
        message: `ETB ${p2p.amount} has been credited to your wallet.`,
        type: 'success',
      });
      return { ok: true, deposit_id: p2p.id, wallet_transaction_id: ledger.id };
    }
  );
}

export async function rejectDepositInQueue(
  req: Request,
  txId: string,
  input: RejectDepositInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const scopedTenantId = requireScopedTenantId(scope);
      const tx = await client.query<{ id: string }>(
        `UPDATE p2p_deposits
            SET status = 'rejected',
                rejection_note = $2
          WHERE id = $1 AND tenant_id = $3 AND status = 'pending'
          RETURNING id`,
        [txId, input.reason, scopedTenantId]
      );
      if (!tx.rows[0]) throw new NotFoundError('Deposit not found or not pending');
      const resolvedTenantId = scopedTenantId;
      audit({
        tenantId: resolvedTenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.deposit.reject',
        resource: 'p2p_deposits',
        resourceId: txId,
        meta: { reason: input.reason },
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      if (resolvedTenantId) {
        emitToAdmins(resolvedTenantId, 'P2P_DEPOSIT_REJECTED', { deposit_id: txId });
      }
      return { ok: true, deposit_id: txId };
    }
  );
}

/* ========================================================================== */
/* Withdrawal queue                                                             */
/* ========================================================================== */

export async function listWithdrawalQueue(
  req: Request,
  q: ListWithdrawalQueueQuery
) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const settings = scope.tenantId
        ? await repo.getOrCreateSettings(client, scope.tenantId)
        : null;

      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`r.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.status) {
        const baseStatusMap: Record<string, string[]> = {
          pending: ['pending'],
          processing: ['processing'],
          awaiting_approval: ['pending'],
          success: ['completed'],
          failed: ['rejected', 'failed', 'cancelled'],
        };
        const list = baseStatusMap[q.status] ?? [];
        if (list.length) {
          filters.push(`r.status = ANY($${i++})`);
          values.push(list);
        }
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const rowsRes = await client.query(
        `SELECT r.id, r.tenant_id, r.user_id, r.amount, r.currency, r.status,
                r.telebirr_number, r.account_name, r.requested_at, r.created_at,
                u.email AS user_email, u.phone AS user_phone
           FROM telebirr_withdrawal_requests r
           LEFT JOIN users u ON u.id = r.user_id
           ${where}
         ORDER BY r.created_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      const totalRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM telebirr_withdrawal_requests r ${where}`,
        values
      );

      const threshold = settings ? Number(settings.manual_approval_threshold) : 10000;

      const items = rowsRes.rows.map((r: { amount: string; status: string; [k: string]: unknown }) => ({
        ...r,
        is_awaiting_approval:
          r.status === 'pending' && Number(r.amount) >= threshold,
      }));

      return {
        items,
        total: Number(totalRes.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
        manual_approval_threshold: threshold,
      };
    }
  );
}

export async function setApprovalThreshold(
  req: Request,
  input: SetApprovalThresholdInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const updated = await repo.updateSettings(client, tenantId, {
        manual_approval_threshold: input.manual_approval_threshold,
      });
      audit({
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.withdrawal.set_threshold',
        resource: 'p2p_settings',
        resourceId: tenantId,
        after: { manual_approval_threshold: input.manual_approval_threshold },
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      return updated;
    }
  );
}

export async function approveWithdrawal(
  req: Request,
  withdrawalId: string,
  input: ApproveWithdrawalInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query<{ id: string; tenant_id: string; status: string; user_id: string }>(
        `UPDATE telebirr_withdrawal_requests SET status = 'processing', processed_at = now()
           WHERE id = $1 AND status = 'pending'
           RETURNING id, tenant_id, status, user_id`,
        [withdrawalId]
      );
      if (!r.rows[0]) throw new NotFoundError('Withdrawal not found or not pending');

      // Optionally enqueue a USSD command for the agent.
      if (input.agent_id) {
        await repo.createCommand(client, r.rows[0].tenant_id, {
          agent_id: input.agent_id,
          kind: 'withdraw',
          payload: { withdrawal_id: withdrawalId },
          reference: withdrawalId,
          issued_by: scope.actorId,
        });
      }

      audit({
        tenantId: r.rows[0].tenant_id,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.withdrawal.approve',
        resource: 'telebirr_withdrawal_requests',
        resourceId: withdrawalId,
        meta: { agent_id: input.agent_id, note: input.note },
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      emitToAdmins(r.rows[0].tenant_id, 'P2P_WITHDRAWAL_APPROVED', {
        withdrawal_id: withdrawalId,
      });
      emitToUser(r.rows[0].tenant_id, r.rows[0].user_id, 'P2P_WITHDRAWAL_APPROVED', {
        withdrawal_id: withdrawalId,
      });
      return { ok: true };
    }
  );
}

export async function rejectWithdrawal(
  req: Request,
  withdrawalId: string,
  input: RejectWithdrawalInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query<{ id: string; tenant_id: string; user_id: string }>(
        `UPDATE telebirr_withdrawal_requests SET status = 'rejected', notes = $2
           WHERE id = $1 AND status IN ('pending','processing')
           RETURNING id, tenant_id, user_id`,
        [withdrawalId, input.reason]
      );
      if (!r.rows[0]) throw new NotFoundError('Withdrawal not found');
      audit({
        tenantId: r.rows[0].tenant_id,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.withdrawal.reject',
        resource: 'telebirr_withdrawal_requests',
        resourceId: withdrawalId,
        meta: { reason: input.reason },
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      emitToAdmins(r.rows[0].tenant_id, 'P2P_WITHDRAWAL_REJECTED', {
        withdrawal_id: withdrawalId,
      });
      emitToUser(r.rows[0].tenant_id, r.rows[0].user_id, 'P2P_WITHDRAWAL_REJECTED', {
        withdrawal_id: withdrawalId,
        reason: input.reason,
      });
      return { ok: true };
    }
  );
}

export async function switchWithdrawalWallet(
  req: Request,
  withdrawalId: string,
  input: SwitchWithdrawalWalletInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM telebirr_withdrawal_requests WHERE id = $1`,
        [withdrawalId]
      );
      if (!r.rows[0]) throw new NotFoundError('Withdrawal not found');

      const tenantId = r.rows[0].tenant_id;
      // Mark old open command as cancelled.
      await client.query(
        `UPDATE p2p_commands SET status = 'cancelled', completed_at = now()
           WHERE reference = $1 AND status IN ('pending','sent','executing')`,
        [withdrawalId]
      );
      const cmd = await repo.createCommand(client, tenantId, {
        agent_id: input.agent_id,
        kind: 'withdraw',
        payload: { withdrawal_id: withdrawalId, switched: true },
        reference: withdrawalId,
        issued_by: scope.actorId,
      });
      await repo.logEvent(client, tenantId, {
        agent_id: input.agent_id,
        kind: 'wallet_switch',
        level: 'info',
        message: `Withdrawal ${withdrawalId} switched to ${input.agent_id}`,
        payload: { withdrawal_id: withdrawalId, reason: input.reason ?? null },
      });
      emitToAdmins(tenantId, 'P2P_WITHDRAWAL_SWITCHED', {
        withdrawal_id: withdrawalId,
        agent_id: input.agent_id,
      });
      return { ok: true, command: cmd };
    }
  );
}

/* ========================================================================== */
/* Commands                                                                     */
/* ========================================================================== */

export async function listCommands(req: Request, q: ListCommandsQuery) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listCommands(client, scope.tenantId, {
        status: q.status ?? null,
        agentId: q.agent_id ?? null,
        kind: q.kind ?? null,
        limit: q.limit,
        offset,
      })
  );
  return { items: data.rows, total: data.total, page: q.page, limit: q.limit };
}

export async function issueCommand(req: Request, input: IssueCommandInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const agent = await repo.getAgent(client, input.agent_id);
      if (!agent) throw new NotFoundError('Wallet device not found');
      const cmd = await repo.createCommand(client, tenantId, {
        agent_id: input.agent_id,
        kind: input.kind,
        payload: input.payload ?? {},
        reference: input.reference ?? null,
        issued_by: scope.actorId,
      });
      audit({
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.command.issue',
        resource: 'p2p_commands',
        resourceId: cmd.id,
        after: cmd,
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      emitToAdmins(tenantId, 'P2P_COMMAND_ISSUED', { command: cmd });
      return cmd;
    }
  );
}

export async function broadcastCommand(req: Request, input: BroadcastCommandInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const agentsRes = await client.query<{ id: string }>(
        `SELECT id FROM telebirr_agents WHERE tenant_id = $1 AND status = 'active'`,
        [tenantId]
      );
      const ids = agentsRes.rows.map((r) => r.id);
      const created: repo.CommandRow[] = [];
      for (const agentId of ids) {
        const cmd = await repo.createCommand(client, tenantId, {
          agent_id: agentId,
          kind: input.kind,
          payload: input.payload ?? {},
          reference: 'broadcast',
          issued_by: scope.actorId,
        });
        created.push(cmd);
      }
      audit({
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.command.broadcast',
        resource: 'p2p_commands',
        meta: { kind: input.kind, count: created.length },
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      emitToAdmins(tenantId, 'P2P_COMMAND_BROADCAST', {
        kind: input.kind,
        count: created.length,
      });
      return { count: created.length, commands: created };
    }
  );
}

export async function updateCommandStatus(
  req: Request,
  id: string,
  patch: UpdateCommandStatusInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const updated = await repo.updateCommandStatus(client, id, patch);
      if (!updated) throw new NotFoundError('Command not found');
      emitToAdmins(updated.tenant_id, 'P2P_COMMAND_UPDATED', { command: updated });
      return updated;
    }
  );
}

export async function cancelCommand(req: Request, id: string) {
  return updateCommandStatus(req, id, { status: 'cancelled' });
}

/* ========================================================================== */
/* Operators                                                                    */
/* ========================================================================== */

export async function listOperators(req: Request, q: ListOperatorsQuery) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const list = await repo.listOperators(client, scope.tenantId, {
        role: q.role ?? null,
        status: q.status ?? null,
        search: q.search ?? null,
        limit: q.limit,
        offset,
      });
      // Hydrate assignment lists.
      const items = await Promise.all(
        list.rows.map(async (row) => {
          const assignedAgents = await repo.getOperatorAssignments(client, row.id);
          return { ...row, assigned_agent_ids: assignedAgents };
        })
      );
      return { items, total: list.total };
    }
  );
  return { items: data.items, total: data.total, page: q.page, limit: q.limit };
}

export async function getOperator(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const op = await repo.getOperator(client, id);
      if (!op) throw new NotFoundError('Operator not found');
      const assigned_agent_ids = await repo.getOperatorAssignments(client, id);
      const tokens = await repo.listAccessTokens(client, id);
      return {
        ...op,
        assigned_agent_ids,
        tokens: tokens.map((t) => ({
          id: t.id,
          token_tail: t.token_tail,
          expires_at: t.expires_at,
          revoked_at: t.revoked_at,
          last_used_at: t.last_used_at,
          delivered_to: t.delivered_to,
          created_at: t.created_at,
        })),
      };
    }
  );
}

export async function createOperator(req: Request, input: CreateOperatorInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      let op: repo.OperatorRow;
      try {
        op = await repo.createOperator(client, tenantId, {
          name: input.name,
          email: input.email,
          role: input.role,
          status: input.status,
          permissions: input.permissions,
          user_id: input.user_id ?? null,
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Operator email already exists');
        }
        throw err;
      }
      if (input.assigned_agent_ids.length) {
        await repo.setOperatorAssignments(
          client,
          tenantId,
          op.id,
          input.assigned_agent_ids
        );
      }
      audit({
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.operator.create',
        resource: 'p2p_operators',
        resourceId: op.id,
        after: op,
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      return { ...op, assigned_agent_ids: input.assigned_agent_ids };
    }
  );
}

export async function updateOperator(
  req: Request,
  id: string,
  patch: UpdateOperatorInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.getOperator(client, id);
      if (!before) throw new NotFoundError('Operator not found');
      const updated = await repo.updateOperator(client, id, patch);
      audit({
        tenantId: before.tenant_id,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.operator.update',
        resource: 'p2p_operators',
        resourceId: id,
        before,
        after: updated,
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      return updated;
    }
  );
}

export async function setOperatorAssignments(
  req: Request,
  id: string,
  input: SetOperatorAssignmentsInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const op = await repo.getOperator(client, id);
      if (!op) throw new NotFoundError('Operator not found');
      const result = await repo.setOperatorAssignments(
        client,
        op.tenant_id,
        id,
        input.assigned_agent_ids
      );
      return result;
    }
  );
}

export async function setOperatorPermissions(
  req: Request,
  id: string,
  input: SetOperatorPermissionsInput
) {
  return updateOperator(req, id, { permissions: input.permissions });
}

/* ========================================================================== */
/* Operator access tokens (magic links)                                          */
/* ========================================================================== */

export async function issueAccessToken(
  req: Request,
  operatorId: string,
  input: IssueAccessTokenInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const op = await repo.getOperator(client, operatorId);
      if (!op) throw new NotFoundError('Operator not found');

      // 32-byte random URL-safe token.
      const plaintext = crypto.randomBytes(32).toString('base64url');
      const tokenHash = sha256(plaintext);
      const expiresAt = new Date(Date.now() + input.ttl_hours * 3600 * 1000);

      const row = await repo.insertAccessToken(client, op.tenant_id, {
        operator_id: operatorId,
        token_hash: tokenHash,
        token_tail: plaintext.slice(-8),
        delivered_to: input.delivered_to ?? op.email,
        expires_at: expiresAt,
        created_by: scope.actorId,
      });

      audit({
        tenantId: op.tenant_id,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.operator.token.issue',
        resource: 'p2p_operator_access_tokens',
        resourceId: row.id,
        meta: {
          operator_id: operatorId,
          delivered_to: input.delivered_to ?? op.email,
        },
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });

      await Promise.all([
        sendSmsBestEffort({
          tenantId: op.tenant_id,
          to: null,
          templateCode: 'p2p_operator_token',
          message:
            'P2P operator access token issued for {operator}. Token tail: {token_tail}.',
          variables: { operator: op.name, token_tail: row.token_tail },
        }),
        sendEmailBestEffort({
          tenantId: op.tenant_id,
          to: input.delivered_to ?? op.email,
          subject: 'P2P operator access token issued',
          body: `A new P2P operator token was issued for ${op.name}. Token tail: ${row.token_tail}.`,
        }),
      ]);

      return {
        token: plaintext,
        token_tail: row.token_tail,
        token_hash: row.token_hash,
        expires_at: row.expires_at,
      };
    }
  );
}

export async function rotateAccessToken(
  req: Request,
  operatorId: string,
  input: IssueAccessTokenInput
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const op = await repo.getOperator(client, operatorId);
      if (!op) throw new NotFoundError('Operator not found');
      // Revoke active tokens
      await client.query(
        `UPDATE p2p_operator_access_tokens SET revoked_at = now()
           WHERE operator_id = $1 AND revoked_at IS NULL`,
        [operatorId]
      );
      return issueAccessToken(req, operatorId, input);
    }
  );
}

export async function revokeAccessToken(req: Request, tokenId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const out = await repo.revokeAccessToken(client, tokenId);
      if (!out) throw new NotFoundError('Token not found or already revoked');
      return { ok: true };
    }
  );
}

export async function getOperatorByToken(token: string) {
  const tokenHash = sha256(token);
  return withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client) => {
      const tok = await repo.findAccessTokenByHash(client, tokenHash);
      if (!tok) return null;
      if (tok.revoked_at) return null;
      if (tok.expires_at.getTime() < Date.now()) return null;
      const op = await repo.getOperator(client, tok.operator_id);
      if (!op || op.status !== 'active') return null;
      await repo.touchAccessTokenLastUsed(client, tok.id);
      const assigned = await repo.getOperatorAssignments(client, op.id);
      return { operator: op, assigned_agent_ids: assigned };
    }
  );
}

/* ========================================================================== */
/* Settings & limits                                                             */
/* ========================================================================== */

export async function getSettings(req: Request) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.getOrCreateSettings(client, tenantId)
  );
}

export async function updateSettings(req: Request, input: UpdateP2pSettingsInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const updated = await repo.updateSettings(client, tenantId, input);
      audit({
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.settings.update',
        resource: 'p2p_settings',
        resourceId: tenantId,
        after: input,
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      return updated;
    }
  );
}

export async function getWalletPriority(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const items = await repo.listWalletPriority(client, scope.tenantId);
      return { items };
    }
  );
}

export async function setWalletPriority(req: Request, input: SetWalletPriorityInput) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      await repo.setWalletPriority(client, tenantId, input.items);
      audit({
        tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'p2p.wallet_priority.set',
        resource: 'p2p_wallet_priority',
        meta: { count: input.items.length },
        status: 'success',
        ip: getIp(req),
        userAgent: getUa(req),
      });
      const items = await repo.listWalletPriority(client, tenantId);
      return { items };
    }
  );
}

/* ========================================================================== */
/* Commissions                                                                   */
/* ========================================================================== */

export async function listCommissions(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const [settings, wallets, clients] = await Promise.all([
        scope.tenantId ? repo.getOrCreateSettings(client, scope.tenantId) : null,
        repo.listWalletCommissions(client, scope.tenantId),
        repo.listClientCommissions(client, scope.tenantId),
      ]);
      return {
        defaults: settings
          ? {
              deposit_pct: settings.default_deposit_commission_pct,
              withdrawal_pct: settings.default_withdrawal_commission_pct,
            }
          : null,
        wallets,
        clients,
      };
    }
  );
}

export async function upsertWalletCommission(
  req: Request,
  input: UpsertWalletCommissionInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.upsertWalletCommission(client, tenantId, input)
  );
}

export async function upsertClientCommission(
  req: Request,
  input: UpsertClientCommissionInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.upsertClientCommission(client, tenantId, input)
  );
}

export async function deleteClientCommission(req: Request, userId: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const ok = await repo.deleteClientCommission(client, tenantId, userId);
      if (!ok) throw new NotFoundError('Per-client override not found');
      return { ok: true };
    }
  );
}

/* ========================================================================== */
/* Logs                                                                          */
/* ========================================================================== */

/**
 * Map the spec's tab → existing event-log kind.
 *
 *   tab=sms       → kind=sms_in (incoming SMS — what the spec calls "SMS Logs")
 *   tab=ussd      → kind=ussd
 *   tab=errors    → level=error  (any kind, level error)
 *   tab=switches  → kind=wallet_switch
 */
function applyLogsTab(q: ListEventLogsQuery) {
  let kind = q.kind ?? null;
  let level = q.level ?? null;
  switch (q.tab) {
    case 'sms':
      kind = kind ?? 'sms_in';
      break;
    case 'ussd':
      kind = kind ?? 'ussd';
      break;
    case 'errors':
      level = level ?? 'error';
      break;
    case 'switches':
      kind = kind ?? 'wallet_switch';
      break;
    default:
      break;
  }
  return { kind, level };
}

export async function listEventLogs(req: Request, q: ListEventLogsQuery) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  const { kind, level } = applyLogsTab(q);
  const data = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      repo.listEventLogs(client, scope.tenantId, {
        kind,
        level,
        agentId: q.agent_id ?? null,
        search: q.search ?? null,
        from: q.from ?? null,
        to: q.to ?? null,
        limit: q.limit,
        offset,
      })
  );
  return { items: data.rows, total: data.total, page: q.page, limit: q.limit };
}

// Also exposes a writer used by other modules (e.g. fraud, withdrawal flow).
export async function recordEventLog(
  tenantId: string,
  input: Parameters<typeof repo.logEvent>[2]
) {
  return withTenantClient({ tenantId, bypassRls: false }, async (client) =>
    repo.logEvent(client, tenantId, input)
  );
}

