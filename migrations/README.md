# Database Migrations

PostgreSQL migrations for the betET multi-tenant betting platform, written in
[`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/) format.

These migrations only define schema. They do **not** modify any panel
(admin / cashier / user / game-engine) and do not change any existing
functionality. The Supabase migration in
`admin-panel-main/supabase/migrations/` is left untouched.

---

## Prerequisites

- Node.js >= 20
- PostgreSQL >= 14 (the schema uses `pgcrypto`, `citext`, and Row Level Security)
- A Postgres user that **does not** have `BYPASSRLS`, except where you
  explicitly want to bypass tenant isolation (typically only the migration
  runner during initial setup).

---

## Install & run

```bash
cd migrations
npm install

# Apply all pending migrations
DATABASE_URL=postgres://user:pass@host:5432/betet npm run migrate

# Roll back the last migration
DATABASE_URL=postgres://... npm run migrate:down

# Show pending vs applied
DATABASE_URL=postgres://... npm run migrate:status
```

`node-pg-migrate` reads `DATABASE_URL` (or `PG*` env vars). Configuration is
in `.node-pg-migraterc.json` — every migration is wrapped in a single
transaction (`single-transaction`) and ordering is enforced (`check-order`).

---

## Migration order

| # | File | Purpose |
|---|------|---------|
| 01 | `20260507100001_extensions_and_helpers.js` | extensions, tenant context fns, RLS bypass helper, `touch_updated_at` |
| 02 | `20260507100002_create_tenants.js`         | `tenants` (root entity, RLS on `id`) |
| 03 | `20260507100003_create_roles.js`           | `roles` |
| 04 | `20260507100004_create_users.js`           | `users` |
| 05 | `20260507100005_create_wallets.js`         | `wallets` |
| 06 | `20260507100006_create_transactions.js`    | `transactions` (append-only ledger) |
| 07 | `20260507100007_create_games.js`           | `games` |
| 08 | `20260507100008_create_game_sessions.js`   | `game_sessions` |
| 09 | `20260507100009_create_bets.js`            | `bets` |
| 10 | `20260507100010_create_audit_logs.js`      | `audit_logs` (append-only, tenant_id nullable for system events) |
| 11 | `20260507100011_create_cashier_transactions.js` | `cashier_transactions` |
| 12 | `20260507100012_create_settings.js`        | `settings` |
| 13 | `20260507100013_create_bonus_rules.js`     | `bonus_rules` |
| 14 | `20260507100014_create_mobile_tokens.js`   | `mobile_tokens` |
| 15 | `20260507100015_create_refresh_tokens.js`  | `refresh_tokens` (JWT refresh rotation, family revocation) |
| 16 | `20260507100016_alter_users_add_login_lock.js` | adds `failed_login_attempts`, `locked_until`, `last_failed_login_at` to `users` |
| 17 | `20260507100017_create_password_reset_tokens.js` | `password_reset_tokens` |
| 18 | `20260507100018_create_bonus_assignments.js`     | `bonus_assignments` |
| 19 | `20260507100019_create_cashier_shifts.js`        | `cashier_shifts` |
| 20 | `20260507100020_alter_cashier_transactions_add_shift.js` | adds `shift_id` to `cashier_transactions` |
| 21 | `20260507100021_create_telebirr_agents.js`       | `telebirr_agents` (Flutter SMS-Pay Client device registry) |
| 22 | `20260507100022_create_telebirr_sms_raw.js`      | `telebirr_sms_raw` (append-only raw SMS log) |
| 23 | `20260507100023_create_telebirr_transactions.js` | `telebirr_transactions` (parsed payments, `telebirr_ref` globally unique) |
| 24 | `20260507100024_create_telebirr_deposit_requests.js` | `telebirr_deposit_requests` (player-initiated deposit + reference code) |
| 25 | `20260507100025_create_telebirr_agent_sessions.js`   | `telebirr_agent_sessions` (per-device login audit) |
| 26 | `20260508100001_alter_telebirr_sms_raw_add_dedup_hash.js` | adds `dedup_hash` + partial unique index to `telebirr_sms_raw` (batch idempotency) |
| 27 | `20260508110001_create_telebirr_fraud_tables.js` | `telebirr_disputes`, `telebirr_reconciliation_reports`, `telebirr_refcode_attempts` (security + dispute resolution + reconciliation) |
| 28 | `20260508120001_create_payment_methods_and_withdrawals.js` | `payment_methods` (per-tenant catalogue), `telebirr_withdrawal_requests` (manual cashier-processed payouts), `telebirr_agents.last_assigned_at` (round-robin agent picker) |

---

## Tenant isolation model (RLS)

Every tenant-scoped table:

1. has a `tenant_id` column (FK to `tenants.id`, `ON DELETE CASCADE`),
2. has `ROW LEVEL SECURITY` enabled and `FORCE ROW LEVEL SECURITY` set so
   table owners are also subject to policies,
3. has a single policy
   `<table>_tenant_isolation` that allows access when:
   - `app_is_bypass_rls()` is on (superadmin / cross-tenant flows), **or**
   - `tenant_id = get_tenant_context()`.

`tenants` itself isolates on `id` instead of `tenant_id`.

`audit_logs` allows `tenant_id IS NULL` rows only to bypass-RLS callers
(superadmin), so global/system events never leak into a tenant view.

---

## Required call pattern from the application layer

For **every** request / unit of work, before issuing tenant queries:

```sql
-- once per transaction
SELECT set_tenant_context($1);  -- $1 = current request tenant uuid
```

For superadmin operations that legitimately span tenants (e.g., the
super admin panel that "controls EVERYTHING across all panels and
tenants"):

```sql
SELECT set_bypass_rls(true);
-- ... cross-tenant queries ...
SELECT set_bypass_rls(false);
```

The recommended pattern is:

1. acquire a pooled connection,
2. `BEGIN`,
3. `SELECT set_tenant_context($tenantId)` (and optionally `set_bypass_rls(true)` for superadmin),
4. run all queries for that request,
5. `COMMIT` (which clears `SET LOCAL` settings automatically).

---

## Helper functions

| Function | Purpose |
|----------|---------|
| `set_tenant_context(uuid, boolean DEFAULT true)` | Sets `app.tenant_id`. Second arg: local-to-transaction (default) vs. session-wide. |
| `get_tenant_context() RETURNS uuid` | Returns the current `app.tenant_id` (NULL if unset). |
| `clear_tenant_context()` | Clears tenant context and bypass flag. |
| `set_bypass_rls(boolean, boolean DEFAULT true)` | Toggles `app.bypass_rls`. |
| `app_is_bypass_rls() RETURNS boolean` | Used by every RLS policy. |
| `touch_updated_at()` | Trigger function used by tables with `updated_at`. |

---

## Indexing summary

Every tenant-scoped table is indexed on at least:

- `tenant_id`
- `created_at` (or `placed_at` / `started_at`)
- `status` (where applicable)
- `user_id` (where applicable)
- composite `(tenant_id, created_at)` and `(tenant_id, <hot_filter>)` indexes
  on tables used for tenant-scoped pagination/reporting (transactions, bets,
  cashier_transactions, audit_logs).

---

## Rollback

Each migration provides an explicit `down`. Order is reversed automatically by
`node-pg-migrate`. Note that dropping `tenants` will cascade-delete every
tenant-scoped row.

---

## What is intentionally NOT included here

These are deliberately deferred for a follow-up migration set so that this
batch can be reviewed and applied without touching any existing surface:

- Domain sub-tables (e.g. `bet_selections`, `game_providers`, `iframe_integrations`,
  `iframe_domains`, `provider_callbacks`, `p2p_*`, `tournaments_*`, `packages_*`,
  `notifications`, `reporting_*`).
- Object-storage references.
- Seeds for system roles, default tenant, and superadmin user.

These will be added incrementally in subsequent numbered migrations.
