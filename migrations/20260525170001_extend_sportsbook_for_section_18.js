/**
 * Section 18 — How Betting Works End to End.
 *
 *   sportsbook_bets gets the columns required by the end-to-end betting
 *   flow described in Section 18:
 *
 *     - idempotency_key  -- POST /api/bets/place uses a client-generated
 *                           key to prevent accidental double-spend on
 *                           network retries.
 *     - total_odds       -- product of leg odds, frozen at placement.
 *     - tax_amount       -- winning_tax_rate × payout, only when
 *                           net_pay > winning_tax_threshold.
 *     - cashout_amount   -- amount credited if the user takes early
 *                           cashout via POST /api/bets/:id/cashout.
 *     - coupon_code      -- human-readable ticket number for receipts
 *                           and coupon-check screens. Generated column
 *                           SBK-YYMMDD-XXXXXXXX where XXXXXXXX is the
 *                           first 8 chars of the bet UUID.
 *
 *   All columns are added IF NOT EXISTS so the migration is idempotent
 *   and safe to re-run against environments that already have partial
 *   shapes (e.g. test fixtures).
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    ALTER TABLE sportsbook_bets
      ADD COLUMN IF NOT EXISTS idempotency_key text,
      ADD COLUMN IF NOT EXISTS total_odds       numeric(20,8),
      ADD COLUMN IF NOT EXISTS tax_amount       numeric(18,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cashout_amount   numeric(18,2),
      ADD COLUMN IF NOT EXISTS cashout_at       timestamptz,
      ADD COLUMN IF NOT EXISTS cashout_available boolean      NOT NULL DEFAULT true
  `);

  // Generated coupon column: SBK-YYMMDD-XXXXXXXX
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'sportsbook_bets' AND column_name = 'coupon_code'
      ) THEN
        ALTER TABLE sportsbook_bets
          ADD COLUMN coupon_code text
          GENERATED ALWAYS AS (
            'SBK-'
            || to_char(placed_at, 'YYMMDD')
            || '-'
            || upper(substr(id::text, 1, 8))
          ) STORED;
      END IF;
    END $$;
  `);

  // Unique per (tenant_id, user_id, idempotency_key) — re-sends of the
  // same key produce the same row instead of duplicate spend.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      sportsbook_bets_idempotency_uniq
      ON sportsbook_bets (tenant_id, user_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS sportsbook_bets_coupon_code_idx
      ON sportsbook_bets (coupon_code)
  `);

  // Extend the transactions.type check to include the cashout entry.
  // Done via DROP + ADD because the original constraint name is the
  // pg-migrate default ('transactions_type_check'). We probe for the
  // exact constraint name at runtime so this migration doesn't break
  // when pg-migrate changes its naming convention in a future release.
  pgm.sql(`
    DO $$
    DECLARE
      cname text;
    BEGIN
      SELECT conname INTO cname
        FROM pg_constraint
       WHERE conrelid = 'transactions'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%bet_stake%';
      IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', cname);
      END IF;
      ALTER TABLE transactions ADD CONSTRAINT transactions_type_check CHECK (
        type IN (
          'deposit','withdrawal','bet_stake','bet_win','bet_refund',
          'bet_cashout','bonus_credit','bonus_debit','transfer_in',
          'transfer_out','adjustment','commission','cashier_deposit',
          'cashier_withdrawal','p2p_deposit','p2p_withdrawal',
          'jackpot_win','rollback'
        )
      );
    END $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS sportsbook_bets_coupon_code_idx`);
  pgm.sql(`DROP INDEX IF EXISTS sportsbook_bets_idempotency_uniq`);
  pgm.sql(`
    ALTER TABLE sportsbook_bets
      DROP COLUMN IF EXISTS coupon_code,
      DROP COLUMN IF EXISTS cashout_available,
      DROP COLUMN IF EXISTS cashout_at,
      DROP COLUMN IF EXISTS cashout_amount,
      DROP COLUMN IF EXISTS tax_amount,
      DROP COLUMN IF EXISTS total_odds,
      DROP COLUMN IF EXISTS idempotency_key
  `);
};
