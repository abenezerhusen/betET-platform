/**
 * Sportsbook Tax & Compensation Bonus System.
 *
 * Adds an ADDITIVE audit layer to `sportsbook_bets` that records the tax /
 * bonus breakdown for every ticket. Nothing here changes existing columns or
 * data — every column is added IF NOT EXISTS and is nullable, so:
 *
 *   - Legacy / in-flight tickets (columns NULL) keep settling exactly as
 *     before (no betting tax, no compensation bonus, no winning-tax deduction
 *     inside settleBetFromLegs).
 *   - Only tickets placed AFTER this feature carry a config snapshot and are
 *     therefore subject to the new calculation layer.
 *
 * Stored per the spec (all for auditing):
 *   original_stake, bet_tax_enabled, bet_tax_percent, bet_tax_amount,
 *   effective_stake, gross_payout_before_bonus, compensation_bonus_enabled,
 *   compensation_bonus_percent, compensation_bonus_amount, winning_tax_enabled,
 *   winning_tax_percent, winning_tax_amount, final_payout.
 *
 * NOTE: the existing `tax_amount` column (Section 18) is retained and kept in
 * sync with `winning_tax_amount` at settlement for backward-compatible reads.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sportsbook_bets
      ADD COLUMN IF NOT EXISTS original_stake              numeric(18,2),
      ADD COLUMN IF NOT EXISTS bet_tax_enabled             boolean,
      ADD COLUMN IF NOT EXISTS bet_tax_percent             numeric(6,3),
      ADD COLUMN IF NOT EXISTS bet_tax_amount              numeric(18,2),
      ADD COLUMN IF NOT EXISTS effective_stake             numeric(18,2),
      ADD COLUMN IF NOT EXISTS gross_payout_before_bonus   numeric(18,2),
      ADD COLUMN IF NOT EXISTS compensation_bonus_enabled  boolean,
      ADD COLUMN IF NOT EXISTS compensation_bonus_percent  numeric(6,3),
      ADD COLUMN IF NOT EXISTS compensation_bonus_amount   numeric(18,2),
      ADD COLUMN IF NOT EXISTS winning_tax_enabled         boolean,
      ADD COLUMN IF NOT EXISTS winning_tax_percent         numeric(6,3),
      ADD COLUMN IF NOT EXISTS winning_tax_amount          numeric(18,2),
      ADD COLUMN IF NOT EXISTS final_payout                numeric(18,2)
  `);

  // Helpful for the Sportsbook Tax Report date-range scans.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS sportsbook_bets_tax_report_idx
      ON sportsbook_bets (tenant_id, placed_at)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS sportsbook_bets_tax_report_idx`);
  pgm.sql(`
    ALTER TABLE sportsbook_bets
      DROP COLUMN IF EXISTS original_stake,
      DROP COLUMN IF EXISTS bet_tax_enabled,
      DROP COLUMN IF EXISTS bet_tax_percent,
      DROP COLUMN IF EXISTS bet_tax_amount,
      DROP COLUMN IF EXISTS effective_stake,
      DROP COLUMN IF EXISTS gross_payout_before_bonus,
      DROP COLUMN IF EXISTS compensation_bonus_enabled,
      DROP COLUMN IF EXISTS compensation_bonus_percent,
      DROP COLUMN IF EXISTS compensation_bonus_amount,
      DROP COLUMN IF EXISTS winning_tax_enabled,
      DROP COLUMN IF EXISTS winning_tax_percent,
      DROP COLUMN IF EXISTS winning_tax_amount,
      DROP COLUMN IF EXISTS final_payout
  `);
};
