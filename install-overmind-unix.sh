#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# OVERMIND-MCP - INSTALLATION COMPLÈTE Linux/macOS (Docker)
# ═══════════════════════════════════════════════════════════════════════════════
# Ce script installe et configure TOUT automatiquement :
# - npm install -g overmind-mcp
# - Docker (vérification)
# - PostgreSQL + pgvector (si absent)
# - Infrastructure complète (RabbitMQ, Temporal, Prometheus, Grafana, Jaeger)
# - Validation de tous les services
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

clear
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC} ${WHITE}                                                                ${NC} ${CYAN}║${NC}"
echo -e "${CYAN}║${NC} ${MAGENTA}     🚀 OVERMIND-MCP - INSTALLATION COMPLÈTE                     ${NC} ${CYAN}║${NC}"
echo -e "${CYAN}║${NC} ${WHITE}     Linux/macOS + Docker                                         ${NC} ${CYAN}║${NC}"
echo -e "${CYAN}║${NC} ${WHITE}                                                                ${NC} ${CYAN}║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1: Vérifier Node.js et NPM
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}═════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}║  ÉTAPE 1/7: VÉRIFICATION NODE.JS ET NPM                              ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js non trouvé. Installation requise...${NC}"
    echo -e "${YELLOW}📥 Linux: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -${NC}"
    echo -e "${YELLOW}📥 macOS: brew install node${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js détecté:${NC}"
node --version
echo -e "${GREEN}✅ NPM détecté:${NC}"
npm --version
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2: Installer OverMind-MCP globalement
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}═════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}║  ÉTAPE 2/7: INSTALLATION OVERMIND-MCP                                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}📦 Installation d'overmind-mcp (dernière version)...${NC}"
npm install -g overmind-mcp@latest

echo -e "${GREEN}✅ overmind-mcp installé:${NC}"
npm view overmind-mcp version
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3: Vérifier Docker
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}═════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}║  ÉTAPE 3/7: VÉRIFICATION DOCKER                                      ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker non trouvé.${NC}"
    echo -e "${YELLOW}📥 Linux: https://docs.docker.com/engine/install/${NC}"
    echo -e "${YELLOW}📥 macOS: https://www.docker.com/products/docker-desktop/${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker détecté:${NC}"
docker --version
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4: Installer PostgreSQL + pgvector
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}═════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}║  ÉTAPE 4/7: INSTALLATION POSTGRESQL + PGVECTOR                       ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

npx overmind-mcp install-dependencies
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5: Créer configuration OverMind
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}═════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}║  ÉTAPE 5/7: CONFIGURATION OVERMIND                                  ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

OVERMIND_DIR="$HOME/.overmind"
mkdir -p "$OVERMIND_DIR"

# Créer .env de base
if [ ! -f "$OVERMIND_DIR/.env" ]; then
    echo -e "${YELLOW}📝 Création configuration .env...${NC}"
    cat > "$OVERMIND_DIR/.env" << EOF
# OverMind-MCP Environment Configuration
# Généré par install-overmind-unix.sh

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=overmind_temp_password_change_me
POSTGRES_DB=overmind

# OpenTelemetry (optionnel)
OTEL_ENABLED=false

# Workspace
OVERMIND_WORKSPACE=$OVERMIND_DIR
EOF
    echo -e "${GREEN}✅ Configuration créée:${NC} $OVERMIND_DIR/.env"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 6: Lancer infrastructure Docker complète
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}═════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}║  ÉTAPE 6/7: DÉMARRAGE INFRASTRUCTURE DOCKER                           ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Télécharger docker-compose depuis GitHub
echo -e "${YELLOW}📥 Téléchargement docker-compose.yml...${NC}"
curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.yml -o "$OVERMIND_DIR/docker-compose.yml"
curl -sL https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.exporters.yml -o "$OVERMIND_DIR/docker-compose.exporters.yml"

echo -e "${YELLOW}🚀 Démarrage de l'infrastructure Docker...${NC}"
cd "$OVERMIND_DIR"
docker-compose -f docker-compose.yml up -d

echo ""
sleep 10

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 7: Validation de tous les services
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}═════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}║  ÉTAPE 7/7: VALIDATION DES SERVICES                                  ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}🔍 Vérification des containers Docker...${NC}"
echo ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

