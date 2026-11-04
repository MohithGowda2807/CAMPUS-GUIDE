@echo off
setlocal EnableExtensions

:: ============================================================================
:: RVCE Campus Navigation & Visitor Management Portal — Stop Local Servers
:: ============================================================================

title Stop RVCE Campus Portal
echo Stopping local FastAPI (port 8000) and Vite Frontend (port 5173) servers...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    echo [STOP] Terminating process on port 8000 ^(PID %%a^)...
    taskkill /PID %%a /T /F >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    echo [STOP] Terminating process on port 5173 ^(PID %%a^)...
    taskkill /PID %%a /T /F >nul 2>&1
)

echo [DONE] Portal development servers stopped. (MySQL80 and MongoDB remain running.)
timeout /t 2 /nobreak >nul
exit /b 0
