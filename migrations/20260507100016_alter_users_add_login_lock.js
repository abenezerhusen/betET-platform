/**
 * users (login lock columns)
 *  - failed_login_attempts: counter, reset to 0 on successful login.
 *  - locked_until: when set in the future, login is blocked.
 *  - last_failed_login_at: most recent failed attempt (for forensic / audit).
 *
 * The application increments failed_login_attempts on every wrong password.
 * When attempts >= MAX_FAILED_LOGIN_ATTEMPTS (env, default 10), the account
 * is locked by setting locked_until = now() + ACCOUNT_LOCK_DURATION.
 *
 * NOTE: last_login_at is already defined on users in
 *       20260507100004_create_users.js — it is intentionally NOT added here.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('users', {
    failed_login_attempts: { type: 'integer', notNull: true, default: 0 },
    locked_until: { type: 'timestamptz' },
    last_failed_login_at: { type: 'timestamptz' },
  });

  pgm.createIndex('users', 'locked_until');
  pgm.createIndex('users', 'failed_login_attempts');
};

exports.down = (pgm) => {
  pgm.dropIndex('users', 'failed_login_attempts');
  pgm.dropIndex('users', 'locked_until');
  pgm.dropColumns('users', [
    'failed_login_attempts',
    'locked_until',
    'last_failed_login_at',
  ]);
};
