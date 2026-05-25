/**
 * Section 21 — Payment Configuration extensions.
 *
 * Adds two missing flags to `payment_methods`:
 *
 *   supports_transfer   — When true, the method shows in the
 *                         user-panel transfer flow (peer to peer).
 *   is_default          — When true, marks the row as the tenant's
 *                         default gateway. Used by deposit/withdraw
 *                         pages to pre-select a method when the user
 *                         hasn't picked one yet.
 *
 * Both default to FALSE so existing rows keep their behaviour. A
 * partial UNIQUE INDEX enforces "at most one default per tenant" so
 * the admin UI can flip the flag without explicit demotion of the
 * previous default (the application code uses ON CONFLICT to flip).
 *
 * Down: drop the new columns + index.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE payment_methods
      ADD COLUMN IF NOT EXISTS supports_transfer boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_default        boolean NOT NULL DEFAULT false
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_one_default_per_tenant
      ON payment_methods (tenant_id)
      WHERE is_default = true
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS payment_methods_one_default_per_tenant`);
  pgm.sql(`
    ALTER TABLE payment_methods
      DROP COLUMN IF EXISTS supports_transfer,
      DROP COLUMN IF EXISTS is_default
  `);
};
