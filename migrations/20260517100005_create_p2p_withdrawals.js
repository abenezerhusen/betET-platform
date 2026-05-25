exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_withdrawals (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id),
      device_id        UUID REFERENCES p2p_devices(id),
      amount           DECIMAL(18,2) NOT NULL,
      recipient_phone  VARCHAR(20) NOT NULL,
      ussd_command     VARCHAR(100),
      status           VARCHAR(30) DEFAULT 'pending'
                       CHECK (status IN (
                         'pending','processing','awaiting_approval',
                         'success','failed','switched'
                       )),
      threshold_flag   BOOLEAN DEFAULT false,
      approved_by      UUID REFERENCES users(id),
      approved_at      TIMESTAMPTZ,
      failed_reason    TEXT,
      retry_count      SMALLINT DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

exports.down = () => {};
