exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_devices (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label           VARCHAR(100) NOT NULL,
      telebirr_phone  VARCHAR(20)  NOT NULL UNIQUE,
      device_token    VARCHAR(255) NOT NULL UNIQUE,
      status          VARCHAR(20)  DEFAULT 'offline'
                      CHECK (status IN ('online','offline','maintenance')),
      battery_pct     SMALLINT,
      signal_strength SMALLINT,
      last_seen_at    TIMESTAMPTZ,
      pre_deposit     DECIMAL(18,2) DEFAULT 0,
      commission_rate DECIMAL(5,4)  DEFAULT 0.02,
      daily_limit     DECIMAL(18,2) DEFAULT 100000,
      used_today      DECIMAL(18,2) DEFAULT 0,
      encrypted_pin   TEXT,
      autostart       BOOLEAN DEFAULT false,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION p2p_devices_touch_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_p2p_devices_updated_at ON p2p_devices;
    CREATE TRIGGER trg_p2p_devices_updated_at
      BEFORE UPDATE ON p2p_devices
      FOR EACH ROW EXECUTE FUNCTION p2p_devices_touch_updated_at();
  `);
};

exports.down = () => {};
