#!/usr/bin/env bash
# ============================================================
# install-overmind-native.sh — Installation NATIVE OverMind-MCP
# Multi-OS: Linux (apt/dnf/pacman) + macOS (Homebrew)
# Idempotent: peut être ré-exécuté sans casser l'existant.
# Anti-cassure: chaque step est gardé, erreurs non-fatales Continuent.
# ============================================================

set -uo pipefail   # PAS de set -e — on gère les erreurs manuellement

# ─── Couleurs + helpers ──────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; B='\033[1m'; D='\033[2m'; N='\033[0m'
STEPS_TOTAL=11
STEP=0

log()    { echo -e "${C}[$(date +%H:%M:%S)]${N} ${D}$*${N}"; }
ok()     { echo -e "  ${G}✓${N} $*"; }
warn()   { echo -e "  ${Y}⚠${N} $*"; }
fail()   { echo -e "  ${R}✗${N} $*"; }
die()    { echo -e "${R}[FATAL]${N} $*"; exit 1; }
step()   { STEP=$((STEP+1)); echo; echo -e "${B}${C}━━━ STEP $STEP/$STEPS_TOTAL — $* ━━━${N}"; }
have()   { command -v "$1" >/dev/null 2>&1; }

# ─── Détection OS ────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) OS_NAME="macOS $ARCH";;
  Linux)  OS_NAME="Linux $ARCH";;
  *)      OS_NAME="$OS $ARCH";;
esac
echo
echo -e "${B}${C}╔════════════════════════════════════════════════════════════╗${N}"
echo -e "${B}${C}║   🚀 OverMind-MCP — Installation NATIVE                   ║${N}"
echo -e "${B}${C}║   Multi-OS: $OS_NAME$(printf '%*s' $((24-${#OS_NAME})) '')║${N}"
echo -e "${B}${C}╚════════════════════════════════════════════════════════════╝${N}"
echo

# ─── Détection utilisateur + home ────────────────────────────
OM_USER="${SUDO_USER:-$(whoami)}"
if have getent; then
  OM_HOME="$(getent passwd "$OM_USER" | cut -d: -f6)"
elif have dscl; then
  OM_HOME="$(dscl . -read "/Users/$OM_USER" NFSHomeDirectory | awk '{print $2}')"
else
  OM_HOME="$(eval echo "~$OM_USER")"
fi
OM_DIR="$OM_HOME/.overmind"
LOG_DIR="$OM_DIR/logs"

# ─── Constantes ──────────────────────────────────────────────
PG_DB="overmind_memory"
PG_PORT=5432
MCP_PORT_CORE=3099
MCP_PORT_PG=5433
ERRORS=0
WARNINGS=0

track_error() { fail "$*"; ERRORS=$((ERRORS+1)); }
track_warn()  { warn "$*"; WARNINGS=$((WARNINGS+1)); }

# ================================================================
# STEP 1/8 — Vérifications préalables (root, OS, arch)
# ================================================================
step "Vérifications préalables"

# Vérifier root/sudo
if [ "$(id -u)" -ne 0 ]; then
  echo -e "  ${Y}ℹ${N}  Lancement en mode non-root — sudo requis pour certaines étapes"
  if ! have sudo; then
    die "sudo non disponible. Lancez en root: sudo $0"
  fi
  SUDO="sudo"
else
  SUDO=""
fi
ok "Privilèges: OK (${OM_USER})"

# Vérifier OS supporté
if [ "$OS" != "Darwin" ] && [ "$OS" != "Linux" ]; then
  die "OS non supporté: $OS. Utilisez le mode Docker: npm i -g overmind-mcp && overmind-postgres-mcp up"
fi
ok "OS: $OS_NAME"

# ================================================================
# STEP 2/8 — Node.js + npm
# ================================================================
step "Node.js + npm"

if ! have node; then
  fail "Node.js non trouvé"
  log "Installation automatique de Node.js LTS..."
  if [ "$OS" = "Darwin" ]; then
    if have brew; then
      brew install node@24 || track_error "brew install node@24 a échoué"
    else
      track_error "Homebrew manquant. Installez Node: https://nodejs.org/"
    fi
  else
    if have curl; then
      curl -fsSL https://deb.nodesource.com/setup_lts.x | $SUDO -E bash - 2>/dev/null || true
      $SUDO apt install -y nodejs 2>/dev/null || track_error "apt install nodejs a échoué"
    else
      track_error "curl manquant pour installer Node.js"
    fi
  fi
fi

if have node; then
  NODE_VER="$(node -v)"
  NODE_MAJ="${NODE_VER#v}"
  NODE_MAJ="${NODE_MAJ%%.*}"
  ok "Node.js: ${NODE_VER}"
  if [ "$NODE_MAJ" -lt 20 ]; then
    track_error "Node >= 20 requis (vous avez ${NODE_VER})"
  elif [ "$NODE_MAJ" -ge 25 ]; then
    track_warn "Node ${NODE_VER} — overmind-postgres-mcp préfère Node 24"
    if [ -d "$OM_HOME/.nvm" ]; then
      log "Bascule nvm → Node 24..."
      \. "$OM_HOME/.nvm/nvm.sh" 2>/dev/null || true
      nvm install 24 2>/dev/null && nvm use 24 2>/dev/null && hash -r || true
      ok "Node $(node -v) actif via nvm"
    fi
  fi
