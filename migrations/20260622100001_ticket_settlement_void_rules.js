/**
 * Ticket Settlement & Void Rules — extended statuses, audit trail, and
 * postponement fields required by the full settlement specification.
 *
 * Design principles:
 *   - All new columns use IF NOT EXISTS / DO-blocks so the migration is
 *     safe to re-run on environments that already have partial shapes.
 *   - Existing status values ('pending','won','lost','void','cashout',
 *     'partial') on sportsbook_bets are preserved; the new
 *     `settlement_status` column carries the extended vocabulary while
 *     the core column retains backward-compat values.
 *   - sportsbook_bet_legs gets `selection_status` (extended) alongside
 *     the existing `status` column.
 *   - sports_events gets new statuses added to its check constraint via
 *     a safe DROP-then-ADD pattern identical to the one already used in
 *     migration 20260525170001.
 *   - A new `settlement_audit_logs` table captures every settlement
 *     action with full before/after state for the audit log page.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  /* ------------------------------------------------------------------ */
  /* 1. sportsbook_bets — extended settlement columns                    */
  /* ------------------------------------------------------------------ */
  pgm.sql(`
    ALTER TABLE sportsbook_bets
      ADD COLUMN IF NOT EXISTS settlement_status   text,
      ADD COLUMN IF NOT EXISTS void_reason         text,
      ADD COLUMN IF NOT EXISTS settlement_reason   text,
      ADD COLUMN IF NOT EXISTS original_odds       numeric(20,8),
      ADD COLUMN IF NOT EXISTS recalculated_odds   numeric(20,8),
      ADD COLUMN IF NOT EXISTS postponed_at        timestamptz,
      ADD COLUMN IF NOT EXISTS postpone_wait_hours integer NOT NULL DEFAULT 48,
      ADD COLUMN IF NOT EXISTS settled_by          uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS review_required     boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS settlement_error    text
  `);

  /* Back-fill original_odds for existing rows that already have total_odds. */
  pgm.sql(`
    UPDATE sportsbook_bets
       SET original_odds = total_odds
     WHERE original_odds IS NULL
       AND total_odds IS NOT NULL
  `);

  /* Populate settlement_status from existing status for already-settled rows. */
  pgm.sql(`
    UPDATE sportsbook_bets
       SET settlement_status = CASE
             WHEN status = 'won'     THEN 'won'
             WHEN status = 'lost'    THEN 'lost'
             WHEN status = 'void'    THEN 'fully_voided'
             WHEN status = 'cashout' THEN 'won'
             WHEN status = 'partial' THEN 'partially_voided'
             ELSE 'pending'
           END
     WHERE settlement_status IS NULL
  `);

  /* ------------------------------------------------------------------ */
  /* 2. sportsbook_bet_legs — selection_status (extended)               */
  /* ------------------------------------------------------------------ */
  pgm.sql(`
    ALTER TABLE sportsbook_bet_legs
      ADD COLUMN IF NOT EXISTS selection_status text,
      ADD COLUMN IF NOT EXISTS void_reason      text,
      ADD COLUMN IF NOT EXISTS original_odds    numeric(10,4),
      ADD COLUMN IF NOT EXISTS settled_odds     numeric(10,4)
  `);

  /* Back-fill selection_status from existing status. */
  pgm.sql(`
    UPDATE sportsbook_bet_legs
       SET selection_status = CASE
             WHEN status = 'won'  THEN 'won'
             WHEN status = 'lost' THEN 'lost'
             WHEN status = 'void' THEN 'voided'
             ELSE 'pending'
           END,
           original_odds = odds_at_placement,
           settled_odds  = odds_at_placement
     WHERE selection_status IS NULL
  `);

  /* ------------------------------------------------------------------ */
  /* 3. sports_events — extend status check constraint                   */
  /* ------------------------------------------------------------------ */
  pgm.sql(`
    DO $$
    DECLARE cname text;
    BEGIN
      SELECT conname INTO cname
        FROM pg_constraint
       WHERE conrelid = 'sports_events'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%scheduled%';
      IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE sports_events DROP CONSTRAINT %I', cname);
      END IF;
      ALTER TABLE sports_events ADD CONSTRAINT sports_events_status_check CHECK (
        status IN (
          'scheduled','live','finished','postponed','cancelled',
          'abandoned','interrupted','void'
        )
      );
    END $$;
  `);

  /* ------------------------------------------------------------------ */
  /* 4. sports_markets — extend status check constraint                  */
  /* ------------------------------------------------------------------ */
  pgm.sql(`
    DO $$
    DECLARE cname text;
    BEGIN
      SELECT conname INTO cname
        FROM pg_constraint
       WHERE conrelid = 'sports_markets'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%open%';
      IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE sports_markets DROP CONSTRAINT %I', cname);
      END IF;
      ALTER TABLE sports_markets ADD CONSTRAINT sports_markets_status_check CHECK (
        status IN ('open','locked','settled','cancelled','void','suspended')
      );
    END $$;
  `);

  /* ------------------------------------------------------------------ */
  /* 5. settlement_audit_logs — full history of every settlement action  */
  /* ------------------------------------------------------------------ */
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS settlement_audit_logs (
      id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      bet_id            uuid        NOT NULL,
      bet_source        text        NOT NULL DEFAULT 'sportsbook_bets',
      leg_id            uuid,
      actor_id          uuid        REFERENCES users(id) ON DELETE SET NULL,
      action            text        NOT NULL,
      old_status        text,
      new_status        text,
      old_odds          numeric(20,8),
      new_odds          numeric(20,8),
      stake             numeric(18,2),
      original_payout   numeric(18,2),
      recalculated_payout numeric(18,2),
      void_reason       text,
      settlement_reason text,
      metadata          jsonb       NOT NULL DEFAULT '{}',
      created_at        timestamptz NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS settlement_audit_bet_id_idx
      ON settlement_audit_logs (bet_id)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS settlement_audit_tenant_created_idx
      ON settlement_audit_logs (tenant_id, created_at DESC)
  `);

  /* ------------------------------------------------------------------ */
  /* 6. settings — postponement_wait_hours default value                 */
  /* ------------------------------------------------------------------ */
  pgm.sql(`
    INSERT INTO settings (tenant_id, key, value)
    SELECT id,
           'settlement.postponement_wait_hours',
           '48'::jsonb
      FROM tenants
    ON CONFLICT (tenant_id, key) DO NOTHING
  `);

  /* ------------------------------------------------------------------ */
  /* 7. Indexes for common settlement queries                            */
  /* ------------------------------------------------------------------ */
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS sbets_settlement_status_idx
      ON sportsbook_bets (tenant_id, settlement_status)
      WHERE settlement_status NOT IN ('won','lost','fully_voided','refunded','cancelled')
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS sbets_postponed_at_idx
      ON sportsbook_bets (postponed_at)
      WHERE postponed_at IS NOT NULL
        AND settlement_status = 'postponed'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS sbets_review_required_idx
      ON sportsbook_bets (tenant_id, review_required)
      WHERE review_required = true
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS sbets_review_required_idx`);
  pgm.sql(`DROP INDEX IF EXISTS sbets_postponed_at_idx`);
  pgm.sql(`DROP INDEX IF EXISTS sbets_settlement_status_idx`);
  pgm.sql(`DROP INDEX IF EXISTS settlement_audit_tenant_created_idx`);
  pgm.sql(`DROP INDEX IF EXISTS settlement_audit_bet_id_idx`);
  pgm.sql(`DROP TABLE IF EXISTS settlement_audit_logs`);
  pgm.sql(`
    ALTER TABLE sportsbook_bet_legs
      DROP COLUMN IF EXISTS settled_odds,
      DROP COLUMN IF EXISTS original_odds,
      DROP COLUMN IF EXISTS void_reason,
      DROP COLUMN IF EXISTS selection_status
  `);
  pgm.sql(`
    ALTER TABLE sportsbook_bets
      DROP COLUMN IF EXISTS settlement_error,
      DROP COLUMN IF EXISTS review_required,
      DROP COLUMN IF EXISTS settled_by,
      DROP COLUMN IF EXISTS postpone_wait_hours,
      DROP COLUMN IF EXISTS postponed_at,
      DROP COLUMN IF EXISTS recalculated_odds,
      DROP COLUMN IF EXISTS original_odds,
      DROP COLUMN IF EXISTS settlement_reason,
      DROP COLUMN IF EXISTS void_reason,
      DROP COLUMN IF EXISTS settlement_status
  `);
};
