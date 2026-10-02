@echo off
cd /d "%~dp0.."

if not exist "node_modules" (
  echo [ERROR] node_modules not found. Run "npm install" first.
  exit /b 1
)

powershell -NoProfile -Command "$node = (Get-Command node -ErrorAction Stop).Source; $p = Start-Process -FilePath $node -ArgumentList 'scripts/dev-server.mjs' -WorkingDirectory '%CD%' -WindowStyle Hidden -PassThru; $p.Id | Out-File -FilePath '%CD%\.dev-server.pid' -Encoding ascii; Write-Host ('dev server started in background, pid=' + $p.Id)"

if errorlevel 1 (
  echo [ERROR] failed to start dev server.
  exit /b 1
)

echo URL    http://localhost:5173/
echo LOG    .dev-server.log
echo STOP   scripts\stop-dev-server.cmd
exit /b 0