else
  die "Node.js toujours manquant après tentative d'installation"
fi

if have npm; then
  ok "npm: $(npm -v)"
else
  die "npm non trouvé"
fi

# ================================================================
# STEP 3/8 — PostgreSQL + pgvector
# ================================================================
step "PostgreSQL + pgvector"

PG_INSTALLED=false
PG_SUPERUSER="postgres"

if [ "$OS" = "Darwin" ]; then
  # ─── macOS: Homebrew ─────────────────────────────────────────
  PG_SUPERUSER="$(whoami)"

  if ! have brew; then
    track_warn "Homebrew non trouvé — installez: https://brew.sh"
    track_warn "Bypass: installez Docker et utilisez overmind-postgres-mcp up"
  else
    # PostgreSQL — brew a postgresql@17 en stable, @18 peut ne pas exister encore
    PG_BREW_VER=""
    for pgver in postgresql@18 postgresql@17 postgresql@16 postgresql@15 postgresql@14 postgresql; do
      if brew list "$pgver" >/dev/null 2>&1; then
        PG_BREW_VER="$pgver"
        ok "$pgver déjà installé"
        break
      fi
    done
    if [ -z "$PG_BREW_VER" ]; then
      log "Installation PostgreSQL via brew (dernière version stable)..."
      brew install postgresql 2>/dev/null && PG_BREW_VER="postgresql" || {
        # Fallback: essayer les versions numérotées
        for pgver in postgresql@17 postgresql@16 postgresql@15; do
          log "Tentative $pgver..."
          brew install "$pgver" 2>/dev/null && PG_BREW_VER="$pgver" && break
        done
      }
      if [ -z "$PG_BREW_VER" ]; then
        track_error "brew install postgresql a échoué"
      fi
    fi

    # pgvector
    if brew list pgvector >/dev/null 2>&1; then
      ok "pgvector déjà installé"
    else
      log "Installation pgvector via brew..."
      brew install pgvector 2>/dev/null || {
        track_warn "pgvector non disponible via brew — compilation depuis source..."
        (
          cd /tmp && git clone --depth 1 https://github.com/pgvector/pgvector.git 2>/dev/null && \
          cd pgvector && make 2>/dev/null && make install 2>/dev/null
        ) && ok "pgvector compilé depuis source" || track_warn "pgvector compilation échouée"
      }
    fi

    # Démarrer le service
    if [ -n "$PG_BREW_VER" ]; then
      brew services start "$PG_BREW_VER" 2>/dev/null || true
      sleep 3
      PG_INSTALLED=true
      ok "Service $PG_BREW_VER démarré via brew"
    fi
  fi

elif [ "$OS" = "Linux" ]; then
  # ─── Linux: apt / dnf / pacman ──────────────────────────────
  if have apt; then
    log "Gestionnaire: apt (Debian/Ubuntu)"
    $SUDO apt update -qq 2>/dev/null || true
    if dpkg -l 2>/dev/null | grep -q 'postgresql.*18.*pgvector'; then
      ok "postgresql-18-pgvector déjà installé"
      PG_INSTALLED=true
    else
      log "Installation postgresql + pgvector..."
      DEBIAN_FRONTEND=noninteractive $SUDO apt install -y postgresql postgresql-contrib 2>/dev/null || track_error "apt install postgresql"
      # pgvector (peut nécessiter un PPA)
      DEBIAN_FRONTEND=noninteractive $SUDO apt install -y postgresql-18-pgvector 2>/dev/null || {
        track_warn "postgresql-18-pgvector non disponible via apt"
        log "Tentative compilation pgvector depuis source..."
        $SUDO apt install -y build-essential postgresql-server-dev-all git 2>/dev/null || true
        (
          cd /tmp && git clone --depth 1 https://github.com/pgvector/pgvector.git 2>/dev/null && \
          cd pgvector && make 2>/dev/null && $SUDO make install 2>/dev/null
        ) || track_warn "Compilation pgvector échouée — voir docs"
      }
      PG_INSTALLED=true
    fi

  elif have dnf; then
    log "Gestionnaire: dnf (Fedora/RHEL)"
    $SUDO dnf install -y postgresql-server postgresql-contrib 2>/dev/null || track_error "dnf install postgresql"
    $SUDO postgresql-setup --initdb 2>/dev/null || true
    PG_INSTALLED=true
    # pgvector
    $SUDO dnf install -y pgvector 2>/dev/null || track_warn "pgvector non disponible via dnf"

  elif have pacman; then
    log "Gestionnaire: pacman (Arch)"
    $SUDO pacman -S --noconfirm postgresql 2>/dev/null || track_error "pacman install postgresql"
    $SUDO pacman -S --noconfirm pgvector 2>/dev/null || track_warn "pgvector non disponible via pacman"
    $SUDO su - postgres -c "initdb -D /var/lib/postgres/data" 2>/dev/null || true
    PG_INSTALLED=true

  elif have apk; then
    log "Gestionnaire: apk (Alpine)"
    $SUDO apk add postgresql postgresql-contrib 2>/dev/null || track_error "apk install postgresql"
    PG_INSTALLED=true

  else
    track_error "Gestionnaire de paquets non supporté. Installez PostgreSQL manuellement."
  fi

  # Service systemd
  if have systemctl; then
    if ! $SUDO systemctl is-active --quiet postgresql 2>/dev/null; then
      log "Démarrage postgresql.service..."
      $SUDO systemctl enable --now postgresql 2>/dev/null || track_warn "systemctl start postgresql"
      sleep 2
    fi
    ok "postgresql.service: $($SUDO systemctl is-active postgresql 2>/dev/null || echo '?')"
  fi
