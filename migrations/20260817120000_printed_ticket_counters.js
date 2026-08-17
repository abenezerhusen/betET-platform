/**
 * Race-safe printed-ticket sequence counters.
 *
 * The old generator derived the 4-digit SEQ of `TKT-{BRANCH}-{YYYYMMDD}-{SEQ}`
 * from `COUNT(*) + 1` over already-printed rows. Two sells racing on the same
 * branch/day computed the same count and produced DUPLICATE coupon numbers
 * (the per-table unique index also let the same code exist once in `bets`
 * and once in `sportsbook_bets`).
 *
 * This table is the single source of the next sequence per code prefix
 * (`TKT-{BRANCH}-{YYYYMMDD}`). The generator increments it with a single
 * atomic `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`, so concurrent
 * requests serialize on the row lock and can never receive the same number.
 * On first use of a prefix the row is seeded from the max sequence already
 * present on legacy rows, so existing same-day codes are never re-issued;
 * a brand-new branch/day starts at 0001.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS printed_ticket_counters (
      tenant_id   uuid        NOT NULL,
      code_prefix text        NOT NULL,
      last_seq    integer     NOT NULL DEFAULT 0,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, code_prefix)
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS printed_ticket_counters`);
};
