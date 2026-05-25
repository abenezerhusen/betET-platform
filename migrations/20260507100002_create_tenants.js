/**
 * tenants
 *  - Root entity for multi-tenant isolation. Every other tenant-scoped table
 *    references tenants(id) via tenant_id.
 *  - RLS uses id (not tenant_id) for self-isolation.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('tenants', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: { type: 'text', notNull: true },
    slug: { type: 'citext', notNull: true, unique: true },
    config: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
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

  pgm.addConstraint('tenants', 'tenants_status_check', {
    check: "status IN ('active','suspended','disabled','pending')",
  });

  pgm.createIndex('tenants', 'status');
  pgm.createIndex('tenants', 'created_at');

  pgm.createTrigger('tenants', 'tenants_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE tenants ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE tenants FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY tenants_isolation ON tenants
    FOR ALL
    USING (
      app_is_bypass_rls()
      OR id = get_tenant_context()
    )
    WITH CHECK (
      app_is_bypass_rls()
      OR id = get_tenant_context()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP POLICY IF EXISTS tenants_isolation ON tenants`);
  pgm.dropTrigger('tenants', 'tenants_touch_updated_at');
  pgm.dropTable('tenants');
};