echo -e "${YELLOW}🧪 Tests de connexion...${NC}"
echo ""

# Test PostgreSQL
echo -e "${YELLOW}   • PostgreSQL:${NC}"
if docker exec overmind-postgres-pgvector pg_isready -U postgres &> /dev/null; then
    echo -e "${GREEN}      ✅ PostgreSQL actif${NC}"
else
    echo -e "${RED}      ❌ PostgreSQL non prêt${NC}"
fi

# Test RabbitMQ
echo -e "${YELLOW}   • RabbitMQ:${NC}"
if docker ps --filter "name=rabbitmq" --format "{{.Names}}" | grep -q rabbitmq; then
    echo -e "${GREEN}      ✅ RabbitMQ actif${NC}"
else
    echo -e "${RED}      ❌ RabbitMQ non trouvé${NC}"
fi

# Test Temporal
echo -e "${YELLOW}   • Temporal:${NC}"
if docker ps --filter "name=temporal" --format "{{.Names}}" | grep -q temporal; then
    echo -e "${GREEN}      ✅ Temporal actif${NC}"
else
    echo -e "${RED}      ❌ Temporal non trouvé${NC}"
fi

# Test Prometheus
echo -e "${YELLOW}   • Prometheus:${NC}"
if docker ps --filter "name=prometheus" --format "{{.Names}}" | grep -q prometheus; then
    echo -e "${GREEN}      ✅ Prometheus actif${NC}"
else
    echo -e "${RED}      ❌ Prometheus non trouvé${NC}"
fi

# Test Grafana
echo -e "${YELLOW}   • Grafana:${NC}"
if docker ps --filter "name=grafana" --format "{{.Names}}" | grep -q grafana; then
    echo -e "${GREEN}      ✅ Grafana actif${NC}"
else
    echo -e "${RED}      ❌ Grafana non trouvé${NC}"
fi

# Test Jaeger
echo -e "${YELLOW}   • Jaeger:${NC}"
if docker ps --filter "name=jaeger" --format "{{.Names}}" | grep -q jaeger; then
    echo -e "${GREEN}      ✅ Jaeger actif${NC}"
else
    echo -e "${RED}      ❌ Jaeger non trouvé${NC}"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# RÉSUMÉ FINAL
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC} ${WHITE}             ✅ INSTALLATION TERMINÉE AVEC SUCCÈS !                  ${NC} ${GREEN}║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}📋 SERVICES DISPONIBLES:${NC}"
echo ""
echo -e "${CYAN}┌─────────────────────────────────────────────────────────────────┐${NC}"
echo -e "${CYAN}│${NC} ${MAGENTA}Docker:${NC}                                                           ${CYAN}│${NC}"
echo -e "${CYAN}│${NC}   Ouvrez Docker Desktop pour voir tous les containers         ${CYAN}│${NC}"
echo -e "${CYAN}│${NC}                                                                  ${CYAN}│${NC}"
echo -e "${CYAN}│${NC} ${MAGENTA}URLs utiles:${NC}                                                      ${CYAN}│${NC}"
echo -e "${CYAN}│${NC}   • Prometheus: http://localhost:9090                              ${CYAN}│${NC}"
echo -e "${CYAN}│${NC}   • Grafana:      http://localhost:3000 (admin/admin)            ${CYAN}│${NC}"
echo -e "${CYAN}│${NC}   • Jaeger:       http://localhost:16686                           ${CYAN}│${NC}"
echo -e "${CYAN}│${NC}   • RabbitMQ:    http://localhost:15672 (guest/guest)            ${CYAN}│${NC}"
echo -e "${CYAN}│${NC}   • Temporal:     http://localhost:8233                           ${CYAN}│${NC}"
echo -e "${CYAN}└─────────────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${YELLOW}📚 DOCUMENTATION:${NC}"
echo "   • https://github.com/DeamonDev888/overmind-mcp"
echo "   • https://www.npmjs.com/package/overmind-mcp"
echo ""
echo -e "${YELLOW}🎉 PROCHAINE ÉTAPE:${NC}"
echo "   • Lancez: overmind-setup --full"
echo "   • Ou créez votre premier agent: overmind create-agent"
echo ""
