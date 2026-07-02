#!/bin/bash
# ============================================================
# OVERMIND-MCP - INSTALLATION INTELLIGENTE Linux/macOS
# ============================================================
# Ce script détecte et utilise l'infrastructure existante
# - PostgreSQL existant ? Utilise-le !
# - Ports occupés ? Adapte la configuration !
# ============================================================

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

clear
echo -e "${CYAN}***************************************************************${NC}"
echo -e "${CYAN}*                                                             *${NC}"
echo -e "${MAGENTA}     🚀 OVERMIND-MCP - INSTALLATION INTELLIGENTE            ${NC}"
echo -e "${CYAN}*     Linux/macOS + Docker Desktop                                *${NC}"
echo -e "${CYAN}*                                                             *${NC}"
echo -e "${CYAN}***************************************************************${NC}"
echo ""

# ============================================================
# STEP 1: Vérifier Node.js et NPM
# ============================================================
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}[ STEP 1/8 ] VERIFICATION NODE.JS${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERREUR] Node.js non trouvé${NC}"
    echo -e "${YELLOW}Linux: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -${NC}"
    echo -e "${YELLOW}macOS: brew install node${NC}"
    exit 1
fi

echo -e "${GREEN}[OK] Node.js détecté:${NC}"
NODE_MAJ=$(node -p "process.versions.node.split('.')[0]")
node --version
echo -e "${GREEN}[OK] NPM détecté:${NC}"
npm --version
echo ""

# Check Node version compatibility (overmind-postgres-mcp requires <25)
if [ "$NODE_MAJ" -ge 25 ]; then
  echo -e "${YELLOW}[WARN] Node $NODE_MAJ détecté. overmind-postgres-mcp nécessite Node < 25.${NC}"
  if [ -d "$HOME/.nvm" ]; then
    echo -e "${YELLOW}[INFO] Bascule vers Node 24 via nvm...${NC}"
    \. "$HOME/.nvm/nvm.sh" 2>/dev/null
    nvm install 24 2>/dev/null && nvm use 24 2>/dev/null && hash -r || true
    echo -e "${GREEN}[OK] Node $(node --version) actif${NC}"
  else
    echo -e "${YELLOW}[INFO] Installez Node 24: nvm install 24 && nvm use 24${NC}"
  fi
fi

