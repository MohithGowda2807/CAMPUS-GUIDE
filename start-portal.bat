@echo off
setlocal EnableExtensions

:: ============================================================================
:: RVCE Campus Navigation & Visitor Management Portal — Quick Launcher
:: Double-click this file to verify DB services, start Backend + Frontend,
:: and open the portal in your browser.
:: ============================================================================

title RVCE Campus Portal Launcher
cd /d "%~dp0"

echo ============================================================================
echo   RVCE Campus Navigation ^& Visitor Management Portal
echo ============================================================================
echo.

:: 1. Verify Virtual Environment & Frontend Dependencies
if not exist "backend\.venv\Scripts\uvicorn.exe" (
    echo [ERROR] Python virtual environment not found at backend\.venv
    echo         Run powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1 first.
    pause
    exit /b 1
)

if not exist "frontend\node_modules" (
    echo [INFO] Installing frontend dependencies...
    pushd frontend
    call npm install
    popd
)

:: 2. Check MySQL80 & MongoDB Windows Services
sc query MySQL80 | find "RUNNING" >nul 2>&1
if errorlevel 1 (
    echo [WARN] MySQL80 service is not running. Attempting to start...
    net start MySQL80 >nul 2>&1
) else (
    echo [OK] MySQL80 service is running.
)

sc query MongoDB | find "RUNNING" >nul 2>&1
if errorlevel 1 (
    echo [WARN] MongoDB service is not running. Attempting to start...
    net start MongoDB >nul 2>&1
) else (
    echo [OK] MongoDB service is running.
)

:: 3. Start FastAPI Backend on 0.0.0.0:8000 (accessible on local PC, LAN, and mobile)
netstat -ano | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [START] Launching FastAPI Backend on http://0.0.0.0:8000 ...
    start "RVCE Portal - Backend API (8000)" cmd /k "cd /d "%~dp0" && backend\.venv\Scripts\uvicorn.exe backend.app.main:app --host 0.0.0.0 --port 8000 --reload"
) else (
    echo [OK] FastAPI Backend is already running on port 8000.
)

:: 4. Start Vite React Frontend on 127.0.0.1:5173 (skip if already listening)
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [START] Launching React Frontend on http://127.0.0.1:5173 ...
    start "RVCE Portal - Frontend UI (5173)" cmd /k "cd /d "%~dp0frontend" && npm run dev -- --host 127.0.0.1 --port 5173"
) else (
    echo [OK] React Frontend is already running on port 5173.
)

:: 5. Wait briefly and open browser
echo.
echo Waiting for portal services to become ready...
timeout /t 3 /nobreak >nul

start "" "http://127.0.0.1:5173"

echo.
echo [READY] Portal UI  : http://127.0.0.1:5173
echo [READY] API Docs   : http://127.0.0.1:8000/api/docs
echo.
exit /b 0
