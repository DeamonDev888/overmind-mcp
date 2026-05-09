# ═══════════════════════════════════════════════════════════════════════════════
# OVERMIND-MCP: SETUP WINDOWS (PostgreSQL Existant)
# ═══════════════════════════════════════════════════════════════════════════════
# Guide de configuration pour OverMind-MCP avec PostgreSQL + pgvector existant
#
# Prérequis:
#   - Docker Desktop démarré
#   - PostgreSQL + pgvector en Docker (container: postgres-pgvector)
#   - Node.js 20+ installé
#   - pnpm installé
# ═══════════════════════════════════════════════════════════════════════════════

## 📋 ÉTAPE 1: Configuration de l'environnement

### 1.1 Créer le fichier .env

```bash
# Copier l'exemple
cp .env.example .env
```

### 1.2 Éditer .env avec votre configuration PostgreSQL existante

```bash
# ─── WORKSPACE ───────────────────────────────────────────────────────────────────
OVERMIND_WORKSPACE=C:/Users/Deamon/Desktop/Backup/Serveur MCP

# ─── DATABASE (VOTRE POSTGRESQL EXISTANT) ──────────────────────────────────────
POSTGRES_HOST=host.docker.internal  # ← IMPORTANT pour Docker
POSTGRES_PORT=5432
POSTGRES_DATABASE=overmind_memory   # Sera créé automatiquement
POSTGRES_USER=postgres
POSTGRES_PASSWORD=votre_mot_de_passe_ici  # ← CHANGEZ CECI
POSTGRES_SSL=false

# ─── MEMORY ───────────────────────────────────────────────────────────────────────
OVERMIND_MEMORY_TYPE=postgres

# ─── EMBEDDINGS (Qwen 8B - 4096D) ────────────────────────────────────────────────
OVERMIND_EMBEDDING_URL=https://openrouter.ai/api/v1
OVERMIND_EMBEDDING_KEY=sk-or-v1-votre_cle_api_ici  # ← CHANGEZ CECI
OVERMIND_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
OVERMIND_EMBEDDING_DIMENSIONS=4096

# ─── MESSAGE BROKER (Docker RabbitMQ) ────────────────────────────────────────────
OVERMIND_BROKER=rabbitmq
RABBITMQ_URL=amqp://overmind:overmind_secret_password_change_me@localhost:5672

# ─── WORKFLOW (Docker Temporal) ───────────────────────────────────────────────────
OVERMIND_WORKFLOW=temporal
TEMPORAL_ADDRESS=localhost:7233

# ─── TELEMETRY (Désactivé par défaut) ────────────────────────────────────────────
OTEL_ENABLED=false
```

---

## 🗄️ ÉTAPE 2: Initialiser la base OverMind

### Option A: Script automatique (RECOMMANDÉ)

```bash
# Lancer le script de setup
node scripts/setup-overmind-db.js
```

**Le script va:**
1. Se connecter à votre PostgreSQL existant
2. Vérifier que pgvector est installé
3. Créer la base `overmind_memory`
4. Activer l'extension pgvector
5. Initialiser les tables

### Option B: Manuel

```bash
# Se connecter à votre PostgreSQL Docker
docker exec -it postgres-pgvector psql -U postgres

# Créer la base de données
CREATE DATABASE overmind_memory;

# Se connecter à la nouvelle base
\c overmind_memory

# Activer pgvector
CREATE EXTENSION IF NOT EXISTS vector;

# Quitter
\q

# Exécuter le script d'initialisation
docker exec -i postgres-pgvector psql -U postgres -d overmind_memory < init-db.sql
```

---

## 🐳 ÉTAPE 3: Lancer les services Docker OverMind

### 3.1 Lancer RabbitMQ + Temporal

```bash
# Lancer les services minimal
docker-compose -f docker-compose.overmind.yml up -d
```

**Services démarrés:**
- ✅ RabbitMQ (ports 5672, 15672)
- ✅ Temporal (ports 7233, 8088)
- ✅ Temporal Web UI

### 3.2 Vérifier que tout tourne

```bash
# Vérifier les containers
docker ps
```

**Vous devriez voir:**
```
postgres-pgvector     (déjà existant)
overmind-rabbitmq     (nouveau)
overmind-temporal      (nouveau)
overmind-temporal-web  (nouveau)
```

### 3.3 Tester les interfaces

- **RabbitMQ Management UI**: http://localhost:15672
  - User: `overmind`
  - Pass: `overmind_secret_password_change_me`

- **Temporal Web UI**: http://localhost:8088

---

## 🔨 ÉTAPE 4: Builder et démarrer OverMind

### 4.1 Builder le projet

