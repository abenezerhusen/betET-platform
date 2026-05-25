/**
 * game_sessions
 *  - One row per launched game session (iframe or native).
 *  - token is a signed launch/session token used in postMessage init.
 *  - status lifecycle: active -> ended | expired | revoked.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('game_sessions', {
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
    game_id: {
      type: 'uuid',
      notNull: true,
      references: 'games(id)',
      onDelete: 'CASCADE',
    },
    token: { type: 'text', notNull: true, unique: true },
    status: { type: 'text', notNull: true, default: 'active' },
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
    started_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    ended_at: { type: 'timestamptz' },
    expires_at: { type: 'timestamptz' },
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

  pgm.addConstraint('game_sessions', 'game_sessions_status_check', {
    check: "status IN ('active','ended','expired','revoked')",
  });

  pgm.createIndex('game_sessions', 'tenant_id');
  pgm.createIndex('game_sessions', 'user_id');
  pgm.createIndex('game_sessions', 'game_id');
  pgm.createIndex('game_sessions', 'status');
  pgm.createIndex('game_sessions', 'started_at');
  pgm.createIndex('game_sessions', 'created_at');
  pgm.createIndex('game_sessions', ['tenant_id', 'user_id']);
  pgm.createIndex('game_sessions', ['tenant_id', 'status']);
  pgm.createIndex('game_sessions', ['tenant_id', 'created_at']);

  pgm.sql(`ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE game_sessions FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY game_sessions_tenant_isolation ON game_sessions
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
  pgm.sql(`DROP POLICY IF EXISTS game_sessions_tenant_isolation ON game_sessions`);
  pgm.dropTable('game_sessions');
};
