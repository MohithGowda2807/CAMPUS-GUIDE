# =============================================================================
# RVCE Campus Navigation & Visitor Management Portal — Start Local Dev Servers
# Launches FastAPI (http://127.0.0.1:8000) and Vite React (http://localhost:5173)
# =============================================================================

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "Starting FastAPI Backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RepoRoot'; & 'backend\.venv\Scripts\uvicorn.exe' backend.app.main:app --reload --port 8000"

Write-Host "Starting React Frontend on http://localhost:5173 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RepoRoot\frontend'; npm run dev"

Write-Host "Portal launching at http://localhost:5173 (API Docs: http://127.0.0.1:8000/docs)" -ForegroundColor Green
