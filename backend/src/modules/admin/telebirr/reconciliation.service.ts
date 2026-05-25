import type { Request } from 'express';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import {
  attachAgentStatement,
  reconcileTenantDay,
} from '../../telebirr/telebirr.reconciliation';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

import type {
  AttachStatementInput,
  ListReconciliationQuery,
  ResolveReconciliationInput,
  RunReconciliationInput,
} from './reconciliation.dto';

interface ReconciliationRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  agent_name: string | null;
  report_date: Date;
  expected_credits: string;
  expected_credits_count: number;
  reported_total: string | null;
  reported_count: number | null;
  variance: string | null;
  status: string;
  notes: string | null;
  statement_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function listReports(
  req: Request,
  params: ListReconciliationQuery
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const filters: string[] = ['r.tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let i = 2;
      if (params.agent_id) {
        filters.push(`r.agent_id = $${i++}`);
        values.push(params.agent_id);
      }
      if (params.status) {
        filters.push(`r.status = $${i++}`);
        values.push(params.status);
      }
      if (params.from) {
        filters.push(`r.report_date >= $${i++}`);
        values.push(params.from);
      }
      if (params.to) {
        filters.push(`r.report_date <= $${i++}`);
        values.push(params.to);
      }
      const where = `WHERE ${filters.join(' AND ')}`;

      const totalRes = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM telebirr_reconciliation_reports r ${where}`,
        values
      );
      const total = totalRes.rows[0].count;

      const rows = await client.query<ReconciliationRow>(
        `SELECT r.id, r.tenant_id, r.agent_id, a.agent_name,
                r.report_date,
                r.expected_credits::text       AS expected_credits,
                r.expected_credits_count,
                r.reported_total::text         AS reported_total,
                r.reported_count,
                r.variance::text               AS variance,
                r.status, r.notes, r.statement_url,
                r.created_at, r.updated_at
           FROM telebirr_reconciliation_reports r
           LEFT JOIN telebirr_agents a ON a.id = r.agent_id
           ${where}
          ORDER BY r.report_date DESC, a.agent_name ASC
          LIMIT $${i++} OFFSET $${i++}`,
        [...values, params.limit, offset]
      );

      return { rows: rows.rows, total };
    }
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
 * Run the daily reconciliation pass for a given day. Defaults to
 * "yesterday UTC" so end-of-day batches don't double-count rows that
 * land in the same calendar minute as the cron.
 */
export async function runReconciliation(
  req: Request,
  body: RunReconciliationInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const day = body.day ?? yesterdayUtc();
  const result = await reconcileTenantDay({
    tenantId,
    day,
    rebuild: body.rebuild ?? false,
  });

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.reconciliation.run',
      resource: 'telebirr_reconciliation_report',
      resourceId: null,
      payload: { ...result },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result;
}

export async function attachStatement(
  req: Request,
  body: AttachStatementInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  if (Number(body.reported_total) < 0) {
    throw new BadRequestError('reported_total must be non-negative', {
      reason: 'invalid_reported_total',
    });
  }

  const result = await attachAgentStatement({
    tenantId,
    agentId: body.agent_id,
    day: body.day,
    reportedTotal: body.reported_total,
    reportedCount: body.reported_count ?? null,
    statementUrl: body.statement_url ?? null,
    notes: body.notes ?? null,
    actorId: scope.actorId,
    actorType: scope.actorType,
  });

  return {
    agent_id: body.agent_id,
    day: body.day.toISOString().slice(0, 10),
    reported_total: body.reported_total,
    variance: result.variance,
    status: result.status,
  };
}

export async function resolveReport(
  req: Request,
  id: string,
  body: ResolveReconciliationInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const updated = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM telebirr_reconciliation_reports
          WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id]
      );
      const row = r.rows[0];
      if (!row) throw new NotFoundError('Reconciliation report not found');
      if (row.status === 'resolved') {
        throw new BadRequestError('Report is already resolved', {
          reason: 'already_resolved',
        });
      }
      const u = await client.query<{ id: string }>(
        `UPDATE telebirr_reconciliation_reports
            SET status = 'resolved',
                notes  = COALESCE($2, notes)
          WHERE id = $1
          RETURNING id`,
        [id, body.notes ?? null]
      );
      return u.rows[0];
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.reconciliation.resolve',
      resource: 'telebirr_reconciliation_report',
      resourceId: id,
      payload: { notes: body.notes ?? null },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return updated;
}

function yesterdayUtc(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
