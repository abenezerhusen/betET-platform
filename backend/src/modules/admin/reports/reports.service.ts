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
  type AdminScope,
} from '../admin-shared';
import {
  findSetting,
  upsertSetting,
} from '../settings/settings.repository';
import * as repo from './reports.repository';
import {
  resolveRange,
  type BetsReportQuery,
  type OfflineCashReportQuery,
  type OnlineCashReportQuery,
  type PayableActionInput,
  type PayableReportQuery,
  type RevenueReportQuery,
  type TransactionsReportQuery,
  type UsersReportQuery,
} from './reports.dto';
import { buildKey, invalidate, withCache } from './reports.cache';

const REPORT_CACHE_TTL_SECONDS = 60;

const COMMISSION_SETTING_KEY = 'reports.payable.commission_rates';
const DEFAULT_COMMISSION_RATES = {
  agent: 5, // %
  branch: 3,
  sales: 1,
};

/**
 * Resolve the effective tenant_id used for filtering reports.
 *  - tenant_admin: forced to their own tenant (any tenant_id query is ignored).
 *  - superadmin:   honors ?tenant_id, then x-tenant-id header, else null
 *                  (= cross-tenant aggregation).
 */
function resolveTenantFilter(scope: AdminScope, queryTenantId?: string): string | null {
  if (!scope.isSuperadmin) {
    if (queryTenantId && queryTenantId !== scope.tenantId) {
      throw new ForbiddenError('Cannot query reports for a different tenant');
    }
    return scope.tenantId;
  }
  return queryTenantId ?? scope.tenantId ?? null;
}

function rangeAndTenant(req: Request, query: { from?: Date; to?: Date; tenant_id?: string }) {
  const scope = getAdminScope(req);
  const tenantId = resolveTenantFilter(scope, query.tenant_id);
  const { from, to } = resolveRange(query);
  return { scope, tenantId, from, to };
}

export async function revenueReport(req: Request, query: RevenueReportQuery) {
  const { scope, tenantId, from, to } = rangeAndTenant(req, query);
  const granularity = query.granularity;
  const key = buildKey('revenue', {
    tenantId,
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
  });

  return withCache(key, REPORT_CACHE_TTL_SECONDS, async () =>
    withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const data = await repo.revenueByPeriod(client, {
          tenantId,
          from,
          to,
          granularity,
        });
        return {
          tenant_id: tenantId,
          range: { from: from.toISOString(), to: to.toISOString() },
          granularity,
          summary: data.summary,
          series: data.series,
          cached_for_seconds: REPORT_CACHE_TTL_SECONDS,
        };
      }
    )
  );
}

export async function betsReport(req: Request, query: BetsReportQuery) {
  const { scope, tenantId, from, to } = rangeAndTenant(req, query);
  const granularity = query.granularity;
  const key = buildKey('bets', {
    tenantId,
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
  });

  return withCache(key, REPORT_CACHE_TTL_SECONDS, async () =>
    withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const data = await repo.betsAggregates(client, {
          tenantId,
          from,
          to,
          granularity,
        });
        return {
          tenant_id: tenantId,
          range: { from: from.toISOString(), to: to.toISOString() },
          granularity,
          summary: data.summary,
          series: data.series,
          cached_for_seconds: REPORT_CACHE_TTL_SECONDS,
        };
      }
    )
  );
}

export async function usersReport(req: Request, query: UsersReportQuery) {
  const { scope, tenantId, from, to } = rangeAndTenant(req, query);
  const granularity = query.granularity;
  const key = buildKey('users', {
    tenantId,
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
  });

  return withCache(key, REPORT_CACHE_TTL_SECONDS, async () =>
    withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const data = await repo.userMetrics(client, {
          tenantId,
          from,
          to,
          granularity,
        });
        return {
          tenant_id: tenantId,
          range: { from: from.toISOString(), to: to.toISOString() },
          granularity,
          summary: data.summary,
          series: data.series,
          cached_for_seconds: REPORT_CACHE_TTL_SECONDS,
        };
      }
    )
  );
}

