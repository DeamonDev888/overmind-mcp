#!/usr/bin/env bash
# ============================================================
# install-overmind-native.sh
# Installation OverMind-MCP + Postgres-MCP — mode NATIF (sans Docker)
# Pour Ubuntu 26.04+ avec PostgreSQL 18 + pgvector + systemd
# Idempotent : peut être ré-exécuté sans casser l'existant.
# ============================================================

set -euo pipefail

# ---------- Couleurs ----------
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; N='\033[0m'

log()  { echo -e "${C}[$(date +%H:%M:%S)]${N} $*"; }
ok()   { echo -e "${G}[OK]${N} $*"; }
warn() { echo -e "${Y}[WARN]${N} $*"; }
die()  { echo -e "${R}[FAIL]${N} $*"; exit 1; }

# ---------- Constantes ----------
OM_USER="${SUDO_USER:-$(whoami)}"
# Multi-OS home resolution (Linux: getent, macOS: dscl, fallback: eval ~)
if command -v getent >/dev/null 2>&1; then
  OM_HOME="$(getent passwd "$OM_USER" | cut -d: -f6)"
elif command -v dscl >/dev/null 2>&1; then
  OM_HOME="$(dscl . -read "/Users/$OM_USER" NFSHomeDirectory | awk '{print $2}')"
else
  OM_HOME="$(eval echo "~$OM_USER")"
fi
OM_DIR="$OM_HOME/.overmind"
LOG_DIR="$OM_DIR/logs"
PG_DB="overmind_memory"
PG_PORT=5432
MCP_PORT_CORE=3099
MCP_PORT_PG=5433

[ "$(id -u)" -ne 0 ] && die "Lancer avec sudo : sudo $0"
[ -z "$OM_USER" ] || [ -z "$OM_HOME" ] && die "Impossible de déterminer l'utilisateur"

log "Installation pour user=$OM_USER home=$OM_HOME"

# ============================================================
# STEP 1/6 — Vérification Node.js + npm
# ============================================================
log "STEP 1/6 : Node.js"
command -v node >/dev/null || die "Node.js manquant : curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs"
NODE_MAJ=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJ" -ge 20 ] || die "Node >= 20 requis (vous avez $(node -v))"
ok "Node $(node -v) / npm $(npm -v)"

# ============================================================
# STEP 2/6 — PostgreSQL + pgvector (multi-OS)
# ============================================================
log "STEP 2/6 : PostgreSQL + pgvector"

OS_TYPE="$(uname -s)"

if [ "$OS_TYPE" = "Darwin" ]; then
    # ─── macOS (Homebrew) ───────────────────────────────────────────────
    if ! command -v brew >/dev/null 2>&1; then
        die "Homebrew non trouvé. Installez-le: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    fi
    if ! brew list postgresql@18 >/dev/null 2>&1; then
        log "Installation postgresql@18 via brew..."
        brew install postgresql@18
    fi
    if ! brew list pgvector >/dev/null 2>&1; then
        log "Installation pgvector via brew..."
        brew install pgvector
    fi
    # Démarrer le service
    brew services start postgresql@18 2>/dev/null || true
    sleep 3
    ok "postgresql@18 + pgvector installés via brew"

elif [ "$OS_TYPE" = "Linux" ]; then
    # ─── Linux (apt / yum / pacman) ────────────────────────────────────
    if command -v apt >/dev/null 2>&1; then
        if ! dpkg -l postgresql-18-pgvector 2>/dev/null | grep -q '^ii'; then
            log "Installation postgresql-18-pgvector via apt..."
            apt update -qq
            DEBIAN_FRONTEND=noninteractive apt install -y postgresql-18-pgvector postgresql-client-18
        fi
    elif command -v yum >/dev/null 2>&1; then
        log "Installation postgresql + pgvector via yum..."
        yum install -y postgresql-server postgresql-contrib pgvector
        postgresql-setup --initdb 2>/dev/null || true
    elif command -v pacman >/dev/null 2>&1; then
        log "Installation postgresql + pgvector via pacman..."
        pacman -S --noconfirm postgresql pgvector
        su - postgres -c "initdb -D /var/lib/postgres/data" 2>/dev/null || true
    else
        die "Gestionnaire de paquets non supporté. Installez PostgreSQL + pgvector manuellement."
    fi

    # Service systemd
    if command -v systemctl >/dev/null 2>&1; then
        if ! systemctl is-active --quiet postgresql; then
            systemctl enable --now postgresql
        fi
        ok "postgresql.service: $(systemctl is-active postgresql)"
    fi
fi

# DB + extension vector (multi-OS)
PG_SUPERUSER="postgres"
if [ "$OS_TYPE" = "Darwin" ]; then
    PG_SUPERUSER="$(whoami)"
fi

if ! psql -U "$PG_SUPERUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" 2>/dev/null | grep -q 1; then
    log "Création DB $PG_DB..."
    createdb -U "$PG_SUPERUSER" "$PG_DB" 2>/dev/null || sudo -u postgres createdb "$PG_DB"
fi
psql -U "$PG_SUPERUSER" -d "$PG_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || sudo -u postgres psql -d "$PG_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null
PGV=$(psql -U "$PG_SUPERUSER" -d "$PG_DB" -tAc "SELECT extversion FROM pg_extension WHERE extname='vector'" 2>/dev/null || echo "?")
ok "DB $PG_DB prête, pgvector v$PGV"

# ============================================================
# STEP 3/6 — Packages npm globaux
# ============================================================
log "STEP 3/6 : npm install -g"
if ! npm list -g overmind-mcp >/dev/null 2>&1; then
    npm install -g overmind-mcp@latest
