/**
 * bonus_rules
 *  - Tenant-scoped bonus engine rules (signup, deposit match, referral,
 *    cashback, free bet, loyalty, tournament, custom).
 *  - config jsonb holds the strategy-specific parameters.
 *  - priority disambiguates overlapping rules at evaluation time.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('bonus_rules', {
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
    name: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true },
    config: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    is_active: { type: 'boolean', notNull: true, default: true },
    valid_from: { type: 'timestamptz' },
    valid_to: { type: 'timestamptz' },
    priority: { type: 'integer', notNull: true, default: 0 },
    status: { type: 'text', notNull: true, default: 'active' },
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

  pgm.addConstraint('bonus_rules', 'bonus_rules_type_check', {
    check:
      "type IN ('signup','deposit','referral','cashback','free_bet','loyalty','tournament','custom')",
  });
  pgm.addConstraint('bonus_rules', 'bonus_rules_status_check', {
    check: "status IN ('active','paused','expired','disabled')",
  });
  pgm.addConstraint('bonus_rules', 'bonus_rules_validity_range', {
    check: 'valid_from IS NULL OR valid_to IS NULL OR valid_from < valid_to',
  });
  pgm.addConstraint('bonus_rules', 'bonus_rules_tenant_name_unique', {
    unique: ['tenant_id', 'name'],
  });

  pgm.createIndex('bonus_rules', 'tenant_id');
  pgm.createIndex('bonus_rules', 'type');
  pgm.createIndex('bonus_rules', 'is_active');
  pgm.createIndex('bonus_rules', 'status');
  pgm.createIndex('bonus_rules', 'created_at');
  pgm.createIndex('bonus_rules', ['tenant_id', 'is_active']);
  pgm.createIndex('bonus_rules', ['tenant_id', 'type']);

  pgm.createTrigger('bonus_rules', 'bonus_rules_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE bonus_rules ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE bonus_rules FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY bonus_rules_tenant_isolation ON bonus_rules
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
  pgm.sql(`DROP POLICY IF EXISTS bonus_rules_tenant_isolation ON bonus_rules`);
  pgm.dropTrigger('bonus_rules', 'bonus_rules_touch_updated_at');
  pgm.dropTable('bonus_rules');
};
