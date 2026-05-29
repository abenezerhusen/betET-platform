$ErrorActionPreference = 'Stop'
$baseHeaders = @{ "x-tenant-id" = "default" }
$body = @{ email = "cashier@playcore.local"; password = "Admin@123456"; branch_id = "PC001" } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "http://localhost:4000/api/auth/cashier/login" -Method Post -ContentType "application/json" -Body $body -Headers $baseHeaders
$headers = @{ Authorization = "Bearer $($login.access_token)"; "x-tenant-id" = "default" }
Write-Host "==> Cashier login OK ($($login.user.email))"

# Seed two sportsbook tickets we can exercise.
$seedSql = @"
WITH t AS (SELECT id AS tenant_id FROM tenants LIMIT 1),
     u AS (SELECT id AS user_id FROM users WHERE role = 'user' ORDER BY created_at LIMIT 1)
INSERT INTO sportsbook_bets
  (tenant_id, user_id, channel, bet_type, stake, currency,
   total_odds, potential_payout, idempotency_key, status, metadata)
SELECT t.tenant_id, u.user_id, 'online', 'single', 50.00, 'ETB',
       1.8, 90.00, 'smoke-e2e-' || gen_random_uuid()::text, 'pending',
       '{"placed_via":"e2e_smoke"}'::jsonb
  FROM t, u, generate_series(1, 2)
RETURNING coupon_code;
"@
$seedSql | Out-File -FilePath e2e-seed.sql -Encoding ascii
$rows = (Get-Content e2e-seed.sql | docker compose exec -T postgres psql -U playcore -d playcore -t -A)
Remove-Item e2e-seed.sql
$coupons = $rows | Where-Object { $_ -like 'SBK-*' }
$sellCode  = $coupons[0]
$cancelCode = $coupons[1]
Write-Host "==> Seeded sportsbook tickets:  SELL=$sellCode  CANCEL=$cancelCode"

Write-Host "`n--- LOOKUP ($sellCode) ---"
$look = Invoke-RestMethod -Uri "http://localhost:4000/api/cashier/tickets/$sellCode" -Headers $headers
Write-Host ("source={0}  bet_id={1}  status={2}  stake={3}  potential_win={4}" -f $look.source, $look.bet_id, $look.status, $look.stake, $look.potential_win)

Write-Host "`n--- SELL ($sellCode) ---"
$sell = Invoke-RestMethod -Uri "http://localhost:4000/api/cashier/tickets/$sellCode/sell" -Method Post -Headers $headers
Write-Host ("already_sold={0}  printed_ticket_code={1}  source={2}" -f $sell.already_sold, $sell.ticket.printed_ticket_code, $sell.ticket.source)

Write-Host "`n--- LOOKUP by printed code ---"
$printed = $sell.ticket.printed_ticket_code
$reFind = Invoke-RestMethod -Uri "http://localhost:4000/api/cashier/tickets/$printed" -Headers $headers
Write-Host ("source={0}  bet_id={1}  sold_at={2}" -f $reFind.source, $reFind.bet_id, $reFind.sold_at)

Write-Host "`n--- CANCEL ($cancelCode) ---"
$cancel = Invoke-RestMethod -Uri "http://localhost:4000/api/cashier/tickets/$cancelCode/cancel" -Method Post -Headers $headers
Write-Host ("refunded={0}  status={1}  source={2}" -f $cancel.refunded, $cancel.ticket.status, $cancel.ticket.source)

Write-Host "`n--- CHECK-PAYOUT (still pending; SELL ticket) ---"
$check = Invoke-RestMethod -Uri "http://localhost:4000/api/cashier/tickets/$sellCode/check-payout" -Headers $headers
Write-Host ("status={0}  payout_amount={1}  expired={2}" -f $check.status, $check.payout_amount, $check.expired)

Write-Host "`n--- LIST today ---"
$list = Invoke-RestMethod -Uri "http://localhost:4000/api/cashier/tickets?mine=true&date=today" -Headers $headers
Write-Host "Total=$($list.total)"
foreach ($t in $list.items) {
  Write-Host ("  - {0}  {1}  {2}  status={3}  stake={4}" -f $t.source, $t.ticket_code, $t.coupon_code, $t.status, $t.stake)
}

Write-Host "`n==> Cleanup"
$cleanup = "DELETE FROM sportsbook_bets WHERE idempotency_key LIKE 'smoke-e2e-%' RETURNING coupon_code, status;"
$cleanup | docker compose exec -T postgres psql -U playcore -d playcore -q
