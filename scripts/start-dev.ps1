# =============================================================================
# RVCE Campus Navigation & Visitor Management Portal — Start Local Dev Servers
# Launches FastAPI (http://127.0.0.1:8000) and Vite React (http://localhost:5173)
# =============================================================================

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "Starting FastAPI Backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RepoRoot'; & 'backend\.venv\Scripts\uvicorn.exe' backend.app.main:app --host 127.0.0.1 --port 8000 --reload"

Write-Host "Starting React Frontend on http://127.0.0.1:5173 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RepoRoot\frontend'; npm run dev -- --host 127.0.0.1 --port 5173"

Write-Host "Portal launching at http://127.0.0.1:5173 (API Docs: http://127.0.0.1:8000/api/docs)" -ForegroundColor Green
