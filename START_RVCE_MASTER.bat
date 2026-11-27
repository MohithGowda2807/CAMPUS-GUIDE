@echo off
setlocal EnableExtensions EnableDelayedExpansion
title RVCE Campus Navigator - One-Click Master Launcher
cd /d "%~dp0"

echo ============================================================================
echo   RVCE CAMPUS NAVIGATOR - ONE-CLICK MASTER SYSTEM LAUNCHER
echo   Starts: MySQL 8.0 + FastAPI Backend + Web Portal + Network Access
echo ============================================================================
echo.

:: ----------------------------------------------------------------------------
:: STEP 1: Check MySQL80 & MongoDB Windows Services
:: ----------------------------------------------------------------------------
echo [1/5] Checking Database Services...
sc query MySQL80 | find "RUNNING" >nul 2>&1
if errorlevel 1 (
    net start MySQL80 >nul 2>&1
)
sc query MySQL80 | find "RUNNING" >nul 2>&1
if errorlevel 1 (
    echo       [WARN] MySQL80 is not running. Please start MySQL80 service if needed.
) else (
    echo       [OK] MySQL80 is RUNNING.
)

sc query MongoDB | find "RUNNING" >nul 2>&1
if errorlevel 1 (
    net start MongoDB >nul 2>&1
)
sc query MongoDB | find "RUNNING" >nul 2>&1
if errorlevel 1 (
    echo       [INFO] MongoDB Windows Service requires Admin; Backend resilient floor overlays active.
) else (
    echo       [OK] MongoDB is RUNNING.
)
echo.

:: ----------------------------------------------------------------------------
:: STEP 2: Clean Any Orphaned/Zombie Process Holding Port 8000
:: ----------------------------------------------------------------------------
echo [2/5] Ensuring Port 8000 is Clean and Starting FastAPI Backend...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 1 /nobreak >nul

start "RVCE Backend API (Port 8000)" cmd /k "cd /d "%~dp0" && backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 75 --proxy-headers --forwarded-allow-ips=*"

echo       Waiting for Backend API health check...
set "BACKEND_OK=0"
for /L %%I in (1,1,20) do (
    powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 2; if ($r.mysql.connected -eq $true) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        set "BACKEND_OK=1"
        goto :backend_ready
    )
    timeout /t 1 /nobreak >nul
)
:backend_ready
if "!BACKEND_OK!"=="1" (
    echo       [OK] FastAPI Backend + MySQL 8.0 + Hybrid RAG are ONLINE on Port 8000.
) else (
    echo       [ERROR] Backend did not pass health check. Check the Backend API window.
)
echo.

:: ----------------------------------------------------------------------------
:: STEP 3: Start React Web Portal on Port 5173
:: ----------------------------------------------------------------------------
echo [3/5] Checking React Web Portal on Port 5173...
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    if exist "frontend\package.json" (
        start "RVCE Web Portal (Port 5173)" cmd /k "cd /d "%~dp0frontend" && npm run dev -- --host 0.0.0.0 --port 5173"
        echo       [OK] Web Portal launching at http://127.0.0.1:5173
    )
) else (
    echo       [OK] Web Portal is already RUNNING at http://127.0.0.1:5173
)
echo.

:: ----------------------------------------------------------------------------
:: STEP 4: Show Zero-Drop Direct Wi-Fi / Mobile Hotspot URLs (BEST FOR DEMO!)
:: ----------------------------------------------------------------------------
echo [4/5] ZERO-DROP DEMO CONNECTION (RECOMMENDED FOR COLLEGE DEMO):
echo   Connect your phone to your Laptop Hotspot or the same Wi-Fi, then paste:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R /C:"IPv4 Address"') do (
    set "RAW_IP=%%A"
    set "RAW_IP=!RAW_IP: =!"
    echo       --^>  http://!RAW_IP!:8000
)
echo   (Direct Wi-Fi/Hotspot NEVER disconnects, NEVER throttles, and works offline!)
echo.

:: ----------------------------------------------------------------------------
:: STEP 5: Optional Public HTTPS Tunnel (Cloudflare -> SSH Fallback)
:: ----------------------------------------------------------------------------
echo [5/5] Staff Login Reminder:
echo   Password for all 5 demo accounts: RvceStaff#2026
echo   (hod.cse@rvce.edu.in, faculty.cse@rvce.edu.in, security@rvce.edu.in, sysadmin@rvce.edu.in)
echo   TOTP Authenticator keys are permanently saved in backend\.dev_oidc_state.json
echo.
echo   Press [Y] to also open a Public HTTPS Tunnel for 4G/5G phones,
echo   or press [N] if you are using the Direct Wi-Fi / Hotspot URL above:
choice /C YN /N /M "Start Public HTTPS Tunnel? (Y/N): "
if errorlevel 2 (
    echo.
    echo [READY] All local services are running! Keep the Backend ^& Web windows open.
    pause
    exit /b 0
)

:tunnel_loop
echo.
echo [TUNNEL] Attempting Cloudflare Tunnel (HTTP/2)...
cloudflared tunnel --protocol http2 --edge-ip-version 4 --ha-connections 4 --url http://127.0.0.1:8000
echo.
echo [FALLBACK] Cloudflare blocked by Campus Wi-Fi Firewall!
echo            Starting SSH HTTPS Tunnel (localhost.run)...
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:127.0.0.1:8000 nokey@localhost.run
timeout /t 3 /nobreak >nul
goto :tunnel_loop
