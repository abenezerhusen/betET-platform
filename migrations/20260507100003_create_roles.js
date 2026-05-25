/**
 * roles
 *  - Tenant-scoped roles with JSON permissions array.
 *  - Built-in role names (e.g. superadmin, tenant_admin, cashier, user) are
 *    represented on users.role; this table allows custom per-tenant roles.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('roles', {
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
    description: { type: 'text' },
    permissions: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'[]'::jsonb"),
    },
    is_system: { type: 'boolean', notNull: true, default: false },
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

  pgm.addConstraint('roles', 'roles_status_check', {
    check: "status IN ('active','disabled')",
  });
  pgm.addConstraint('roles', 'roles_tenant_name_unique', {
    unique: ['tenant_id', 'name'],
  });

  pgm.createIndex('roles', 'tenant_id');
  pgm.createIndex('roles', 'status');
  pgm.createIndex('roles', 'created_at');
  pgm.createIndex('roles', ['tenant_id', 'name']);

  pgm.createTrigger('roles', 'roles_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE roles ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE roles FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY roles_tenant_isolation ON roles
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
  pgm.sql(`DROP POLICY IF EXISTS roles_tenant_isolation ON roles`);
  pgm.dropTrigger('roles', 'roles_touch_updated_at');
  pgm.dropTable('roles');
};
