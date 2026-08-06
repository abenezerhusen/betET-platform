/**
 * Multi Hot 5 — set the default RTP target to 97.05%.
 *
 * The slot's return-to-player is enforced as a win-frequency gate in the RNG
 * (see generateMultiHot5Outcome in game-rng.service.ts). This migration aligns
 * the game's configured default_rtp with the 97.05% design target.
 *
 * Purely a data update on the single `multi-hot-5` catalog row — any admin
 * per-client override in `game_rtp_overrides` still takes precedence, and no
 * schema or other game is touched.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    UPDATE internal_games
       SET default_rtp = 97.05
     WHERE id = 'multi-hot-5'
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    UPDATE internal_games
       SET default_rtp = 96.50
     WHERE id = 'multi-hot-5'
  `);
};
