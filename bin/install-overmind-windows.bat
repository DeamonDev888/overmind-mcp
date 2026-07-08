@echo off
REM ============================================================
REM OVERMIND-MCP - INSTALLATION INTELLIGENTE WINDOWS
REMB ============================================================
REM Ce script détecte et utilise l'infrastructure existante
REM - PostgreSQL existant ? Utilise-le !
REM - Ports occupés ? Adapte la configuration !
REM ============================================================

setlocal enabledelayedexpansion

REM Couleurs ANSI
for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "%ESC%=[0m"

echo.
echo %ESC%[96m***************************************************************%ESC%
echo %ESC%[96m*                                                             *%ESC%
echo %ESC%[96m*     OVERMIND-MCP - INSTALLATION INTELLIGENTE            *%ESC%
echo %ESC%[96m*     Windows + Docker Desktop                                *%ESC%
echo %ESC%[96m*                                                             *%ESC%
echo %ESC%[96m***************************************************************%ESC%
echo.

REM ============================================================
REM STEP 1: Verifier Node.js
REM ============================================================
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ STEP 1/8 ] VERIFICATION NODE.JS%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo %ESC%[91m[ERREUR] Node.js non trouve%ESC%
    echo Telechargez: https://nodejs.org/
    pause
    exit /b 1
)

echo %ESC%[92m[OK] Node.js:%ESC%
node --version
echo %ESC%[92m[OK] NPM:%ESC%
npm --version
echo.

REM ============================================================
REM STEP 2: Installer OverMind-MCP
REM ============================================================
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ STEP 2/8 ] INSTALLATION OVERMIND-MCP%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.

echo [INFO] Installation en cours...
call npm install -g overmind-mcp@latest
if errorlevel 1 (
    echo %ESC%[91m[ERREUR] Echec installation overmind-mcp%ESC%
    pause
    exit /b 1
)

echo %ESC%[92m[OK] overmind-mcp installe: Version%ESC%
npm view overmind-mcp version
echo.

REM ============================================================
REM STEP 3: Verifier Docker
REM ============================================================
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ STEP 3/8 ] VERIFICATION DOCKER%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.

docker --version >nul 2>&1
if errorlevel 1 (
    echo %ESC%[91m[ERREUR] Docker non trouve%ESC%
    echo Telechargez: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

echo %ESC%[92m[OK] Docker detecte:%ESC%
docker --version
echo.

REM ============================================================
REM STEP 4: Analyse infrastructure existante
REM ============================================================
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ STEP 4/8 ] ANALYSE INFRASTRUCTURE%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.

echo [INFO] Detection des services existants...
echo.

set "POSTGRES_EXISTS=0"
set "POSTGRES_CONTAINER="
set "USE_EXTERNAL_POSTGRES=0"

REM Verifier PostgreSQL sur port 5432
docker ps -a --filter "publish=5432" --format "{{.Names}}" | findstr /i "postgres" >nul
if not errorlevel 1 (
    for /f "tokens=*" %%a in ('docker ps -a --filter "publish=5432" --format "{{.Names}}"') do (
        set "POSTGRES_EXISTS=1"
        set "POSTGRES_CONTAINER=%%a"
        echo %ESC%[92m[OK] PostgreSQL existant: %%a%ESC%
        set "USE_EXTERNAL_POSTGRES=1"
    )
) else (
    echo %ESC%[93m[INFO] PostgreSQL non detecte - installation prevue%ESC%
)

echo.
echo [INFO] Verification des ports...
netstat -an | findstr ":5432 " >nul && echo %ESC%[93m[WARN] Port 5432 utilise%ESC% || echo %ESC%[92m[OK] Port 5432 libre%ESC%
netstat -an | findstr ":5672 " >nul && echo %ESC%[93m[WARN] Port 5672 utilise%ESC% || echo %ESC%[92m[OK] Port 5672 libre%ESC%
netstat -an | findstr ":9090 " >nul && echo %ESC%[93m[WARN] Port 9090 utilise%ESC% || echo %ESC%[92m[OK] Port 9090 libre%ESC%
netstat -an | findstr ":3000 " >nul && echo %ESC%[93m[WARN] Port 3000 utilise%ESC% || echo %ESC%[92m[OK] Port 3000 libre%ESC%

echo.

REM ============================================================
REM STEP 5: Configuration MCP HTTP
REM ============================================================
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ STEP 5/8 ] CONFIGURATION MCP HTTP%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.
echo [INFO] Creation configuration MCP HTTP singleton...
if not exist "%USERPROFILE%\.overmind\config" mkdir "%USERPROFILE%\.overmind\config"

(
    echo {
    echo   "mcpServers": {
    echo     "overmind": {
    echo       "transport": "http-stream",
    echo       "url": "http://localhost:3099"
    echo     },
    echo     "memory": {
    echo       "transport": "http-stream",
    echo       "url": "http://localhost:3099"
    echo     },
    echo     "postgresql": {
    echo       "transport": "http-stream",
    echo       "url": "http://localhost:5433"
    echo     },
    echo     "discord": {
    echo       "transport": "http-stream",
    echo       "url": "http://localhost:3141"
    echo     },
    echo     "x": {
    echo       "transport": "http-stream",
    echo       "url": "http://localhost:3142"
    echo     }
    echo   }
    echo }
) > "%USERPROFILE%\.overmind\config\mcp-servers.json"

echo %ESC%[92m[OK] Configuration MCP creee: %USERPROFILE%\.overmind\config\mcp-servers.json%ESC%
echo.
echo [INFO] Ports a lancer manuellement apres installation:
echo    Overmind:   node cli.js --transport http-stream --port 3099
echo    PostgreSQL: node dist/index.js (FASTMCP_TRANSPORT=httpStream FASTMCP_PORT=5433)
echo    Discord:    node dist/index.js (FASTMCP_TRANSPORT=httpStream FASTMCP_PORT=3141)
echo    X:          node dist/src/server.js (FASTMCP_TRANSPORT=httpStream FASTMCP_PORT=3142)
echo.

REM STEP 6: PostgreSQL intelligent
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ STEP 6/8 ] POSTGRESQL INTELLIGENT%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.

if "%USE_EXTERNAL_POSTGRES%"=="1" (
    echo %ESC%[92m[OK] Utilisation PostgreSQL existant: %POSTGRES_CONTAINER%%ESC%

    REM Verifier pgvector
    docker exec %POSTGRES_CONTAINER% psql -U postgres -c "SELECT extname FROM pg_extension WHERE extname = 'vector';" >nul 2>&1
    if errorlevel 1 (
        echo %ESC%[93m[WARN] pgvector non detecte%ESC%
        echo.
        echo [INFO] Pour installer pgvector manuellement:
        echo     docker exec %POSTGRES_CONTAINER% psql -U postgres -c "CREATE EXTENSION vector;"
    ) else (
        echo %ESC%[92m[OK] pgvector detecte%ESC%
    )
) else (
    echo [INFO] Installation PostgreSQL + pgvector...
    call npm exec -y overmind-mcp -- install-dependencies
    if errorlevel 1 (
        echo %ESC%[91m[ERREUR] Echec installation PostgreSQL%ESC%
    )
)

echo.

REM ============================================================
REM STEP 7: Configuration MCP .mcp.json
REM ============================================================
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ STEP 7/8 ] CONFIGURATION MCP .MCP.JSON%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.

if not exist "%USERPROFILE%\.overmind" mkdir "%USERPROFILE%\.overmind"

REM Creer .env intelligent
if not exist "%USERPROFILE%\.overmind\.env" (
    echo [INFO] Creation .env...
    (
        echo # OverMind-MCP Environment Configuration
        echo # Genere par install-overmind-windows.bat
        echo.
        echo # PostgreSQL
        echo POSTGRES_HOST=localhost
        echo POSTGRES_PORT=5432
        echo POSTGRES_USER=postgres
        echo POSTGRES_PASSWORD=CHANGE_ME_IN_DOTENV
        echo POSTGRES_DATABASE=overmind_memory
        echo.
        echo # Infrastructure detectee
        if "%USE_EXTERNAL_POSTGRES%"=="1" (
            echo POSTGRES_EXTERNAL=%POSTGRES_CONTAINER%
        )
        echo.
        echo # OpenTelemetry
        echo OTEL_ENABLED=false
        echo.
        echo # Workspace
        echo OVERMIND_WORKSPACE=%USERPROFILE%\.overmind
    ) > "%USERPROFILE%\.overmind\.env"
    echo %ESC%[92m[OK] .env cree%ESC%
)

echo.

REM ============================================================
REM STEP 8: Telechargement docker-compose
REM ============================================================
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ STEP 8/8 ] TELECHARGEMENT CONFIG%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.

echo [INFO] Telechargement docker-compose.yml...
curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.yml -o "%USERPROFILE%\.overmind\docker-compose.yml"
curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.exporters.yml -o "%USERPROFILE%\.overmind\docker-compose.exporters.yml"

echo [INFO] Creation configuration fichiers...
if not exist "%USERPROFILE%\.overmind\config" mkdir "%USERPROFILE%\.overmind\config"
if not exist "%USERPROFILE%\.overmind\config\grafana\provisioning\datasources" mkdir "%USERPROFILE%\.overmind\config\grafana\provisioning\datasources"

echo [INFO] Creation OTEL collector config...
(
echo receivers:
echo   otlp:
echo     protocols:
echo       grpc:
echo         endpoint: 0.0.0.0:4317
echo       http:
echo         endpoint: 0.0.0.0:4318
echo.
echo processors:
echo   batch:
echo.
echo exporters:
echo   otlp/jaeger:
echo     endpoint: jaeger:4317
echo     tls:
echo       insecure: true
echo.
echo   prometheusremotewrite:
echo     endpoint: http://prometheus:9090/api/v1/write
echo.
echo service:
echo   pipelines:
echo     traces:
echo       receivers: [otlp]
echo       processors: [batch]
echo       exporters: [otlp/jaeger]
echo.
echo     metrics:
echo       receivers: [otlp]
echo       processors: [batch]
echo       exporters: [prometheusremotewrite]
) > "%USERPROFILE%\.overmind\config\otel-collector.yml"

echo [INFO] Creation Prometheus config...
(
echo global:
echo   scrape_interval: 15s
echo   evaluation_interval: 15s
echo.
echo scrape_configs:
echo   - job_name: 'prometheus'
echo     static_configs:
echo       - targets: ['localhost:9090']
echo.
echo   - job_name: 'otel-collector'
echo     static_configs:
echo       - targets: ['otel-collector:9464']
) > "%USERPROFILE%\.overmind\config\prometheus.yml"

echo [INFO] Creation Grafana datasource config...
(
echo apiVersion: 1
echo.
echo datasources:
echo   - name: Prometheus
echo     type: prometheus
echo     access: proxy
echo     url: http://prometheus:9090
echo     isDefault: true
) > "%USERPROFILE%\.overmind\config\grafana\provisioning\datasources\prometheus.yml"

echo %ESC%[92m[OK] Configuration fichiers crees%ESC%

	echo [INFO] Creation init-db.sql...
	curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/init-db.sql -o "%USERPROFILE%.overmindinit-db.sql"

echo.

REM ============================================================
REM STEP 8: Demarrage intelligent
REM ============================================================
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ STEP 8/8 ] DEMARRAGE DOCKER ET SERVEURS HTTP%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.

echo [INFO] Demarrage infrastructure Docker...
cd "%USERPROFILE%\.overmind"

REM Si PostgreSQL externe, adapter le docker-compose
if "%USE_EXTERNAL_POSTGRES%"=="1" (
    echo [INFO] Adaptation docker-compose (PostgreSQL externe)...
    powershell -Command "(Get-Content '%USERPROFILE%\.overmind\docker-compose.yml') -replace '  postgres:','# postgres:', [System.Text.RegularExpressions.RegexOptions]::Multiline) -replace '    image: pgvector/pgvector:pg16','    # image: pgvector/pgvector:pg16' -replace '    container_name: overmind-postgres','    # container_name: overmind-postgres' | Set-Content '%USERPROFILE%\.overmind\docker-compose.yml'"
    echo %ESC%[92m[OK] Docker-compose adapte (postgres desactive)%ESC%
)

docker-compose -f docker-compose.yml up -d

if errorlevel 1 (
    echo %ESC%[93m[WARN] Certains services ont pu echouer%ESC%
    echo [INFO] Verification des services demarres...
)

echo.
timeout /t 20 /nobreak >nul

REM ============================================================
REM STEP 9: Validation intelligente
REM ============================================================
echo.
echo %ESC%[36m=======================================================%ESC%
echo %ESC%[36m[ VALIDATION DES SERVICES ]%ESC%
echo %ESC%[36m=======================================================%ESC%
echo.

echo [INFO] Verification des containers...
echo.

docker ps --filter "name=overmind" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo.

echo [INFO] Tests de connexion...
echo.

echo   - PostgreSQL:
if "%USE_EXTERNAL_POSTGRES%"=="1" (
    docker exec %POSTGRES_CONTAINER% pg_isready -U postgres >nul 2>&1
    if errorlevel 1 (
        echo %ESC%[91m      [FAIL] PostgreSQL non pret%ESC%
    ) else (
        echo %ESC%[92m      [OK] PostgreSQL actif (%POSTGRES_CONTAINER%)%ESC%
    )
) else (
    docker ps --filter "name=overmind-postgres" --format "{{.Names}}" | findstr postgres >nul
    if errorlevel 1 (
        echo %ESC%[91m      [FAIL] OverMind PostgreSQL non trouve%ESC%
    ) else (
        docker exec overmind-postgres pg_isready -U postgres >nul 2>&1
        if errorlevel 1 (
            echo %ESC%[91m      [FAIL] PostgreSQL non pret%ESC%
        ) else (
            echo %ESC%[92m      [OK] OverMind PostgreSQL actif%ESC%
        )
    )
)

echo   - RabbitMQ:
docker ps --filter "name=overmind-rabbitmq" --format "{{.Names}}" | findstr rabbitmq >nul
if errorlevel 1 (
    echo %ESC%[91m      [FAIL] RabbitMQ non trouve%ESC%
) else (
    echo %ESC%[92m      [OK] RabbitMQ actif%ESC%
)

REM Temporal desactive - skip validation
echo   - Temporal: %ESC%[93m      [INFO] Desactive (requiert init DB)%ESC%

echo   - Prometheus:
docker ps --filter "name=overmind-prometheus" --format "{{.Names}}" | findstr prometheus >nul
if errorlevel 1 (
    echo %ESC%[91m      [FAIL] Prometheus non trouve%ESC%
) else (
    echo %ESC%[92m      [OK] Prometheus actif%ESC%
)

echo   - Grafana:
docker ps --filter "name=overmind-grafana" --format "{{.Names}}" | findstr grafana >nul
if errorlevel 1 (
    echo %ESC%[91m      [FAIL] Grafana non trouve%ESC%
) else (
    echo %ESC%[92m      [OK] Grafana actif%ESC%
)

echo   - Jaeger:
docker ps --filter "name=overmind-jaeger" --format "{{.Names}}" | findstr jaeger >nul
if errorlevel 1 (
    echo %ESC%[91m[      [FAIL] Jaeger non trouve%ESC%
) else (
    echo %ESC%[92m      [OK] Jaeger actif%ESC%
)

echo.
echo %ESC%[92m***************************************************************%ESC%
echo %ESC%[92m*                                                             *%ESC%
echo %ESC%[92m*        INSTALLATION TERMINÉE AVEC SUCCÈS !             *%ESC%
echo %ESC%[92m*                                                             *%ESC%
echo %ESC%[92m***************************************************************%ESC%
echo.
echo %ESC%[93m[SERVICES ACTIFS]
echo.
echo    Ouvrez Docker Desktop - onglet Containers
echo.
echo    URLs utiles:
echo       - Prometheus:  http://localhost:9090
echo       - Grafana:      http://localhost:3000 (admin/admin)
echo       - Jaeger:       http://localhost:16686
echo       - RabbitMQ:    http://localhost:15672 (guest/guest)
echo       - Temporal:     http://localhost:8233
echo.
echo %ESC%[93m[PROCHAINE ETAPE]
echo.
echo    - Creer votre premier agent: overmind create-agent
echo    - Lister les agents: overmind list-agents
echo.
pause
