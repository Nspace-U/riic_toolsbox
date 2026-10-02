@echo off
setlocal
cd /d "%~dp0.."

powershell -NoProfile -Command "$found = $false; $listener = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue; if ($listener) { foreach ($item in $listener) { $target = $item.OwningProcess; $proc = Get-Process -Id $target -ErrorAction SilentlyContinue; if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $target -Force; Write-Host ('stopped node pid=' + $target); $found = $true } } }; if (-not $found) { Write-Host 'nothing to stop on port 5173' }; Remove-Item -LiteralPath '.dev-server.pid' -ErrorAction SilentlyContinue"

exit /b 0
