exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_deposits (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sms_log_id      UUID REFERENCES p2p_sms_logs(id),
      device_id       UUID NOT NULL REFERENCES p2p_devices(id),
      user_id         UUID REFERENCES users(id),
      amount          DECIMAL(18,2) NOT NULL,
      sender_name     VARCHAR(100),
      sender_phone    VARCHAR(20),
      telebirr_ref    VARCHAR(100) UNIQUE,
      status          VARCHAR(30) DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected')),
      detection_type  VARCHAR(10) DEFAULT 'auto'
                      CHECK (detection_type IN ('auto','manual')),
      approved_by     UUID REFERENCES users(id),
      approved_at     TIMESTAMPTZ,
      rejection_note  TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_deposits_status ON p2p_deposits(status);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_deposits_ref ON p2p_deposits(telebirr_ref);`);
};

exports.down = () => {};
