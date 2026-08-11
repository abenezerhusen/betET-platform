/**
 * Top Leagues configuration (ADDITIVE ONLY).
 *
 * Admin-configurable list of "top leagues" per tenant (managed from the Game
 * Picks settings page). Replaces the previously hardcoded top-5 league
 * ordering: the public sports board ranks configured leagues first (by
 * priority) and the odds sync prices them ahead of everything else. When a
 * tenant has no rows the platform falls back to the previous hardcoded
 * defaults, so existing behaviour is unchanged until an admin configures it.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('top_leagues', {
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
    league: { type: 'text', notNull: true },
    enabled: { type: 'boolean', notNull: true, default: true },
    priority: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('top_leagues', 'top_leagues_tenant_league_uniq', {
    unique: ['tenant_id', 'league'],
  });
  pgm.createIndex('top_leagues', ['tenant_id', 'priority']);
};

exports.down = (pgm) => {
  pgm.dropTable('top_leagues');
};
