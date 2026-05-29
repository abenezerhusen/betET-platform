/**
 * Section 24 Step 10 — printed ticket-code format on cashier sell.
 *
 * The spec requires the printed receipt to display
 * `TKT-{BRANCH_CODE}-{YYYYMMDD}-{SEQUENCE}` (e.g. `TKT-PC001-20260516-0042`).
 *
 * We can't change the existing `ticket_code` column because:
 *   - it is a STORED generated column whose expression must be IMMUTABLE
 *     and self-contained (no subqueries, no cross-table lookups);
 *   - existing rows already have the simpler `TKT-YYMMDD-XXXXXXXX` format
 *     and are referenced by other tables (audit logs, dashboard counters,
 *     cashier_transactions.metadata).
 *
 * Instead we add a sibling nullable `printed_ticket_code` column that is
 * populated by the `/api/cashier/tickets/:id/sell` handler at the moment
 * the cashier prints the receipt. Both columns coexist:
 *
 *   ticket_code            (auto) — used for backend lookups and audit.
 *   printed_ticket_code    (sell) — what the customer sees on paper.
 *
 * A partial unique index keeps the printed code unique per tenant when
 * present.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE bets
      ADD COLUMN IF NOT EXISTS printed_ticket_code text
  `);
  pgm.sql(`
    ALTER TABLE sportsbook_bets
      ADD COLUMN IF NOT EXISTS printed_ticket_code text
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS bets_printed_ticket_code_uniq
      ON bets (tenant_id, printed_ticket_code)
      WHERE printed_ticket_code IS NOT NULL
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS sportsbook_bets_printed_ticket_code_uniq
      ON sportsbook_bets (tenant_id, printed_ticket_code)
      WHERE printed_ticket_code IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS bets_printed_ticket_code_uniq`);
  pgm.sql(`DROP INDEX IF EXISTS sportsbook_bets_printed_ticket_code_uniq`);
  pgm.sql(`ALTER TABLE bets DROP COLUMN IF EXISTS printed_ticket_code`);
  pgm.sql(`ALTER TABLE sportsbook_bets DROP COLUMN IF EXISTS printed_ticket_code`);
};