fi

# ================================================================
# STEP 4/8 — Base de données + extension pgvector
# ================================================================
step "Base de données + pgvector"

if [ "$PG_INSTALLED" = "true" ]; then
  # Wait for PostgreSQL to be ready (max 15s)
  log "Attente démarrage PostgreSQL..."
  PG_READY=false
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if [ "$OS" = "Darwin" ]; then
      if psql -U "$PG_SUPERUSER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
        PG_READY=true; break
      fi
    else
      if $SUDO -u postgres psql -c "SELECT 1" >/dev/null 2>&1; then
        PG_READY=true; break
      fi
    fi
    sleep 2
  done

  if [ "$PG_READY" = "true" ]; then
    ok "PostgreSQL prêt"
  else
    track_warn "PostgreSQL ne répond pas après 20s"
  fi

  # Créer la DB si elle n'existe pas
  DB_EXISTS=false
  if [ "$OS" = "Darwin" ]; then
    if psql -U "$PG_SUPERUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" 2>/dev/null | grep -q 1; then
      DB_EXISTS=true
    fi
  else
    if $SUDO -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" 2>/dev/null | grep -q 1; then
      DB_EXISTS=true
    fi
  fi

  if [ "$DB_EXISTS" = "false" ]; then
    log "Création DB $PG_DB..."
    if [ "$OS" = "Darwin" ]; then
      createdb -U "$PG_SUPERUSER" "$PG_DB" 2>/dev/null || track_warn "createdb échoué"
    else
      $SUDO -u postgres createdb "$PG_DB" 2>/dev/null || track_warn "createdb échoué"
    fi
  else
    ok "DB $PG_DB existe déjà"
  fi

  # Activer pgvector
  if [ "$OS" = "Darwin" ]; then
    psql -U "$PG_SUPERUSER" -d "$PG_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || track_warn "CREATE EXTENSION vector échoué"
    PGV="$(psql -U "$PG_SUPERUSER" -d "$PG_DB" -tAc "SELECT extversion FROM pg_extension WHERE extname='vector'" 2>/dev/null || echo '?')"
  else
    $SUDO -u postgres psql -d "$PG_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || track_warn "CREATE EXTENSION vector échoué"
    PGV="$($SUDO -u postgres psql -d "$PG_DB" -tAc "SELECT extversion FROM pg_extension WHERE extname='vector'" 2>/dev/null || echo '?')"
  fi

  if [ "$PGV" != "?" ]; then
    ok "pgvector v${PGV} activé sur $PG_DB"
  else
    track_warn "pgvector non détecté — extension vector peut nécessiter une installation manuelle"
  fi

  # Tester la connexion
  if [ "$OS" = "Darwin" ]; then
    if psql -U "$PG_SUPERUSER" -d "$PG_DB" -c "SELECT 1" >/dev/null 2>&1; then
      ok "Connexion PostgreSQL: OK (user=$PG_SUPERUSER)"
    else
      track_warn "Connexion PostgreSQL échouée en local"
    fi
  else
    if $SUDO -u postgres psql -d "$PG_DB" -c "SELECT 1" >/dev/null 2>&1; then
      ok "Connexion PostgreSQL: OK (user=postgres)"
    else
      track_warn "Connexion PostgreSQL échouée"
    fi
  fi
else
  track_warn "PostgreSQL non installé — utilisez Docker: overmind-postgres-mcp up"
fi

# ================================================================
# STEP 5/8 — Packages npm globaux
# ================================================================
step "Packages npm globaux"

log "Vérification overmind-mcp..."
if npm list -g overmind-mcp >/dev/null 2>&1; then
  ok "overmind-mcp: $(npm list -g overmind-mcp --depth=0 2>/dev/null | grep overmind-mcp | head -1 | awk -F@ '{print $NF}')"
else
  log "Installation overmind-mcp..."
  $SUDO npm install -g overmind-mcp@latest 2>/dev/null || npm install -g overmind-mcp@latest 2>/dev/null || track_error "npm install overmind-mcp"
fi

log "Vérification overmind-postgres-mcp..."
if npm list -g overmind-postgres-mcp >/dev/null 2>&1; then
  ok "overmind-postgres-mcp: installé"
