/**
 * Format-tolerant phone search support (ADDITIVE ONLY).
 *
 * Admin list endpoints now match phones with either a raw substring
 * (`phone ILIKE '%x%'`) or a digits-only comparison
 * (`regexp_replace(COALESCE(phone,''), '\D', '', 'g') LIKE '%digits%'`)
 * so +2519…, 2519… and 09… inputs all find the same user. Substring
 * matching cannot use btree indexes, so add pg_trgm GIN indexes on both
 * forms of users.phone — the column every one of those searches hits.
 *
 * Runs outside a transaction so the indexes can be built CONCURRENTLY
 * (no write lock on the live users table).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();

  pgm.createExtension('pg_trgm', { ifNotExists: true });

  // Raw substring search (existing ILIKE '%x%' behaviour).
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_phone_trgm
      ON users USING gin (phone gin_trgm_ops)
  `);

  // Digits-only search — expression must match the SQL emitted by
  // phoneDigitsSql() in backend/src/modules/admin/admin-shared.ts.
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_phone_digits_trgm
      ON users USING gin (regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') gin_trgm_ops)
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_users_phone_digits_trgm');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_users_phone_trgm');
};
