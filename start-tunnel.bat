@echo off
setlocal EnableExtensions
title RVCE Campus Guide - Cloudflare Public Tunnel
cd /d "%~dp0"

echo ============================================================================
echo   RVCE Campus Guide - Instant Public HTTPS Tunnel (HTTP/2 Mode)
echo   Generates a secure HTTPS tunnel for mobile phones on 4G/5G/WiFi
echo ============================================================================
echo.

:: Ensure RVCE FastAPI Backend is running on port 8000 before starting tunnel
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 2; if ($r.status -eq 'ok') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [START] RVCE FastAPI Backend not running on port 8000. Starting it now...
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do (
        taskkill /F /PID %%P >nul 2>&1
    )
    start "RVCE Portal - Backend API (8000)" cmd /k "cd /d "%~dp0" && backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 75"
    echo Waiting for FastAPI Backend to finish starting...
    for /L %%I in (1,1,15) do (
        powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 2; if ($r.status -eq 'ok') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
        if not errorlevel 1 goto :backend_up
        timeout /t 1 /nobreak >nul
    )
)
:backend_up
echo [OK] RVCE FastAPI Backend is running and verified on port 8000.

echo.
echo Starting Cloudflare Tunnel over HTTP/2 (4 HA Connections)...
echo Copy the HTTPS URL ending with '.trycloudflare.com' and paste it into the app's
echo Server Settings (Account -^> Server).
echo.

:retry_tunnel
cloudflared tunnel --protocol http2 --edge-ip-version 4 --ha-connections 4 --url http://127.0.0.1:8000
echo.
echo [FALLBACK] Cloudflare blocked by Campus Wi-Fi Firewall!
echo            Automatically switching to SSH HTTPS Tunnel (localhost.run)...
echo            Copy the https://xxxx.app.lhr.life link below into Account -^> Server:
echo.
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:127.0.0.1:8000 nokey@localhost.run
timeout /t 3 /nobreak >nul
goto :retry_tunnel
