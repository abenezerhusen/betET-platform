/**
 * RTP + Iframe + External Providers integration (Section 15).
 *
 * Adds the following tables that drive the new RTP-management page, the
 * iframe outbound (white-label) mode, and the iframe inbound (external
 * provider) mode for the user-panel game lobby.
 *
 *   1) internal_games           — global catalog of the 4 first-party games
 *                                 (aviator, jetx, fast-keno, multi-hot-5).
 *                                 Super Admin tunes default_rtp here.
 *
 *   2) game_rtp_overrides       — per-client RTP override that game-engine
 *                                 workers read at round start. Looked up
 *                                 via (game_id, client_id).
 *
 *   3) external_game_providers  — Pragmatic Play / Spribe-style providers.
 *                                 encrypted_secret holds the launch API
 *                                 key/secret (AES-256-GCM, never echoed).
 *
 *   4) external_game_provider_games
 *                               — allow-list of provider game IDs that may
 *                                 be launched into the user panel.
 *
 *   5) external_game_sessions   — per-player launch sessions with the token
 *                                 we hand to the provider; webhooks resolve
 *                                 their callbacks back to this row.
 *
 *   6) iframe_outbound_configs  — one row per (tenant, client_id) target
 *                                 that we expose YOUR games to.
 *
 *   7) iframe_whitelisted_domains
 *                               — host whitelist for the public /embed
 *                                 endpoint.
 *
 * The four internal_games rows are seeded inside the same migration so the
 * RTP page works immediately after `npm run db:migrate`.
 *
 * The internal_games table is intentionally NOT tenant-scoped — the
 * proprietary games are the same engine across every white-label client,
 * and per-client tuning lives in game_rtp_overrides via client_id.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  /* ------------------------------------------------------------------ */
  /* 1) internal_games                                                   */
  /* ------------------------------------------------------------------ */
  pgm.createTable('internal_games', {
    id: { type: 'varchar(50)', primaryKey: true },
    name: { type: 'varchar(100)', notNull: true },
    provider: { type: 'varchar(50)', notNull: true, default: 'Internal' },
    default_rtp: { type: 'numeric(5,2)', notNull: true, default: 97.0 },
    min_rtp: { type: 'numeric(5,2)', notNull: true, default: 70.0 },
    max_rtp: { type: 'numeric(5,2)', notNull: true, default: 98.0 },
    status: { type: 'varchar(20)', notNull: true, default: 'Active' },
    min_bet: { type: 'numeric(18,2)', notNull: true, default: 5.0 },
    max_bet: { type: 'numeric(18,2)', notNull: true, default: 50000.0 },
    slug: { type: 'varchar(50)' },
    thumbnail_url: { type: 'text' },
    description: { type: 'text' },
    game_type: { type: 'varchar(30)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('internal_games', 'internal_games_status_check', {
    check: "status IN ('Active','Disabled')",
  });
  pgm.addConstraint('internal_games', 'internal_games_rtp_range', {
    check: 'default_rtp >= min_rtp AND default_rtp <= max_rtp',
  });
  pgm.createTrigger('internal_games', 'internal_games_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  // Seed the four first-party games (idempotent).
  pgm.sql(`
    INSERT INTO internal_games
      (id, name, provider, default_rtp, slug, game_type, thumbnail_url, description)
    VALUES
      ('aviator',     'Aviator',     'Internal', 97.00, 'aviator',     'crash', '/games/aviator.png',     'Crash multiplier game.'),
      ('jetx',        'JetX',        'Internal', 96.00, 'jetx',        'crash', '/games/jet-x-thumb.png', 'Jet-themed crash multiplier game.'),
      ('fast-keno',   'Fast Keno',   'Internal', 95.00, 'fast-keno',   'keno',  '/games/fast-keno.png',   '80-ball quick draw keno.'),
      ('multi-hot-5', 'Multi Hot 5', 'Internal', 96.50, 'multi-hot-5', 'slot',  '/games/multi-hot-5-thumb.png', '5-reel hot-symbol slot.')
    ON CONFLICT (id) DO NOTHING;
  `);

  /* ------------------------------------------------------------------ */
  /* 2) game_rtp_overrides                                               */
  /* ------------------------------------------------------------------ */
  pgm.createTable('game_rtp_overrides', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    game_id: {
      type: 'varchar(50)',
      notNull: true,
      references: 'internal_games(id)',
      onDelete: 'CASCADE',
    },
    client_id: { type: 'varchar(80)', notNull: true },
    rtp: { type: 'numeric(5,2)', notNull: true },
    updated_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('game_rtp_overrides', 'game_rtp_overrides_game_client_unique', {
    unique: ['game_id', 'client_id'],
  });
  pgm.createIndex('game_rtp_overrides', 'game_id');
  pgm.createIndex('game_rtp_overrides', 'client_id');

  /* ------------------------------------------------------------------ */
  /* 3) external_game_providers                                          */
  /* ------------------------------------------------------------------ */
  pgm.createTable('external_game_providers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    name: { type: 'varchar(100)', notNull: true },
    slug: { type: 'varchar(120)', notNull: true },
    base_url: { type: 'text', notNull: true },
    auth_method: { type: 'varchar(20)', notNull: true, default: 'token' },
    encrypted_secret: { type: 'text' },
    callback_url: { type: 'text' },
    sandbox: { type: 'boolean', notNull: true, default: true },
    status: { type: 'varchar(20)', notNull: true, default: 'Active' },
    last_ping: { type: 'timestamptz' },
    config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('external_game_providers', 'external_providers_auth_method_check', {
    check: "auth_method IN ('token','apikey','none')",
  });
  pgm.addConstraint('external_game_providers', 'external_providers_status_check', {
    check: "status IN ('Active','Paused')",
  });
  pgm.addConstraint('external_game_providers', 'external_providers_tenant_slug_unique', {
    unique: ['tenant_id', 'slug'],
  });
  pgm.createIndex('external_game_providers', 'tenant_id');
  pgm.createIndex('external_game_providers', 'status');
  pgm.createTrigger('external_game_providers', 'external_providers_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE external_game_providers ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE external_game_providers FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY external_game_providers_tenant_isolation ON external_game_providers
    FOR ALL
    USING (app_is_bypass_rls() OR tenant_id = get_tenant_context())
    WITH CHECK (app_is_bypass_rls() OR tenant_id = get_tenant_context());
  `);

  /* ------------------------------------------------------------------ */
  /* 4) external_game_provider_games                                     */
  /* ------------------------------------------------------------------ */
  pgm.createTable('external_game_provider_games', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    provider_id: {
      type: 'uuid',
      notNull: true,
      references: 'external_game_providers(id)',
      onDelete: 'CASCADE',
    },
    game_id: { type: 'varchar(100)', notNull: true },
    name: { type: 'varchar(120)' },
    thumbnail_url: { type: 'text' },
    enabled: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'external_game_provider_games',
    'external_provider_games_unique',
    { unique: ['provider_id', 'game_id'] }
  );
  pgm.createIndex('external_game_provider_games', 'provider_id');
  pgm.createIndex('external_game_provider_games', 'enabled');

  /* ------------------------------------------------------------------ */
  /* 5) external_game_sessions                                           */
  /* ------------------------------------------------------------------ */
  pgm.createTable('external_game_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    provider_id: {
      type: 'uuid',
      notNull: true,
      references: 'external_game_providers(id)',
      onDelete: 'CASCADE',
    },
    game_id: { type: 'varchar(100)', notNull: true },
    session_token: { type: 'varchar(255)', notNull: true, unique: true },
    launch_url: { type: 'text' },
    status: { type: 'varchar(20)', notNull: true, default: 'active' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz' },
    closed_at: { type: 'timestamptz' },
  });
  pgm.createIndex('external_game_sessions', 'tenant_id');
  pgm.createIndex('external_game_sessions', 'user_id');
  pgm.createIndex('external_game_sessions', 'session_token');
  pgm.createIndex('external_game_sessions', ['provider_id', 'status']);

  pgm.sql(`ALTER TABLE external_game_sessions ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE external_game_sessions FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY external_game_sessions_tenant_isolation ON external_game_sessions
    FOR ALL
    USING (app_is_bypass_rls() OR tenant_id = get_tenant_context())
    WITH CHECK (app_is_bypass_rls() OR tenant_id = get_tenant_context());
  `);

  /* ------------------------------------------------------------------ */
  /* 6) iframe_outbound_configs                                          */
  /* ------------------------------------------------------------------ */
  pgm.createTable('iframe_outbound_configs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    client_id: { type: 'varchar(80)', notNull: true },
    game_id: {
      type: 'varchar(50)',
      references: 'internal_games(id)',
      onDelete: 'SET NULL',
    },
    enabled: { type: 'boolean', notNull: true, default: true },
    use_token: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'iframe_outbound_configs',
    'iframe_outbound_tenant_client_unique',
    { unique: ['tenant_id', 'client_id'] }
  );
  pgm.createIndex('iframe_outbound_configs', 'tenant_id');
  pgm.createTrigger(
    'iframe_outbound_configs',
    'iframe_outbound_configs_touch_updated_at',
    {
      when: 'BEFORE',
      operation: 'UPDATE',
      level: 'ROW',
      function: 'touch_updated_at',
    }
  );

  pgm.sql(`ALTER TABLE iframe_outbound_configs ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE iframe_outbound_configs FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY iframe_outbound_configs_tenant_isolation ON iframe_outbound_configs
    FOR ALL
    USING (app_is_bypass_rls() OR tenant_id = get_tenant_context())
    WITH CHECK (app_is_bypass_rls() OR tenant_id = get_tenant_context());
  `);

  /* ------------------------------------------------------------------ */
  /* 7) iframe_whitelisted_domains                                       */
  /* ------------------------------------------------------------------ */
  pgm.createTable('iframe_whitelisted_domains', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    domain: { type: 'varchar(255)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'iframe_whitelisted_domains',
    'iframe_whitelist_tenant_domain_unique',
    { unique: ['tenant_id', 'domain'] }
  );
  pgm.createIndex('iframe_whitelisted_domains', 'domain');

  pgm.sql(`ALTER TABLE iframe_whitelisted_domains ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE iframe_whitelisted_domains FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY iframe_whitelisted_domains_tenant_isolation ON iframe_whitelisted_domains
    FOR ALL
    USING (app_is_bypass_rls() OR tenant_id = get_tenant_context())
    WITH CHECK (app_is_bypass_rls() OR tenant_id = get_tenant_context());
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `DROP POLICY IF EXISTS iframe_whitelisted_domains_tenant_isolation ON iframe_whitelisted_domains`
  );
  pgm.dropTable('iframe_whitelisted_domains');

  pgm.sql(
    `DROP POLICY IF EXISTS iframe_outbound_configs_tenant_isolation ON iframe_outbound_configs`
  );
  pgm.dropTrigger('iframe_outbound_configs', 'iframe_outbound_configs_touch_updated_at');
  pgm.dropTable('iframe_outbound_configs');

  pgm.sql(
    `DROP POLICY IF EXISTS external_game_sessions_tenant_isolation ON external_game_sessions`
  );
  pgm.dropTable('external_game_sessions');

  pgm.dropTable('external_game_provider_games');

  pgm.sql(
    `DROP POLICY IF EXISTS external_game_providers_tenant_isolation ON external_game_providers`
  );
  pgm.dropTrigger('external_game_providers', 'external_providers_touch_updated_at');
  pgm.dropTable('external_game_providers');

  pgm.dropTable('game_rtp_overrides');

  pgm.dropTrigger('internal_games', 'internal_games_touch_updated_at');
  pgm.dropTable('internal_games');
};
