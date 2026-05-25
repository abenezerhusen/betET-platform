exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE p2p_devices
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  `);

  pgm.sql(`
    ALTER TABLE p2p_deposits
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  `);

  // Backfill device tenant from existing Telebirr agent links.
  pgm.sql(`
    UPDATE p2p_devices p
       SET tenant_id = a.tenant_id
      FROM telebirr_agents a
     WHERE p.tenant_id IS NULL
       AND (
         a.telebirr_number = p.telebirr_phone
         OR a.device_id = p.device_token
       );
  `);

  // Backfill deposit tenant from linked user first.
  pgm.sql(`
    UPDATE p2p_deposits d
       SET tenant_id = u.tenant_id
      FROM users u
     WHERE d.tenant_id IS NULL
       AND d.user_id = u.id;
  `);

  // Then from the linked device.
  pgm.sql(`
    UPDATE p2p_deposits d
       SET tenant_id = p.tenant_id
      FROM p2p_devices p
     WHERE d.tenant_id IS NULL
       AND d.device_id = p.id;
  `);

  // Safety fallback for old local data: first tenant.
  pgm.sql(`
    UPDATE p2p_devices p
       SET tenant_id = t.id
      FROM (
        SELECT id
          FROM tenants
         ORDER BY created_at ASC
         LIMIT 1
      ) t
     WHERE p.tenant_id IS NULL;
  `);

  pgm.sql(`
    UPDATE p2p_deposits d
       SET tenant_id = t.id
      FROM (
        SELECT id
          FROM tenants
         ORDER BY created_at ASC
         LIMIT 1
      ) t
     WHERE d.tenant_id IS NULL;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_p2p_devices_tenant
      ON p2p_devices(tenant_id);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_p2p_deposits_tenant_status
      ON p2p_deposits(tenant_id, status, created_at DESC);
  `);
};

exports.down = () => {};