# ============================================================
# STEP 2: Installer OverMind-MCP
# ============================================================
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}[ STEP 2/8 ] INSTALLATION OVERMIND-MCP${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

echo -e "${YELLOW}[INFO] Installation d'overmind-mcp...${NC}"
npm install -g overmind-mcp@latest

echo -e "${GREEN}[OK] overmind-mcp installé:${NC}"
npm view overmind-mcp version
echo ""

# ============================================================
# STEP 3: Vérifier Docker
# ============================================================
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}[ STEP 3/8 ] VERIFICATION DOCKER${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

if ! command -v docker &> /dev/null; then
    echo -e "${RED}[ERREUR] Docker non trouvé${NC}"
    echo -e "${YELLOW}Linux: https://docs.docker.com/engine/install/${NC}"
    echo -e "${YELLOW}macOS: https://www.docker.com/products/docker-desktop/${NC}"
    exit 1
fi

echo -e "${GREEN}[OK] Docker détecté:${NC}"
docker --version
echo ""

# ============================================================
# STEP 4: Analyse infrastructure existante
# ============================================================
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}[ STEP 4/8 ] ANALYSE INFRASTRUCTURE${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

echo -e "${YELLOW}[INFO] Détection des services existants...${NC}"
echo ""

POSTGRES_EXISTS=0
POSTGRES_CONTAINER=""
USE_EXTERNAL_POSTGRES=0

# Vérifier PostgreSQL sur port 5432
if docker ps -a --filter "publish=5432" --format "{{.Names}}" | grep -qi "postgres"; then
    POSTGRES_CONTAINER=$(docker ps -a --filter "publish=5432" --format "{{.Names}}" | head -1)
    POSTGRES_EXISTS=1
    USE_EXTERNAL_POSTGRES=1
    echo -e "${GREEN}[OK] PostgreSQL existant détecté: ${POSTGRES_CONTAINER}${NC}"
else
    echo -e "${YELLOW}[INFO] PostgreSQL non détecté - installation prévue${NC}"
fi

echo ""
echo -e "${YELLOW}[INFO] Vérification des ports...${NC}"
netstat -tuln 2>/dev/null | grep ":5432 " > /dev/null && echo -e "${YELLOW}[WARN] Port 5432 utilisé${NC}" || echo -e "${GREEN}[OK] Port 5432 libre${NC}"
netstat -tuln 2>/dev/null | grep ":5672 " > /dev/null && echo -e "${YELLOW}[WARN] Port 5672 utilisé${NC}" || echo -e "${GREEN}[OK] Port 5672 libre${NC}"
netstat -tuln 2>/dev/null | grep ":9090 " > /dev/null && echo -e "${YELLOW}[WARN] Port 9090 utilisé${NC}" || echo -e "${GREEN}[OK] Port 9090 libre${NC}"
netstat -tuln 2>/dev/null | grep ":3000 " > /dev/null && echo -e "${YELLOW}[WARN] Port 3000 utilisé${NC}" || echo -e "${GREEN}[OK] Port 3000 libre${NC}"

echo ""

# ============================================================
# STEP 5: PostgreSQL intelligent
# ============================================================
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}[ STEP 5/8 ] POSTGRESQL INTELLIGENT${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

if [ "$USE_EXTERNAL_POSTGRES" -eq 1 ]; then
    echo -e "${GREEN}[OK] Utilisation PostgreSQL existant: ${POSTGRES_CONTAINER}${NC}"

    # Vérifier pgvector
    if docker exec "${POSTGRES_CONTAINER}" psql -U postgres -c "SELECT extname FROM pg_extension WHERE extname = 'vector';" 2>/dev/null | grep -q vector; then
        echo -e "${GREEN}[OK] pgvector détecté${NC}"
    else
        echo -e "${YELLOW}[WARN] pgvector non détecté${NC}"
        echo ""
        echo -e "${YELLOW}Pour installer pgvector manuellement :${NC}"
        echo "    docker exec ${POSTGRES_CONTAINER} psql -U postgres -c \"CREATE EXTENSION vector;\""
    fi
else
    echo -e "${YELLOW}[INFO] Installation PostgreSQL + pgvector...${NC}"
    npx overmind-mcp install-dependencies
fi

echo ""

# ============================================================
# STEP 6: Configuration intelligente
# ============================================================
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}[ STEP 6/8 ] CONFIGURATION ADAPTIVE${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

OVERMIND_DIR="$HOME/.overmind"
mkdir -p "$OVERMIND_DIR"

# Créer .env intelligent
if [ ! -f "$OVERMIND_DIR/.env" ]; then
    echo -e "${YELLOW}[INFO] Création configuration .env...${NC}"
    cat > "$OVERMIND_DIR/.env" << EOF
# OverMind-MCP Environment Configuration
# Généré par install-overmind-unix.sh

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=overmind_temp_password_change_me
POSTGRES_DB=overmind

# Infrastructure détectée
EOF

    if [ "$USE_EXTERNAL_POSTGRES" -eq 1 ]; then
        echo "POSTGRES_EXTERNAL=${POSTGRES_CONTAINER}" >> "$OVERMIND_DIR/.env"
    fi

    cat >> "$OVERMIND_DIR/.env" << EOF

# OpenTelemetry
OTEL_ENABLED=false

# Workspace
OVERMIND_WORKSPACE=$OVERMIND_DIR
EOF
    echo -e "${GREEN}[OK] Configuration créée: ${OVERMIND_DIR}/.env${NC}"
fi

echo ""

# ============================================================
# STEP 7: Télécharger docker-compose
# ============================================================
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}[ STEP 7/8 ] TÉLECHARGEMENT CONFIG${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

echo -e "${YELLOW}[INFO] Téléchargement docker-compose.yml...${NC}"
curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.yml -o "$OVERMIND_DIR/docker-compose.yml"
curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.exporters.yml -o "$OVERMIND_DIR/docker-compose.exporters.yml"

# Adapter docker-compose si PostgreSQL externe
if [ "$USE_EXTERNAL_POSTGRES" -eq 1 ]; then
    echo -e "${YELLOW}[INFO] Adaptation docker-compose (PostgreSQL externe)...${NC}"
    sed -i.bak 's/^  postgres:/# postgres:/' "$OVERMIND_DIR/docker-compose.yml"
    sed -i.bak 's/^    image: pgvector/#    image:/' "$OVERMIND_DIR/docker-compose.yml"
    sed -i.bak 's/^    container_name: overmind-postgres/#    container_name:/' "$OVERMIND_DIR/docker-compose.yml"
    echo -e "${GREEN}[OK] Docker-compose adapté (postgres désactivé)${NC}"
fi

echo -e "${GREEN}[OK] Fichers téléchargés${NC}"

	echo -e "${YELLOW}[INFO] Création fichiers de configuration...${NC}"
	mkdir -p "$OVERMIND_DIR/config/grafana/provisioning/datasources"

	echo -e "${YELLOW}[INFO] Création config OTEL collector...${NC}"
	cat > "$OVERMIND_DIR/config/otel-collector.yml" << 'EOF'
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

  prometheusremotewrite:
    endpoint: http://prometheus:9090/api/v1/write

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/jaeger]

    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheusremotewrite]
EOF

	echo -e "${YELLOW}[INFO] Création config Prometheus...${NC}"
	cat > "$OVERMIND_DIR/config/prometheus.yml" << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'otel-collector'
    static_configs:
      - targets: ['otel-collector:9464']
EOF

	echo -e "${YELLOW}[INFO] Création config Grafana datasource...${NC}"
	cat > "$OVERMIND_DIR/config/grafana/provisioning/datasources/prometheus.yml" << 'EOF'
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
EOF

	echo -e "${GREEN}[OK] Fichiers de configuration créés${NC}"

	echo -e "${YELLOW}[INFO] Création init-db.sql...${NC}"
	curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/init-db.sql -o "$OVERMIND_DIR/init-db.sql"
	echo -e "${GREEN}[OK] init-db.sql téléchargé${NC}"


