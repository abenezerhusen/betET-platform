/**
 * telebirr_agent_sessions
 *  - Tracks every login of the Flutter Telebirr SMS Pay Client app on a
 *    paired device. One row is inserted on login; last_active_at is
 *    bumped by every authenticated request; logged_out_at is set on
 *    explicit logout, token revocation, or pairing reset.
 *  - device_fingerprint is the stable identifier reported by the app
 *    (Android ID + install id); ip_address is the originating IP.
 *
 *  Note on tenant_id: the user spec did not list tenant_id on this
 *  table, but it is required for RLS to work consistently with every
 *  other tenant-scoped table in this schema. The backend will populate
 *  it from telebirr_agents.tenant_id at session-creation time. Remove
 *  it later if you want to switch to a JOIN-based RLS policy.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('telebirr_agent_sessions', {
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
    agent_id: {
      type: 'uuid',
      notNull: true,
      references: 'telebirr_agents(id)',
      onDelete: 'CASCADE',
    },
    device_fingerprint: { type: 'text' },
    ip_address: { type: 'inet' },
    logged_in_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    last_active_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    logged_out_at: { type: 'timestamptz' },
  });

  pgm.createIndex('telebirr_agent_sessions', 'tenant_id');
  pgm.createIndex('telebirr_agent_sessions', 'agent_id');
  pgm.createIndex('telebirr_agent_sessions', 'logged_in_at');
  pgm.createIndex('telebirr_agent_sessions', 'last_active_at');
  pgm.createIndex('telebirr_agent_sessions', ['agent_id', 'logged_out_at']);
  pgm.createIndex('telebirr_agent_sessions', ['tenant_id', 'last_active_at']);

  pgm.sql(`ALTER TABLE telebirr_agent_sessions ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE telebirr_agent_sessions FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY telebirr_agent_sessions_tenant_isolation
      ON telebirr_agent_sessions
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
    `DROP POLICY IF EXISTS telebirr_agent_sessions_tenant_isolation ON telebirr_agent_sessions`
  );
  pgm.dropTable('telebirr_agent_sessions');
};
