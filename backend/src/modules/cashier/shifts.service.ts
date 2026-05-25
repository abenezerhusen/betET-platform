import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError, NotFoundError } from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { getCashierScope, getIp, getUa } from './cashier-shared';
import * as repo from './cashier.repository';
import type { CloseShiftInput, OpenShiftInput } from './cashier.dto';

function buildSummary(
  shift: repo.ShiftRow,
  agg: repo.ShiftAggregates
): Record<string, unknown> {
  const opening = Number(shift.opening_balance);
  const deposits = Number(agg.total_deposits);
  const withdrawals = Number(agg.total_withdrawals);
  const expected = opening + deposits - withdrawals;
  return {
    opening_balance: shift.opening_balance,
    total_deposits: agg.total_deposits,
    total_withdrawals: agg.total_withdrawals,
    deposit_count: agg.deposit_count,
    withdrawal_count: agg.withdrawal_count,
    expected_balance: expected.toFixed(4),
    duration_seconds: Math.floor(
      (Date.now() - new Date(shift.opened_at).getTime()) / 1000
    ),
  };
}

function pickAuditShift(s: repo.ShiftRow): Record<string, unknown> {
  return {
    id: s.id,
    cashier_id: s.cashier_id,
    branch_id: s.branch_id,
    status: s.status,
    opening_balance: s.opening_balance,
    closing_balance: s.closing_balance,
    expected_balance: s.expected_balance,
    variance: s.variance,
    total_deposits: s.total_deposits,
    total_withdrawals: s.total_withdrawals,
    deposit_count: s.deposit_count,
    withdrawal_count: s.withdrawal_count,
    currency: s.currency,
    opened_at: s.opened_at,
    closed_at: s.closed_at,
  };
}

export async function openShift(req: Request, body: OpenShiftInput) {
  const scope = getCashierScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const existing = await repo.findOpenShiftForCashier(
        client,
        scope.tenantId,
        scope.cashierId
      );
      if (existing) {
        throw new BadRequestError(
          'You already have an open shift; close it before opening another',
          { reason: 'shift_already_open', shift_id: existing.id }
        );
      }
      const currency =
        body.currency ?? (await repo.getDefaultCurrency(client, scope.tenantId));
      return repo.insertShift(client, {
        tenantId: scope.tenantId,
        cashierId: scope.cashierId,
        branchId: body.branch_id ?? null,
        openingBalance: body.opening_balance,
        currency,
        notes: body.notes ?? null,
        metadata: body.metadata ?? {},
      });
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.cashierId,
    actorType: 'cashier',
    action: 'cashier.shift.open',
    resource: 'cashier_shift',
    resourceId: result.id,
    payload: { after: pickAuditShift(result) },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  return result;
}

export async function closeShift(req: Request, body: CloseShiftInput) {
  const scope = getCashierScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const before = await repo.findOpenShiftForCashier(
        client,
        scope.tenantId,
        scope.cashierId
      );
      if (!before) {
        throw new NotFoundError('No open shift to close');
      }

      const agg = await repo.aggregateShift(client, before.id);
      const opening = Number(before.opening_balance);
      const expected = opening + Number(agg.total_deposits) - Number(agg.total_withdrawals);
      const closing = Number(body.closing_balance);
      const variance = closing - expected;

      const closed = await repo.closeShift(client, {
        id: before.id,
        closingBalance: body.closing_balance,
        expectedBalance: expected.toFixed(4),
        variance: variance.toFixed(4),
        totalDeposits: agg.total_deposits,
        totalWithdrawals: agg.total_withdrawals,
        depositCount: agg.deposit_count,
        withdrawalCount: agg.withdrawal_count,
        notes: body.notes ?? null,
      });
      if (!closed) {
        // Race: shift was closed concurrently. Read the final state and return.
        const fresh = await repo.findShiftById(client, before.id);
        if (!fresh) throw new NotFoundError('Shift not found');
        return { before, after: fresh, agg };
      }
      return { before, after: closed, agg };
    }
  );

  const summary = buildSummary(result.after, result.agg);

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.cashierId,
    actorType: 'cashier',
    action: 'cashier.shift.close',
    resource: 'cashier_shift',
    resourceId: result.after.id,
    payload: {
      before: pickAuditShift(result.before),
      after: pickAuditShift(result.after),
      summary,
    },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  return {
    shift: result.after,
    summary: {
      ...summary,
      closing_balance: result.after.closing_balance,
      variance: result.after.variance,
    },
  };
}

export async function currentShift(req: Request) {
  const scope = getCashierScope(req);

  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const shift = await repo.findOpenShiftForCashier(
        client,
        scope.tenantId,
        scope.cashierId
      );
      if (!shift) return { shift: null, agg: null };
      const agg = await repo.aggregateShift(client, shift.id);
      return { shift, agg };
    }
  );

  if (!data.shift || !data.agg) {
    return { shift: null, summary: null };
  }
  return {
    shift: data.shift,
    summary: buildSummary(data.shift, data.agg),
  };
}