echo ""

# ============================================================
# STEP 8: Démarrage intelligent
# ============================================================
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}[ STEP 8/8 ] DÉMARRAGE DOCKER${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

echo -e "${YELLOW}[INFO] Démarrage infrastructure Docker...${NC}"
cd "$OVERMIND_DIR"
docker-compose -f docker-compose.yml up -d

if [ $? -ne 0 ]; then
    echo -e "${YELLOW}[WARN] Certains services ont pu échouer${NC}"
    echo -e "${YELLOW}[INFO] Vérification des services démarrés...${NC}"
fi

echo ""
sleep 15

# ============================================================
# VALIDATION INTELLIGENTE
# ============================================================
echo ""
echo -e "${CYAN}=======================================================${NC}"
echo -e "${CYAN}[ VALIDATION DES SERVICES ]${NC}"
echo -e "${CYAN}=======================================================${NC}"
echo ""

echo -e "${YELLOW}[INFO] Vérification des containers...${NC}"
echo ""
docker ps --filter "name=overmind" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

echo -e "${YELLOW}[INFO] Tests de connexion...${NC}"
echo ""

# Test PostgreSQL
echo -e "   • PostgreSQL:"
if [ "$USE_EXTERNAL_POSTGRES" -eq 1 ]; then
    docker exec "${POSTGRES_CONTAINER}" pg_isready -U postgres > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}      [OK] PostgreSQL actif (${POSTGRES_CONTAINER})${NC}"
    else
        echo -e "${RED}      [FAIL] PostgreSQL non prêt${NC}"
    fi
else
    docker ps --filter "name=overmind-postgres" --format "{{.Names}}" | grep -q postgres
    if [ $? -eq 0 ]; then
        docker exec overmind-postgres pg_isready -U postgres > /dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}      [OK] OverMind PostgreSQL actif${NC}"
        else
            echo -e "${RED}      [FAIL] PostgreSQL non prêt${NC}"
        fi
    else
        echo -e "${RED}      [FAIL] OverMind PostgreSQL non trouvé${NC}"
    fi
fi

# Test RabbitMQ
echo -e "   • RabbitMQ:"
docker ps --filter "name=overmind-rabbitmq" --format "{{.Names}}" | grep -q rabbitmq
if [ $? -eq 0 ]; then
    echo -e "${GREEN}      [OK] RabbitMQ actif${NC}"
else
    echo -e "${RED}      [FAIL] RabbitMQ non trouvé${NC}"
fi

# Test Temporal
echo -e "   • Temporal:"
echo -e "${YELLOW}      [INFO] Désactivé (requiert init DB)${NC}"

# Test Prometheus
echo -e "   • Prometheus:"
docker ps --filter "name=overmind-prometheus" --format "{{.Names}}" | grep -q prometheus
if [ $? -eq 0 ]; then
    echo -e "${GREEN}      [OK] Prometheus actif${NC}"
else
    echo -e "${RED}      [FAIL] Prometheus non trouvé${NC}"
fi

# Test Grafana
echo -e "   • Grafana:"
docker ps --filter "name=overmind-grafana" --format "{{.Names}}" | grep -q grafana
if [eq $? -eq 0 ]; then
    echo -e "${GREEN}      [OK] Grafana actif${NC}"
else
    echo -e "${RED}      [FAIL] Grafana non trouvé${NC}"
fi

# Test Jaeger
echo -e "   • Jaeger:"
docker ps --filter "name=overmind-jaeger" --format "{{.Names}}" | grep -q jaeger
if [ $? -eq 0 ]; then
    echo -e "${GREEN}      [OK] Jaeger actif${NC}"
else
    echo -e "${RED}      [FAIL] Jaeger non trouvé${NC}"
fi

echo ""
echo -e "${GREEN}***************************************************************${NC}"
echo -e "${GREEN}*                                                             *${NC}"
echo -e "${GREEN}*        ✅ INSTALLATION TERMINÉE !                            *${NC}"
echo -e "${GREEN}*                                                             *${NC}"
echo -e "${GREEN}***************************************************************${NC}"
echo ""
echo -e "${YELLOW}[SERVICES ACTIFS]"
echo ""
echo "    Ouvrez Docker Desktop → onglet Containers"
echo ""
echo "    URLs utiles:"
echo "       • Prometheus:  http://localhost:9090"
echo "       • Grafana:      http://localhost:3000 (admin/admin)"
echo "       • Jaeger:       http://localhost:16686"
echo "       • RabbitMQ:    http://localhost:15672 (guest/guest)"
echo "       • Temporal:     http://localhost:8233"
echo ""
echo -e "${YELLOW}[PROCHAINE ÉTAPE]"
echo ""
echo "    • Créez votre premier agent: overmind create-agent"
echo "    • Ou listez les agents: overmind list-agents"
echo ""
