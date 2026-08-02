/**
 * Affiliate manual payout workflow.
 *
 * Replaces the previous "auto-credit the affiliate wallet" behaviour with a
 * request → approve → paid workflow that mirrors how a real operator settles
 * commissions off-platform (bank transfer / Telebirr).
 *
 *   1. `affiliates` gains payout-account columns so each affiliate can store
 *      their bank details and Telebirr number.
 *
 *   2. `affiliate_withdrawals` is the new ledger of withdrawal requests. An
 *      affiliate raises a request from their self-service dashboard; an
 *      Admin / Super Admin approves it, transfers the money manually, and then
 *      marks it Paid (or Rejects it). Every state transition and the payout
 *      destination snapshot is stored for a complete, auditable history.
 *
 * Both changes are additive; existing affiliate CRUD / commission tracking
 * keeps working unchanged.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // ---------------------------------------------------------------------
  // 1. Payout-account columns on `affiliates`
  // ---------------------------------------------------------------------
  pgm.sql(`
    ALTER TABLE affiliates
      ADD COLUMN IF NOT EXISTS bank_name           text,
      ADD COLUMN IF NOT EXISTS bank_account_name   text,
      ADD COLUMN IF NOT EXISTS bank_account_number text,
      ADD COLUMN IF NOT EXISTS telebirr_number     text
  `);

  // ---------------------------------------------------------------------
  // 2. Affiliate withdrawal requests
  // ---------------------------------------------------------------------
  pgm.createTable('affiliate_withdrawals', {
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
    affiliate_id: {
      type: 'uuid',
      notNull: true,
      references: 'affiliates(id)',
      onDelete: 'CASCADE',
    },
    /** Convenience copy of the affiliate's linked user (may be null). */
    user_id: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    amount: { type: 'numeric(18,2)', notNull: true },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    /** bank | telebirr */
    method: { type: 'text', notNull: true },
    /** Snapshot of the payout destination at request time (account details). */
    destination: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    /** pending | approved | paid | rejected */
    status: { type: 'text', notNull: true, default: 'pending' },
    /** Bank/Telebirr transfer reference captured when marked Paid. */
    reference: { type: 'text' },
    /** Free-text note from the reviewing admin (esp. on rejection). */
    admin_note: { type: 'text' },
    requested_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    reviewed_at: { type: 'timestamptz' },
    reviewed_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    paid_at: { type: 'timestamptz' },
    paid_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
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
    'affiliate_withdrawals',
    'affiliate_withdrawals_status_check',
    { check: "status IN ('pending','approved','paid','rejected')" }
  );
  pgm.addConstraint(
    'affiliate_withdrawals',
    'affiliate_withdrawals_method_check',
    { check: "method IN ('bank','telebirr')" }
  );
  pgm.addConstraint(
    'affiliate_withdrawals',
    'affiliate_withdrawals_amount_positive',
    { check: 'amount > 0' }
  );

  pgm.createIndex('affiliate_withdrawals', 'tenant_id');
  pgm.createIndex('affiliate_withdrawals', 'affiliate_id');
  pgm.createIndex('affiliate_withdrawals', 'status');
  pgm.createIndex('affiliate_withdrawals', ['tenant_id', 'status']);

  // RLS — mirror the existing tenant-isolation policy used elsewhere.
  pgm.sql(`ALTER TABLE affiliate_withdrawals ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE affiliate_withdrawals FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY affiliate_withdrawals_tenant_isolation
      ON affiliate_withdrawals
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
    CREATE OR REPLACE FUNCTION affiliate_withdrawals_touch_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_affiliate_withdrawals_updated_at
      ON affiliate_withdrawals;
    CREATE TRIGGER trg_affiliate_withdrawals_updated_at
      BEFORE UPDATE ON affiliate_withdrawals
      FOR EACH ROW EXECUTE FUNCTION affiliate_withdrawals_touch_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `DROP POLICY IF EXISTS affiliate_withdrawals_tenant_isolation
       ON affiliate_withdrawals`
  );
  pgm.dropTable('affiliate_withdrawals', { ifExists: true });
  // Payout-account columns on `affiliates` are intentionally left in place;
  // a dedicated cleanup migration can drop them if ever needed.
};
