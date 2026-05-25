/**
 * bets
 *  - Unified bet record across sports, casino, virtuals, jackpots and
 *    embedded games. Selection details live in result/metadata jsonb to
 *    avoid coupling to a single domain shape.
 *  - settled_at is set on terminal status (won/lost/void/cancelled).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('bets', {
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
      references: 'games(id)',
    },
    session_id: {
      type: 'uuid',
      references: 'game_sessions(id)',
    },
    stake: { type: 'numeric(20,4)', notNull: true },
    potential_win: { type: 'numeric(20,4)', notNull: true, default: 0 },
    payout: { type: 'numeric(20,4)' },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    status: { type: 'text', notNull: true, default: 'pending' },
    result: { type: 'jsonb' },
    placed_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    settled_at: { type: 'timestamptz' },
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

  pgm.addConstraint('bets', 'bets_status_check', {
    check:
      "status IN ('pending','accepted','won','lost','void','cancelled','cashed_out','partial_won')",
  });
  pgm.addConstraint('bets', 'bets_stake_positive', { check: 'stake > 0' });
  pgm.addConstraint('bets', 'bets_potential_nonneg', {
    check: 'potential_win >= 0',
  });

  pgm.createIndex('bets', 'tenant_id');
  pgm.createIndex('bets', 'user_id');
  pgm.createIndex('bets', 'game_id');
  pgm.createIndex('bets', 'session_id');
  pgm.createIndex('bets', 'status');
  pgm.createIndex('bets', 'placed_at');
  pgm.createIndex('bets', 'settled_at');
  pgm.createIndex('bets', 'created_at');
  pgm.createIndex('bets', ['tenant_id', 'status']);
  pgm.createIndex('bets', ['tenant_id', 'user_id']);
  pgm.createIndex('bets', ['tenant_id', 'created_at']);
  pgm.createIndex('bets', ['tenant_id', 'game_id', 'status']);

  pgm.sql(`ALTER TABLE bets ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE bets FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY bets_tenant_isolation ON bets
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
  pgm.sql(`DROP POLICY IF EXISTS bets_tenant_isolation ON bets`);
  pgm.dropTable('bets');
};
