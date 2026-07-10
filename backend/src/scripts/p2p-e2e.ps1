$ErrorActionPreference = 'Stop'
$base = 'http://localhost:4000'
$tenant = @{ 'x-tenant-id' = 'default' }
$deviceId = 'e5c2ccde-3b3c-469a-973f-a3108444bb99'
$amount = 133
$ref = "E2E" + (Get-Random -Minimum 100000 -Maximum 999999)

function Show($label, $obj) {
  Write-Host "==== $label ====" -ForegroundColor Cyan
  $obj | ConvertTo-Json -Depth 6 | Write-Host
}
function ErrBody($e) {
  if ($e.Exception.Response) {
    $r = New-Object System.IO.StreamReader($e.Exception.Response.GetResponseStream())
    return $r.ReadToEnd()
  }
  return $e.Exception.Message
}

try {
  # 1) User login
  $userLogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -Headers $tenant `
    -ContentType 'application/json' `
    -Body (@{ email = 'user@playcore.local'; password = 'Admin@123456' } | ConvertTo-Json)
  $userToken = $userLogin.access_token
  $userId = $userLogin.user.id
  $userAuth = $tenant + @{ Authorization = "Bearer $userToken" }
  Write-Host "User logged in: $userId" -ForegroundColor Green

  # 2) Agent login + heartbeat so the picker sees it online
  $agentLogin = Invoke-RestMethod -Method Post -Uri "$base/api/agent/auth/login" -Headers $tenant `
    -ContentType 'application/json' `
    -Body (@{ telebirr_phone = '0924004654'; password = '212122'; deviceId = $deviceId } | ConvertTo-Json)
  $agentToken = $agentLogin.token
  $agentAuth = $tenant + @{ Authorization = "Bearer $agentToken" }
  Invoke-RestMethod -Method Post -Uri "$base/api/agent/auth/heartbeat" -Headers $agentAuth `
    -ContentType 'application/json' -Body '{}' | Out-Null
  Write-Host "Agent online (heartbeat sent): $($agentLogin.agent_id)" -ForegroundColor Green

  # 3) Confirm agent shows online in the user pool
  $pool = Invoke-RestMethod -Method Get -Uri "$base/api/p2p/accounts" -Headers $userAuth
  Show 'P2P accounts pool (user panel)' $pool

  # 4) Cancel any lingering waiting requests, then initiate a fresh one
  $hist = Invoke-RestMethod -Method Get -Uri "$base/api/user/deposits/telebirr/history" -Headers $userAuth
  foreach ($it in ($hist.items | Where-Object { $_.status -eq 'waiting' })) {
    Write-Host "Cancelling lingering waiting request $($it.id) ..." -ForegroundColor Yellow
    Invoke-RestMethod -Method Delete -Uri "$base/api/user/deposits/telebirr/$($it.id)/cancel" -Headers $userAuth | Out-Null
  }
  $init = Invoke-RestMethod -Method Post -Uri "$base/api/user/deposits/telebirr/initiate" -Headers $userAuth `
    -ContentType 'application/json' -Body (@{ amount = "$amount" } | ConvertTo-Json)
  Show 'Deposit initiated' $init
  $requestId = $init.request_id

  # 5) Report a Telebirr SMS (creates a pending p2p_deposit)
  $smsBody = "You have received ETB $amount.00 from Test User(251900000001) on 01/07/2026 12:00:00. Your transaction number is $ref. Your balance is ETB 50133.00"
  $batch = Invoke-RestMethod -Method Post -Uri "$base/api/agent/sms/batch" -Headers $agentAuth `
    -ContentType 'application/json' `
    -Body (@{ messages = @(@{ smsBody = $smsBody; senderNumber = 'telebirr'; receivedAt = (Get-Date).ToUniversalTime().ToString('o') }) } | ConvertTo-Json -Depth 6)
  Show 'SMS batch reported' $batch

  # 6) Admin login
  $adminLogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/admin/login" -Headers $tenant `
    -ContentType 'application/json' `
    -Body (@{ email = 'superadmin@playcore.local'; password = 'Admin@123456' } | ConvertTo-Json)
  $adminAuth = $tenant + @{ Authorization = "Bearer $($adminLogin.access_token)" }
  Write-Host "Admin logged in" -ForegroundColor Green

  # 7) Find the pending deposit by our ref
  $queue = Invoke-RestMethod -Method Get -Uri "$base/api/admin/p2p/deposits?status=pending&limit=50" -Headers $adminAuth
  $items = $queue.items; if (-not $items) { $items = $queue.data }
  $target = $items | Where-Object { $_.reference -eq $ref -or $_.telebirr_ref -eq $ref } | Select-Object -First 1
  if (-not $target) { throw "Deposit with ref $ref not found in pending queue" }
  Write-Host "Found pending deposit id=$($target.id) amount=$($target.amount)" -ForegroundColor Green

  # 8) Approve, assigning the user
  $approve = Invoke-RestMethod -Method Post -Uri "$base/api/admin/p2p/deposits/$($target.id)/approve" -Headers $adminAuth `
    -ContentType 'application/json' -Body (@{ user_id = $userId } | ConvertTo-Json)
  Show 'Approve result' $approve

  # 9) Verify the user deposit request flipped to confirmed
  Start-Sleep -Milliseconds 500
  $status = Invoke-RestMethod -Method Get -Uri "$base/api/user/deposits/telebirr/$requestId/status" -Headers $userAuth
  Show 'User deposit status after approval' $status

  Write-Host ""
  if ($status.status -eq 'confirmed') {
    Write-Host "E2E PASS: deposit request is CONFIRMED. Admin-approval bridge works end to end." -ForegroundColor Green
  } else {
    Write-Host "E2E CHECK: request status = $($status.status) (expected confirmed)" -ForegroundColor Yellow
  }
}
catch {
  Write-Host "E2E ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host (ErrBody $_) -ForegroundColor Red
  throw
}
