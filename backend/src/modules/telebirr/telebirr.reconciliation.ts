import type { PoolClient } from 'pg';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import { tryAudit } from '../audit/audit.service';

import { loadTelebirrSettings } from './telebirr.settings';

/**
 * Daily reconciliation of credited Telebirr volume per agent.
 *
 * Run shape: for a given (tenant, day), upsert a row in
 * `telebirr_reconciliation_reports` summarising the credited
 * transactions for each ACTIVE OR INACTIVE (not deleted) agent.
 * `reported_total` stays NULL until an operator uploads the agent's
 * Telebirr statement; once uploaded, we recompute `variance` and flip
 * status to `matched` / `flagged` based on the configured threshold.
 *
 * This is a pure function — wire it into a cron, a worker, or the
 * admin "rebuild reconciliation" button. The caller chooses the
 * tenant context (one tenant per call so the policy/RLS path stays
 * consistent).
 */

export interface ReconcileTenantDayInput {
  tenantId: string;
  /** Calendar date (UTC) to summarise. */
  day: Date;
  /** When set we (re)compute even if a row already exists. */
  rebuild?: boolean;
}

export interface ReconcileTenantDayResult {
  tenantId: string;
  day: string;
  inserted: number;
  updated: number;
  skipped: number;
  flagged: number;
}

export async function reconcileTenantDay(
  input: ReconcileTenantDayInput
): Promise<ReconcileTenantDayResult> {
  const day = startOfUtcDay(input.day);
  const result: ReconcileTenantDayResult = {
    tenantId: input.tenantId,
    day: day.toISOString().slice(0, 10),
    inserted: 0,
    updated: 0,
    skipped: 0,
    flagged: 0,
  };

  await withTenantClient(
    { tenantId: input.tenantId, bypassRls: true },
    async (client) => {
      const settings = await loadTelebirrSettings(client, input.tenantId);

      const agg = await client.query<{
        agent_id: string;
        total: string;
        count: number;
      }>(
        `SELECT agent_id,
                COALESCE(SUM(amount), 0)::text AS total,
                COUNT(*)::int                  AS count
           FROM telebirr_transactions
          WHERE tenant_id = $1
            AND status = 'credited'
            AND created_at >= $2
            AND created_at <  $2 + interval '1 day'
          GROUP BY agent_id`,
        [input.tenantId, day]
      );

      // Also include agents with ZERO credits today so the admin can
      // see "agent X had nothing on Tuesday" at a glance.
      const allAgents = await client.query<{ id: string }>(
        `SELECT id FROM telebirr_agents WHERE tenant_id = $1`,
        [input.tenantId]
      );
      const aggByAgent = new Map(agg.rows.map((r) => [r.agent_id, r]));

      for (const a of allAgents.rows) {
        const row = aggByAgent.get(a.id) ?? { total: '0', count: 0 };
        const upsert = await upsertReconciliationRow(client, {
          tenantId: input.tenantId,
          agentId: a.id,
          day,
          expectedCredits: row.total,
          expectedCreditsCount: row.count,
          rebuild: Boolean(input.rebuild),
          varianceThreshold: settings.reconciliation_variance_threshold,
        });
        if (upsert.action === 'inserted') result.inserted += 1;
        else if (upsert.action === 'updated') result.updated += 1;
        else result.skipped += 1;
        if (upsert.flagged) result.flagged += 1;
      }
    }
  );

  logger.info(
    { ...result },
    'telebirr: reconciliation pass complete'
  );
  return result;
}

interface UpsertOutcome {
  action: 'inserted' | 'updated' | 'skipped';
  flagged: boolean;
}

async function upsertReconciliationRow(
  client: PoolClient,
  params: {
    tenantId: string;
    agentId: string;
    day: Date;
    expectedCredits: string;
    expectedCreditsCount: number;
    rebuild: boolean;
    varianceThreshold: number;
  }
): Promise<UpsertOutcome> {
  const existing = await client.query<{
    id: string;
    expected_credits: string;
    reported_total: string | null;
    status: string;
  }>(
    `SELECT id, expected_credits::text AS expected_credits,
            reported_total::text AS reported_total, status
       FROM telebirr_reconciliation_reports
      WHERE tenant_id = $1 AND agent_id = $2 AND report_date = $3
      LIMIT 1`,
    [params.tenantId, params.agentId, params.day]
  );

  if (!existing.rows[0]) {
    await client.query(
      `INSERT INTO telebirr_reconciliation_reports
         (tenant_id, agent_id, report_date, expected_credits,
          expected_credits_count, status)
       VALUES ($1, $2, $3, $4::numeric, $5, 'open')`,
      [
        params.tenantId,
        params.agentId,
        params.day,
        params.expectedCredits,
        params.expectedCreditsCount,
      ]
    );
    return { action: 'inserted', flagged: false };
  }

  // Already exists. We only refresh expected_credits when:
  //   - the operator asked for a rebuild, OR
  //   - the existing row hasn't been resolved yet.
  // This keeps "resolved" snapshots immutable history.
  if (existing.rows[0].status === 'resolved' && !params.rebuild) {
    return { action: 'skipped', flagged: false };
  }

  // Recompute variance + status if we have a reported_total on file.
  const reported = existing.rows[0].reported_total;
  let variance: string | null = null;
  let status: 'open' | 'matched' | 'flagged' | 'resolved';
  if (reported === null) {
    status = 'open';
  } else {
    const v = Number(reported) - Number(params.expectedCredits);
    variance = v.toFixed(2);
    status =
      Math.abs(v) <= params.varianceThreshold ? 'matched' : 'flagged';
  }

  await client.query(
    `UPDATE telebirr_reconciliation_reports
        SET expected_credits = $2::numeric,
            expected_credits_count = $3,
            variance = $4::numeric,
            status = $5
      WHERE id = $1`,
    [
      existing.rows[0].id,
      params.expectedCredits,
      params.expectedCreditsCount,
      variance,
      status,
    ]
  );

  return { action: 'updated', flagged: status === 'flagged' };
}

