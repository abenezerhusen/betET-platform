/**
 * refresh_tokens
 *  - Stores the SHA-256 hash of issued refresh tokens for rotation + replay
 *    detection. Tokens themselves are signed JWTs (RS256); the DB row links
 *    them to a tenant + user and tracks lifecycle.
 *  - `family_id` groups every refresh token derived from a single login.
 *    On rotation, the parent row goes status='rotated' and a new row is
 *    inserted in the same family. If a rotated token is presented again
 *    (replay) the entire family must be revoked.
 *  - `jti` is the JWT id and uniquely identifies a single refresh token.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('refresh_tokens', {
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
    jti: { type: 'uuid', notNull: true },
    family_id: { type: 'uuid', notNull: true },
    parent_id: {
      type: 'uuid',
      references: 'refresh_tokens(id)',
      onDelete: 'SET NULL',
    },
    token_hash: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'active' },
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('refresh_tokens', 'refresh_tokens_status_check', {
    check: "status IN ('active','rotated','revoked','expired','reused')",
  });
  pgm.addConstraint('refresh_tokens', 'refresh_tokens_jti_unique', {
    unique: ['jti'],
  });

  pgm.createIndex('refresh_tokens', 'tenant_id');
  pgm.createIndex('refresh_tokens', 'user_id');
  pgm.createIndex('refresh_tokens', 'family_id');
  pgm.createIndex('refresh_tokens', 'status');
  pgm.createIndex('refresh_tokens', 'expires_at');
  pgm.createIndex('refresh_tokens', 'created_at');
  pgm.createIndex('refresh_tokens', ['tenant_id', 'user_id']);
  pgm.createIndex('refresh_tokens', ['tenant_id', 'status']);
  pgm.createIndex('refresh_tokens', ['user_id', 'status']);

  pgm.sql(`ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY refresh_tokens_tenant_isolation ON refresh_tokens
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
    `DROP POLICY IF EXISTS refresh_tokens_tenant_isolation ON refresh_tokens`
  );
  pgm.dropTable('refresh_tokens');
};
