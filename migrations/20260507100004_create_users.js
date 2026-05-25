/**
 * users
 *  - Tenant-scoped user accounts spanning all panels (Admin, Cashier, User).
 *  - Email/phone uniqueness is per-tenant only, and only when present.
 *  - role is a flat enum-like string capturing every persona used by the
 *    Admin Panel today (superadmin, tenant_admin, admin, agent, branch,
 *    cashier, sales, operator, user, affiliate).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('users', {
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
    email: { type: 'citext' },
    phone: { type: 'text' },
    password_hash: { type: 'text' },
    role: { type: 'text', notNull: true, default: 'user' },
    kyc_status: { type: 'text', notNull: true, default: 'pending' },
    status: { type: 'text', notNull: true, default: 'active' },
    metadata: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    last_login_at: { type: 'timestamptz' },
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

  pgm.addConstraint('users', 'users_role_check', {
    check:
      "role IN ('superadmin','tenant_admin','admin','agent','branch','cashier','sales','operator','user','affiliate')",
  });
  pgm.addConstraint('users', 'users_status_check', {
    check: "status IN ('active','suspended','disabled','pending','banned')",
  });
  pgm.addConstraint('users', 'users_kyc_status_check', {
    check:
      "kyc_status IN ('pending','submitted','verified','rejected','expired')",
  });
  pgm.addConstraint('users', 'users_email_or_phone_required', {
    check: 'email IS NOT NULL OR phone IS NOT NULL',
  });

  pgm.sql(
    `CREATE UNIQUE INDEX users_tenant_email_key ON users (tenant_id, email) WHERE email IS NOT NULL`
  );
  pgm.sql(
    `CREATE UNIQUE INDEX users_tenant_phone_key ON users (tenant_id, phone) WHERE phone IS NOT NULL`
  );

  pgm.createIndex('users', 'tenant_id');
  pgm.createIndex('users', 'role');
  pgm.createIndex('users', 'status');
  pgm.createIndex('users', 'kyc_status');
  pgm.createIndex('users', 'created_at');
  pgm.createIndex('users', ['tenant_id', 'role']);
  pgm.createIndex('users', ['tenant_id', 'status']);
  pgm.createIndex('users', ['tenant_id', 'created_at']);

  pgm.createTrigger('users', 'users_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE users ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE users FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY users_tenant_isolation ON users
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
  pgm.sql(`DROP POLICY IF EXISTS users_tenant_isolation ON users`);
  pgm.dropTrigger('users', 'users_touch_updated_at');
  pgm.dropTable('users');
};
