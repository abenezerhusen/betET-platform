# Game Engine — iframe integration

This document is the contract between the platform backend and:
1. **Frontend host pages** that embed game iframes (browser-side `postMessage`).
2. **Third-party game providers** that call the platform's webhooks (server-to-server HMAC).

## 1. Outbound — launching a game

```
POST /api/game/session/create
Authorization: Bearer <user access token>

{
  "game_id": "<uuid>",
  "currency": "ETB",                 // optional, defaults to settings.general.currency
  "language": "en",                  // optional
  "return_url": "https://app/lobby", // optional
  "metadata": { "device": "web" }    // optional, surfaced to the provider
}
```

Response:

```
{
  "session_id": "f1b2…",
  "launch_url": "https://provider.example/play?token=…&tenant=acme&currency=ETB&lang=en",
  "token": "<RS256 JWT>",
  "expires_at": "2026-05-07T11:35:00.000Z",
  "game":   { "id": "…", "name": "Aviator", "provider": "spribe", "type": "crash" },
  "tenant": { "id": "…", "slug": "acme" },
  "wallet": { "id": "…", "currency": "ETB", "balance": "100.0000", "bonus_balance": "10.0000" }
}
```

### Launch URL format

```
{game.iframe_url}?token={JWT}&tenant={slug}&currency={cur}[&lang={lang}][&return_url={url}]
```

The host page renders an `<iframe src="{launch_url}">` and listens for `postMessage` events (see §3).

### Launch token (JWT, RS256)

| claim | meaning                          |
|-------|----------------------------------|
| `sub` | user_id                          |
| `tid` | tenant_id                        |
| `sid` | session_id                       |
| `wid` | wallet_id                        |
| `gid` | game_id                          |
| `cur` | currency (e.g. `"ETB"`)          |
| `typ` | always `"game_launch"`           |
| `jti` | random uuid (single use marker)  |
| `iss` | platform issuer                  |
| `aud` | platform audience                |
| `iat` | issued-at                        |
| `exp` | issued-at + 15 minutes           |

The token is short-lived and **single-use** in the sense that webhooks are
gated by the `game_sessions.status` row, not by the JWT alone. Once the
session status leaves `'active'` (ended / expired / revoked), all webhooks
for that session are rejected with `409 session_not_active`.

### Ending a session

```
POST /api/game/session/{session_id}/end
Authorization: Bearer <user access token>
```

Idempotent. After this call, all subsequent webhooks for the session
are rejected. The frontend SHOULD call this when the iframe emits
`SESSION_END` (see §3) or when the user navigates away.

### Admin enable/disable

`POST /api/admin/games/:id/toggle` flips `games.is_active`. When a game
is disabled (or `status != 'available'`), `POST /api/game/session/create`
returns **400 game_not_available**. Existing live sessions continue to
function until they end naturally or hit `expires_at`.

## 2. Inbound — provider webhooks

Webhooks are authenticated by IP allowlist + HMAC-SHA256 signature.
Standard Bearer auth is intentionally **not** required.

### Common request headers

| Header                 | Required | Description                                                  |
|------------------------|----------|--------------------------------------------------------------|
| `Content-Type`         | yes      | `application/json`                                           |
| `X-Game-Timestamp`     | yes      | Epoch seconds when the body was signed; ±300s window         |
| `X-Game-Signature`     | yes      | `hex(HMAC-SHA256(secret, "<timestamp>.<raw_body>"))`         |

Pseudocode:

```js
const ts  = Math.floor(Date.now() / 1000).toString();
const sig = crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');
fetch(url, {
  method: 'POST',
  headers: {
    'content-type':       'application/json',
    'x-game-timestamp':   ts,
    'x-game-signature':   sig,
  },
  body,
});
```

### Where the secret + IP allowlist live

Per-tenant via `settings.providers`:

```jsonc
// settings.key = "providers"
{
  "spribe": {
    "webhook_secret":   "spribe-secret-…",
    "ip_allowlist":     ["54.85.0.0/16", "203.0.113.7"],
    "outbound_signing_secret": "…"   // optional, when WE sign outbound
  },
  "evolution": { "webhook_secret": "…", "ip_allowlist": ["…"] }
}
```

Per-game override (rotated secret, narrower allowlist) via
`games.config.provider`:

```jsonc
{ "provider": { "webhook_secret": "rotated-secret", "ip_allowlist": ["1.2.3.4"] } }
```

The game-level value wins when both are present. Empty allowlist
**denies everyone** (fail-closed).

