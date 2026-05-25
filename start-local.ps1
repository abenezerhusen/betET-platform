# PlayCore Local Development Startup Script
# Run this once to start everything

param(
    [switch]$Reset,
    [switch]$StopAll
)

# Stop all panels if requested
if ($StopAll) {
    Write-Host "Stopping all services..." -ForegroundColor Red
    docker compose down
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host "All stopped." -ForegroundColor Green
    exit
}

# Reset database if requested
if ($Reset) {
    Write-Host "Resetting database..." -ForegroundColor Yellow
    docker compose down -v
    Write-Host "Database reset complete." -ForegroundColor Green
}

# Install dependencies if node_modules missing
function Install-If-Needed {
    param([string]$dir)
    if (-not (Test-Path "$dir/node_modules")) {
        Write-Host "Installing dependencies for $dir..." -ForegroundColor Yellow
        Push-Location $dir
        npm install
        Pop-Location
    }
}

Install-If-Needed "admin-panel-main"
Install-If-Needed "user-panel-main"
Install-If-Needed "cashier-panel-main"
Install-If-Needed "game-engine-main"

# Stop any stale frontend dev servers on known ports before launching new ones.
function Stop-PortProcess {
    param([int]$port)
    try {
        $pids = netstat -ano | Select-String ":$port" | ForEach-Object {
            ($_ -split '\s+')[-1]
        } | Sort-Object -Unique
        foreach ($pid in $pids) {
            if ($pid -and $pid -match '^\d+$') {
                Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}
}

Write-Host "Stopping stale frontend servers on ports 5173/3000/3001/3002..." -ForegroundColor Yellow
Stop-PortProcess 5173
Stop-PortProcess 3000
Stop-PortProcess 3001
Stop-PortProcess 3002

# Start Docker services (DB + Backend only)
Write-Host ""
Write-Host "Starting database and backend..." -ForegroundColor Green
docker compose up -d --build

# Wait for backend to be healthy
Write-Host "Waiting for backend to be ready..." -ForegroundColor Yellow
$maxWait = 60
$waited = 0
do {
    Start-Sleep -Seconds 2
    $waited += 2
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/api/health" `
            -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) { break }
    } catch {}
    Write-Host "  Waiting... ($waited/$maxWait seconds)" -ForegroundColor Gray
} while ($waited -lt $maxWait)

Write-Host "Backend ready!" -ForegroundColor Green

# Run migrations and seed if first time
$dbReady = docker compose exec -T postgres `
    psql -U playcore -d playcore -c "\dt" 2>&1

if ($dbReady -notmatch "users") {
    Write-Host "Running migrations and seed data..." -ForegroundColor Yellow
    docker compose exec backend npm run migrate
    docker compose exec backend npm run seed
    Write-Host "Database ready with test data!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Test accounts created:" -ForegroundColor Cyan
    Write-Host "  superadmin@playcore.local / Admin@123456" -ForegroundColor White
    Write-Host "  admin@playcore.local      / Admin@123456" -ForegroundColor White
    Write-Host "  cashier@playcore.local    / Admin@123456" -ForegroundColor White
    Write-Host "  user@playcore.local       / Admin@123456 (ETB 5000 balance)" -ForegroundColor White
}

# Start all 4 panels in separate windows
Write-Host ""
Write-Host "Starting frontend panels..." -ForegroundColor Green

# Admin Panel
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$PWD\admin-panel-main'; `$host.UI.RawUI.WindowTitle = 'PlayCore Admin Panel'; npm run dev"
)
Start-Sleep -Seconds 1

# User Panel
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$PWD\user-panel-main'; `$host.UI.RawUI.WindowTitle = 'PlayCore User Panel'; npm run dev"
)
Start-Sleep -Seconds 1

# Cashier Panel
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$PWD\cashier-panel-main'; `$host.UI.RawUI.WindowTitle = 'PlayCore Cashier Panel'; npm run dev -- -p 3001"
)
Start-Sleep -Seconds 1

# Game Engine
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$PWD\game-engine-main'; `$host.UI.RawUI.WindowTitle = 'PlayCore Game Engine'; npm run dev -- -p 3002"
)

# Print summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  PlayCore is starting up!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Wait ~30 seconds for all panels to compile" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Admin Panel  -> http://localhost:5173" -ForegroundColor Cyan
Write-Host "  User Panel   -> http://localhost:3000" -ForegroundColor Cyan
Write-Host "  Cashier      -> http://localhost:3001" -ForegroundColor Cyan
Write-Host "  Game Engine  -> http://localhost:3002" -ForegroundColor Cyan
Write-Host "  Backend API  -> http://localhost:4000" -ForegroundColor Cyan
Write-Host "  API Docs     -> http://localhost:4000/api-docs" -ForegroundColor Cyan
Write-Host "  Database     -> localhost:5432" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To stop everything:  .\start-local.ps1 -StopAll" -ForegroundColor Gray
Write-Host "  To reset database:   .\start-local.ps1 -Reset" -ForegroundColor Gray
Write-Host ""