else
  log "Installation overmind-postgres-mcp..."
  $SUDO npm install -g overmind-postgres-mcp@latest 2>/dev/null || npm install -g overmind-postgres-mcp@latest 2>/dev/null || track_warn "overmind-postgres-mcp (non bloquant)"
fi

ok "Packages npm globaux: vérifiés"

# ================================================================
# STEP 6/8 — Arborescence ~/.overmind/ + .env
# ================================================================
step "Arborescence ~/.overmind/"

mkdir -p "$OM_DIR/logs" "$OM_DIR/config" "$OM_DIR/bridge/wrappers" 2>/dev/null || true
ok "Dossiers créés: $OM_DIR"

# .env
ENV_FILE="$OM_DIR/.env"
ENV_PASSWORD=""
if [ ! -f "$ENV_FILE" ]; then
  log "Création .env avec password aléatoire..."
  ENV_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24 2>/dev/null || echo 'overmind_temp_'$RANDOM)"
  cat > "$ENV_FILE" <<ENVEOF
# OverMind-MCP — Configuration (mode natif)
# Généré le $(date)

# ─── PostgreSQL ───
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=${PG_PORT}
POSTGRES_USER=${PG_SUPERUSER}
POSTGRES_PASSWORD=${ENV_PASSWORD}
POSTGRES_DATABASE=${PG_DB}
POSTGRES_SSL=false

# ─── OverMind Core ───
OVERMIND_WORKSPACE=${OM_DIR}
OVERMIND_MEMORY_TYPE=postgres
OVERMIND_LOG_LEVEL=info

# ─── Ports MCP ───
MEMORY_HTTP_PORT=${MCP_PORT_CORE}
OVERMIND_HTTP_MODE=false
OVERMIND_HTTP_PORT=${MCP_PORT_CORE}

# ─── Embeddings (Qwen 8B, 4096D) ───
OVERMIND_EMBEDDING_DIMENSIONS=4096
OVERMIND_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
# OVERMIND_EMBEDDING_URL=https://openrouter.ai/api/v1
# OVERMIND_EMBEDDING_KEY=sk-or-...

# ─── Clés LLM (à remplir) ───
# ANTHROPIC_AUTH_TOKEN=...
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# ANTHROPIC_MODEL=claude-sonnet-4-6
ENVEOF
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  ok ".env créé avec password aléatoire"
  warn "⚠️  POSTGRES_PASSWORD stocké dans $ENV_FILE"
else
  ok ".env existant conservé"
  ENV_PASSWORD="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
  if [ -z "$ENV_PASSWORD" ] || echo "$ENV_PASSWORD" | grep -qi 'change'; then
    track_warn "POSTGRES_PASSWORD vide ou 'change_me' dans .env"
  fi
fi

# .mcp.json (minimal si absent)
MCP_FILE="$OM_DIR/.mcp.json"
if [ ! -f "$MCP_FILE" ]; then
  log "Création .mcp.json..."
  cat > "$MCP_FILE" <<MCPEOF
{
  "mcpServers": {
    "memory": {
      "transport": "httpStream",
      "url": "http://localhost:${MCP_PORT_CORE}/mcp"
    },
    "postgres": {
      "transport": "httpStream",
      "url": "http://localhost:${MCP_PORT_PG}/mcp"
    }
  }
}
MCPEOF
  ok ".mcp.json créé"
else
  ok ".mcp.json existant"
fi

# Permissions
if [ "$OS" = "Darwin" ]; then
  chown -R "$OM_USER:staff" "$OM_DIR" 2>/dev/null || true
else
  chown -R "$OM_USER:$OM_USER" "$OM_DIR" 2>/dev/null || true
fi

# ================================================================
# STEP 7/8 — Services système (systemd / launchd)
# ================================================================
step "Services système"