### Common request body fields

| Field         | Type   | Description                                     |
|---------------|--------|-------------------------------------------------|
| `session_id`  | uuid   | Returned by `/api/game/session/create`          |
| `request_id`  | string | Provider's request id; echoed in the response   |

### `POST /api/game/webhook/balance`

Get the user's current balance.

Request:
```json
{ "session_id": "…", "request_id": "rq-…" }
```

Response:
```json
{
  "request_id": "rq-…",
  "session_id": "…",
  "user_id": "…",
  "currency": "ETB",
  "balance": "100.0000",
  "bonus_balance": "10.0000",
  "locked_balance": "0.0000",
  "status": "ok"
}
```

### `POST /api/game/webhook/debit`

Place a bet — debits the wallet atomically and creates a `bets` row
(`status='accepted'`).

Request:
```json
{
  "session_id":     "…",
  "request_id":     "rq-…",
  "transaction_id": "spribe-bet-12345",
  "amount":         "10.00",
  "currency":       "ETB",
  "round_id":       "spribe-round-7",
  "metadata":       { "any": "extra" }
}
```

Response:
```json
{
  "request_id": "rq-…",
  "session_id": "…",
  "transaction_id":          "<our uuid>",
  "provider_transaction_id": "spribe-bet-12345",
  "bet_id":                  "<our uuid>",
  "currency": "ETB",
  "balance":  "90.0000",
  "bonus_balance": "10.0000",
  "idempotent": false,
  "status": "ok"
}
```

* **Idempotent on `transaction_id`.** Re-sending the same `transaction_id`
  returns the original outcome with `idempotent: true` and **no** state change.
* Insufficient funds → `409 insufficient_balance`.

### `POST /api/game/webhook/credit`

Pay a win — credits the wallet atomically. If `reference_transaction_id`
matches the original debit's id, the linked bet is settled to
`status='won'` with `payout = amount`.

Request:
```json
{
  "session_id":     "…",
  "request_id":     "rq-…",
  "transaction_id": "spribe-win-12345",
  "amount":         "20.00",
  "currency":       "ETB",
  "round_id":       "spribe-round-7",
  "reference_transaction_id": "spribe-bet-12345"
}
```

Response: same shape as debit.

### `POST /api/game/webhook/rollback`

Reverse a previous debit. Refunds the wallet, marks the original
debit transaction as `'reversed'`, and voids the linked bet.

Request:
```json
{
  "session_id":     "…",
  "request_id":     "rq-…",
  "transaction_id": "spribe-rollback-12345",
  "reference_transaction_id": "spribe-bet-12345"
}
```

* **Idempotent on `transaction_id`.** Also idempotent at the *target*
  level: if the original debit is already `'reversed'`, the call returns
  the existing reversal record without applying changes.

### Error envelope

Every error returns:

```json
{
  "status":  "error",
  "code":    "insufficient_balance",
  "message": "balance too low",
  "details": { "balance": "5.0000", "requested": "10.0000" }
}
```

| HTTP | code                              | When                                                  |
|------|-----------------------------------|-------------------------------------------------------|
| 400  | `invalid_body`                    | request body fails Zod validation                     |
| 400  | `currency_mismatch`               | `currency` in body ≠ session wallet currency          |
| 400  | `invalid_rollback_target`         | `reference_transaction_id` is not a bet stake         |
| 401  | `invalid_signature`               | HMAC missing / wrong / stale timestamp                |
| 403  | `ip_not_allowed`                  | source IP not in the provider allowlist               |
| 404  | `session_not_found`               | unknown `session_id`                                  |
| 404  | `wallet_not_found`                | session's wallet has been deleted                     |
| 404  | `original_transaction_not_found`  | rollback references unknown debit                     |
| 409  | `session_not_active`              | session has been ended / expired / revoked            |
| 409  | `session_expired`                 | `expires_at` is in the past                           |
| 409  | `wallet_not_active`               | wallet is suspended / closed                          |
| 409  | `insufficient_balance`            | debit would push balance negative                     |
| 503  | `provider_unconfigured`           | no `webhook_secret` configured for the game provider  |

Every rejected webhook also writes a `failure` row to `audit_logs`
with `action = "game.webhook.{kind}.rejected"` and the originating IP.

## 3. PostMessage — browser-side iframe protocol

The host page (`window.top`) and the embedded game iframe communicate
via `window.postMessage`. **Always specify a target origin** — never
use `'*'`.

