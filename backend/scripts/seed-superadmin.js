const { Client } = require("pg");
const bcrypt = require("bcrypt");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const tenantName = "Default Tenant";
  const tenantSlug = "default";
  const adminPhone = "0911000000";
  const adminPassword = "Admin@12345";
  const adminRole = "superadmin";
  const adminUsername = "superadmin";

  const tenantRes = await client.query(
    `INSERT INTO tenants (name, slug, status, config)
     VALUES ($1, $2::citext, 'active', '{}'::jsonb)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [tenantName, tenantSlug]
  );
  const tenantId = tenantRes.rows[0].id;

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await client.query(
    `INSERT INTO users
      (tenant_id, phone, password_hash, role, status, kyc_status, metadata)
     VALUES
      ($1, $2, $3, $4, 'active', 'verified', $5::jsonb)
     ON CONFLICT (tenant_id, phone) WHERE phone IS NOT NULL
     DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role,
      status = 'active',
      kyc_status = 'verified',
      metadata = EXCLUDED.metadata,
      updated_at = now()`,
    [
      tenantId,
      adminPhone,
      passwordHash,
      adminRole,
      JSON.stringify({ full_name: "Super Admin", username: adminUsername }),
    ]
  );

  await client.end();

  console.log("Seed complete:");
  console.log(`tenant_slug=${tenantSlug}`);
  console.log(`super_admin_username=${adminUsername}`);
  console.log(`super_admin_phone=${adminPhone}`);
  console.log(`super_admin_password=${adminPassword}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