if [ "$OS" = "Linux" ] && have systemctl; then
  # ─── Linux: systemd units ───────────────────────────────────
  NODE_BIN="$(which node)"
  NPM_GLOBAL="$(npm root -g 2>/dev/null || echo /usr/lib/node_modules)"

  write_unit() {
    local name="$1" entry="$2"
    cat > "/etc/systemd/system/$name" <<UNIT
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
ExecStart=$NODE_BIN --max-old-space-size=256 --no-warnings $entry
Restart=on-failure
RestartSec=5
StandardOutput=append:$LOG_DIR/${name%.service}.log
StandardError=append:$LOG_DIR/${name%.service}.err

[Install]
WantedBy=multi-user.target
UNIT
    ok "Unit $name écrit"
  }

  write_unit "overmind-mcp.service" \
    "$NPM_GLOBAL/overmind-mcp/dist/bin/cli.js --transport httpStream --port $MCP_PORT_CORE"

  if npm list -g overmind-postgres-mcp >/dev/null 2>&1; then
    write_unit "overmind-postgres-mcp.service" \
      "$NPM_GLOBAL/overmind-postgres-mcp/dist/index.js"
  fi

  $SUDO systemctl daemon-reload

  # ─── Gestion des conflits de port ────────────────────────────
  # Tue UNIQUEMENT les zombies/doublons, jamais un service sain.
  for port in $MCP_PORT_CORE $MCP_PORT_PG; do
    # Récupérer TOUS les PIDs sur ce port
    PIDS_ON_PORT=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null || ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -5)

    if [ -n "$PIDS_ON_PORT" ]; then
      PID_COUNT=$(echo "$PIDS_ON_PORT" | wc -w)

      for pid in $PIDS_ON_PORT; do
        [ -z "$pid" ] && continue

        # Vérifier si c'est un process zombie (Z état)
        PID_STATE=$(ps -o stat= -p "$pid" 2>/dev/null | head -1)
        PID_CMD=$(ps -o args= -p "$pid" 2>/dev/null | head -1)

        # Cas 1: Zombie → kill certain
        if echo "$PID_STATE" | grep -q 'Z'; then
          warn "Port :$port — PID $pid est un ZOMBIE → kill"
          kill -9 "$pid" 2>/dev/null || $SUDO kill -9 "$pid" 2>/dev/null || true
          sleep 1
          continue
        fi

        # Cas 2: Pas un process overmind/node → doublon parasite → kill
        if ! echo "$PID_CMD" | grep -qE 'overmind|cli\.js|dist/index\.js'; then
          warn "Port :$port — PID $pid est un doublon parasite ($PID_CMD) → kill"
          kill "$pid" 2>/dev/null || $SUDO kill "$pid" 2>/dev/null || true
          sleep 2
          continue
        fi

        # Cas 3: Doublon (plusieurs process overmind sur le même port)
        if [ "$PID_COUNT" -gt 1 ]; then
          warn "Port :$port — doublon détecté ($PID_COUNT process) → kill du plus ancien ($pid)"
          kill "$pid" 2>/dev/null || $SUDO kill "$pid" 2>/dev/null || true
          sleep 2
          continue
        fi

        # Cas 4: Process overmind unique et sain → on garde, systemd fera un restart
        ok "Port :$port — PID $pid (overmind sain) — préservé, systemd takeover"
      done

      # Vérification finale
      sleep 1
      PID_AFTER=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)
      if [ -n "$PID_AFTER" ]; then
        AFTER_CMD=$(ps -o args= -p "$PID_AFTER" 2>/dev/null | head -1)
        if echo "$AFTER_CMD" | grep -qE 'overmind|cli\.js|dist/index\.js'; then
          ok "Port :$port — process overmind sain conservé (PID $PID_AFTER)"
        else
          track_warn "Port :$port — toujours occupé par un process non-overmind"
        fi
      else
        ok "Port :$port libéré"
      fi
    fi
  done

  $SUDO systemctl enable --now overmind-mcp.service 2>/dev/null || track_warn "systemctl enable overmind-mcp"
  ok "overmind-mcp.service: $($SUDO systemctl is-active overmind-mcp.service 2>/dev/null || echo '?')"

  if npm list -g overmind-postgres-mcp >/dev/null 2>&1; then
    $SUDO systemctl enable --now overmind-postgres-mcp.service 2>/dev/null || track_warn "systemctl enable overmind-postgres-mcp"
    ok "overmind-postgres-mcp.service: $($SUDO systemctl is-active overmind-postgres-mcp.service 2>/dev/null || echo '?')"
  fi

elif [ "$OS" = "Darwin" ]; then
  # ─── macOS: launchd plist ───────────────────────────────────
  NODE_BIN="$(which node)"
  NPM_GLOBAL="$(npm root -g 2>/dev/null || echo /usr/local/lib/node_modules)"
  LAUNCH_DIR="$OM_HOME/Library/LaunchAgents"
  mkdir -p "$LAUNCH_DIR" 2>/dev/null || true

  write_plist() {
    local name="$1" entry="$2" port="$3"
    local plist="$LAUNCH_DIR/com.overmind.${name}.plist"
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.overmind.${name}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>--max-old-space-size=256</string>
    <string>--no-warnings</string>
    <string>${entry}</string>
    <string>--transport</string>
    <string>httpStream</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>WorkingDirectory</key><string>${OM_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${OM_HOME}</string>
  </dict>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${LOG_DIR}/${name}.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/${name}.err</string>
</dict>
</plist>
PLIST
    launchctl bootout gui/$(id -u) "$plist" 2>/dev/null || true
    launchctl bootstrap gui/$(id -u) "$plist" 2>/dev/null || true

    # ─── Gestion des conflits de port (macOS) ───────────────────
    # Tue UNIQUEMENT zombies/doublons, jamais un process overmind sain.
    PIDS_ON_PORT=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null)
    if [ -n "$PIDS_ON_PORT" ]; then
      PID_COUNT=$(echo "$PIDS_ON_PORT" | wc -w)
      for pid in $PIDS_ON_PORT; do
        [ -z "$pid" ] && continue
        PID_STATE=$(ps -o stat= -p "$pid" 2>/dev/null | head -1)
        PID_CMD=$(ps -o args= -p "$pid" 2>/dev/null | head -1)

        # Cas 1: Zombie → kill
        if echo "$PID_STATE" | grep -q 'Z'; then
          warn "Port :$port — PID $pid est un ZOMBIE → kill"
          kill -9 "$pid" 2>/dev/null || true
          sleep 1
          continue
        fi

        # Cas 2: Process non-overmind → parasite → kill
        if ! echo "$PID_CMD" | grep -qE 'overmind|cli\.js|dist/index\.js'; then
          warn "Port :$port — PID $pid parasite ($PID_CMD) → kill"
          kill "$pid" 2>/dev/null || true
          sleep 2
          continue
        fi

        # Cas 3: Doublon overmind
        if [ "$PID_COUNT" -gt 1 ]; then
          warn "Port :$port — doublon ($PID_COUNT process) → kill $pid"
          kill "$pid" 2>/dev/null || true
          sleep 2
          continue
        fi

        # Cas 4: overmind sain unique → préservé
        ok "Port :$port — PID $pid (overmind sain) préservé"
      done

      sleep 1
      PID_AFTER=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)
      if [ -z "$PID_AFTER" ]; then
        ok "Port :$port libéré"
        # Re-bootstrap après libération
        launchctl bootstrap gui/$(id -u) "$plist" 2>/dev/null || true
      fi
    fi
    ok "launchd: com.overmind.${name} chargé"
  }

  write_plist "overmind-mcp" \
    "$NPM_GLOBAL/overmind-mcp/dist/bin/cli.js" "$MCP_PORT_CORE"

  if npm list -g overmind-postgres-mcp >/dev/null 2>&1; then
    write_plist "overmind-postgres-mcp" \
      "$NPM_GLOBAL/overmind-postgres-mcp/dist/index.js" "$MCP_PORT_PG"
  fi

