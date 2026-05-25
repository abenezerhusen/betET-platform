/**
 * payable_records — Section 6: Payable Report (admin panel).
 *
 * Stores the lifecycle of "payables" the platform owes to agents,
 * branches, sales reps, and the rolled-up daily total. Each row is keyed
 * on (tenant_id, scope, entity_id, period_date). Rows are materialized
 * lazily by `GET /api/admin/reports/payable` from the underlying bet/
 * cashier-transaction data; admins can then approve / reject / mark paid
 * via `PATCH /api/admin/reports/payable/:id/{approve,reject}`.
 *
 *   scope ∈ ('daily','agent','branch','sales')
 *
 *   - daily : entity_id IS NULL — the rolled-up total payable for that day.
 *   - agent : entity_id = agent's user.id
 *   - branch: entity_id = branch's user.id (role='branch')
 *   - sales : entity_id = sales rep's user.id (role='sales')
 *
 * Status workflow:
 *   pending → approved → paid
 *   pending → rejected
 *
 * The unique constraints below ensure we get exactly one row per
 * (tenant, scope, entity, day) so the materializer can use an upsert.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('payable_records', {
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
    scope: {
      type: 'text',
      notNull: true,
      check: "scope IN ('daily','agent','branch','sales')",
    },
    entity_id: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    entity_label: { type: 'text' },
    period_date: { type: 'date', notNull: true },
    total_stakes: { type: 'numeric(20,4)', notNull: true, default: 0 },
    total_payouts: { type: 'numeric(20,4)', notNull: true, default: 0 },
    total_payable: { type: 'numeric(20,4)', notNull: true, default: 0 },
    commission_rate: { type: 'numeric(8,4)' },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','approved','rejected','paid')",
    },
    approved_by: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    approved_at: { type: 'timestamptz' },
    rejected_by: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    rejected_at: { type: 'timestamptz' },
    paid_by: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    paid_at: { type: 'timestamptz' },
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

  pgm.createIndex('payable_records', 'tenant_id');
  pgm.createIndex('payable_records', 'scope');
  pgm.createIndex('payable_records', 'period_date');
  pgm.createIndex('payable_records', 'status');
  pgm.createIndex('payable_records', ['tenant_id', 'scope', 'period_date']);

  // Daily rolls up to one row per tenant + day.
  pgm.sql(`
    CREATE UNIQUE INDEX payable_records_daily_uniq
      ON payable_records (tenant_id, period_date)
      WHERE scope = 'daily';
  `);

  // Per-entity rows: one row per (tenant, scope, entity, day).
  pgm.sql(`
    CREATE UNIQUE INDEX payable_records_entity_uniq
      ON payable_records (tenant_id, scope, entity_id, period_date)
      WHERE entity_id IS NOT NULL;
  `);

  pgm.sql(`ALTER TABLE payable_records ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE payable_records FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY payable_records_tenant_isolation ON payable_records
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

  // Auto-bump updated_at on UPDATE so audits always reflect the last edit.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION payable_records_touch_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  pgm.sql(`
    CREATE TRIGGER payable_records_touch_updated_at
      BEFORE UPDATE ON payable_records
      FOR EACH ROW EXECUTE FUNCTION payable_records_touch_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `DROP TRIGGER IF EXISTS payable_records_touch_updated_at ON payable_records`
  );
  pgm.sql(`DROP FUNCTION IF EXISTS payable_records_touch_updated_at()`);
  pgm.sql(
    `DROP POLICY IF EXISTS payable_records_tenant_isolation ON payable_records`
  );
  pgm.dropTable('payable_records');
};
