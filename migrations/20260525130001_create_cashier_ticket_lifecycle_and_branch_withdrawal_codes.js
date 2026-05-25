/**
 * Cashier ticket lifecycle + branch withdrawal codes.
 *
 *   1. `bets` gets the columns the cashier panel needs to track the
 *      ticket lifecycle (sold / paid / cancelled), plus a human-readable
 *      `ticket_code` for the receipt printout.
 *
 *      ticket_code format: TKT-YYMMDD-XXXXXXXX
 *      where YYMMDD is the placement date and XXXXXXXX is the first 8
 *      chars of the bet UUID. Computed as a STORED generated column so
 *      no application code needs to populate it.
 *
 *   2. `branch_withdrawal_codes` is the new table backing the user-panel
 *      "Branch Withdrawal" flow: the user requests a withdrawal online,
 *      receives a single-use code, brings it to any shop, and the cashier
 *      processes it by typing the code (Section 16).
 *
 * Both changes are additive; existing queries against `bets` /
 * `sportsbook_bets` keep working unchanged.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // ---------------------------------------------------------------------
  // 1. Cashier ticket lifecycle columns on `bets`
  // ---------------------------------------------------------------------
  pgm.sql(`
    ALTER TABLE bets
      ADD COLUMN IF NOT EXISTS sold_at                timestamptz,
      ADD COLUMN IF NOT EXISTS sold_by_cashier_id     uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS sold_branch_id         uuid,
      ADD COLUMN IF NOT EXISTS paid_at                timestamptz,
      ADD COLUMN IF NOT EXISTS paid_by_cashier_id     uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS paid_branch_id         uuid,
      ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz,
      ADD COLUMN IF NOT EXISTS cancelled_by_cashier_id uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS cashback_amount        numeric(20,4) NOT NULL DEFAULT 0
  `);

  // ticket_code: generated column. Concat is IMMUTABLE; substr/to_char are
  // IMMUTABLE on (uuid, text) and (timestamptz, text) respectively.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'bets' AND column_name = 'ticket_code'
      ) THEN
        ALTER TABLE bets
          ADD COLUMN ticket_code text
          GENERATED ALWAYS AS (
            'TKT-' ||
            to_char(placed_at, 'YYMMDD') ||
            '-' ||
            upper(substr(id::text, 1, 8))
          ) STORED;
      END IF;
    END$$;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS bets_ticket_code_idx
      ON bets (tenant_id, ticket_code)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS bets_sold_branch_idx
      ON bets (tenant_id, sold_branch_id, sold_at)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS bets_paid_branch_idx
      ON bets (tenant_id, paid_branch_id, paid_at)
  `);

  // ---------------------------------------------------------------------
  // 2. Same lifecycle columns on `sportsbook_bets` (offline sportsbook)
  // ---------------------------------------------------------------------
  pgm.sql(`
    ALTER TABLE sportsbook_bets
      ADD COLUMN IF NOT EXISTS sold_at                timestamptz,
      ADD COLUMN IF NOT EXISTS sold_by_cashier_id     uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS sold_branch_id         uuid,
      ADD COLUMN IF NOT EXISTS paid_at                timestamptz,
      ADD COLUMN IF NOT EXISTS paid_by_cashier_id     uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS paid_branch_id         uuid,
      ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz,
      ADD COLUMN IF NOT EXISTS cancelled_by_cashier_id uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS cashback_amount        numeric(18,2) NOT NULL DEFAULT 0
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'sportsbook_bets' AND column_name = 'ticket_code'
      ) THEN
        ALTER TABLE sportsbook_bets
          ADD COLUMN ticket_code text
          GENERATED ALWAYS AS (
            'TKT-' ||
            to_char(placed_at, 'YYMMDD') ||
            '-' ||
            upper(substr(id::text, 1, 8))
          ) STORED;
      END IF;
    END$$;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS sportsbook_bets_ticket_code_idx
      ON sportsbook_bets (tenant_id, ticket_code)
  `);

  // ---------------------------------------------------------------------
  // 3. Branch withdrawal codes table
  // ---------------------------------------------------------------------
  pgm.createTable('branch_withdrawal_codes', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    /** Single-use, human-readable: 6-10 alphanumeric chars. */
    code: { type: 'text', notNull: true },
    amount: { type: 'numeric(20,4)', notNull: true },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    status: { type: 'text', notNull: true, default: 'pending' },
    cashier_id: { type: 'uuid', references: 'users(id)' },
    branch_id: { type: 'uuid' },
    processed_at: { type: 'timestamptz' },
    expires_at: { type: 'timestamptz', notNull: true },
    metadata: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint(
    'branch_withdrawal_codes',
    'branch_withdrawal_codes_status_check',
    {
      check:
        "status IN ('pending','processed','expired','cancelled')",
    }
  );
  pgm.addConstraint(
    'branch_withdrawal_codes',
    'branch_withdrawal_codes_amount_positive',
    { check: 'amount > 0' }
  );

  pgm.createIndex('branch_withdrawal_codes', 'tenant_id');
  pgm.createIndex('branch_withdrawal_codes', 'user_id');
  pgm.createIndex('branch_withdrawal_codes', 'status');
  pgm.createIndex('branch_withdrawal_codes', 'expires_at');

  // A given code may only be in `pending` state once per tenant — this
  // guarantees the cashier lookup always lands on at most one row even
  // when the same short code is later regenerated after an old one is
  // cancelled/expired.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS branch_withdrawal_codes_active_code_idx
      ON branch_withdrawal_codes (tenant_id, code)
      WHERE status = 'pending'
  `);

  // RLS — mirror the existing tenant-isolation policy used elsewhere.
  pgm.sql(`ALTER TABLE branch_withdrawal_codes ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE branch_withdrawal_codes FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY branch_withdrawal_codes_tenant_isolation
      ON branch_withdrawal_codes
      FOR ALL
      USING (
        app_is_bypass_rls()
        OR tenant_id = get_tenant_context()
      )
      WITH CHECK (
        app_is_bypass_rls()
        OR tenant_id = get_tenant_context()
      )
  `);

  // Touch updated_at automatically.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION branch_withdrawal_codes_touch_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_branch_withdrawal_codes_updated_at
      ON branch_withdrawal_codes;
    CREATE TRIGGER trg_branch_withdrawal_codes_updated_at
      BEFORE UPDATE ON branch_withdrawal_codes
      FOR EACH ROW EXECUTE FUNCTION branch_withdrawal_codes_touch_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `DROP POLICY IF EXISTS branch_withdrawal_codes_tenant_isolation
       ON branch_withdrawal_codes`
  );
  pgm.dropTable('branch_withdrawal_codes', { ifExists: true });
  // Note: we deliberately don't drop the new columns on `bets` /
  // `sportsbook_bets` here — a follow-up cleanup migration can do that
  // explicitly if you ever need to revert.
};
