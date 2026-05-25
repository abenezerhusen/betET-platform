/**
 * Section 13 — Packages
 *
 * Original schema stored the client as a free-form text name. The spec
 * positions packages as "Super Admin" bundling games for white-label
 * client tenants, so an assignment is really a (package -> tenant) link.
 *
 * This migration adds a strongly-typed `client_tenant_id` FK to
 * `tenants(id)` while keeping the existing `client_name` column for
 * backwards-compat with the rows that were created before this change.
 *
 * A partial unique index prevents the same client tenant being assigned to
 * multiple packages simultaneously (a tenant has at most one active
 * package).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('package_assignments', {
    client_tenant_id: {
      type: 'uuid',
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.createIndex('package_assignments', 'client_tenant_id');

  // A given client tenant can be assigned to at most one package per
  // operator tenant. Older rows without a client_tenant_id are unaffected.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      package_assignments_tenant_client_tenant_unique
    ON package_assignments (tenant_id, client_tenant_id)
    WHERE client_tenant_id IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS package_assignments_tenant_client_tenant_unique
  `);
  pgm.dropIndex('package_assignments', 'client_tenant_id', { ifExists: true });
  pgm.dropColumns('package_assignments', ['client_tenant_id'], { ifExists: true });
};
