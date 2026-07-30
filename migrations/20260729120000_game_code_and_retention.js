/**
 * Human-readable 8-digit Game ID for every internal game round.
 *
 * The admin "Game List → History" view needs a short, searchable identifier
 * for each play. Round primary keys are UUIDs (hard to read / type), so we add
 * a `game_code` column filled from a dedicated sequence and zero-padded to 8
 * digits (e.g. 10000042). Because the value comes from a column DEFAULT, every
 * existing round-insert path (the Multi Hot 5 spin route and the
 * Aviator / JetX / Fast Keno worker loops) automatically receives a code with
 * no code changes required.
 *
 * The sequence starts at 10_000_000 so codes are always 8 digits until well
 * past 90M rounds; after that lpad simply stops padding and codes grow to 9+
 * digits (still valid, still unique).
 *
 * Retention: game history is only kept for 45 days. A background worker
 * (`game-retention-loop`) deletes `game_rounds` older than that; `game_bets`
 * cascade automatically via their `round_id` foreign key.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Dedicated sequence so codes are globally unique and monotonic (easy to
  // read / search). CACHE 1 keeps values gap-free-ish across restarts.
  pgm.sql(`CREATE SEQUENCE IF NOT EXISTS game_code_seq START WITH 10000000 MINVALUE 10000000`);

  pgm.addColumn('game_rounds', {
    game_code: { type: 'text' },
  });

  // Backfill existing rounds with sequential codes (advances the sequence so
  // future inserts continue after the last backfilled value).
  pgm.sql(`
    UPDATE game_rounds
       SET game_code = lpad(nextval('game_code_seq')::text, 8, '0')
     WHERE game_code IS NULL
  `);

  // New rounds get a code automatically from the sequence.
  pgm.sql(`
    ALTER TABLE game_rounds
      ALTER COLUMN game_code SET DEFAULT lpad(nextval('game_code_seq')::text, 8, '0')
  `);

  pgm.alterColumn('game_rounds', 'game_code', { notNull: true });

  pgm.createIndex('game_rounds', 'game_code', {
    unique: true,
    name: 'game_rounds_game_code_unique',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('game_rounds', 'game_code', {
    name: 'game_rounds_game_code_unique',
    ifExists: true,
  });
  pgm.dropColumn('game_rounds', 'game_code');
  pgm.sql(`DROP SEQUENCE IF EXISTS game_code_seq`);
};
