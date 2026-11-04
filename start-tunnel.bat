@echo off
title RVCE Campus Guide - Cloudflare Public Tunnel
cd /d "%~dp0"
echo ============================================================================
echo   RVCE Campus Guide — Instant Public HTTPS Tunnel
echo   Generates a secure HTTPS tunnel for mobile phones on 4G/5G/WiFi
echo ============================================================================
echo.
echo Starting Cloudflare Tunnel pointing to local backend (http://127.0.0.1:8000)...
echo Copy the HTTPS URL ending with '.trycloudflare.com' and paste it into the app's
echo Backend Connection settings.
echo.
cloudflared tunnel --url http://127.0.0.1:8000
pause