```bash
cd "C:/Users/Deamon/Desktop/Backup/Serveur MCP/Workflow"
pnpm run build
```

### 4.2 Démarrer OverMind

```bash
# Mode développement (avec watch)
pnpm run dev

# Ou mode production
pnpm run start
```

---

## ✅ ÉTAPE 5: Vérifier l'installation

### 5.1 Tester la connexion PostgreSQL

```bash
# Lancer un test simple
node -e "
const { Client } = require('pg');
const client = new Client({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'votre_mot_de_passe',
  database: 'overmind_memory'
});
client.connect().then(() => {
  console.log('✅ Connexion PostgreSQL réussie !');
  return client.query('SELECT version()');
}).then(res => {
  console.log('PostgreSQL version:', res.rows[0].version);
  return client.end();
}).catch(err => {
  console.error('❌ Erreur:', err.message);
  process.exit(1);
});
"
```

### 5.2 Vérifier les services Docker

```bash
# Vérifier RabbitMQ
curl http://localhost:15672/api/overview
# User: overmind
# Pass: overmind_secret_password_change_me

# Vérifier Temporal
curl http://localhost:7233
```

---

## 🧪 ÉTAPE 6: Premier test

### 6.1 Créer un agent de test

```bash
# Via l'interface MCP (Cursor, Claude Code, etc.)

create_agent({
  name: 'test-agent',
  prompt: 'Tu es un agent de test pour vérifier l\'installation',
  runner: 'claude'
})
```

### 6.2 Tester la mémoire

```bash
# Stocker une connaissance
memory_store({
  text: 'OverMind-MCP est installé sur Windows avec PostgreSQL existant',
  source: 'setup',
  agentName: 'system'
})

# Rechercher
memory_search({
  query: 'installation Windows',
  limit: 5
})
```

---

## 📊 ÉTAPE 7: Monitoring (Optionnel)

Si vous voulez activer l'observabilité, décommentez les services Prometheus et Grafana dans `docker-compose.overmind.yml`:

```bash
# Arrêter les services
docker-compose -f docker-compose.overmind.yml down

# Éditer docker-compose.overmind.yml
# Décommentez les sections prometheus et grafana

# Relancer
docker-compose -f docker-compose.overmind.yml up -d
```

**Interfaces disponibles:**
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (admin/grafana_password_change_me)

---

## 🛠️ COMMANDES UTILES

### Docker

```bash
# Voir les logs
docker-compose -f docker-compose.overmind.yml logs -f

# Arrêter les services
docker-compose -f docker-compose.overmind.yml down

# Redémarrer un service
docker-compose -f docker-compose.overmind.yml restart rabbitmq

# Voir l'état
docker-compose -f docker-compose.overmind.yml ps
```

### OverMind

```bash
# Builder
pnpm run build

# Linter
pnpm run lint

# Tests
pnpm run test

# Démarrer
pnpm run dev      # Développement
pnpm run start    # Production
```

---

## 🐛 DÉPANNAGE

### Problème: "ECONNREFUSED" PostgreSQL

**Solution:**
```bash
# Vérifier que PostgreSQL tourne
docker ps | grep postgres-pgvector

# Vérifier le port
docker port postgres-pgvector
```

### Problème: "pgvector not installed"

**Solution:**
```bash
# Se connecter au container
docker exec -it postgres-pgvector psql -U postgres

# Installer pgvector
CREATE EXTENSION IF NOT EXISTS vector;
```

### Problème: "RabbitMQ connection refused"

**Solution:**
```bash
# Vérifier que RabbitMQ tourne
docker ps | grep overmind-rabbitmq

# Voir les logs
docker logs overmind-rabbitmq
```

### Problème: "Temporal can't connect to PostgreSQL"

**Solution:**
```bash
# Vérifier .env
# POSTGRES_HOST doit être "host.docker.internal"
# POSTGRES_PASSWORD doit être correct

# Redémarrer Temporal
docker-compose -f docker-compose.overmind.yml restart temporal
```

---

## 🎯 RÉSUMÉ

**Setup minimal:**
- ✅ PostgreSQL existant réutilisé
- ✅ RabbitMQ (message broker)
- ✅ Temporal (workflow orchestrator)
- ✅ OverMind agents (Node.js natif)

**Services disponibles:**
- 📊 RabbitMQ Management UI: http://localhost:15672
- 📈 Temporal Web UI: http://localhost:8088
- 🗄️ PostgreSQL: localhost:5432
- 🤖 OverMind Agents: Processus Node.js

**Prochaine étape:**
Créer vos agents et workflows personnalisés ! 🚀

---

**Pour plus d'informations:**
- Documentation: https://deamondev888.github.io/overmind-mcp/
- Support: https://discord.gg/4AR82phtBz
