@echo off
REM ═══════════════════════════════════════════════════════════════════════════════
REM OVERMIND-MCP - INSTALLATION COMPLÈTE WINDOWS (Docker Desktop)
REM ═══════════════════════════════════════════════════════════════════════════════
REM Ce script installe et configure TOUT automatiquement :
REM - npm install -g overmind-mcp
REM - Docker Desktop (vérification)
REM - PostgreSQL + pgvector (si absent)
REM - Infrastructure complète (RabbitMQ, Temporal, Prometheus, Grafana, Jaeger)
REM - Validation de tous les services
REM ═══════════════════════════════════════════════════════════════════════════════

setlocal enabledelayedexpansion

REM Couleurs ANSI pour Windows 10+
for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "%ESC%=[0m"

echo.
echo %ESC%[96m╔════════════════════════════════════════════════════════════════════════════╗%ESC%
echo %ESC%[96m║%ESC%[0m %ESC%[93m                                                                %ESC%[0m %ESC%[96m║%ESC%[0m
echo %ESC%[96m║%ESC%[0m %ESC%[95m     🚀 OVERMIND-MCP - INSTALLATION COMPLÈTE                     %ESC%[0m %ESC%[96m║%ESC%[0m
echo %ESC%[96m║%ESC%[0m %ESC%[93m     Windows + Docker Desktop                                      %ESC%[0m %ESC%[96m║%ESC%[0m
echo %ESC%[96m║%ESC%[0m %ESC%[93m                                                                %ESC%[0m %ESC%[96m║%ESC%[0m
echo %ESC%[96m╚════════════════════════════════════════════════════════════════════════════╝%ESC%
echo.

REM ═══════════════════════════════════════════════════════════════════════════════
REM STEP 1: Vérifier Node.js et NPM
REM ═══════════════════════════════════════════════════════════════════════════════
echo %ESC%[36m═════════════════════════════════════════════════════════════════════════════%ESC%
echo %ESC%[36m║  ÉTAPE 1/7: VÉRIFICATION NODE.JS ET NPM                              ║%ESC%
echo %ESC%[36m╚════════════════════════════════════════════════════════════════════════════╝%ESC%
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo %ESC%[91m❌ Node.js non trouvé. Installation requise...%ESC%
    echo %ESC%[93m📥 Téléchargement: https://nodejs.org/%ESC%
    pause
    exit /b 1
)

echo %ESC%[92m✅ Node.js détecté:%ESC%
node --version
echo %ESC%[92m✅ NPM détecté:%ESC%
npm --version
echo.

REM ═══════════════════════════════════════════════════════════════════════════════
REM STEP 2: Installer OverMind-MCP globalement
REM ═══════════════════════════════════════════════════════════════════════════════
echo %ESC%[36m═════════════════════════════════════════════════════════════════════════════%ESC%
echo %ESC%[36m║  ÉTAPE 2/7: INSTALLATION OVERMIND-MCP                                ║%ESC%
echo %ESC%[36m╚════════════════════════════════════════════════════════════════════════════╝%ESC%
echo.

echo %ESC%[93m📦 Installation d'overmind-mcp (dernière version)...%ESC%
call npm install -g overmind-mcp@latest
if errorlevel 1 (
    echo %ESC%[91m❌ Erreur installation overmind-mcp%ESC%
    pause
    exit /b 1
)

echo %ESC%[92m✅ overmind-mcp installé:%ESC%
npm view overmind-mcp version
echo.

REM ═══════════════════════════════════════════════════════════════════════════════
REM STEP 3: Vérifier Docker Desktop
REM ═══════════════════════════════════════════════════════════════════════════════
echo %ESC%[36m═════════════════════════════════════════════════════════════════════════════%ESC%
echo %ESC%[36m║  ÉTAPE 3/7: VÉRIFICATION DOCKER DESKTOP                             ║%ESC%
echo %ESC%[36m╚════════════════════════════════════════════════════════════════════════════╝%ESC%
echo.

docker --version >nul 2>&1
if errorlevel 1 (
    echo %ESC%[91m❌ Docker non trouvé. Docker Desktop requis.%ESC%
    echo %ESC%[93m📥 Téléchargement: https://www.docker.com/products/docker-desktop/%ESC%
    pause
    exit /b 1
)

echo %ESC%[92m✅ Docker détecté:%ESC%
docker --version
echo.

REM ═══════════════════════════════════════════════════════════════════════════════
REM STEP 4: Installer PostgreSQL + pgvector
REM ═══════════════════════════════════════════════════════════════════════════════
echo %ESC%[36m═════════════════════════════════════════════════════════════════════════════%ESC%
echo %ESC%[36m║  ÉTAPE 4/7: INSTALLATION POSTGRESQL + PGVECTOR                       ║%ESC%
echo %ESC%[36m╚════════════════════════════════════════════════════════════════════════════╝%ESC%
echo.

call npm exec -y overmind-mcp -- install-dependencies
echo.

REM ═══════════════════════════════════════════════════════════════════════════════
REM STEP 5: Créer configuration OverMind
REM ═══════════════════════════════════════════════════════════════════════════════
echo %ESC%[36m═════════════════════════════════════════════════════════════════════════════%ESC%
echo %ESC%[36m║  ÉTAPE 5/7: CONFIGURATION OVERMIND                                  ║%ESC%
echo %ESC%[36m╚════════════════════════════════════════════════════════════════════════════╝%ESC%
echo.

if not exist "%USERPROFILE%\.overmind" mkdir "%USERPROFILE%\.overmind"

REM Créer .env de base
if not exist "%USERPROFILE%\.overmind\.env" (
    echo %ESC%[93m📝 Création configuration .env...%ESC%
    (
        echo # OverMind-MCP Environment Configuration
        echo # Généré par install-overmind-windows.bat
        echo.
        echo # PostgreSQL
        echo POSTGRES_HOST=localhost
        echo POSTGRES_PORT=5432
        echo POSTGRES_USER=postgres
        echo POSTGRES_PASSWORD=overmind_temp_password_change_me
        echo POSTGRES_DB=overmind
        echo.
        echo # OpenTelemetry (optionnel)
        echo OTEL_ENABLED=false
        echo.
        echo # Workspace
        echo OVERMIND_WORKSPACE=%USERPROFILE%\.overmind
    ) > "%USERPROFILE%\.overmind\.env"
    echo %ESC%[92m✅ Configuration créée:%ESC% %USERPROFILE%\.overmind\.env
)

echo.

REM ═══════════════════════════════════════════════════════════════════════════════
REM STEP 6: Lancer infrastructure Docker complète
REM ═══════════════════════════════════════════════════════════════════════════════
echo %ESC%[36m═════════════════════════════════════════════════════════════════════════════%ESC%
echo %ESC%[36m║  ÉTAPE 6/7: DÉMARRAGE INFRASTRUCTURE DOCKER                           ║%ESC%
echo %ESC%[36m╚════════════════════════════════════════════════════════════════════════════╝%ESC%
echo.

REM Télécharger docker-compose depuis GitHub
echo %ESC%[93m📥 Téléchargement docker-compose.yml...%ESC%
curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.yml -o "%USERPROFILE%\.overmind\docker-compose.yml"
curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.exporters.yml -o "%USERPROFILE%\.overmind\docker-compose.exporters.yml"

echo %ESC%[93m🚀 Démarrage de l'infrastructure Docker...%ESC%
cd "%USERPROFILE%\.overmind"
docker-compose -f docker-compose.yml up -d

echo.
timeout /t 10 /nobreak >nul

REM ═══════════════════════════════════════════════════════════════════════════════
REM STEP 7: Validation de tous les services
REM ═══════════════════════════════════════════════════════════════════════════════
echo %ESC%[36m═════════════════════════════════════════════════════════════════════════════%ESC%
echo %ESC%[36m║  ÉTAPE 7/7: VALIDATION DES SERVICES                                  ║%ESC%
echo %ESC%[36m╚════════════════════════════════════════════════════════════════════════════╝%ESC%
echo.

echo %ESC%[93m🔍 Vérification des containers Docker...%ESC%
echo.
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo.

echo %ESC%[93m🧪 Tests de connexion...%ESC%
echo.

REM Test PostgreSQL
echo %ESC%[93m   • PostgreSQL:%ESC%
docker exec overmind-postgres-pgvector pg_isready -U postgres >nul 2>&1
if errorlevel 1 (
    echo %ESC%[91m      ❌ PostgreSQL non prêt%ESC%
) else (
    echo %ESC%[92m      ✅ PostgreSQL actif%ESC%
)

REM Test RabbitMQ
echo %ESC%[93m   • RabbitMQ:%ESC%
docker ps --filter "name=rabbitmq" --format "{{.Names}}" | findstr rabbitmq >nul
if errorlevel 1 (
    echo %ESC%[91m      ❌ RabbitMQ non trouvé%ESC%
) else (
    echo %ESC%[92m      ✅ RabbitMQ actif%ESC%
)

REM Test Temporal
echo %ESC%[93m   • Temporal:%ESC%
docker ps --filter "name=temporal" --format "{{.Names}}" | findstr temporal >nul
if errorlevel 1 (
    echo %ESC%[91m      ❌ Temporal non trouvé%ESC%
) else (
    echo %ESC%[92m      ✅ Temporal actif%ESC%
)

REM Test Prometheus
echo %ESC%[93m   • Prometheus:%ESC%
docker ps --filter "name=prometheus" --format "{{.Names}}" | findstr prometheus >nul
if errorlevel 1 (
    echo %ESC%[91m      ❌ Prometheus non trouvé%ESC%
) else (
    echo %ESC%[92m      ✅ Prometheus actif%ESC%
)

REM Test Grafana
echo %ESC%[93m   • Grafana:%ESC%
docker ps --filter "name=grafana" --format "{{.Names}}" | findstr grafana >nul
if errorlevel 1 (
    echo %ESC%[91m      ❌ Grafana non trouvé%ESC%
) else (
    echo %ESC%[92m      ✅ Grafana actif%ESC%
)

REM Test Jaeger
echo %ESC%[93m   • Jaeger:%ESC%
docker ps --filter "name=jaeger" --format "{{.Names}}" | findstr jaeger >nul
if errorlevel 1 (
    echo %ESC%[91m      ❌ Jaeger non trouvé%ESC%
) else (
    echo %ESC%[92m      ✅ Jaeger actif%ESC%
)

echo.

REM ═══════════════════════════════════════════════════════════════════════════════
REM RÉSUMÉ FINAL
REM ═══════════════════════════════════════════════════════════════════════════════
echo %ESC%[92m╔════════════════════════════════════════════════════════════════════════════╗%ESC%
echo %ESC%[92m║%ESC%[0m %ESC%[97m             ✅ INSTALLATION TERMINÉE AVEC SUCCÈS !                  %ESC%[0m %ESC%[92m║%ESC%
echo %ESC%[92m╚════════════════════════════════════════════════════════════════════════════╝%ESC%
echo.
echo %ESC%[93m📋 SERVICES DISPONIBLES:%ESC%
echo.
echo    %ESC%[96m┌─────────────────────────────────────────────────────────────────┐%ESC%
echo    %ESC%[96m│%ESC%[0m %ESC%[95mDocker Desktop:%ESC%[0m                                                  %ESC%[96m│%ESC%
echo    %ESC%[96m│%ESC%[0m   Ouvrez Docker Desktop pour voir tous les containers         %ESC%[96m│%ESC%
echo    %ESC%[96m│%ESC%[0m                                                                  %ESC%[96m│%ESC%
echo    %ESC%[96m│%ESC%[0m %ESC%[95mURLs utiles:%ESC%[0m                                                     %ESC%[96m│%ESC%
echo    %ESC%[96m│%ESC%[0m   • Prometheus: http://localhost:9090                              %ESC%[96m│%ESC%
echo    %ESC%[96m│%ESC%[0m   • Grafana:      http://localhost:3000 (admin/admin)            %ESC%[96m│%ESC%
echo    %ESC%[96m│%ESC%[0m   • Jaeger:       http://localhost:16686                           %ESC%[96m│%ESC%
echo    %ESC%[96m│%ESC%[0m   • RabbitMQ:    http://localhost:15672 (guest/guest)            %ESC%[96m│%ESC%
echo    %ESC%[96m│%ESC%[0m   • Temporal:     http://localhost:8233                           %ESC%[96m│%ESC%
echo    %ESC%[96m└─────────────────────────────────────────────────────────────────┘%ESC%
echo.
echo %ESC%[93m📚 DOCUMENTATION:%ESC%
echo    • https://github.com/DeamonDev888/overmind-mcp
echo    • https://www.npmjs.com/package/overmind-mcp
echo.
echo %ESC%[93m🎉 PROCHAINE ÉTAPE:%ESC%
echo    • Lancez: overmind-setup --full
echo    • Ou créez votre premier agent: overmind create-agent
echo.
pause