else
  warn "OS non Linux/macOS — pas de service système. Démarrez manuellement:"
  echo "    node $NPM_GLOBAL/overmind-mcp/dist/bin/cli.js --transport httpStream --port $MCP_PORT_CORE"
fi

# ================================================================
# STEP 8/10 — Vérification + MAJ des CLIs runners
# ================================================================
step "CLIs runners (claude, kilo, hermes, gemini, etc.)"

# ─── Hermes ───────────────────────────────────────────────────
if have hermes; then
  HERMES_VER="$(hermes version 2>/dev/null || echo '?')"
  ok "Hermes: ${HERMES_VER}"
  log "Vérification MAJ Hermes..."
  hermes update 2>/dev/null && ok "Hermes mis à jour" || ok "Hermes déjà à jour"
else
  log "Installation Hermes..."
  if have pip3; then
    $SUDO pip3 install -U hermes-agent 2>/dev/null || pip3 install -U hermes-agent 2>/dev/null || track_warn "pip3 install hermes-agent"
    ok "Hermes installé via pip3"
  elif have pip; then
    $SUDO pip install -U hermes-agent 2>/dev/null || pip install -U hermes-agent 2>/dev/null || track_warn "pip install hermes-agent"
    ok "Hermes installé via pip"
  else
    track_warn "Hermes non installé — pip3 manquant (pip3 install hermes-agent)"
  fi
fi

# ─── Claude CLI ───────────────────────────────────────────────
if have claude; then
  CLAUDE_VER="$(claude --version 2>/dev/null || echo '?')"
  ok "Claude CLI: ${CLAUDE_VER}"
  log "Vérification MAJ Claude..."
  npm install -g @anthropic-ai/claude-code@latest 2>/dev/null && ok "Claude CLI mis à jour" || ok "Claude CLI déjà à jour"
else
  log "Claude CLI non détecté (optionnel — npm i -g @anthropic-ai/claude-code)"
fi

# ─── Kilo Code ────────────────────────────────────────────────
if have kilo; then
  KILO_VER="$(kilo --version 2>/dev/null || echo '?')"
  ok "Kilo Code: ${KILO_VER}"
else
  log "Kilo Code non détecté (optionnel)"
fi

# ─── Gemini CLI (optionnel, pas affiché) ─────────────────────
if have gemini; then
  log "Gemini CLI détecté (optionnel)"
fi

# ─── Autres CLIs (optionnel, pas affiché) ────────────────────
for cli in opencode openclaw cline qwencli; do
  have "$cli" && log "${cli} détecté (optionnel)"
done

ok "CLIs runners vérifiés"

# ================================================================
# STEP 9/10 — MAJ overmind-mcp + dependencies npm
# ================================================================
step "MAJ packages npm (overmind + deps)"

# Récupérer le path global npm
NPM_GLOBAL="$(npm root -g 2>/dev/null || echo /usr/lib/node_modules)"
NPM_BIN="$(npm bin -g 2>/dev/null || dirname "$(which npm)")"

log "MAJ overmind-mcp..."
npm install -g overmind-mcp@latest 2>/dev/null && ok "overmind-mcp mis à jour" || ok "overmind-mcp déjà à jour"

log "MAJ overmind-postgres-mcp..."
npm install -g overmind-postgres-mcp@latest 2>/dev/null && ok "overmind-postgres-mcp mis à jour" || ok "overmind-postgres-mcp déjà à jour"

