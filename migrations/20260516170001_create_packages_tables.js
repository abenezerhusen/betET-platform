/**
 * Prompt 5 / A.1
 * Packages + package_assignments for white-label client game bundles.
 */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('packages', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    name: { type: 'varchar(100)', notNull: true },
    tier: {
      type: 'varchar(20)',
      notNull: true,
      default: 'Starter',
      check: "tier IN ('Starter','Premium','VIP')",
    },
    color: { type: 'varchar(20)', notNull: true, default: 'gray' },
    game_ids: { type: 'text[]', notNull: true, default: pgm.func('ARRAY[]::text[]') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('packages', 'tenant_id');
  pgm.createIndex('packages', 'tier');

  pgm.createTable('package_assignments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants(id)', onDelete: 'CASCADE' },
    package_id: { type: 'uuid', notNull: true, references: 'packages(id)', onDelete: 'CASCADE' },
    client_name: { type: 'varchar(100)', notNull: true },
    user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    assigned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('package_assignments', 'tenant_id');
  pgm.createIndex('package_assignments', 'package_id');
  pgm.addConstraint('package_assignments', 'package_assignments_tenant_client_unique', {
    unique: ['tenant_id', 'client_name'],
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('package_assignments', { ifExists: true, cascade: true });
  pgm.dropTable('packages', { ifExists: true, cascade: true });
};