fi
if ! npm list -g overmind-postgres-mcp >/dev/null 2>&1; then
    npm install -g overmind-postgres-mcp@latest
fi
ok "overmind-mcp $(npm list -g overmind-mcp --depth=0 | awk '/overmind-mcp@/ {print $2}')"
ok "overmind-postgres-mcp $(npm list -g overmind-postgres-mcp --depth=0 | awk '/overmind-postgres-mcp@/ {print $2}')"

# ============================================================
# STEP 4/6 — Arborescence + .env
# ============================================================
log "STEP 4/6 : ~/.overmind/"
mkdir -p "$OM_DIR/logs" "$OM_DIR/config"
chown -R "$OM_USER:$OM_USER" "$OM_DIR"

if [ ! -f "$OM_DIR/.env" ]; then
    log "Création $OM_DIR/.env (template à compléter)..."
    cat > "$OM_DIR/.env" <<'EOF'
# OverMind - Configuration principale (mode natif sans Docker)

# --- PostgreSQL (apt postgresql-18 + pgvector) ---
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=CHANGEME_PG_PASS
POSTGRES_DATABASE=overmind_memory
POSTGRES_SSL=false
POSTGRES_MAX_CONNECTIONS=10

# --- Provider LLM par défaut ---
OVERMIND_DEFAULT_PROVIDER=anthropic

# --- Core ---
OVERMIND_MEMORY_TYPE=postgres
MEMORY_HTTP_PORT=3099
OVERMIND_HTTP_MODE=false
OVERMIND_HTTP_PORT=3099

# --- Embeddings (Qwen 8B, 4096D) ---
OVERMIND_EMBEDDING_DIMENSIONS=4096
OVERMIND_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
OVERMIND_EMBEDDING_URL=https://openrouter.ai/api/v1
# OVERMIND_EMBEDDING_KEY=sk-or-...

# --- Clés LLM (à remplir) ---
# ANTHROPIC_AUTH_TOKEN=...
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# ANTHROPIC_MODEL=claude-sonnet-4-6
# MISTRAL_API_KEY=...
# GLM_API_KEY=...
# ELEVENLABS_API_KEY=...
EOF
    chown "$OM_USER:$OM_USER" "$OM_DIR/.env"
    chmod 600 "$OM_DIR/.env"
    warn "Éditer $OM_DIR/.env et remplir POSTGRES_PASSWORD + clés LLM"
else
    ok ".env existant conservé"
fi

# ============================================================
# STEP 5/6 — Systemd units
# ============================================================
log "STEP 5/6 : systemd units"

write_unit() {
    local name="$1" port="$2" entry="$3"
    cat > "/etc/systemd/system/$name" <<EOF
[Unit]
Description=$name (OverMind)
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=$OM_USER
Group=$OM_USER
WorkingDirectory=$OM_DIR
EnvironmentFile=$OM_DIR/.env
ExecStart=/usr/bin/node --max-old-space-size=256 --no-warnings $entry
Restart=on-failure
RestartSec=5
StandardOutput=append:$LOG_DIR/$name.log
StandardError=append:$LOG_DIR/$name.err

[Install]
WantedBy=multi-user.target
EOF
}

write_unit "overmind-mcp.service" "$MCP_PORT_CORE" \
    "/usr/lib/node_modules/overmind-mcp/dist/bin/cli.js --transport httpStream --port $MCP_PORT_CORE"

write_unit "overmind-postgres-mcp.service" "$MCP_PORT_PG" \
    "/usr/lib/node_modules/overmind-postgres-mcp/dist/index.js"

systemctl daemon-reload
systemctl enable --now overmind-mcp.service overmind-postgres-mcp.service
ok "Services activés et démarrés"

# ============================================================
# STEP 6/6 — Validation HTTP
# ============================================================
log "STEP 6/6 : validation"

sleep 3
test_endpoint() {
    local port="$1" name="$2"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 \
        -H "Accept: application/json, text/event-stream" \
        -H "Content-Type: application/json" \
        -X POST "http://127.0.0.1:$port/mcp" \
        -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' || echo "000")
    if [ "$code" = "200" ]; then
        ok "$name (port $port) : HTTP 200"
    else
        warn "$name (port $port) : HTTP $code — voir $LOG_DIR/$name.err"
    fi
}

test_endpoint "$MCP_PORT_CORE" "overmind-mcp"
test_endpoint "$MCP_PORT_PG"   "overmind-postgres-mcp"

# Test SQL direct
if sudo -u postgres psql -d "$PG_DB" -c "SELECT 1" >/dev/null 2>&1; then
    ok "PostgreSQL $PG_DB accessible en local"
else
    warn "PostgreSQL $PG_DB inaccessible — vérifier sudo -u postgres psql"
fi

echo
echo -e "${G}============================================================${N}"
echo -e "${G}✅ Installation terminée${N}"
echo -e "${G}============================================================${N}"
echo
echo "Endpoints (loopback uniquement) :"
echo "  • overmind-mcp         : http://127.0.0.1:$MCP_PORT_CORE"
echo "  • overmind-postgres-mcp: http://127.0.0.1:$MCP_PORT_PG"
echo
echo "Pour accès distant, utiliser un tunnel SSH :"
echo "  ssh -L 13099:127.0.0.1:$MCP_PORT_CORE -L 15433:127.0.0.1:$MCP_PORT_PG user@host"
echo
echo "Actions manuelles restantes :"
echo "  1. Éditer $OM_DIR/.env et remplir POSTGRES_PASSWORD + clés LLM"
echo "  2. sudo systemctl restart overmind-mcp overmind-postgres-mcp"
echo "  3. (Optionnel) Créer un user Postgres dédié et restreindre pg_hba.conf"