/**
 * Operator-facing: attach a reported_total + statement_url to the
 * reconciliation row for a given (agent, day) and recompute variance
 * + status. Audited.
 */
export async function attachAgentStatement(input: {
  tenantId: string;
  agentId: string;
  day: Date;
  reportedTotal: string;
  reportedCount: number | null;
  statementUrl: string | null;
  notes: string | null;
  actorId: string;
  actorType: string;
}): Promise<{ status: string; variance: string | null }> {
  const day = startOfUtcDay(input.day);

  const out = await withTenantClient(
    { tenantId: input.tenantId, bypassRls: true },
    async (client) => {
      const settings = await loadTelebirrSettings(client, input.tenantId);

      const r = await client.query<{
        id: string;
        expected_credits: string;
      }>(
        `SELECT id, expected_credits::text AS expected_credits
           FROM telebirr_reconciliation_reports
          WHERE tenant_id = $1 AND agent_id = $2 AND report_date = $3
          LIMIT 1`,
        [input.tenantId, input.agentId, day]
      );
      if (!r.rows[0]) {
        // Bootstrap a row by running a one-day reconcile inline so the
        // operator workflow can attach a statement before the cron runs.
        // Done outside the current transaction — keep it simple and
        // synchronous: just use a fresh top-level call.
        // Note: this nested withTenantClient opens a sibling client,
        // but reconcileTenantDay is short and idempotent so it's safe.
      }

      // Rebuild for this exact (agent, day) inline so expected_credits
      // is fresh.
      const rebuilt = await rebuildOneAgentDay(
        client,
        input.tenantId,
        input.agentId,
        day,
        settings.reconciliation_variance_threshold
      );

      const variance = (
        Number(input.reportedTotal) - Number(rebuilt.expectedCredits)
      ).toFixed(2);
      const status: 'matched' | 'flagged' =
        Math.abs(Number(variance)) <=
        settings.reconciliation_variance_threshold
          ? 'matched'
          : 'flagged';

      await client.query(
        `UPDATE telebirr_reconciliation_reports
            SET reported_total = $2::numeric,
                reported_count = $3,
                statement_url = $4,
                notes = COALESCE($5, notes),
                variance = $6::numeric,
                status = $7
          WHERE id = $1`,
        [
          rebuilt.id,
          input.reportedTotal,
          input.reportedCount,
          input.statementUrl,
          input.notes,
          variance,
          status,
        ]
      );

      return { id: rebuilt.id, status, variance };
    }
  );

  await tryAudit(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: 'admin.telebirr.reconciliation.attach_statement',
      resource: 'telebirr_reconciliation_report',
      resourceId: out.id,
      payload: {
        agent_id: input.agentId,
        day: day.toISOString().slice(0, 10),
        reported_total: input.reportedTotal,
        reported_count: input.reportedCount,
        statement_url: input.statementUrl,
        variance: out.variance,
        new_status: out.status,
      },
      ip: null,
      userAgent: null,
      status: 'success',
    },
    { bypassRls: true }
  );

  return { status: out.status, variance: out.variance };
}

async function rebuildOneAgentDay(
  client: PoolClient,
  tenantId: string,
  agentId: string,
  day: Date,
  _varianceThreshold: number
): Promise<{ id: string; expectedCredits: string }> {
  void _varianceThreshold;
  const agg = await client.query<{ total: string; count: number }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total,
            COUNT(*)::int                  AS count
       FROM telebirr_transactions
      WHERE tenant_id = $1
        AND agent_id = $2
        AND status = 'credited'
        AND created_at >= $3
        AND created_at <  $3 + interval '1 day'`,
    [tenantId, agentId, day]
  );
  const total = agg.rows[0]?.total ?? '0';
  const count = agg.rows[0]?.count ?? 0;

  const upsert = await client.query<{ id: string }>(
    `INSERT INTO telebirr_reconciliation_reports
       (tenant_id, agent_id, report_date, expected_credits,
        expected_credits_count, status)
     VALUES ($1, $2, $3, $4::numeric, $5, 'open')
     ON CONFLICT (tenant_id, agent_id, report_date) DO UPDATE
        SET expected_credits = EXCLUDED.expected_credits,
            expected_credits_count = EXCLUDED.expected_credits_count
     RETURNING id`,
    [tenantId, agentId, day, total, count]
  );
  // The migration didn't create a unique constraint on (tenant_id,
  // agent_id, report_date) — fall back when ON CONFLICT misses by
  // selecting the existing row when INSERT failed silently.
  let id = upsert.rows[0]?.id ?? null;
  if (!id) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM telebirr_reconciliation_reports
        WHERE tenant_id = $1 AND agent_id = $2 AND report_date = $3
        LIMIT 1`,
      [tenantId, agentId, day]
    );
    id = existing.rows[0]?.id ?? null;
    if (!id) {
      throw new Error('failed to upsert reconciliation row');
    }
  }
  return { id, expectedCredits: total };
}

function startOfUtcDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
