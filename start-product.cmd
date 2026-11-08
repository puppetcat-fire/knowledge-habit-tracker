@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js, then retry.
  pause
  exit /b 1
)
if not exist "node_modules\express\package.json" (
  echo Dependencies are missing. Run npm install in this folder first.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
pause
