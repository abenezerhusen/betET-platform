/**
 * Per-game bet & win limits for the internal games.
 *
 * `internal_games` already carries `min_bet` / `max_bet`, but those columns
 * were never enforced on the bet APIs and their generic defaults (5 … 50000)
 * did not match the ranges the game clients actually use. This migration:
 *
 *   1. Adds `max_win` — a hard ceiling on a single-round payout so large bets
 *      can never produce an uncontrolled payout (admin-configurable).
 *   2. Re-seeds `min_bet` / `max_bet` / `max_win` per game to match each
 *      client's real bet range, so turning ON enforcement keeps every existing
 *      bet valid (Aviator/JetX 1…50000, Fast Keno 1…10000, Multi Hot 5
 *      0.05…2000 total stake).
 *   3. Adds a range check so admin edits stay sane.
 *
 * Additive only — no game, RTP value, or existing setting is removed.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.addColumn('internal_games', {
    max_win: {
      type: 'numeric(18,2)',
      notNull: true,
      default: 1000000,
    },
  });

  // Align limits with the ranges the live game clients allow, so enabling
  // enforcement does not reject any bet players can currently place.
  pgm.sql(`
    UPDATE internal_games SET min_bet = 1,    max_bet = 50000, max_win = 500000  WHERE id = 'aviator';
    UPDATE internal_games SET min_bet = 1,    max_bet = 50000, max_win = 500000  WHERE id = 'jetx';
    UPDATE internal_games SET min_bet = 1,    max_bet = 10000, max_win = 1000000 WHERE id = 'fast-keno';
    UPDATE internal_games SET min_bet = 0.05, max_bet = 2000,  max_win = 200000  WHERE id = 'multi-hot-5';
  `);

  pgm.addConstraint('internal_games', 'internal_games_bet_win_range', {
    check: 'min_bet > 0 AND max_bet >= min_bet AND max_win >= max_bet',
  });
};

exports.down = async (pgm) => {
  pgm.dropConstraint('internal_games', 'internal_games_bet_win_range', {
    ifExists: true,
  });
  pgm.dropColumn('internal_games', 'max_win', { ifExists: true });
};