# Vérifier les versions installées
OM_VER="$(npm list -g overmind-mcp --depth=0 2>/dev/null | grep 'overmind-mcp@' | awk -F@ '{print $NF}' || echo '?')"
PGM_VER="$(npm list -g overmind-postgres-mcp --depth=0 2>/dev/null | grep 'overmind-postgres-mcp@' | awk -F@ '{print $NF}' || echo '?')"
ok "overmind-mcp: v${OM_VER}"
ok "overmind-postgres-mcp: v${PGM_VER}"

# ================================================================
# STEP 10/11 — Audit arborescence agents (~/.overmind/hermes/profiles/)
# ================================================================
step "Audit arborescence agents"

PROFILES_DIR="$OM_DIR/hermes/profiles"

if [ ! -d "$PROFILES_DIR" ]; then
  warn "Dossier profiles/ absent — aucun agent configuré"
  log "Création de la structure canonique..."
  mkdir -p "$PROFILES_DIR" "$OM_DIR/hermes/distributions" "$OM_DIR/bridge/wrappers" 2>/dev/null || true
  ok "Structure ~/.overmind/hermes/ créée"
else
  ok "Dossier profiles/ trouvé"
fi

# Lister les profils existants
PROFILE_COUNT=0
if [ -d "$PROFILES_DIR" ]; then
  PROFILE_COUNT=$(find "$PROFILES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
fi

if [ "$PROFILE_COUNT" -eq 0 ]; then
  warn "Aucun profil agent dans ~/.overmind/hermes/profiles/"
  log "Créez un agent avec: overmind create-agent --name <name> --prompt '...' --runner hermes"
else
  log "Audit de $PROFILE_COUNT profil(s)..."
  echo

  # Pour chaque profil, vérifier les fichiers requis
  for profile_path in "$PROFILES_DIR"/*/; do
    [ -d "$profile_path" ] || continue
    pname=$(basename "$profile_path")
    echo -e "  ${C}▸ ${pname}${N}"

    # Fichiers requis (v3.1)
    PROFILE_OK=true

    # config.yaml (OBLIGATOIRE)
    if [ -f "${profile_path}config.yaml" ]; then
      ok "${pname}/config.yaml"
    else
      fail "${pname}/config.yaml MANQUANT"
      PROFILE_OK=false
    fi

    # SOUL.md (prompt système)
    if [ -f "${profile_path}SOUL.md" ]; then
      SOUL_SIZE=$(wc -c < "${profile_path}SOUL.md" 2>/dev/null | tr -d ' ')
      if [ "$SOUL_SIZE" -lt 50 ]; then
        track_warn "${pname}/SOUL.md trop petit (${SOUL_SIZE} bytes)"
      else
        ok "${pname}/SOUL.md (${SOUL_SIZE} bytes)"
      fi
    else
      track_warn "${pname}/SOUL.md MANQUANT — l'agent n'a pas de prompt système"
    fi

    # .env (secrets du profil)
    if [ -f "${profile_path}.env" ]; then
      ok "${pname}/.env"
    else
      track_warn "${pname}/.env MANQUANT — clés LLM manquantes"
    fi

    # profile.yaml (kanban — OBLIGATOIRE v3.1)
    if [ -f "${profile_path}profile.yaml" ]; then
      ok "${pname}/profile.yaml"
    else
      track_warn "${pname}/profile.yaml MANQUANT — kanban router sera aveugle"
    fi

    # workspace.yaml
    if [ -f "${profile_path}workspace.yaml" ]; then
      ok "${pname}/workspace.yaml"
    else
      track_warn "${pname}/workspace.yaml MANQUANT — workspace kind inconnu"
    fi

    # state.db (sessions)
    if [ -f "${profile_path}state.db" ]; then
      ok "${pname}/state.db (sessions)"
    else
      log "${D}  ${pname}/state.db non créé (sera créé au premier run)${N}"
    fi

    # .mcp.json (MCP servers override)
    if [ -f "${profile_path}.mcp.json" ]; then
      ok "${pname}/.mcp.json (MCP override)"
    else
      log "${D}  ${pname}/.mcp.json absent (utilisera le global)${N}"
    fi

    # skills/ (optionnel)
    if [ -d "${profile_path}skills" ]; then
      SKILL_COUNT=$(find "${profile_path}skills" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
      if [ "$SKILL_COUNT" -gt 0 ]; then
        ok "${pname}/skills/ (${SKILL_COUNT} skill(s))"
      fi
    fi

    # memories/ (optionnel)
    if [ -f "${profile_path}memories/MEMORY.md" ]; then
      ok "${pname}/memories/MEMORY.md"
    fi

    # auth.json (cache credentials — vérifier pas stale)
    if [ -f "${profile_path}auth.json" ]; then
      AUTH_AGE=$(($(date +%s) - $(stat -f %m "${profile_path}auth.json" 2>/dev/null || stat -c %Y "${profile_path}auth.json" 2>/dev/null || echo 0)))
      if [ "$AUTH_AGE" -gt 604800 ]; then
        track_warn "${pname}/auth.json stale (${AUTH_AGE}s — >7j). Peut causer des 401/429."
      else
        ok "${pname}/auth.json (récent)"
      fi
    fi

    echo
  done
fi

# Vérifier la structure globale ~/.overmind/
echo -e "  ${C}Structure globale:${N}"
for check_dir in "bridge" "logs" "hermes/profiles" "hermes/distributions"; do
  if [ -d "$OM_DIR/$check_dir" ]; then
    ok "~/.overmind/${check_dir}/"
  else
    track_warn "~/.overmind/${check_dir}/ MANQUANT"
    mkdir -p "$OM_DIR/$check_dir" 2>/dev/null || true
  fi
done

# Vérifier les symlinks cassés (runs/, agents/ legacy)
for legacy_link in "hermes/runs" "hermes/agents" "hermes/sessions"; do
  if [ -L "$OM_DIR/$legacy_link" ]; then
    if [ ! -e "$OM_DIR/$legacy_link" ]; then
      track_warn "Symlink cassé: ~/.overmind/${legacy_link} → suppression"
      rm -f "$OM_DIR/$legacy_link" 2>/dev/null || true
    else
      ok "Symlink legacy: ~/.overmind/${legacy_link} → OK"
    fi
  fi
done

# Vérifier bridge/agents.json (sessions runtime)
if [ -f "$OM_DIR/bridge/agents.json" ]; then
  SESSION_COUNT=$(grep -c '"id"' "$OM_DIR/bridge/agents.json" 2>/dev/null || echo 0)
  ok "bridge/agents.json (${SESSION_COUNT} session(s))"
else
  log "${D}bridge/agents.json absent (créé au premier run)${N}"
fi

# Vérifier .mcp.json global
if [ -f "$OM_DIR/.mcp.json" ]; then
  MCP_SERVERS=$(grep -c '"transport"' "$OM_DIR/.mcp.json" 2>/dev/null || echo 0)
  ok ".mcp.json global (${MCP_SERVERS} serveur(s) MCP)"
else
  track_warn ".mcp.json global MANQUANT"
fi

ok "Audit arborescence terminé"

# ================================================================
# STEP 11/11 — Validation finale
# ================================================================
step "Validation finale"

sleep 3  # Laisser les services démarrer

# Test MCP :3099
MCP_CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 5 \
  -H 'Content-Type: application/json' \
  -X POST "http://127.0.0.1:$MCP_PORT_CORE/mcp" \
  -d '{"jsonrpc":"2.0","method":"ping","params":{}}' 2>/dev/null || echo '000')"
if [ "$MCP_CODE" = "200" ] || [ "$MCP_CODE" = "202" ]; then
  ok "OverMind MCP :${MCP_PORT_CORE} → HTTP ${MCP_CODE}"
else
  track_warn "OverMind MCP :${MCP_PORT_CORE} → HTTP ${MCP_CODE} (peut nécessiter un redémarrage)"
fi

# Test PostgreSQL
if [ "$OS" = "Darwin" ]; then
  PG_TEST="$(psql -U "$PG_SUPERUSER" -d "$PG_DB" -tAc 'SELECT 1' 2>/dev/null || echo '0')"
else
  PG_TEST="$($SUDO -u postgres psql -d "$PG_DB" -tAc 'SELECT 1' 2>/dev/null || echo '0')"
fi
if [ "$PG_TEST" = "1" ]; then
  ok "PostgreSQL DB '$PG_DB' → accessible"
else
  track_warn "PostgreSQL DB '$PG_DB' → connexion échouée"
fi

# ─── Résumé ──────────────────────────────────────────────────
echo
echo -e "${B}═══════════════════════════════════════════════════════════════${N}"
if [ "$ERRORS" -eq 0 ]; then
  echo -e "${G}${B}  ✅ Installation terminée${N} (${WARNINGS} warning(s))"
else
  echo -e "${Y}${B}  ⚠️  Installation terminée avec ${ERRORS} erreur(s)${N}"
fi
echo -e "${B}═══════════════════════════════════════════════════════════════${N}"
echo
echo -e "Endpoints (loopback):"
echo -e "  ${C}OverMind MCP${N}          → http://127.0.0.1:${MCP_PORT_CORE}"
echo -e "  ${C}OverMind PostgreSQL MCP${N} → http://127.0.0.1:${MCP_PORT_PG}"
echo
echo -e "Fichiers de config:"
echo -e "  ${D}.env${N}     $ENV_FILE"
echo -e "  ${D}.mcp.json${N} $MCP_FILE"
echo -e "  ${D}logs/${N}     $LOG_DIR/"
echo
if [ -n "$ENV_PASSWORD" ] && [ "$ENV_PASSWORD" != "" ]; then
  echo -e "${Y}⚠️  POSTGRES_PASSWORD généré automatiquement${N}"
  echo -e "  Il est stocké dans $ENV_FILE"
  echo -e "  Sauvegardez-le dans Keychain/1Password maintenant."
  echo
fi
echo -e "Actions restantes:"
echo -e "  1. Éditer ${C}$ENV_FILE${N} et remplir les clés LLM"
echo -e "  2. Redémarrer les services (${D}systemctl restart overmind-*${N} ou ${D}launchctl kickstart ${N})"
echo
