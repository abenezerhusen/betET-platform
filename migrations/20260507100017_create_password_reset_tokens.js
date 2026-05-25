/**
 * password_reset_tokens
 *  - Stores SHA-256 hash of single-use password reset tokens.
 *  - The plaintext token is delivered to the user via SMS / email by the
 *    notifications module (out-of-scope here; the auth service logs the
 *    token in non-production environments only).
 *  - Tokens are valid until expires_at and only if used_at IS NULL.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('password_reset_tokens', {
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
    token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('password_reset_tokens', 'password_reset_tokens_hash_unique', {
    unique: ['token_hash'],
  });

  pgm.createIndex('password_reset_tokens', 'tenant_id');
  pgm.createIndex('password_reset_tokens', 'user_id');
  pgm.createIndex('password_reset_tokens', 'expires_at');
  pgm.createIndex('password_reset_tokens', 'created_at');
  pgm.createIndex('password_reset_tokens', ['tenant_id', 'user_id']);

  pgm.sql(`ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY password_reset_tokens_tenant_isolation ON password_reset_tokens
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
    `DROP POLICY IF EXISTS password_reset_tokens_tenant_isolation ON password_reset_tokens`
  );
  pgm.dropTable('password_reset_tokens');
};