export async function transactionsReport(
  req: Request,
  query: TransactionsReportQuery
) {
  const { scope, tenantId, from, to } = rangeAndTenant(req, query);
  const granularity = query.granularity;
  const key = buildKey('transactions', {
    tenantId,
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
  });

  return withCache(key, REPORT_CACHE_TTL_SECONDS, async () =>
    withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const data = await repo.transactionsAggregates(client, {
          tenantId,
          from,
          to,
          granularity,
        });
        return {
          tenant_id: tenantId,
          range: { from: from.toISOString(), to: to.toISOString() },
          granularity,
          summary: data.summary,
          by_type: data.byType,
          series: data.series,
          cached_for_seconds: REPORT_CACHE_TTL_SECONDS,
        };
      }
    )
  );
}

/* ================================================================== */
/* Section 6 — Online / Offline Cash & Payable                          */
/* ================================================================== */

export async function onlineCashReport(
  req: Request,
  query: OnlineCashReportQuery
) {
  const { scope, tenantId, from, to } = rangeAndTenant(req, query);
  const sport = query.sport ?? null;
  const key = buildKey('online-cash', {
    tenantId,
    from: from.toISOString(),
    to: to.toISOString(),
    sport,
  });

  return withCache(key, REPORT_CACHE_TTL_SECONDS, async () =>
    withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
      async (client) => {
        const data = await repo.onlineCashReport(client, {
          tenantId,
          from,
          to,
          sport: sport ?? undefined,
        });
        return {
          tenant_id: tenantId,
          range: { from: from.toISOString(), to: to.toISOString() },
          filter: { sport },
          summary: data.summary,
          by_day: data.by_day,
          by_sport: data.by_sport,
          cached_for_seconds: REPORT_CACHE_TTL_SECONDS,
        };
      }
    )
  );
}

export async function offlineCashReport(
  req: Request,
  query: OfflineCashReportQuery
) {
  const { scope, tenantId, from, to } = rangeAndTenant(req, query);
  const key = buildKey('offline-cash', {
    tenantId,
    from: from.toISOString(),
    to: to.toISOString(),
    branchId: query.branch_id ?? null,
    cashierId: query.cashier_id ?? null,
  });

  return withCache(key, REPORT_CACHE_TTL_SECONDS, async () =>
    withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
      async (client) => {
        const data = await repo.offlineCashReport(client, {
          tenantId,
          from,
          to,
          branchId: query.branch_id,
          cashierId: query.cashier_id,
        });
        return {
          tenant_id: tenantId,
          range: { from: from.toISOString(), to: to.toISOString() },
          filter: {
            branch_id: query.branch_id ?? null,
            cashier_id: query.cashier_id ?? null,
          },
          summary: data.summary,
          by_branch: data.by_branch,
          by_cashier: data.by_cashier,
          cached_for_seconds: REPORT_CACHE_TTL_SECONDS,
        };
      }
    )
  );
}

/**
 * Resolve commission rates from the tenant's settings, falling back to the
 * platform defaults when the row hasn't been seeded yet.
 */
async function resolveCommissionRates(
  scope: AdminScope,
  tenantId: string
): Promise<{ agent: number; branch: number; sales: number }> {
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls, readOnly: true },
    async (client) => {
      const setting = await findSetting(client, tenantId, COMMISSION_SETTING_KEY);
      const value = (setting?.value as
        | Partial<{ agent: number; branch: number; sales: number }>
        | null
        | undefined) ?? null;
      return {
        agent: Number(value?.agent ?? DEFAULT_COMMISSION_RATES.agent),
        branch: Number(value?.branch ?? DEFAULT_COMMISSION_RATES.branch),
        sales: Number(value?.sales ?? DEFAULT_COMMISSION_RATES.sales),
      };
    }
  );
}

/**
 * Materializes payable rows for the requested scope/range and returns
 * the persisted records (with status). This makes the row IDs stable so
 * the approve/reject endpoints can target individual rows.
 */
