/**
 * streak_configs + user_streaks
 * - Tenant-scoped streak reward tiers managed by admin panel.
 * - Per-user streak progress rows updated as settled bets are processed.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('streak_configs', {
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
    enabled: { type: 'boolean', notNull: true, default: true },
    streak_days: { type: 'integer', notNull: true },
    reward_type: { type: 'text', notNull: true, default: 'free_bet' },
    reward_amount: { type: 'numeric(18,2)', notNull: true, default: 0 },
    min_bet_daily: { type: 'numeric(18,2)', notNull: true, default: 10 },
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

  pgm.addConstraint('streak_configs', 'streak_configs_reward_type_check', {
    check: "reward_type IN ('free_bet','cash','multiplier')",
  });
  pgm.addConstraint('streak_configs', 'streak_configs_streak_days_positive', {
    check: 'streak_days > 0',
  });
  pgm.addConstraint('streak_configs', 'streak_configs_tenant_days_unique', {
    unique: ['tenant_id', 'streak_days'],
  });
  pgm.createIndex('streak_configs', 'tenant_id');
  pgm.createIndex('streak_configs', ['tenant_id', 'enabled']);
  pgm.createIndex('streak_configs', ['tenant_id', 'streak_days']);
  pgm.createTrigger('streak_configs', 'streak_configs_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.createTable('user_streaks', {
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
    current_streak: { type: 'integer', notNull: true, default: 0 },
    longest_streak: { type: 'integer', notNull: true, default: 0 },
    last_bet_date: { type: 'date' },
    streak_bonus_earned: { type: 'numeric(18,2)', notNull: true, default: 0 },
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
  pgm.addConstraint('user_streaks', 'user_streaks_pk', {
    primaryKey: ['tenant_id', 'user_id'],
  });
  pgm.createIndex('user_streaks', ['tenant_id', 'current_streak']);
  pgm.createIndex('user_streaks', ['tenant_id', 'longest_streak']);
  pgm.createIndex('user_streaks', ['tenant_id', 'last_bet_date']);
  pgm.createTrigger('user_streaks', 'user_streaks_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE streak_configs ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE streak_configs FORCE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE user_streaks FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY streak_configs_tenant_isolation ON streak_configs
    FOR ALL
    USING (app_is_bypass_rls() OR tenant_id = get_tenant_context())
    WITH CHECK (app_is_bypass_rls() OR tenant_id = get_tenant_context());
  `);
  pgm.sql(`
    CREATE POLICY user_streaks_tenant_isolation ON user_streaks
    FOR ALL
    USING (app_is_bypass_rls() OR tenant_id = get_tenant_context())
    WITH CHECK (app_is_bypass_rls() OR tenant_id = get_tenant_context());
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP POLICY IF EXISTS user_streaks_tenant_isolation ON user_streaks`);
  pgm.sql(`DROP POLICY IF EXISTS streak_configs_tenant_isolation ON streak_configs`);
  pgm.dropTrigger('user_streaks', 'user_streaks_touch_updated_at');
  pgm.dropTrigger('streak_configs', 'streak_configs_touch_updated_at');
  pgm.dropTable('user_streaks');
  pgm.dropTable('streak_configs');
};
