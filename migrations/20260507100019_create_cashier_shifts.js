/**
 * cashier_shifts
 *  - Tracks a cashier's working session ("shift") at the counter.
 *  - opening_balance: cash counted in drawer at shift open.
 *  - closing_balance: cash counted at shift close (entered by cashier).
 *  - expected_balance = opening_balance + total_cash_in - total_cash_out
 *  - variance = closing_balance - expected_balance (computed at close).
 *  - Aggregate counters are persisted at close time so closed-shift reports
 *    are not dependent on lazy aggregation later.
 *
 *  Constraint: a cashier can have at most ONE open shift at a time.
 *  Enforced via partial unique index on (cashier_id) WHERE status = 'open'.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('cashier_shifts', {
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
    cashier_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    branch_id: { type: 'uuid' },
    status: { type: 'text', notNull: true, default: 'open' },
    opening_balance: { type: 'numeric(20,4)', notNull: true, default: 0 },
    closing_balance: { type: 'numeric(20,4)' },
    expected_balance: { type: 'numeric(20,4)' },
    variance: { type: 'numeric(20,4)' },
    total_deposits: { type: 'numeric(20,4)', notNull: true, default: 0 },
    total_withdrawals: { type: 'numeric(20,4)', notNull: true, default: 0 },
    deposit_count: { type: 'integer', notNull: true, default: 0 },
    withdrawal_count: { type: 'integer', notNull: true, default: 0 },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    opened_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    closed_at: { type: 'timestamptz' },
    notes: { type: 'text' },
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

  pgm.addConstraint('cashier_shifts', 'cashier_shifts_status_check', {
    check: "status IN ('open','closed','abandoned')",
  });
  pgm.addConstraint('cashier_shifts', 'cashier_shifts_opening_nonneg', {
    check: 'opening_balance >= 0',
  });
  pgm.addConstraint('cashier_shifts', 'cashier_shifts_closing_nonneg', {
    check: 'closing_balance IS NULL OR closing_balance >= 0',
  });

  pgm.createIndex('cashier_shifts', 'tenant_id');
  pgm.createIndex('cashier_shifts', 'cashier_id');
  pgm.createIndex('cashier_shifts', 'status');
  pgm.createIndex('cashier_shifts', 'opened_at');
  pgm.createIndex('cashier_shifts', ['tenant_id', 'cashier_id']);
  pgm.createIndex('cashier_shifts', ['tenant_id', 'status']);

  // At most one OPEN shift per cashier.
  pgm.sql(`
    CREATE UNIQUE INDEX cashier_shifts_one_open_per_cashier
      ON cashier_shifts (cashier_id)
      WHERE status = 'open'
  `);

  pgm.createTrigger('cashier_shifts', 'cashier_shifts_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE cashier_shifts ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE cashier_shifts FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY cashier_shifts_tenant_isolation ON cashier_shifts
    FOR ALL
    USING (
      app_is_bypass_rls()
      OR tenant_id = get_tenant_context()
    )
    WITH CHECK (
      app_is_bypass_rls()
      OR tenant_id = get_tenant_context()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `DROP POLICY IF EXISTS cashier_shifts_tenant_isolation ON cashier_shifts`
  );
  pgm.dropTrigger('cashier_shifts', 'cashier_shifts_touch_updated_at');
  pgm.sql(`DROP INDEX IF EXISTS cashier_shifts_one_open_per_cashier`);
  pgm.dropTable('cashier_shifts');
};
