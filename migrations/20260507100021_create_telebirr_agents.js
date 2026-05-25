/**
 * telebirr_agents
 *  - One row per physical Android device running the Flutter
 *    "Telebirr SMS Pay Client" app. The device is paired to a Telebirr
 *    agent number issued by Ethio Telecom.
 *  - The app reads incoming Telebirr SMS in the background and reports
 *    confirmed payments to the backend. Heartbeats update last_seen_at
 *    and, optionally, the running balance held on the SIM.
 *  - auth_token_hash stores the SHA-256 of the device bearer token. The
 *    plaintext token is shown once at pairing time; rotating it requires
 *    the admin to re-pair the device.
 *  - assigned_cashier_id is optional and only used when the device is
 *    operated from inside a branch where a specific cashier signs in.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('telebirr_agents', {
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
    agent_name: { type: 'text', notNull: true },
    telebirr_number: { type: 'text', notNull: true },
    device_id: { type: 'text', notNull: true },
    device_name: { type: 'text' },
    app_version: { type: 'text' },
    auth_token_hash: { type: 'text' },
    last_seen_at: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'active' },
    // User spec: `balance decimal` (unbounded). Kept as-is intentionally;
    // operational balance held on the Telebirr SIM is reported by the
    // device and need not match the platform ledger precision (numeric(20,4)).
    balance: { type: 'numeric', notNull: true, default: 0 },
    assigned_cashier_id: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('telebirr_agents', 'telebirr_agents_status_check', {
    check: "status IN ('active','inactive','suspended')",
  });
  // One device fingerprint maps to at most one agent inside a tenant. Two
  // tenants may legitimately share a string value (rare, but allowed).
  pgm.addConstraint('telebirr_agents', 'telebirr_agents_tenant_device_unique', {
    unique: ['tenant_id', 'device_id'],
  });
  // The same Telebirr number cannot be paired to two active rows in the
  // same tenant; enforced as a partial unique index so historical
  // suspended/inactive rows do not block re-pairing.
  pgm.sql(`
    CREATE UNIQUE INDEX telebirr_agents_tenant_number_active_uniq
      ON telebirr_agents (tenant_id, telebirr_number)
      WHERE status = 'active'
  `);

  pgm.createIndex('telebirr_agents', 'tenant_id');
  pgm.createIndex('telebirr_agents', 'status');
  pgm.createIndex('telebirr_agents', 'last_seen_at');
  pgm.createIndex('telebirr_agents', 'created_at');
  pgm.createIndex('telebirr_agents', 'assigned_cashier_id');
  pgm.createIndex('telebirr_agents', ['tenant_id', 'status']);

  pgm.sql(`ALTER TABLE telebirr_agents ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE telebirr_agents FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY telebirr_agents_tenant_isolation ON telebirr_agents
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
  pgm.sql(`DROP POLICY IF EXISTS telebirr_agents_tenant_isolation ON telebirr_agents`);
  pgm.sql(`DROP INDEX IF EXISTS telebirr_agents_tenant_number_active_uniq`);
  pgm.dropTable('telebirr_agents');
};
