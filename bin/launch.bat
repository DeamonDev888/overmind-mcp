@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0.."
set "LOG=%SCRIPT_DIR%logs"
set "PORT=3099"
set "ENTRY=dist\bin\cli.js"
set "BUILD_CMD=npm run build"
set "NAME=Workflow"

echo [CLEANUP] Port %PORT%...
for /f %%A in ('powershell -c "Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue ^| Format-Table -HideTableHeaders -Property OwningProcess ^| ForEach-Object {$_.Trim()} ^| Where-Object {$_}"') do (
    echo   Port %PORT%  PID %%A killed
    taskkill /F /PID %%A >nul 2>&1
)
echo.

echo [BUILD] %NAME%...
if not exist "%LOG%" mkdir "%LOG%"
call %BUILD_CMD% > "%LOG%uild.log" 2>&1
if errorlevel 1 (
    if exist "dist" (
        echo   [WARN] build failed, using existing dist
    ) else (
        echo   [FAIL] no dist found
        pause
        exit /b 1
    )
)
echo   [OK] build done
echo.

echo [LAUNCH] %NAME% on port %PORT%...
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath node -WorkingDirectory '%SCRIPT_DIR%' -ArgumentList '--max-old-space-size=256 --no-warnings --env-file=.env','%ENTRY%' -RedirectStandardOutput '%LOG%\%NAME%.log' -RedirectStandardError '%LOG%\%NAME%.err.log'"
echo   [SPAWN] %NAME%
echo.
echo [DONE] %NAME% launched. Logs: %LOG%\%NAME%.log
endlocal
exit /b 0
