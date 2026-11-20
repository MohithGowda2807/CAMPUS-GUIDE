@echo off
setlocal EnableExtensions
title RVCE Campus Guide - Cloudflare Public Tunnel
cd /d "%~dp0"

echo ============================================================================
echo   RVCE Campus Guide - Instant Public HTTPS Tunnel (HTTP/2 Mode)
echo   Generates a secure HTTPS tunnel for mobile phones on 4G/5G/WiFi
echo ============================================================================
echo.

:: Ensure FastAPI Backend is running on port 8000 before starting tunnel
netstat -ano | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [START] FastAPI Backend not running on port 8000. Starting it now...
    start "RVCE Portal - Backend API (8000)" cmd /k "cd /d "%~dp0" && backend\.venv\Scripts\uvicorn.exe backend.app.main:app --host 0.0.0.0 --port 8000"
    timeout /t 3 /nobreak >nul
) else (
    echo [OK] FastAPI Backend is running on port 8000.
)

echo.
echo Starting Cloudflare Tunnel over HTTP/2 (bypasses QUIC/UDP firewall blocks)...
echo Copy the HTTPS URL ending with '.trycloudflare.com' and paste it into the app's
echo Server Settings (Account -^> Server).
echo.

cloudflared tunnel --protocol http2 --edge-ip-version 4 --url http://127.0.0.1:8000
pause
