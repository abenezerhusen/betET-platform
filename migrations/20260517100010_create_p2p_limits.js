exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_limits (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      max_daily_total           DECIMAL(18,2) DEFAULT 500000,
      max_per_transaction       DECIMAL(18,2) DEFAULT 50000,
      auto_switch_enabled       BOOLEAN DEFAULT true,
      auto_switch_threshold     DECIMAL(5,2) DEFAULT 80,
      exhaustion_threshold      DECIMAL(5,2) DEFAULT 90,
      block_on_exhaustion       BOOLEAN DEFAULT true,
      notify_admin              BOOLEAN DEFAULT true,
      notify_agent              BOOLEAN DEFAULT true,
      notify_channel            VARCHAR(10) DEFAULT 'both'
                                CHECK (notify_channel IN ('sms','email','both')),
      manual_approval_threshold DECIMAL(18,2) DEFAULT 10000,
      wallet_priority           UUID[],
      updated_at                TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  pgm.sql(`
    INSERT INTO p2p_limits DEFAULT VALUES
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = () => {};
