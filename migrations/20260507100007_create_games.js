/**
 * games
 *  - Tenant-scoped game catalog used by user panel + game engine + admin.
 *  - is_iframe + iframe_url cover both inbound provider games (we embed
 *    third-party) and outbound (we render provider URL inside our own UI).
 *  - rtp may be globally defined or overridden per-tenant via this row.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('games', {
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
    provider: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true },
    config: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    is_active: { type: 'boolean', notNull: true, default: true },
    is_iframe: { type: 'boolean', notNull: true, default: false },
    iframe_url: { type: 'text' },
    rtp: { type: 'numeric(6,3)' },
    status: { type: 'text', notNull: true, default: 'available' },
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

  pgm.addConstraint('games', 'games_type_check', {
    check:
      "type IN ('sports','casino','live_casino','virtual','crash','keno','slot','table','jackpot','custom')",
  });
  pgm.addConstraint('games', 'games_status_check', {
    check: "status IN ('available','maintenance','disabled','archived')",
  });
  pgm.addConstraint('games', 'games_rtp_range', {
    check: 'rtp IS NULL OR (rtp >= 0 AND rtp <= 100)',
  });
  pgm.addConstraint('games', 'games_tenant_provider_name_unique', {
    unique: ['tenant_id', 'provider', 'name'],
  });

  pgm.createIndex('games', 'tenant_id');
  pgm.createIndex('games', 'provider');
  pgm.createIndex('games', 'type');
  pgm.createIndex('games', 'is_active');
  pgm.createIndex('games', 'status');
  pgm.createIndex('games', 'created_at');
  pgm.createIndex('games', ['tenant_id', 'is_active']);
  pgm.createIndex('games', ['tenant_id', 'type']);

  pgm.createTrigger('games', 'games_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE games ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE games FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY games_tenant_isolation ON games
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
  pgm.sql(`DROP POLICY IF EXISTS games_tenant_isolation ON games`);
  pgm.dropTrigger('games', 'games_touch_updated_at');
  pgm.dropTable('games');
};
