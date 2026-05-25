/**
 * Prompt 5 / A.4
 * Expand existing game_picks model + add subscriptions table.
 */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('game_picks', {
    game: { type: 'varchar(200)' },
    type: { type: 'varchar(50)' },
    prediction: { type: 'varchar(200)' },
    confidence: { type: 'integer', check: 'confidence BETWEEN 1 AND 100' },
    subscribers: { type: 'integer', notNull: true, default: 0 },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'Active',
      check: "status IN ('Active','Upcoming','Completed','Cancelled')",
    },
    start_time: { type: 'timestamptz' },
    result: { type: 'varchar(50)' },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
  });
  pgm.createIndex('game_picks', 'status');
  pgm.createIndex('game_picks', 'start_time');

  pgm.createTable('game_pick_subscriptions', {
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    pick_id: { type: 'uuid', notNull: true, references: 'game_picks(id)', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('game_pick_subscriptions', 'game_pick_subscriptions_pk', {
    primaryKey: ['tenant_id', 'user_id', 'pick_id'],
  });
  pgm.createIndex('game_pick_subscriptions', 'tenant_id');
  pgm.createIndex('game_pick_subscriptions', 'pick_id');
  pgm.createIndex('game_pick_subscriptions', 'user_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('game_pick_subscriptions', { ifExists: true, cascade: true });
  pgm.dropColumns('game_picks', [
    'game',
    'type',
    'prediction',
    'confidence',
    'subscribers',
    'status',
    'start_time',
    'result',
    'created_by',
  ]);
};