### Common envelope

```ts
interface GameMessage<T = unknown> {
  type:      'GAME_READY' | 'BALANCE_UPDATE' | 'BALANCE_REQUEST'
           | 'BET_PLACED' | 'BET_SETTLED'
           | 'SESSION_END' | 'SESSION_ERROR'
           | 'NAVIGATE'   | 'RESIZE';
  payload?:  T;
  request_id?: string;   // for request/response correlation
  session_id?: string;
  ts?: number;           // epoch ms
  source: 'platform' | 'game';
}
```

### Game → host (outbound from iframe)

| `type`            | `payload`                                                                  | When                                            |
|-------------------|----------------------------------------------------------------------------|-------------------------------------------------|
| `GAME_READY`      | `{ game_id, version }`                                                     | iframe loaded and ready to render               |
| `BALANCE_REQUEST` | `{}` (host should reply with `BALANCE_UPDATE`)                             | game wants a fresh balance read                 |
| `BET_PLACED`      | `{ bet_id, stake, currency, round_id }`                                    | optimistic UI hint — provider also calls debit  |
| `BET_SETTLED`     | `{ bet_id, payout, currency, status }`                                     | optimistic UI hint — provider also calls credit |
| `SESSION_END`     | `{ reason: 'user_closed' \| 'completed' \| 'error', error?: string }`      | iframe is shutting down                         |
| `SESSION_ERROR`   | `{ code, message }`                                                        | unrecoverable error inside the iframe           |
| `NAVIGATE`        | `{ url }`                                                                  | request to navigate the host (e.g. lobby)       |
| `RESIZE`          | `{ width, height }`                                                        | request to resize the iframe                    |

### Host → game (inbound to iframe)

| `type`           | `payload`                                                  | When                                |
|------------------|------------------------------------------------------------|-------------------------------------|
| `BALANCE_UPDATE` | `{ currency, balance, bonus_balance, locked_balance }`     | response to `BALANCE_REQUEST`, or push from `wallet:updated` socket event |
| `SESSION_END`    | `{ reason: 'host_closed' }`                                | host wants the game to clean up     |
| `THEME`          | `{ mode: 'light' \| 'dark', accent?: string }`             | brand customization                 |
| `LOCALE`         | `{ language, timezone }`                                   | locale change                       |

### Wiring with Socket.io

The host page listens to the user's Socket.io room (see
`backend/src/realtime/socket.ts`). When `wallet:updated` fires it
forwards the new balance into the iframe as `BALANCE_UPDATE`:

```ts
socket.on('wallet:updated', ({ wallet }) => {
  iframe.contentWindow?.postMessage({
    type: 'BALANCE_UPDATE',
    source: 'platform',
    session_id,
    payload: {
      currency:       wallet.currency,
      balance:        wallet.balance,
      bonus_balance:  wallet.bonus_balance,
      locked_balance: wallet.locked_balance,
    },
  }, GAME_ORIGIN);
});
```

### Origin allowlist

The host MUST validate `event.origin` against `games.config.allowed_origins`
before processing any inbound message:

```ts
const allowed = new Set(game.config.allowed_origins ?? []);
window.addEventListener('message', (e) => {
  if (!allowed.has(e.origin)) return;
  // … dispatch on e.data.type
});
```

The same list is what the iframe `sandbox`/`allow` attributes should be
configured against — the platform's admin Game Management API stores
this under `games.config.iframe.allowed_origins` and `iframe.sandbox`.

## 4. Security checklist (recap)

| concern             | mechanism                                                            |
|---------------------|----------------------------------------------------------------------|
| Single-use token    | session row gates webhooks; status flips to `ended` once closed      |
| Token expiry        | 15 min `exp` claim + `expires_at` enforced on each webhook           |
| Replay protection   | timestamp window (±300s) inside the HMAC computation                 |
| HMAC verification   | constant-time comparison; raw body captured in express body parser   |
| IP allowlist        | per-game override > per-tenant; empty list = deny everyone           |
| Idempotency         | `transactions.reference` unique per tenant; debit/credit/rollback    |
| Atomic ledger       | `SELECT … FOR UPDATE` + balance check + ledger insert in single tx   |
| Tenant isolation    | session lookup bypasses RLS only to identify tenant; everything else runs with `set_tenant_context()` so row-level security is enforced |
| Audit trail         | every webhook outcome — accepted **and** rejected — appended         |
| Origin pinning      | postMessage handlers check `event.origin` against per-game allowlist |
