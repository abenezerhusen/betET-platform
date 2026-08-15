/**
 * Casino provider separation & reporting readiness (ADDITIVE ONLY).
 *
 * 1. external_game_providers.revenue_share_percent — the negotiated GGR
 *    share owed to an external provider. Configurable per provider; the
 *    casino reports use it to compute the provider-payable amount. Never
 *    assumed — defaults to 0 until an admin sets the commercial terms.
 *
 * 2. transactions type/status CHECK constraints — the external-game
 *    webhook (POST /hooks/:provider) records provider bets/wins as
 *    transactions of type 'external_game_bet' / 'external_game_win' and
 *    marks rolled-back ones as status 'rolled_back'. Neither value was
 *    allowed by the original constraints, so the first live provider
 *    integration would crash on its first debit. Extending a CHECK
 *    constraint is instantaneous and cannot affect existing rows.
 *
 * 3. Partial index on external-game transactions so provider reports can
 *    aggregate them by tenant/date without scanning the whole ledger.
 *    Built CONCURRENTLY (no write lock on the live transactions table).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();

  pgm.sql(`
    ALTER TABLE external_game_providers
      ADD COLUMN IF NOT EXISTS revenue_share_percent numeric(5,2) NOT NULL DEFAULT 0
        CONSTRAINT external_game_providers_rev_share_range
          CHECK (revenue_share_percent >= 0 AND revenue_share_percent <= 100)
  `);

  pgm.sql(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check
  `);
  pgm.sql(`
    ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
      CHECK (type = ANY (ARRAY[
        'deposit','withdrawal','bet_stake','bet_win','bet_refund','bet_cashout',
        'bonus_credit','bonus_debit','transfer_in','transfer_out','adjustment',
        'commission','cashier_deposit','cashier_withdrawal','p2p_deposit',
        'p2p_withdrawal','jackpot_win','rollback',
        'external_game_bet','external_game_win'
      ]))
  `);

  pgm.sql(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check
  `);
  pgm.sql(`
    ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
      CHECK (status = ANY (ARRAY[
        'pending','completed','failed','reversed','cancelled','rolled_back'
      ]))
  `);

  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_external_game
      ON transactions (tenant_id, created_at)
      WHERE type IN ('external_game_bet','external_game_win')
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();

  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_transactions_external_game');

  // Restore the previous constraints only if no rows use the new values —
  // otherwise leave the extended constraints in place (never break data).
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM transactions
         WHERE type IN ('external_game_bet','external_game_win')
            OR status = 'rolled_back'
      ) THEN
        ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
        ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
          CHECK (type = ANY (ARRAY[
            'deposit','withdrawal','bet_stake','bet_win','bet_refund','bet_cashout',
            'bonus_credit','bonus_debit','transfer_in','transfer_out','adjustment',
            'commission','cashier_deposit','cashier_withdrawal','p2p_deposit',
            'p2p_withdrawal','jackpot_win','rollback'
          ]));
        ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
        ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
          CHECK (status = ANY (ARRAY['pending','completed','failed','reversed','cancelled']));
      END IF;
    END $$;
  `);

  pgm.sql(`
    ALTER TABLE external_game_providers
      DROP COLUMN IF EXISTS revenue_share_percent
  `);
};
