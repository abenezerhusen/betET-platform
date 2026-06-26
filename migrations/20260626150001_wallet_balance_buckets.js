/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Wallet Balance Buckets
 * ----------------------
 * Splits the user wallet into three accounting buckets so the platform can
 * prevent fraud and double-spending:
 *
 *   balance                -> Deductable Balance   (used for staking bets)
 *   withdrawable_balance   -> Withdrawable Balance (cash the user may withdraw)
 *   payable_balance        -> Payable Balance      (winnings awaiting settlement)
 *
 * Cashier deposits always credit the Deductable bucket only (non-withdrawable),
 * per the platform rule. Winnings land in Payable first, then move to
 * Withdrawable once the bet is fully settled.
 */
exports.up = async (pgm) => {
  pgm.addColumn('wallets', {
    withdrawable_balance: {
      type: 'numeric',
      notNull: true,
      default: 0,
      check: 'withdrawable_balance >= 0',
    },
  });

  pgm.addColumn('wallets', {
    payable_balance: {
      type: 'numeric',
      notNull: true,
      default: 0,
      check: 'payable_balance >= 0',
    },
  });

  // Backfill existing wallets: treat any current positive balance as
  // withdrawable (safe default — funds were already there before the split).
  // New deposits going forward follow the new bucket rules.
  pgm.sql(`
    UPDATE wallets
       SET withdrawable_balance = COALESCE(balance, 0)
     WHERE COALESCE(balance, 0) > 0
       AND COALESCE(withdrawable_balance, 0) = 0
  `);

  // Helpful composite index for tenant-scoped balance queries.
  pgm.createIndex('wallets', ['tenant_id', 'status'], {
    ifNotExists: true,
  });
};

exports.down = async (pgm) => {
  pgm.dropIndex('wallets', ['tenant_id', 'status'], { ifExists: true });
  pgm.dropColumn('wallets', 'payable_balance');
  pgm.dropColumn('wallets', 'withdrawable_balance');
};
