/**
 * Extend the game_rounds.game_id CHECK constraint so it accepts the
 * full set of game slugs the workers actually insert.
 *
 * The original constraint (introduced when only 3 games existed) listed
 *   aviator, fast-keno, multi-hot-5
 * but the jetx worker tries to insert 'jetx' on every tick, which raised
 * the constraint and prevented JetX rounds from ever rotating.
 *
 * We replace it with the full set the codebase emits today and re-create
 * it with a deterministic name so future migrations can patch it the
 * same way regardless of pg-migrate version.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      cname text;
    BEGIN
      SELECT conname INTO cname
        FROM pg_constraint
       WHERE conrelid = 'game_rounds'::regclass
         AND contype  = 'c'
         AND pg_get_constraintdef(oid) LIKE '%game_id%';
      IF cname IS NOT NULL THEN
        EXECUTE 'ALTER TABLE game_rounds DROP CONSTRAINT ' || quote_ident(cname);
      END IF;

      ALTER TABLE game_rounds
        ADD CONSTRAINT game_rounds_game_id_check
        CHECK (game_id = ANY (ARRAY[
          'aviator',
          'fast-keno',
          'multi-hot-5',
          'jetx',
          'plinko',
          'mines',
          'dice'
        ]::text[]));
    END$$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_game_id_check;
      ALTER TABLE game_rounds
        ADD CONSTRAINT game_rounds_game_id_check
        CHECK (game_id = ANY (ARRAY['aviator', 'fast-keno', 'multi-hot-5']::text[]));
    END$$;
  `);
};
