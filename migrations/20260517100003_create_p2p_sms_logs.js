exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_sms_logs (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id    UUID NOT NULL REFERENCES p2p_devices(id),
      sender       VARCHAR(50),
      body         TEXT NOT NULL,
      received_at  TIMESTAMPTZ NOT NULL,
      dedup_hash   VARCHAR(64) NOT NULL UNIQUE,
      parsed       BOOLEAN DEFAULT false,
      parse_result JSONB,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sms_dedup ON p2p_sms_logs(dedup_hash);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sms_device ON p2p_sms_logs(device_id);`);
};

exports.down = () => {};
