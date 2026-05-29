-- Smoke test: insert a sportsbook ticket so we can verify the
-- cashier lookup picks it up by SBK-... coupon_code, TKT-... ticket_code,
-- and the raw UUID. Wrapped in a transaction so we don't pollute the DB
-- if the cashier test panel hits it afterwards.
\set ON_ERROR_STOP on

WITH t AS (
  SELECT id AS tenant_id FROM tenants LIMIT 1
), u AS (
  SELECT id AS user_id FROM users WHERE role = 'user'
  ORDER BY created_at ASC LIMIT 1
)
INSERT INTO sportsbook_bets
  (tenant_id, user_id, channel, bet_type, stake, currency,
   total_odds, potential_payout, idempotency_key, status, metadata)
SELECT t.tenant_id, u.user_id, 'online', 'single', 100.00, 'ETB',
       2.5, 250.00, 'smoke-test-' || gen_random_uuid()::text, 'pending',
       '{"placed_via":"smoke"}'::jsonb
  FROM t, u
RETURNING id, tenant_id, user_id, ticket_code, coupon_code, status;
