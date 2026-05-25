/**
 * settings
 *  - Tenant-scoped key/value config (general, payment, security, sms, etc.).
 *  - One value per (tenant_id, key). Use category to bucket settings in UI.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('settings', {
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
    key: { type: 'text', notNull: true },
    value: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    description: { type: 'text' },
    category: { type: 'text' },
    updated_by: {
      type: 'uuid',
      references: 'users(id)',
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

  pgm.addConstraint('settings', 'settings_tenant_key_unique', {
    unique: ['tenant_id', 'key'],
  });

  pgm.createIndex('settings', 'tenant_id');
  pgm.createIndex('settings', 'category');
  pgm.createIndex('settings', 'created_at');
  pgm.createIndex('settings', ['tenant_id', 'key']);
  pgm.createIndex('settings', ['tenant_id', 'category']);

  pgm.createTrigger('settings', 'settings_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE settings ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE settings FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY settings_tenant_isolation ON settings
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
  pgm.sql(`DROP POLICY IF EXISTS settings_tenant_isolation ON settings`);
  pgm.dropTrigger('settings', 'settings_touch_updated_at');
  pgm.dropTable('settings');
};
