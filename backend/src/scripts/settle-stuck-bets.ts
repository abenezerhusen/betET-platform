/**
 * One-time backfill: settle bets stuck as 'pending' even though every one of
 * their selections has already been graded (sports_selections.result set) —
 * the state left behind by the historical settlement bugs (leg propagation +
 * the tax_amount NOT NULL crash on lost/void tickets).
 *
 * Run once after deploying the fixed backend:
 *   npx tsx src/scripts/settle-stuck-bets.ts          # all tenants
 *   TENANT_ID=<uuid> npx tsx src/scripts/settle-stuck-bets.ts   # one tenant
 * or: npm run settle:stuck
 *
 * Safe to run multiple times:
 *  - the leg propagation only touches legs still 'pending', and
 *  - settleBetFromLegs skips tickets already in a terminal status, so a
 *    wallet can never be credited twice.
 *
 * Each ticket settles in its OWN transaction, so one broken ticket cannot
 * abort the rest of the backfill; failures are flagged review_required for
 * the Manual Settlement screen, exactly like the background loop does.
 */
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { settleBetFromLegs } from '../modules/admin/settlement/settlement.service';
import { logger } from '../infrastructure/logger';

async function main() {
  const only = process.env.TENANT_ID?.trim() || null;

  // Tenants that actually have pending sportsbook bets.
  const tenantIds = await withTenantClient(
    { tenantId: null, bypassRls: true, readOnly: true },
    async (c) => {
      const r = await c.query<{ tenant_id: string }>(
        `SELECT DISTINCT tenant_id FROM sportsbook_bets WHERE status = 'pending'`
      );
      return r.rows.map((x) => x.tenant_id).filter((t) => !only || t === only);
    }
  );
  logger.info({ tenants: tenantIds.length }, 'settle-stuck-bets: starting');

  let totalSettled = 0;
  let totalFailed = 0;

  for (const tenantId of tenantIds) {
    // Step 1 — propagate graded selection results onto still-pending legs.
    // Identical semantics to results.service.ts: selection_status uses
    // 'voided' (the value settleBetFromLegs checks) and void legs settle at
    // odds 1.00 so parlays pay the correctly reduced amount.
    const betIds = await withTenantClient(
      { tenantId, bypassRls: true },
      async (c) => {
        const updated = await c.query(
          `UPDATE sportsbook_bet_legs leg
              SET status = sel.result,
                  selection_status = CASE sel.result
                    WHEN 'won' THEN 'won'
                    WHEN 'lost' THEN 'lost'
                    ELSE 'voided'
                  END,
                  settled_odds = CASE WHEN sel.result = 'void'
                                      THEN 1.00 ELSE leg.odds_at_placement END,
                  settled_at = now()
             FROM sports_selections sel
            WHERE leg.tenant_id = $1
              AND leg.selection_id = sel.id
              AND leg.status = 'pending'
              AND sel.result IS NOT NULL`,
          [tenantId]
        );
        logger.info(
          { tenantId, legs: updated.rowCount },
          'settle-stuck-bets: propagated graded selections to legs'
        );

        // Step 2 — pending tickets whose legs are now ALL terminal.
        const bets = await c.query<{ id: string }>(
          `SELECT sb.id
             FROM sportsbook_bets sb
            WHERE sb.status = 'pending' AND sb.tenant_id = $1
              AND EXISTS (SELECT 1 FROM sportsbook_bet_legs l WHERE l.bet_id = sb.id)
              AND NOT EXISTS (
                SELECT 1 FROM sportsbook_bet_legs l
                 WHERE l.bet_id = sb.id AND l.status = 'pending'
              )`,
          [tenantId]
        );
        return bets.rows.map((b) => b.id);
      }
    );
    logger.info(
      { tenantId, bets: betIds.length },
      'settle-stuck-bets: tickets ready to settle'
    );

    // Step 3 — settle each ticket in its own transaction via the real engine
    // (wallet credit + transaction + audit log, duplicate-guard inside).
    for (const betId of betIds) {
      try {
        const res = await withTenantClient({ tenantId, bypassRls: true }, (c) =>
          settleBetFromLegs(c, {
            tenantId,
            betId,
            actorId: null,
            reason: 'backfill_settle_stuck_bets',
          })
        );
        logger.info({ tenantId, betId, ...res }, 'settle-stuck-bets: settled');
        totalSettled += 1;
      } catch (err) {
        totalFailed += 1;
        logger.error({ err, tenantId, betId }, 'settle-stuck-bets: failed');
        // Surface the ticket on the Manual Settlement screen instead of
        // leaving it silently stuck (same behaviour as the background loop).
        await withTenantClient({ tenantId, bypassRls: true }, (c) =>
          c.query(
            `UPDATE sportsbook_bets
                SET settlement_status = 'error',
                    settlement_error = $1,
                    review_required = true
              WHERE id = $2 AND status = 'pending'`,
            [String(err instanceof Error ? err.message : err), betId]
          )
        ).catch(() => undefined);
      }
    }
  }

  logger.info(
    { settled: totalSettled, failed: totalFailed },
    'settle-stuck-bets: done'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'settle-stuck-bets: fatal');
    process.exit(1);
  });
