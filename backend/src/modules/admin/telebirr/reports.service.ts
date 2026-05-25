import type { Request } from 'express';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import * as telebirrRepo from '../../telebirr/telebirr.repository';
import { getAdminScope, requireScopedTenantId } from '../admin-shared';

import type { ReportsQuery } from './admin.telebirr.dto';

/**
 * Default lookback is 7 days. Granularity defaults to 'day'. The query
 * is bucketed by date_trunc to keep the response size sane on a 90-day
 * range and to play nice with the dashboard time-series charts.
 */
const DEFAULT_LOOKBACK_DAYS = 7;

export async function getReports(req: Request, params: ReportsQuery) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const to = params.to ?? new Date();
  const from =
    params.from ?? new Date(to.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const buckets = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      telebirrRepo.aggregateTelebirrReport(client, {
        tenantId,
        from,
        to,
        granularity: params.granularity,
      })
  );

  // Roll the buckets up into a single `totals` summary so the UI can
  // show headline numbers without re-aggregating client-side.
  let totalDeposited = 0;
  let totalCount = 0;
  let creditedCount = 0;
  let unmatchedCount = 0;
  let manualCount = 0;
  let confirmTimeWeighted = 0;
  for (const b of buckets) {
    totalDeposited += Number(b.total_deposited);
    totalCount += b.transaction_count;
    creditedCount += b.credited_count;
    unmatchedCount += b.unmatched_count;
    manualCount += b.manual_match_count;
    confirmTimeWeighted +=
      Number(b.avg_confirmation_time_seconds) * b.credited_count;
  }
  const matchRatePct =
    totalCount === 0 ? 0 : (creditedCount / totalCount) * 100;
  const manualMatchPct =
    creditedCount === 0 ? 0 : (manualCount / creditedCount) * 100;
  const avgConfirm =
    creditedCount === 0 ? 0 : confirmTimeWeighted / creditedCount;

  return {
    granularity: params.granularity,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      total_deposited: totalDeposited.toFixed(2),
      transaction_count: totalCount,
      credited_count: creditedCount,
      unmatched_count: unmatchedCount,
      manual_match_count: manualCount,
      match_rate_pct: matchRatePct.toFixed(2),
      manual_match_pct: manualMatchPct.toFixed(2),
      avg_confirmation_time_seconds: avgConfirm.toFixed(2),
    },
    buckets,
  };
}
