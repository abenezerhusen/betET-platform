/**
 * Internal provably-fair rounds for Aviator / Keno / Slots.
 *
 * Note:
 * - Adds tenant_id to preserve platform-wide RLS guarantees.
 * - Uses separate game_bets table for fast in-round operations while keeping
 *   wallet ledger in `transactions`.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('game_rounds', {
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
    game_id: { type: 'text', notNull: true }, // aviator | fast-keno | multi-hot-5
    server_seed: { type: 'text' },
    server_seed_hash: { type: 'text', notNull: true },
    client_seed: { type: 'text', notNull: true },
    crash_point: { type: 'numeric(10,2)' },
    drawn_numbers: { type: 'integer[]' },
    reel_outcome: { type: 'jsonb' },
    phase: { type: 'text', notNull: true, default: 'waiting' },
    started_at: { type: 'timestamptz' },
    ended_at: { type: 'timestamptz' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('game_rounds', 'game_rounds_game_id_check', {
    check: "game_id IN ('aviator','fast-keno','multi-hot-5')",
  });
  pgm.addConstraint('game_rounds', 'game_rounds_phase_check', {
    check: "phase IN ('waiting','flying','crashed','betting','drawing','complete')",
  });
  pgm.createIndex('game_rounds', ['tenant_id', 'game_id', 'created_at']);
  pgm.createIndex('game_rounds', ['tenant_id', 'game_id', 'phase']);
  pgm.createIndex('game_rounds', 'created_at');

  pgm.createTable('game_bets', {
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
    round_id: {
      type: 'uuid',
      notNull: true,
      references: 'game_rounds(id)',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    game_id: { type: 'text', notNull: true },
    amount: { type: 'numeric(18,2)', notNull: true },
    auto_cashout: { type: 'numeric(10,2)' },
    selected_numbers: { type: 'integer[]' },
    lines: { type: 'integer' },
    payout: { type: 'numeric(18,2)', notNull: true, default: 0 },
    multiplier_at_cashout: { type: 'numeric(10,2)' },
    status: { type: 'text', notNull: true, default: 'active' },
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
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('game_bets', 'game_bets_game_id_check', {
    check: "game_id IN ('aviator','fast-keno','multi-hot-5')",
  });
  pgm.addConstraint('game_bets', 'game_bets_status_check', {
    check: "status IN ('active','cashed_out','lost','won')",
  });
  pgm.addConstraint('game_bets', 'game_bets_amount_positive', {
    check: 'amount > 0',
  });
  pgm.createIndex('game_bets', ['tenant_id', 'round_id']);
  pgm.createIndex('game_bets', ['tenant_id', 'user_id', 'created_at']);
  pgm.createIndex('game_bets', ['tenant_id', 'game_id', 'status']);
  pgm.createTrigger('game_bets', 'game_bets_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE game_rounds ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE game_rounds FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY game_rounds_tenant_isolation ON game_rounds
    FOR ALL
    USING (app_is_bypass_rls() OR tenant_id = get_tenant_context())
    WITH CHECK (app_is_bypass_rls() OR tenant_id = get_tenant_context());
  `);

  pgm.sql(`ALTER TABLE game_bets ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE game_bets FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY game_bets_tenant_isolation ON game_bets
    FOR ALL
    USING (app_is_bypass_rls() OR tenant_id = get_tenant_context())
    WITH CHECK (app_is_bypass_rls() OR tenant_id = get_tenant_context());
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP POLICY IF EXISTS game_bets_tenant_isolation ON game_bets`);
  pgm.sql(`DROP POLICY IF EXISTS game_rounds_tenant_isolation ON game_rounds`);
  pgm.dropTrigger('game_bets', 'game_bets_touch_updated_at');
  pgm.dropTable('game_bets');
  pgm.dropTable('game_rounds');
};
