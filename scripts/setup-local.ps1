# =============================================================================
# RVCE Campus Navigation & Visitor Management Portal — Local Environment Setup
# Configures .env, Python virtual environment, Frontend packages, MySQL & MongoDB
# =============================================================================

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "==> [1/4] Checking local .env configuration..." -ForegroundColor Cyan
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    $jwtSecret = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) })
    (Get-Content ".env") -replace "change-this-to-a-secure-random-64-char-hex-secret-before-deploy", $jwtSecret | Set-Content ".env"
}

$envContent = Get-Content ".env" -Raw
if ($envContent -match "MYSQL_PASSWORD=YOUR_MYSQL_PASSWORD_HERE") {
    $secPwd = Read-Host "Enter your local MySQL 8.0 password for user in .env (default 'root')" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPwd)
    $plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $updated = $envContent -replace "MYSQL_PASSWORD=YOUR_MYSQL_PASSWORD_HERE", "MYSQL_PASSWORD=$plainPwd"
    Set-Content -Path ".env" -Value $updated -NoNewline
    Write-Host "Saved MySQL password to untracked local .env." -ForegroundColor Green
}

Write-Host "==> [2/4] Setting up Python backend virtual environment..." -ForegroundColor Cyan
if (-not (Test-Path "backend\.venv\Scripts\python.exe")) {
    python -m venv backend\.venv
}
& "backend\.venv\Scripts\python.exe" -m pip install -r backend\requirements.txt -q

Write-Host "==> [3/4] Provisioning MySQL 8.0 (campusguide) & MongoDB (campusguide_nosql)..." -ForegroundColor Cyan
& "backend\.venv\Scripts\python.exe" database\setup_databases.py --seed

Write-Host "==> [4/4] Verifying Frontend dependencies..." -ForegroundColor Cyan
Push-Location frontend
if (-not (Test-Path "node_modules")) {
    npm install
}
Pop-Location

Write-Host "`nSetup complete! Start both servers anytime with: .\scripts\start-dev.ps1" -ForegroundColor Green
