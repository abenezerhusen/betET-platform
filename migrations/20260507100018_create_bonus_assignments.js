/**
 * bonus_assignments
 *  - Records each grant of a bonus_rule to a specific user (or members of a
 *    segment when expanded into individual rows).
 *  - Decoupled from wallet ledger: the actual bonus_balance crediting is
 *    typically performed asynchronously by the bonus engine, which can read
 *    these rows.
 *  - awarded_amount captures the resolved value at assignment time so later
 *    edits to the rule do not retroactively change history.
 *  - status: active (in flight) -> completed | forfeited | expired.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('bonus_assignments', {
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
    bonus_rule_id: {
      type: 'uuid',
      notNull: true,
      references: 'bonus_rules(id)',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    awarded_by: {
      type: 'uuid',
      references: 'users(id)',
    },
    awarded_amount: { type: 'numeric(20,4)', notNull: true, default: 0 },
    wagering_required: { type: 'numeric(20,4)', notNull: true, default: 0 },
    wagering_progress: { type: 'numeric(20,4)', notNull: true, default: 0 },
    status: { type: 'text', notNull: true, default: 'active' },
    awarded_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    expires_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
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
  });

  pgm.addConstraint('bonus_assignments', 'bonus_assignments_status_check', {
    check: "status IN ('active','completed','forfeited','expired','cancelled')",
  });
  pgm.addConstraint('bonus_assignments', 'bonus_assignments_amount_nonneg', {
    check: 'awarded_amount >= 0',
  });

  pgm.createIndex('bonus_assignments', 'tenant_id');
  pgm.createIndex('bonus_assignments', 'bonus_rule_id');
  pgm.createIndex('bonus_assignments', 'user_id');
  pgm.createIndex('bonus_assignments', 'status');
  pgm.createIndex('bonus_assignments', 'awarded_at');
  pgm.createIndex('bonus_assignments', 'expires_at');
  pgm.createIndex('bonus_assignments', ['tenant_id', 'user_id']);
  pgm.createIndex('bonus_assignments', ['tenant_id', 'status']);
  pgm.createIndex('bonus_assignments', ['tenant_id', 'bonus_rule_id']);

  pgm.sql(`ALTER TABLE bonus_assignments ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE bonus_assignments FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY bonus_assignments_tenant_isolation ON bonus_assignments
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
    `DROP POLICY IF EXISTS bonus_assignments_tenant_isolation ON bonus_assignments`
  );
  pgm.dropTable('bonus_assignments');
};
