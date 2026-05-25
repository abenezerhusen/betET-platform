/**
 * mobile_tokens
 *  - Push notification + device tracking.
 *  - tenant_id is included to comply with the platform-wide RLS policy
 *    (every table is tenant-scoped). The application MUST set tenant_id
 *    from the authenticated user's tenant when creating a row.
 *  - device_token is unique per user (a single device may re-register on
 *    the same user; collisions across users are rare but allowed).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('mobile_tokens', {
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
    device_token: { type: 'text', notNull: true },
    platform: { type: 'text', notNull: true },
    app_version: { type: 'text' },
    device_model: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'active' },
    last_seen: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
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

  pgm.addConstraint('mobile_tokens', 'mobile_tokens_platform_check', {
    check: "platform IN ('ios','android','web','huawei','windows')",
  });
  pgm.addConstraint('mobile_tokens', 'mobile_tokens_status_check', {
    check: "status IN ('active','revoked','expired')",
  });
  pgm.addConstraint('mobile_tokens', 'mobile_tokens_user_token_unique', {
    unique: ['user_id', 'device_token'],
  });

  pgm.createIndex('mobile_tokens', 'tenant_id');
  pgm.createIndex('mobile_tokens', 'user_id');
  pgm.createIndex('mobile_tokens', 'platform');
  pgm.createIndex('mobile_tokens', 'status');
  pgm.createIndex('mobile_tokens', 'last_seen');
  pgm.createIndex('mobile_tokens', 'created_at');
  pgm.createIndex('mobile_tokens', ['tenant_id', 'user_id']);
  pgm.createIndex('mobile_tokens', ['tenant_id', 'status']);

  pgm.createTrigger('mobile_tokens', 'mobile_tokens_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE mobile_tokens ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE mobile_tokens FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY mobile_tokens_tenant_isolation ON mobile_tokens
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
  pgm.sql(`DROP POLICY IF EXISTS mobile_tokens_tenant_isolation ON mobile_tokens`);
  pgm.dropTrigger('mobile_tokens', 'mobile_tokens_touch_updated_at');
  pgm.dropTable('mobile_tokens');
};