export async function payableReport(
  req: Request,
  query: PayableReportQuery
) {
  const scope = getAdminScope(req);
  // Payable is per-tenant: superadmins must scope down via x-tenant-id.
  const tenantId = resolveTenantFilter(scope, query.tenant_id);
  if (!tenantId) {
    throw new BadRequestError(
      'Payable report requires a tenant scope (superadmin must set x-tenant-id or ?tenant_id=)'
    );
  }
  const { from, to } = resolveRange(query);
  const rates = await resolveCommissionRates(scope, tenantId);

  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      // Recompute & upsert rows for the range.
      const computed = await repo.computePayableRows(client, {
        tenantId,
        from,
        to,
        scope: query.scope,
        rates,
      });
      for (const row of computed) {
        await repo.upsertPayableRow(client, tenantId, row);
      }
      const items = await repo.listPayableRecords(client, {
        tenantId,
        scope: query.scope,
        from,
        to,
        status: query.status,
        entityId: query.entity_id,
      });

      const totals = items.reduce(
        (acc, r) => {
          const amt = Number(r.total_payable) || 0;
          acc.total += amt;
          if (r.status === 'pending') acc.pending += amt;
          if (r.status === 'approved') acc.approved += amt;
          if (r.status === 'rejected') acc.rejected += amt;
          if (r.status === 'paid') acc.paid += amt;
          return acc;
        },
        { total: 0, pending: 0, approved: 0, rejected: 0, paid: 0 }
      );

      return {
        tenant_id: tenantId,
        scope: query.scope,
        range: { from: from.toISOString(), to: to.toISOString() },
        commission_rates: rates,
        summary: {
          total: totals.total.toFixed(2),
          pending: totals.pending.toFixed(2),
          approved: totals.approved.toFixed(2),
          rejected: totals.rejected.toFixed(2),
          paid: totals.paid.toFixed(2),
          rows: items.length,
        },
        items,
      };
    }
  );
}

/**
 * Approve / reject a single payable row.
 */
export async function actOnPayable(
  req: Request,
  id: string,
  action: 'approve' | 'reject' | 'mark_paid',
  body: PayableActionInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope, 'Tenant scope required for payable actions');

  const status =
    action === 'approve'
      ? 'approved'
      : action === 'reject'
        ? 'rejected'
        : 'paid';

  const result = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await repo.getPayableRecord(client, tenantId, id);
      if (!existing) {
        throw new NotFoundError('Payable record not found');
      }
      // Only Pending → Approved/Rejected; only Approved → Paid.
      if (action === 'approve' && existing.status !== 'pending') {
        throw new BadRequestError(
          `Cannot approve a payable in status "${existing.status}"`
        );
      }
      if (action === 'reject' && existing.status !== 'pending') {
        throw new BadRequestError(
          `Cannot reject a payable in status "${existing.status}"`
        );
      }
      if (action === 'mark_paid' && existing.status !== 'approved') {
        throw new BadRequestError(
          `Cannot mark paid a payable in status "${existing.status}"`
        );
      }
      return repo.updatePayableStatus(client, {
        tenantId,
        id,
        status,
        actorId: scope.actorId,
        notes: body.notes ?? null,
      });
    }
  );

  if (!result) {
    throw new NotFoundError('Payable record not found');
  }

  void tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: `admin.reports.payable.${action}`,
      resource: 'payable_records',
      resourceId: id,
      payload: {
        scope: result.scope,
        entity_id: result.entity_id,
        period_date: result.period_date,
        amount: result.total_payable,
        notes: body.notes ?? null,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  // Bust any in-memory cached snapshots that include this row.
  invalidate('payable');

  return result;
}

/* Settings -------------------------------------------------------- */

export async function getCommissionRates(req: Request) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  const rates = await resolveCommissionRates(scope, tenantId);
  return { tenant_id: tenantId, rates };
}

export async function setCommissionRates(
  req: Request,
  rates: { agent?: number; branch?: number; sales?: number }
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  const merged = {
    agent: Number(rates.agent ?? DEFAULT_COMMISSION_RATES.agent),
    branch: Number(rates.branch ?? DEFAULT_COMMISSION_RATES.branch),
    sales: Number(rates.sales ?? DEFAULT_COMMISSION_RATES.sales),
  };
  const updated = await withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const row = await upsertSetting(client, {
        tenantId,
        key: COMMISSION_SETTING_KEY,
        value: merged,
        description: 'Default agent/branch/sales commission rates (percent)',
        category: 'reports',
        updatedBy: scope.actorId,
      });
      return row;
    }
  );

  void tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.reports.payable.set_commission_rates',
      resource: 'settings',
      resourceId: updated.id,
      payload: { rates: merged },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  invalidate('payable');
  return { tenant_id: tenantId, rates: merged, updated_at: updated.updated_at };
}
