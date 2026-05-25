# Backend

Express + PostgreSQL (RLS) + JWT (RS256) backend for the multi-tenant betET
platform. This package only contains the server. It does not modify any
existing panel (admin / cashier / user / game-engine).

## Setup

```bash
cd backend
npm install
npm run keys:generate                 # creates keys/jwt-{private,public}.pem
cp .env.example .env                  # then edit DATABASE_URL etc.
```

Apply migrations from `../migrations`:

```bash
cd ../migrations && npm install
DATABASE_URL=$DATABASE_URL npm run migrate
```

Run the API:

```bash
cd ../backend
npm run dev      # tsx watch
# or
npm run build && npm start
```

## Endpoints (this milestone)

All under `/api/auth` and require either tenant context (header / subdomain)
or a refresh-token (which carries tenant claim itself).

| Method | Path | Tenant required? | Notes |
|--------|------|------------------|-------|
| POST | `/api/auth/login` | yes | `email` or `phone` + `password`. Rate-limited 5 / 15 min / IP+tenant. |
| POST | `/api/auth/refresh` | derived from token | Rotates refresh token; family revocation on replay. |
| POST | `/api/auth/logout` | derived from token | Revokes a single refresh token. |
| POST | `/api/auth/forgot-password` | yes | Rate-limited. Always returns 200 (no enumeration). |
| POST | `/api/auth/reset-password` | yes | Revokes ALL active refresh tokens for the user. |

Plus:

- `GET /health`
- `GET /ready`

## Tenant resolution

In order of precedence:

1. `x-tenant-id` header — accepts either a tenant UUID or a tenant slug.
2. Subdomain — when `TENANT_DOMAIN_BASE` is set, the leftmost label
   (excluding `www` / `api`) is treated as the slug.

Resolved tenant id is attached to `req.tenant.id`.

## RLS activation

`withTenantClient({ tenantId }, async (client) => { ... })` is the only way
the application talks to the database. It opens a pooled client, starts a
transaction, calls `SELECT set_tenant_context($1::uuid)`, runs the work, and
commits — guaranteeing that every query runs under the correct tenant
context with RLS enforced. For the rare cross-tenant superadmin flow, pass
`bypassRls: true` (this calls `SELECT set_bypass_rls(true)` inside the same
transaction).

## Security

- Passwords: bcrypt cost 12 (configurable via `BCRYPT_COST`).
- JWT: RS256, access 15m / refresh 7d (both configurable).
- Refresh tokens: SHA-256 hash stored in DB; rotation on every refresh;
  replay or reuse triggers full token-family revocation.
- Account lock after `MAX_FAILED_LOGIN_ATTEMPTS` (default 10) wrong
  passwords for `ACCOUNT_LOCK_DURATION_MINUTES` (default 30).
- `helmet` defaults plus `crossOriginResourcePolicy: cross-origin` so the
  API is reachable from panels on different domains.
- CORS origins: union of `CORS_ALLOWED_ORIGINS` and per-tenant
  `tenants.config->'cors_origins'` (refreshed every 60s).
- Every login / refresh / logout / forgot / reset call writes to
  `audit_logs`.

## Admin panel (local smoke test)

From repo root:

1. Run this backend (`npm run dev` in `backend/`) with Postgres migrated and `.env` configured.
2. Copy `admin-panel-main/.env.example` → `.env` (defaults assume API at `http://localhost:4000`).
3. In `admin-panel-main`: `npm install` then `npm run dev` (Vite). Log in with an admin user for your tenant.
4. Under **P2P System**, open Dashboard, Wallet Devices, queues, Limits & Rules, and Commissions — they now load from `/api/admin/p2p/*` instead of baked-in mocks (empty data until your DB has Telebirr/P2P rows).

## Telebirr agent app (Android APK)

The Flutter agent client lives in `../M-info-app`. Build an installable APK on a machine with Flutter + Android SDK: see **`../M-info-app/ANDROID_BUILD.md`**. The phone talks to **`/api/agent/*`** on this backend (not to the admin UI); use your PC LAN IP as the backend URL when testing on a physical device.
