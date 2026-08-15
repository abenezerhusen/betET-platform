/**
 * Manual end-to-end sync test for the the-odds-api.com v4 provider.
 *
 * Usage:  cd backend && npx tsx test-sync.ts [tenantId]
 *
 * Prerequisites (via the admin panel → Sports Provider, or the DB row):
 *   - api_url  = https://api.the-odds-api.com/v4
 *   - a VALID the-odds-api.com API key (free tier works, ~500 req/month)
 *   - bookmaker set to a v4 bookmaker key, e.g. "draftkings" or "pinnacle"
 *
 * Runs the prematch phase (events + odds import) and the results phase
 * (scores → finalize → auto-settle) with force=true, then prints the
 * counters. Expected on a first successful run: eventsUpserted > 0 and
 * oddsUpserted > 0; resultsFinalized > 0 whenever imported matches finished
 * within the provider's 3-day scores window.
 */
import { pool } from './src/infrastructure/db/pool';
import { runSync } from './src/modules/sports/providers/sync.service';

async function main() {
  let tenantId = process.argv[2];
  if (!tenantId) {
    const r = await pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM sports_data_provider LIMIT 1`
    );
    tenantId = r.rows[0]?.tenant_id;
  }
  if (!tenantId) {
    console.error('No tenant found — pass a tenant id: npx tsx test-sync.ts <tenantId>');
    process.exit(1);
  }
  console.log('tenant:', tenantId);

  console.log('\n--- phase: prematch (events + odds) ---');
  const prematch = await runSync(tenantId, { phase: 'prematch', force: true });
  console.log(JSON.stringify(prematch, null, 2));

  console.log('\n--- phase: results (scores + auto-settle) ---');
  const results = await runSync(tenantId, { phase: 'results', force: true });
  console.log(JSON.stringify(results, null, 2));

  const ok =
    (prematch.eventsUpserted > 0 || prematch.skipped === undefined) &&
    prematch.skipped === undefined;
  console.log(
    '\nsummary:',
    `eventsUpserted=${prematch.eventsUpserted}`,
    `oddsUpserted=${prematch.oddsUpserted}`,
    `resultsFinalized=${results.resultsFinalized ?? 0}`,
    `ticketsSettled=${results.ticketsSettled ?? 0}`,
    `requestsRemaining=${results.requestsRemaining}`,
    prematch.skipped ? `SKIPPED: ${prematch.skipped}` : ok ? 'OK' : ''
  );
  await pool.end();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
