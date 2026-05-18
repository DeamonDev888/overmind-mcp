<# :
@echo off
setlocal enabledelayedexpansion

:: ═══════════════════════════════════════════════════════════════
:: Overmind HTTP MCP Server — Launcher
:: ═══════════════════════════════════════════════════════════════
::
:: Usage:
::   overmind-serve.bat        Start (ou restart si déjà lancé)
::   overmind-serve.bat stop   Arrêter proprement
::   overmind-serve.bat status Voir si ça tourne
::   overmind-serve.bat tail   Voir les 20 dernières lignes du log
::
:: Prérequis:
::   - Node.js dans PATH
::   - .env à la racine du projet
::   - dist\bin\cli.js compilé (npm run build)
::
:: ═══════════════════════════════════════════════════════════════

set "SCRIPT_DIR=%~dp0"
set "BASE=%SCRIPT_DIR%"
set "LOG=%BASE%logs"
set "PID_FILE=%BASE%overmind.pid"
set "HEALTH_URL=http://localhost:3099/health"
set "ENDPOINT_URL=http://localhost:3099/mcp"
set "PORT=3099"

set "NODE_FLAGS=--max-old-space-size=256 --no-warnings"
set "CLI_ARGS=--transport httpStream --port %PORT%"
set "STARTUP_TIMEOUT=10"

:: ─── Parse command ────────────────────────────────────────────

if /i "%~1"=="stop"    goto cmd_stop
if /i "%~1"=="restart" goto cmd_restart
if /i "%~1"=="status"  goto cmd_status
if /i "%~1"=="tail"    goto cmd_tail
if /i "%~1"=="logs"    goto cmd_logs
if /i "%~1"=="kill"    goto cmd_kill
if /i "%~1"==""        goto cmd_start

echo Usage: overmind-serve.bat [start^|stop^|restart^|status^|tail^|logs^|kill]
exit /b 1

:: ─── Ensure logs directory ────────────────────────────────────

:ensure_logs
if exist "%LOG%" goto :EOF
mkdir "%LOG%" 2>nul
exit /b 0

:: ─── Start ────────────────────────────────────────────────────

:cmd_start
call :ensure_logs

:: Vérifier si déjà vivant
call :check_running
if defined ALIVE_PID (
    echo [OVERMIND] Déjà tournant (PID %ALIVE_PID%) — %HEALTH_URL%
    echo Pour redémarrer: overmind-serve.bat restart
    exit /b 0
)

:: Vérifier que le port est libre
netstat -ano | findstr ":3099 " | findstr LISTENING >nul
if !errorlevel!==0 (
    echo [OVERMIND] Port 3099 occupé — tentative de récupération...
    :: Tuer le process qui écoute sur 3099 s'il n'est pas dans le PID file
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3099 " ^| findstr LISTENING') do (
        echo [OVERMIND] Tue PID %%a occupant le port
        taskkill /F /PID %%a >nul 2>&1
    )
    timeout /t 2 >nul
)

:: Lancer le node en background
echo [OVERMIND] Démarrage sur http://localhost:%PORT%/mcp ...
start "" /b cmd /c "cd /d "%BASE%" ^&^& node %NODE_FLAGS% --env-file=.env dist\bin\cli.js %CLI_ARGS% >> "%LOG%\overmind.log" 2>> "%LOG%\overmind.err.log""

:: Attendre que le health check passe (max STARTUP_TIMEOUT s)
set "STARTED="
for /L %%i in (1,1,%STARTUP_TIMEOUT%) do (
    timeout /t 1 >nul
    curl -s "%HEALTH_URL%" >nul 2>&1
    if !errorlevel!==0 (
        set "STARTED=1"
        goto :health_ok
    )
)

:health_ok
if defined STARTED (
    :: Récupérer le PID du node qui écoute sur 3099
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3099 " ^| findstr LISTENING ^| findstr /i node') do (
        echo %%a > "%PID_FILE%"
    )
    echo [OVERMIND] ✓ Started — http://localhost:%PORT%/mcp
    echo [OVERMIND]   Logs: %LOG%\overmind.log
    echo [OVERMIND]   PID file: %PID_FILE%
) else (
    echo [OVERMIND] ✗ Health check failed après %STARTUP_TIMEOUT%s
    echo [OVERMIND]   Voir: %LOG%\overmind.err.log
    type "%LOG%\overmind.err.log" 2>nul | findstr /i "error\|Error\|ERR" | head -5
    exit /b 1
)
exit /b 0

