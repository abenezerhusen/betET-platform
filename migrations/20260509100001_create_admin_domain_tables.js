/**
 * Admin-panel coverage migration.
 *
 * Adds the domain tables required to back the admin panel pages that were
 * previously mock-only:
 *
 *   P2P
 *     - p2p_sub_accounts             — extra phones linked to a wallet device
 *     - p2p_swaps                    — capacity top-ups (manual + auto from withdrawal)
 *     - p2p_commands                 — USSD/SMS command queue (Pending → Sent → Executing → Success/Failed)
 *     - p2p_operators                — admin/operator/client people for P2P scope
 *     - p2p_operator_assignments     — operator → assigned wallet devices
 *     - p2p_operator_access_tokens   — magic-link tokens for the operator dashboard
 *     - p2p_settings                 — per-tenant single-row config (limits + failover)
 *     - p2p_wallet_priority          — ordered wallet selection list
 *     - p2p_commissions              — default + per-wallet rates
 *     - p2p_client_commissions       — per-client overrides
 *     - p2p_event_logs               — USSD/error/wallet-switch logs
 *
 *   Tournaments
 *     - tournaments
 *     - tournament_entries
 *     - tournament_streak_settings   — single jsonb row per tenant
 *
 *   Sportsbook
 *     - sports_events
 *     - sports_markets
 *     - sports_selections
 *     - sportsbook_bets
 *     - sportsbook_bet_legs
 *
 *   Casino
 *     - casino_providers
 *     - casino_categories
 *     - casino_tags
 *     - casino_games
 *     - casino_game_tags             — many-to-many
 *
 *   Promotions
 *     - promo_raffles
 *     - raffle_tickets
 *     - referral_codes
 *     - referrals
 *     - affiliates
 *     - affiliate_clicks
 *
 *   Monitoring
 *     - error_logs
 *     - performance_metrics
 *     - system_notifications
 *
 *   Settings (operational nouns)
 *     - sms_templates
 *     - game_picks
 *     - match_stats
 *     - iframe_integrations
 *     - package_plans
 *     - api_integrations
 *     - api_keys                     — admin-issued, hashed
 *     - maintenance_jobs
 *
 * Conventions inherited from earlier migrations:
 *   - Every tenant-scoped table has tenant_id NOT NULL with FK CASCADE
 *     and FORCE ROW LEVEL SECURITY using set_tenant_context().
 *   - Updated rows use the shared touch_updated_at() trigger.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  /* ---------------------------------------------------------------------- */
  /* Helpers — RLS + updated_at trigger                                     */
  /* ---------------------------------------------------------------------- */
  const tenantTables = [];
  const updatedAtTables = [];

  /* ====================================================================== */
  /* P2P                                                                    */
  /* ====================================================================== */

  pgm.createTable('p2p_sub_accounts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    agent_id: { type: 'uuid', notNull: true, references: 'telebirr_agents(id)', onDelete: 'CASCADE' },
    phone: { type: 'text', notNull: true },
    label: { type: 'text' },
    enabled: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_sub_accounts', 'tenant_id');
  pgm.createIndex('p2p_sub_accounts', 'agent_id');
  pgm.addConstraint('p2p_sub_accounts', 'p2p_sub_accounts_agent_phone_unique', {
    unique: ['agent_id', 'phone'],
  });
  tenantTables.push('p2p_sub_accounts');
  updatedAtTables.push('p2p_sub_accounts');

  pgm.createTable('p2p_swaps', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    agent_id: { type: 'uuid', notNull: true, references: 'telebirr_agents(id)', onDelete: 'CASCADE' },
    amount: { type: 'numeric(18,2)', notNull: true, check: 'amount > 0' },
    /** Manual top-up vs auto-swap from a withdrawal that just freed capacity. */
    source: {
      type: 'text',
      notNull: true,
      check: "source IN ('manual','withdrawal')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'added',
      check: "status IN ('pending','added','failed')",
    },
    operator_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    /** When source='withdrawal' this is the user whose payout triggered the swap. */
    ref_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    /** When source='withdrawal' this is the withdrawal request id. */
    ref_withdrawal_id: { type: 'uuid' },
    note: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_swaps', 'tenant_id');
  pgm.createIndex('p2p_swaps', 'agent_id');
  pgm.createIndex('p2p_swaps', 'status');
  pgm.createIndex('p2p_swaps', 'created_at');
  pgm.createIndex('p2p_swaps', ['tenant_id', 'agent_id', 'created_at']);
  tenantTables.push('p2p_swaps');
  updatedAtTables.push('p2p_swaps');

  pgm.createTable('p2p_commands', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    agent_id: { type: 'uuid', references: 'telebirr_agents(id)', onDelete: 'SET NULL' },
    /** check_balance | withdraw | restart | heartbeat | broadcast_* */
    kind: { type: 'text', notNull: true },
    /** Free-form payload (e.g. {recipient_phone, amount, ussd_string}). */
    payload: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    /** Optional cross-reference (e.g. WD-20411 withdrawal request id). */
    reference: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','sent','executing','success','failed','cancelled')",
    },
    result: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    error_message: { type: 'text' },
    issued_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    sent_at: { type: 'timestamptz' },
    executing_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_commands', 'tenant_id');
  pgm.createIndex('p2p_commands', 'agent_id');
  pgm.createIndex('p2p_commands', 'status');
  pgm.createIndex('p2p_commands', 'kind');
  pgm.createIndex('p2p_commands', 'reference');
  pgm.createIndex('p2p_commands', 'created_at');
  pgm.createIndex('p2p_commands', ['tenant_id', 'status', 'created_at']);
  tenantTables.push('p2p_commands');
  updatedAtTables.push('p2p_commands');

  pgm.createTable('p2p_operators', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    /** Optional link to a real user account (operators may also be plain admins). */
    user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    name: { type: 'text', notNull: true },
    email: { type: 'text', notNull: true },
    role: {
      type: 'text',
      notNull: true,
      check: "role IN ('admin','operator','client')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'active',
      check: "status IN ('active','suspended')",
    },
    /** Permission keys (e.g. p2p.dashboard, p2p.deposit_queue.approve). */
    permissions: { type: 'text[]', notNull: true, default: '{}' },
    last_login_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_operators', 'tenant_id');
  pgm.createIndex('p2p_operators', 'role');
  pgm.createIndex('p2p_operators', 'status');
  pgm.addConstraint('p2p_operators', 'p2p_operators_tenant_email_unique', {
    unique: ['tenant_id', 'email'],
  });
  tenantTables.push('p2p_operators');
  updatedAtTables.push('p2p_operators');

  pgm.createTable('p2p_operator_assignments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    operator_id: {
      type: 'uuid',
      notNull: true,
      references: 'p2p_operators(id)',
      onDelete: 'CASCADE',
    },
    agent_id: {
      type: 'uuid',
      notNull: true,
      references: 'telebirr_agents(id)',
      onDelete: 'CASCADE',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_operator_assignments', 'tenant_id');
  pgm.createIndex('p2p_operator_assignments', 'operator_id');
  pgm.createIndex('p2p_operator_assignments', 'agent_id');
  pgm.addConstraint('p2p_operator_assignments', 'p2p_operator_assignment_unique', {
    unique: ['operator_id', 'agent_id'],
  });
  tenantTables.push('p2p_operator_assignments');

  pgm.createTable('p2p_operator_access_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    operator_id: {
      type: 'uuid',
      notNull: true,
      references: 'p2p_operators(id)',
      onDelete: 'CASCADE',
    },
    /** SHA-256 of the bearer token shown to the operator (one-time at issue). */
    token_hash: { type: 'text', notNull: true },
    /** Last 8 chars of the plaintext token, for UI display only. */
    token_tail: { type: 'text', notNull: true },
    delivered_to: { type: 'text' },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    last_used_at: { type: 'timestamptz' },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_operator_access_tokens', 'tenant_id');
  pgm.createIndex('p2p_operator_access_tokens', 'operator_id');
  pgm.createIndex('p2p_operator_access_tokens', 'expires_at');
  pgm.addConstraint(
    'p2p_operator_access_tokens',
    'p2p_operator_access_tokens_hash_unique',
    { unique: ['token_hash'] }
  );
  tenantTables.push('p2p_operator_access_tokens');

  pgm.createTable('p2p_settings', {
    tenant_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    max_daily_per_wallet: { type: 'numeric(18,2)', notNull: true, default: 100000 },
    max_per_transaction: { type: 'numeric(18,2)', notNull: true, default: 20000 },
    auto_switch_enabled: { type: 'boolean', notNull: true, default: true },
    /** Percent of daily-limit at which auto-switch fires (50–100). */
    auto_switch_threshold_pct: {
      type: 'integer',
      notNull: true,
      default: 90,
      check: 'auto_switch_threshold_pct BETWEEN 50 AND 100',
    },
    exhaustion_failover_enabled: { type: 'boolean', notNull: true, default: true },
    exhaustion_threshold_pct: {
      type: 'integer',
      notNull: true,
      default: 5,
      check: 'exhaustion_threshold_pct BETWEEN 0 AND 100',
    },
    block_wallet_on_empty: { type: 'boolean', notNull: true, default: true },
    notify_admin: { type: 'boolean', notNull: true, default: true },
    notify_agent: { type: 'boolean', notNull: true, default: true },
    notify_channel: {
      type: 'text',
      notNull: true,
      default: 'both',
      check: "notify_channel IN ('sms','email','both')",
    },
    /** Threshold in ETB above which a withdrawal needs admin approval. */
    manual_approval_threshold: {
      type: 'numeric(18,2)',
      notNull: true,
      default: 10000,
    },
    /** Default deposit / withdrawal commission percentages. */
    default_deposit_commission_pct: {
      type: 'numeric(7,4)',
      notNull: true,
      default: 2.5,
    },
    default_withdrawal_commission_pct: {
      type: 'numeric(7,4)',
      notNull: true,
      default: 1.0,
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  tenantTables.push('p2p_settings');
  updatedAtTables.push('p2p_settings');

  pgm.createTable('p2p_wallet_priority', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    agent_id: {
      type: 'uuid',
      notNull: true,
      references: 'telebirr_agents(id)',
      onDelete: 'CASCADE',
    },
    priority: { type: 'integer', notNull: true },
    enabled: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_wallet_priority', 'tenant_id');
  pgm.createIndex('p2p_wallet_priority', ['tenant_id', 'priority']);
  pgm.addConstraint(
    'p2p_wallet_priority',
    'p2p_wallet_priority_tenant_agent_unique',
    { unique: ['tenant_id', 'agent_id'] }
  );
  tenantTables.push('p2p_wallet_priority');
  updatedAtTables.push('p2p_wallet_priority');

  pgm.createTable('p2p_commissions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    agent_id: {
      type: 'uuid',
      notNull: true,
      references: 'telebirr_agents(id)',
      onDelete: 'CASCADE',
    },
    deposit_pct: { type: 'numeric(7,4)', notNull: true, default: 2.5 },
    withdrawal_pct: { type: 'numeric(7,4)', notNull: true, default: 1.0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_commissions', 'tenant_id');
  pgm.addConstraint('p2p_commissions', 'p2p_commissions_agent_unique', {
    unique: ['tenant_id', 'agent_id'],
  });
  tenantTables.push('p2p_commissions');
  updatedAtTables.push('p2p_commissions');

  pgm.createTable('p2p_client_commissions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    deposit_pct: { type: 'numeric(7,4)', notNull: true, default: 2.5 },
    withdrawal_pct: { type: 'numeric(7,4)', notNull: true, default: 1.0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_client_commissions', 'tenant_id');
  pgm.addConstraint(
    'p2p_client_commissions',
    'p2p_client_commissions_tenant_user_unique',
    { unique: ['tenant_id', 'user_id'] }
  );
  tenantTables.push('p2p_client_commissions');
  updatedAtTables.push('p2p_client_commissions');

  pgm.createTable('p2p_event_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    agent_id: { type: 'uuid', references: 'telebirr_agents(id)', onDelete: 'SET NULL' },
    /** sms_in | sms_out | ussd | error | wallet_switch | command */
    kind: { type: 'text', notNull: true },
    /** info | warning | error */
    level: {
      type: 'text',
      notNull: true,
      default: 'info',
      check: "level IN ('info','warning','error')",
    },
    code: { type: 'text' },
    message: { type: 'text' },
    payload: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    duration_ms: { type: 'integer' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('p2p_event_logs', 'tenant_id');
  pgm.createIndex('p2p_event_logs', 'agent_id');
  pgm.createIndex('p2p_event_logs', 'kind');
  pgm.createIndex('p2p_event_logs', 'level');
  pgm.createIndex('p2p_event_logs', 'created_at');
  pgm.createIndex('p2p_event_logs', ['tenant_id', 'kind', 'created_at']);
  tenantTables.push('p2p_event_logs');

  /* ====================================================================== */
  /* Tournaments                                                            */
  /* ====================================================================== */

  pgm.createTable('tournaments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    /** sportsbook | casino | streak | jackpot */
    kind: {
      type: 'text',
      notNull: true,
      default: 'sportsbook',
      check: "kind IN ('sportsbook','casino','streak','jackpot')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'draft',
      check: "status IN ('draft','scheduled','running','paused','completed','cancelled')",
    },
    starts_at: { type: 'timestamptz' },
    ends_at: { type: 'timestamptz' },
    entry_fee: { type: 'numeric(18,2)', notNull: true, default: 0 },
    prize_pool: { type: 'numeric(18,2)', notNull: true, default: 0 },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    max_entries: { type: 'integer' },
    rules: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    leaderboard: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('tournaments', 'tenant_id');
  pgm.createIndex('tournaments', 'status');
  pgm.createIndex('tournaments', 'starts_at');
  pgm.createIndex('tournaments', ['tenant_id', 'status', 'starts_at']);
  tenantTables.push('tournaments');
  updatedAtTables.push('tournaments');

  pgm.createTable('tournament_entries', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    tournament_id: {
      type: 'uuid',
      notNull: true,
      references: 'tournaments(id)',
      onDelete: 'CASCADE',
    },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    score: { type: 'numeric(18,4)', notNull: true, default: 0 },
    rank: { type: 'integer' },
    status: {
      type: 'text',
      notNull: true,
      default: 'active',
      check: "status IN ('active','disqualified','withdrawn')",
    },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('tournament_entries', 'tenant_id');
  pgm.createIndex('tournament_entries', 'tournament_id');
  pgm.createIndex('tournament_entries', 'user_id');
  pgm.createIndex('tournament_entries', ['tournament_id', 'rank']);
  pgm.addConstraint(
    'tournament_entries',
    'tournament_entries_tournament_user_unique',
    { unique: ['tournament_id', 'user_id'] }
  );
  tenantTables.push('tournament_entries');
  updatedAtTables.push('tournament_entries');

  pgm.createTable('tournament_streak_settings', {
    tenant_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    enabled: { type: 'boolean', notNull: true, default: true },
    /** {min_streak: 3, multiplier_per_step: 0.05, max_multiplier: 2, qualifying_market_types: [...]} */
    config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  tenantTables.push('tournament_streak_settings');
  updatedAtTables.push('tournament_streak_settings');

  /* ====================================================================== */
  /* Sportsbook                                                             */
  /* ====================================================================== */

  pgm.createTable('sports_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    sport: { type: 'text', notNull: true },
    league: { type: 'text' },
    home_team: { type: 'text', notNull: true },
    away_team: { type: 'text', notNull: true },
    starts_at: { type: 'timestamptz', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'scheduled',
      check: "status IN ('scheduled','live','finished','postponed','cancelled')",
    },
    /** Final scores when finished. */
    home_score: { type: 'integer' },
    away_score: { type: 'integer' },
    /** Free-form match metadata: live minute, period, lineups, etc. */
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    /** Per-event match-stats jsonb (separate from metadata so admins can edit
     *  it without disturbing the live feed payload). */
    stats: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    /** When set the event is highlighted in the user-facing lobby. */
    is_featured: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('sports_events', 'tenant_id');
  pgm.createIndex('sports_events', 'sport');
  pgm.createIndex('sports_events', 'starts_at');
  pgm.createIndex('sports_events', 'status');
  pgm.createIndex('sports_events', ['tenant_id', 'status', 'starts_at']);
  tenantTables.push('sports_events');
  updatedAtTables.push('sports_events');

  pgm.createTable('sports_markets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    event_id: {
      type: 'uuid',
      notNull: true,
      references: 'sports_events(id)',
      onDelete: 'CASCADE',
    },
    /** e.g. '1x2', 'over_under_2_5', 'btts'. */
    market_type: { type: 'text', notNull: true },
    label: { type: 'text', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'open',
      check: "status IN ('open','locked','settled','cancelled')",
    },
    settled_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('sports_markets', 'tenant_id');
  pgm.createIndex('sports_markets', 'event_id');
  pgm.createIndex('sports_markets', 'status');
  tenantTables.push('sports_markets');
  updatedAtTables.push('sports_markets');

  pgm.createTable('sports_selections', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    market_id: {
      type: 'uuid',
      notNull: true,
      references: 'sports_markets(id)',
      onDelete: 'CASCADE',
    },
    label: { type: 'text', notNull: true },
    odds_decimal: { type: 'numeric(10,4)', notNull: true, check: 'odds_decimal > 1' },
    /** Outcome at settlement: won | lost | void. */
    result: {
      type: 'text',
      check: "result IN ('won','lost','void')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('sports_selections', 'tenant_id');
  pgm.createIndex('sports_selections', 'market_id');
  tenantTables.push('sports_selections');
  updatedAtTables.push('sports_selections');

  pgm.createTable('sportsbook_bets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'RESTRICT' },
    /** offline (placed in branch by cashier) | online | bet_for_me */
    channel: {
      type: 'text',
      notNull: true,
      default: 'online',
      check: "channel IN ('offline','online','bet_for_me')",
    },
    /** single | combo | system | jackpot */
    bet_type: {
      type: 'text',
      notNull: true,
      default: 'single',
      check: "bet_type IN ('single','combo','system','jackpot')",
    },
    cashier_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    /** When channel='bet_for_me' this is the bettor for whom the cashier placed the bet. */
    bet_for_user_phone: { type: 'text' },
    stake: { type: 'numeric(18,2)', notNull: true, check: 'stake > 0' },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    /** Stake × product(odds) for combos; per-pattern aggregate for systems. */
    potential_payout: { type: 'numeric(18,2)', notNull: true, default: 0 },
    actual_payout: { type: 'numeric(18,2)' },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','won','lost','void','cashout','partial')",
    },
    /** Reference to a parent jackpot pool for jackpot bets. */
    jackpot_id: { type: 'uuid' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    placed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    settled_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('sportsbook_bets', 'tenant_id');
  pgm.createIndex('sportsbook_bets', 'user_id');
  pgm.createIndex('sportsbook_bets', 'cashier_id');
  pgm.createIndex('sportsbook_bets', 'status');
  pgm.createIndex('sportsbook_bets', 'channel');
  pgm.createIndex('sportsbook_bets', 'bet_type');
  pgm.createIndex('sportsbook_bets', 'placed_at');
  pgm.createIndex('sportsbook_bets', ['tenant_id', 'status', 'placed_at']);
  tenantTables.push('sportsbook_bets');
  updatedAtTables.push('sportsbook_bets');

  pgm.createTable('sportsbook_bet_legs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    bet_id: {
      type: 'uuid',
      notNull: true,
      references: 'sportsbook_bets(id)',
      onDelete: 'CASCADE',
    },
    selection_id: {
      type: 'uuid',
      notNull: true,
      references: 'sports_selections(id)',
      onDelete: 'RESTRICT',
    },
    /** Snapshot of the odds the user accepted at placement. */
    odds_at_placement: { type: 'numeric(10,4)', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','won','lost','void')",
    },
    settled_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('sportsbook_bet_legs', 'tenant_id');
  pgm.createIndex('sportsbook_bet_legs', 'bet_id');
  pgm.createIndex('sportsbook_bet_legs', 'selection_id');
  tenantTables.push('sportsbook_bet_legs');

  /* ====================================================================== */
  /* Casino                                                                 */
  /* ====================================================================== */

  pgm.createTable('casino_providers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true },
    logo_url: { type: 'text' },
    is_active: { type: 'boolean', notNull: true, default: true },
    config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('casino_providers', 'tenant_id');
  pgm.addConstraint(
    'casino_providers',
    'casino_providers_tenant_slug_unique',
    { unique: ['tenant_id', 'slug'] }
  );
  tenantTables.push('casino_providers');
  updatedAtTables.push('casino_providers');

  pgm.createTable('casino_categories', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true },
    icon_url: { type: 'text' },
    display_order: { type: 'integer', notNull: true, default: 100 },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('casino_categories', 'tenant_id');
  pgm.addConstraint(
    'casino_categories',
    'casino_categories_tenant_slug_unique',
    { unique: ['tenant_id', 'slug'] }
  );
  tenantTables.push('casino_categories');
  updatedAtTables.push('casino_categories');

  pgm.createTable('casino_tags', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true },
    color: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('casino_tags', 'tenant_id');
  pgm.addConstraint(
    'casino_tags',
    'casino_tags_tenant_slug_unique',
    { unique: ['tenant_id', 'slug'] }
  );
  tenantTables.push('casino_tags');
  updatedAtTables.push('casino_tags');

  pgm.createTable('casino_games', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    provider_id: { type: 'uuid', references: 'casino_providers(id)', onDelete: 'SET NULL' },
    category_id: { type: 'uuid', references: 'casino_categories(id)', onDelete: 'SET NULL' },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true },
    image_url: { type: 'text' },
    /** RTP percent (e.g. 96.5). */
    rtp: { type: 'numeric(6,3)' },
    volatility: { type: 'text', check: "volatility IN ('low','medium','high','very_high')" },
    is_active: { type: 'boolean', notNull: true, default: true },
    is_featured: { type: 'boolean', notNull: true, default: false },
    display_order: { type: 'integer', notNull: true, default: 100 },
    config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('casino_games', 'tenant_id');
  pgm.createIndex('casino_games', 'provider_id');
  pgm.createIndex('casino_games', 'category_id');
  pgm.createIndex('casino_games', 'is_active');
  pgm.addConstraint(
    'casino_games',
    'casino_games_tenant_slug_unique',
    { unique: ['tenant_id', 'slug'] }
  );
  tenantTables.push('casino_games');
  updatedAtTables.push('casino_games');

  pgm.createTable('casino_game_tags', {
    game_id: {
      type: 'uuid',
      notNull: true,
      references: 'casino_games(id)',
      onDelete: 'CASCADE',
    },
    tag_id: { type: 'uuid', notNull: true, references: 'casino_tags(id)', onDelete: 'CASCADE' },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('casino_game_tags', 'casino_game_tags_pkey', {
    primaryKey: ['game_id', 'tag_id'],
  });
  pgm.createIndex('casino_game_tags', 'tenant_id');
  pgm.createIndex('casino_game_tags', 'tag_id');
  tenantTables.push('casino_game_tags');

  /* ====================================================================== */
  /* Promotions: raffles, referrals, affiliates                              */
  /* ====================================================================== */

  pgm.createTable('promo_raffles', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    description: { type: 'text' },
    ticket_price: { type: 'numeric(18,2)', notNull: true, default: 0 },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    prize_pool: { type: 'numeric(18,2)', notNull: true, default: 0 },
    max_tickets: { type: 'integer' },
    /** When the draw runs. NULL = manual draw. */
    draw_at: { type: 'timestamptz' },
    status: {
      type: 'text',
      notNull: true,
      default: 'draft',
      check: "status IN ('draft','open','drawn','cancelled')",
    },
    /** Set when the draw runs. */
    winning_ticket_id: { type: 'uuid' },
    rules: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('promo_raffles', 'tenant_id');
  pgm.createIndex('promo_raffles', 'status');
  tenantTables.push('promo_raffles');
  updatedAtTables.push('promo_raffles');

  pgm.createTable('raffle_tickets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    raffle_id: {
      type: 'uuid',
      notNull: true,
      references: 'promo_raffles(id)',
      onDelete: 'CASCADE',
    },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    ticket_number: { type: 'text', notNull: true },
    purchased_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('raffle_tickets', 'tenant_id');
  pgm.createIndex('raffle_tickets', 'raffle_id');
  pgm.createIndex('raffle_tickets', 'user_id');
  pgm.addConstraint(
    'raffle_tickets',
    'raffle_tickets_raffle_number_unique',
    { unique: ['raffle_id', 'ticket_number'] }
  );
  tenantTables.push('raffle_tickets');

  pgm.createTable('referral_codes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    code: { type: 'text', notNull: true },
    uses: { type: 'integer', notNull: true, default: 0 },
    max_uses: { type: 'integer' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('referral_codes', 'tenant_id');
  pgm.createIndex('referral_codes', 'user_id');
  pgm.addConstraint('referral_codes', 'referral_codes_tenant_code_unique', {
    unique: ['tenant_id', 'code'],
  });
  tenantTables.push('referral_codes');
  updatedAtTables.push('referral_codes');

  pgm.createTable('referrals', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    referrer_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    referred_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    code: { type: 'text' },
    bonus_amount: { type: 'numeric(18,2)', notNull: true, default: 0 },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','rewarded','expired','cancelled')",
    },
    rewarded_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('referrals', 'tenant_id');
  pgm.createIndex('referrals', 'referrer_id');
  pgm.createIndex('referrals', 'referred_id');
  pgm.createIndex('referrals', 'status');
  pgm.addConstraint('referrals', 'referrals_referred_unique', {
    unique: ['referred_id'],
  });
  tenantTables.push('referrals');
  updatedAtTables.push('referrals');

  pgm.createTable('affiliates', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', references: 'users(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    code: { type: 'text', notNull: true },
    /** revenue_share | cpa | hybrid */
    plan: {
      type: 'text',
      notNull: true,
      default: 'revenue_share',
      check: "plan IN ('revenue_share','cpa','hybrid')",
    },
    commission_pct: { type: 'numeric(7,4)', notNull: true, default: 25 },
    cpa_amount: { type: 'numeric(18,2)', notNull: true, default: 0 },
    status: {
      type: 'text',
      notNull: true,
      default: 'active',
      check: "status IN ('active','paused','terminated')",
    },
    earnings_total: { type: 'numeric(18,2)', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('affiliates', 'tenant_id');
  pgm.createIndex('affiliates', 'user_id');
  pgm.addConstraint('affiliates', 'affiliates_tenant_code_unique', {
    unique: ['tenant_id', 'code'],
  });
  tenantTables.push('affiliates');
  updatedAtTables.push('affiliates');

  pgm.createTable('affiliate_clicks', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    affiliate_id: {
      type: 'uuid',
      notNull: true,
      references: 'affiliates(id)',
      onDelete: 'CASCADE',
    },
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
    referrer: { type: 'text' },
    landed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('affiliate_clicks', 'tenant_id');
  pgm.createIndex('affiliate_clicks', 'affiliate_id');
  pgm.createIndex('affiliate_clicks', 'landed_at');
  tenantTables.push('affiliate_clicks');

  /* ====================================================================== */
  /* Monitoring: errors, performance, system notifications                  */
  /* ====================================================================== */

  pgm.createTable('error_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', references: 'tenants(id)', onDelete: 'CASCADE' },
    request_id: { type: 'text' },
    /** debug | info | warning | error | fatal */
    level: {
      type: 'text',
      notNull: true,
      default: 'error',
      check: "level IN ('debug','info','warning','error','fatal')",
    },
    source: { type: 'text', notNull: true, default: 'backend' },
    code: { type: 'text' },
    message: { type: 'text', notNull: true },
    stack: { type: 'text' },
    /** Additional structured context (route, status, payload digest). */
    context: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    resolved_at: { type: 'timestamptz' },
    resolved_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
  });
  pgm.createIndex('error_logs', 'tenant_id');
  pgm.createIndex('error_logs', 'level');
  pgm.createIndex('error_logs', 'occurred_at');
  pgm.createIndex('error_logs', 'source');
  pgm.createIndex('error_logs', ['tenant_id', 'level', 'occurred_at']);
  // RLS policy below allows tenant_id IS NULL for cross-tenant rows visible
  // only with bypass_rls.
  tenantTables.push('error_logs');

  pgm.createTable('performance_metrics', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', references: 'tenants(id)', onDelete: 'CASCADE' },
    /** route | job | webhook | provider */
    kind: { type: 'text', notNull: true, default: 'route' },
    /** Endpoint path or job name. */
    name: { type: 'text', notNull: true },
    method: { type: 'text' },
    request_count: { type: 'bigint', notNull: true, default: 0 },
    error_count: { type: 'bigint', notNull: true, default: 0 },
    p50_ms: { type: 'integer' },
    p95_ms: { type: 'integer' },
    p99_ms: { type: 'integer' },
    avg_ms: { type: 'integer' },
    period_start: { type: 'timestamptz', notNull: true },
    period_end: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('performance_metrics', 'tenant_id');
  pgm.createIndex('performance_metrics', 'name');
  pgm.createIndex('performance_metrics', 'period_start');
  pgm.createIndex('performance_metrics', ['tenant_id', 'name', 'period_start']);
  tenantTables.push('performance_metrics');

  pgm.createTable('system_notifications', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    title: { type: 'text', notNull: true },
    message: { type: 'text', notNull: true },
    /** info | success | warning | error | critical */
    level: {
      type: 'text',
      notNull: true,
      default: 'info',
      check: "level IN ('info','success','warning','error','critical')",
    },
    /** all | superadmin | tenant_admin | cashier | user — comma-NOT-array
     *  to keep the schema simple; service layer parses. */
    target_role: { type: 'text', notNull: true, default: 'tenant_admin' },
    /** Optional direct addressee. */
    target_user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    /** When set, the notification only fires after this timestamp. */
    scheduled_at: { type: 'timestamptz' },
    sent_at: { type: 'timestamptz' },
    read_count: { type: 'integer', notNull: true, default: 0 },
    /** Optional CTA link. */
    link_url: { type: 'text' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    status: {
      type: 'text',
      notNull: true,
      default: 'queued',
      check: "status IN ('queued','sent','cancelled','failed')",
    },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('system_notifications', 'tenant_id');
  pgm.createIndex('system_notifications', 'status');
  pgm.createIndex('system_notifications', 'level');
  pgm.createIndex('system_notifications', 'scheduled_at');
  pgm.createIndex('system_notifications', 'created_at');
  tenantTables.push('system_notifications');
  updatedAtTables.push('system_notifications');

  /* ====================================================================== */
  /* Settings nouns: SMS, game picks, match stats, iframes,                  */
  /* packages, integrations, API keys, maintenance jobs                     */
  /* ====================================================================== */

  pgm.createTable('sms_templates', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    /** e.g. 'otp_login','deposit_credited','withdrawal_processed'. */
    code: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true },
    /** ISO-639-1 'en','am','om' etc. */
    language: { type: 'text', notNull: true, default: 'en' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('sms_templates', 'tenant_id');
  pgm.addConstraint('sms_templates', 'sms_templates_tenant_code_lang_unique', {
    unique: ['tenant_id', 'code', 'language'],
  });
  tenantTables.push('sms_templates');
  updatedAtTables.push('sms_templates');

  pgm.createTable('game_picks', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    /** featured | hot | upcoming | top_odds */
    bucket: {
      type: 'text',
      notNull: true,
      default: 'featured',
      check: "bucket IN ('featured','hot','upcoming','top_odds')",
    },
    event_id: {
      type: 'uuid',
      references: 'sports_events(id)',
      onDelete: 'CASCADE',
    },
    casino_game_id: {
      type: 'uuid',
      references: 'casino_games(id)',
      onDelete: 'CASCADE',
    },
    display_order: { type: 'integer', notNull: true, default: 100 },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('game_picks', 'tenant_id');
  pgm.createIndex('game_picks', 'bucket');
  pgm.addConstraint(
    'game_picks',
    'game_picks_one_target_check',
    {
      check:
        '(event_id IS NOT NULL AND casino_game_id IS NULL) OR (event_id IS NULL AND casino_game_id IS NOT NULL)',
    }
  );
  tenantTables.push('game_picks');
  updatedAtTables.push('game_picks');

  pgm.createTable('match_stats', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    event_id: {
      type: 'uuid',
      notNull: true,
      references: 'sports_events(id)',
      onDelete: 'CASCADE',
    },
    /** prematch | live | postmatch */
    period: { type: 'text', notNull: true, default: 'live' },
    stats: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    fetched_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('match_stats', 'tenant_id');
  pgm.createIndex('match_stats', 'event_id');
  pgm.addConstraint('match_stats', 'match_stats_event_period_unique', {
    unique: ['event_id', 'period'],
  });
  tenantTables.push('match_stats');
  updatedAtTables.push('match_stats');

  pgm.createTable('iframe_integrations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true },
    embed_url: { type: 'text', notNull: true },
    width: { type: 'text', notNull: true, default: '100%' },
    height: { type: 'text', notNull: true, default: '600px' },
    /** Whitelist of origins permitted to load this iframe. */
    allowed_origins: { type: 'text[]', notNull: true, default: '{}' },
    is_active: { type: 'boolean', notNull: true, default: true },
    /** Display in user-panel main nav vs admin-internal. */
    visibility: {
      type: 'text',
      notNull: true,
      default: 'admin',
      check: "visibility IN ('admin','user','public')",
    },
    config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('iframe_integrations', 'tenant_id');
  pgm.addConstraint(
    'iframe_integrations',
    'iframe_integrations_tenant_slug_unique',
    { unique: ['tenant_id', 'slug'] }
  );
  tenantTables.push('iframe_integrations');
  updatedAtTables.push('iframe_integrations');

  pgm.createTable('package_plans', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true },
    /** monthly | yearly | one_time */
    period: {
      type: 'text',
      notNull: true,
      default: 'monthly',
      check: "period IN ('monthly','yearly','one_time')",
    },
    price: { type: 'numeric(18,2)', notNull: true, default: 0 },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    features: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    /** Per-package quotas (e.g. {users: 1000, sms_per_day: 5000}). */
    limits: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    is_active: { type: 'boolean', notNull: true, default: true },
    is_popular: { type: 'boolean', notNull: true, default: false },
    display_order: { type: 'integer', notNull: true, default: 100 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('package_plans', 'tenant_id');
  pgm.addConstraint(
    'package_plans',
    'package_plans_tenant_slug_unique',
    { unique: ['tenant_id', 'slug'] }
  );
  tenantTables.push('package_plans');
  updatedAtTables.push('package_plans');

  pgm.createTable('api_integrations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    /** payment | sms | game_provider | analytics | custom */
    kind: {
      type: 'text',
      notNull: true,
      default: 'custom',
      check: "kind IN ('payment','sms','game_provider','analytics','custom')",
    },
    provider: { type: 'text', notNull: true },
    base_url: { type: 'text' },
    /** Encrypted-at-rest application secret (jsonb so multiple keys may live
     *  together). The application is responsible for envelope encryption on
     *  write/read. */
    secrets: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    status: {
      type: 'text',
      notNull: true,
      default: 'active',
      check: "status IN ('active','inactive','error')",
    },
    last_health_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('api_integrations', 'tenant_id');
  pgm.createIndex('api_integrations', 'kind');
  pgm.addConstraint(
    'api_integrations',
    'api_integrations_tenant_provider_unique',
    { unique: ['tenant_id', 'provider'] }
  );
  tenantTables.push('api_integrations');
  updatedAtTables.push('api_integrations');

  pgm.createTable('api_keys', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    /** SHA-256 of the plaintext key (shown once at creation). */
    key_hash: { type: 'text', notNull: true },
    /** First 8 chars of the plaintext for UI listing only. */
    key_prefix: { type: 'text', notNull: true },
    scopes: { type: 'text[]', notNull: true, default: '{}' },
    is_active: { type: 'boolean', notNull: true, default: true },
    expires_at: { type: 'timestamptz' },
    last_used_at: { type: 'timestamptz' },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('api_keys', 'tenant_id');
  pgm.createIndex('api_keys', 'is_active');
  pgm.addConstraint('api_keys', 'api_keys_hash_unique', {
    unique: ['key_hash'],
  });
  tenantTables.push('api_keys');
  updatedAtTables.push('api_keys');

  pgm.createTable('maintenance_jobs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    /** vacuum | archive_audit | rebuild_indexes | clear_cache | custom */
    kind: {
      type: 'text',
      notNull: true,
      default: 'custom',
      check:
        "kind IN ('vacuum','archive_audit','rebuild_indexes','clear_cache','custom')",
    },
    schedule_cron: { type: 'text' },
    last_run_at: { type: 'timestamptz' },
    last_status: {
      type: 'text',
      check: "last_status IN ('success','failure','running')",
    },
    last_message: { type: 'text' },
    /** Free-form per-job options. */
    config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('maintenance_jobs', 'tenant_id');
  pgm.createIndex('maintenance_jobs', 'kind');
  pgm.addConstraint(
    'maintenance_jobs',
    'maintenance_jobs_tenant_name_unique',
    { unique: ['tenant_id', 'name'] }
  );
  tenantTables.push('maintenance_jobs');
  updatedAtTables.push('maintenance_jobs');

  /* ---------------------------------------------------------------------- */
  /* Apply touch_updated_at trigger uniformly                                */
  /* ---------------------------------------------------------------------- */
  for (const table of updatedAtTables) {
    pgm.sql(`
      CREATE TRIGGER ${table}_set_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    `);
  }

  /* ---------------------------------------------------------------------- */
  /* Apply tenant-isolation RLS uniformly                                   */
  /* ---------------------------------------------------------------------- */
  for (const table of tenantTables) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    pgm.sql(`
      CREATE POLICY ${table}_tenant_isolation ON ${table}
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
  }

  /* ---------------------------------------------------------------------- */
  /* error_logs / performance_metrics relax tenant_id NOT NULL               */
  /* (already nullable above); the policy still holds because               */
  /* tenant_id = get_tenant_context() returns false when tenant_id is NULL  */
  /* — so cross-tenant rows can only be read with bypass_rls=true.          */
  /* ---------------------------------------------------------------------- */
};

exports.down = (pgm) => {
  const tables = [
    // Reverse order of creation to respect FKs
    'maintenance_jobs',
    'api_keys',
    'api_integrations',
    'package_plans',
    'iframe_integrations',
    'match_stats',
    'game_picks',
    'sms_templates',
    'system_notifications',
    'performance_metrics',
    'error_logs',
    'affiliate_clicks',
    'affiliates',
    'referrals',
    'referral_codes',
    'raffle_tickets',
    'promo_raffles',
    'casino_game_tags',
    'casino_games',
    'casino_tags',
    'casino_categories',
    'casino_providers',
    'sportsbook_bet_legs',
    'sportsbook_bets',
    'sports_selections',
    'sports_markets',
    'sports_events',
    'tournament_streak_settings',
    'tournament_entries',
    'tournaments',
    'p2p_event_logs',
    'p2p_client_commissions',
    'p2p_commissions',
    'p2p_wallet_priority',
    'p2p_settings',
    'p2p_operator_access_tokens',
    'p2p_operator_assignments',
    'p2p_operators',
    'p2p_commands',
    'p2p_swaps',
    'p2p_sub_accounts',
  ];

  for (const t of tables) {
    pgm.sql(`DROP POLICY IF EXISTS ${t}_tenant_isolation ON ${t}`);
    pgm.sql(`DROP TRIGGER IF EXISTS ${t}_set_updated_at ON ${t}`);
    pgm.dropTable(t);
  }
};
