import { logger } from '../infrastructure/logger';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { ensureDefaultTenant, ensureOwnerSuperadmin } from './seed.data';

/**
 * Creates (or refreshes) ONLY the permanent owner superadmin account.
 *
 * Unlike `npm run seed`, this script touches nothing else — no demo users,
 * no sample sports/games — so it is safe to run against a live database at
 * any time, including production go-live. It is fully idempotent: re-running
 * simply re-applies the (optionally env-overridden) credentials.
 *
 * Credentials come from env vars when set, otherwise the owner defaults:
 *   OWNER_SUPERADMIN_USERNAME / OWNER_SUPERADMIN_PASSWORD / OWNER_SUPERADMIN_EMAIL
 */
async function main(): Promise<void> {
  await withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
    const tenant = await ensureDefaultTenant(client);
    await ensureOwnerSuperadmin(client, tenant.id);
  });
  logger.info(
    'owner superadmin ready — username: %s / email: %s',
    process.env.OWNER_SUPERADMIN_USERNAME ?? 'Abenezer@1birrbet',
    process.env.OWNER_SUPERADMIN_EMAIL ?? 'abenezer.hussen.ab@gmail.com'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed-owner failed');
    process.exit(1);
  });