:: ─── Stop ─────────────────────────────────────────────────────

:cmd_stop
call :check_running
if not defined ALIVE_PID (
    echo [OVERMIND] Pas en cours d'exécution.
    if exist "%PID_FILE%" del "%PID_FILE%"
    exit /b 0
)

echo [OVERMIND] Arrêt PID %ALIVE_PID%...
:: Graceful shutdown: curl POST /mcp shutdown (si endpoint existe)
:: Puis SIGTERM
taskkill /F /PID %ALIVE_PID% >nul 2>&1
timeout /t 2 >nul

:: Vérifier que c'est bien mort
tasklist | findstr node | findstr %ALIVE_PID% >nul
if !errorlevel!==0 (
    echo [OVERMIND] ✓ Arrêté
) else (
    echo [OVERMIND] ⚠ Processus toujours vivant, kill forcé...
    taskkill /F /IM node.exe >nul 2>&1
)
if exist "%PID_FILE%" del "%PID_FILE%"
exit /b 0

:: ─── Kill (force) ──────────────────────────────────────────────

:cmd_kill
call :check_running
if not defined ALIVE_PID (
    echo [OVERMIND] Pas en cours.
    exit /b 0
)
echo [OVERMIND] Kill forcé PID %ALIVE_PID%...
taskkill /F /PID %ALIVE_PID% >nul 2>&1
if exist "%PID_FILE%" del "%PID_FILE%"
echo [OVERMIND] ✓
exit /b 0

:: ─── Restart ──────────────────────────────────────────────────

:cmd_restart
echo [OVERMIND] Restart...
call :cmd_stop
timeout /t 2 >nul
call :cmd_start
exit /b !errorlevel!

:: ─── Status ───────────────────────────────────────────────────

:cmd_status
call :check_running
if defined ALIVE_PID (
    echo [OVERMIND] ✓ Running — PID %ALIVE_PID% — http://localhost:%PORT%/mcp
    curl -s "%HEALTH_URL%"
    echo.
) else (
    if exist "%PID_FILE%" (
        set /p STALE_PID=<"%PID_FILE%"
        echo [OVERMIND] ✗ Not running — stale PID file (%STALE_PID%)
    ) else (
        echo [OVERMIND] ✗ Not running
    )
    exit /b 1
)
exit /b 0

:: ─── Tail (20 lignes log) ─────────────────────────────────────

:cmd_tail
if not exist "%LOG%\overmind.log" (
    echo [OVERMIND] Log pas encore créé.
    exit /b 1
)
echo [OVERMIND] === overmind.log (dernières 20 lignes) ===
powershell -NoProfile -Command "Get-Content '%LOG%\overmind.log' -Tail 20 -Wait"
exit /b 0

:: ─── Logs (full) ──────────────────────────────────────────────

:cmd_logs
if not exist "%LOG%\overmind.log" (
    echo [OVERMIND] Pas de log.
    exit /b 1
)
powershell -NoProfile -Command "Get-Content '%LOG%\overmind.log' -Tail 50 -Wait"
exit /b 0

:: ─── Helpers ──────────────────────────────────────────────────

:check_running
set "ALIVE_PID="
if exist "%PID_FILE%" (
    set /p CACHED_PID=<"%PID_FILE%"
    :: Vérifier que le PID du fichier existe encore
    tasklist | findstr "!CACHED_PID!" >nul 2>&1
    if !errorlevel!==0 (
        :: PID mort — vérifier par le port
        for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3099 " ^| findstr LISTENING') do (
            set "ALIVE_PID=%%a"
        )
    ) else (
        set "ALIVE_PID=!CACHED_PID!"
    )
) else (
    :: Pas de PID file — chercher par le port
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3099 " ^| findstr LISTENING') do (
        set "ALIVE_PID=%%a"
    )
)
exit /b 0

:: ─── Fin ──────────────────────────────────────────────────────
#>
