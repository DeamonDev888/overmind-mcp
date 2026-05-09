# 🚀 OverMind-MCP Deployment Guide

Guide de déploiement complet pour OverMind-MCP avec Temporal, RabbitMQ, Prometheus, Grafana, Jaeger, et PostgreSQL + pgvector.

## 📋 Prérequis

- **Docker** & **Docker Compose** (v2.0+)
- **Node.js** 20+ (pour OverMind-MCP)
- **pnpm** 10+
- **Git** (pour cloner le repo)

## 🎯 Architecture Déployée

```
┌─────────────────────────────────────────────────────────────┐
│                    OverMind-MCP v1.13.15                    │
│                    (AI Orchestrator)                        │
└────────────┬────────────────────────────────────────────────┘
             │
             ├──► RabbitMQ (Message Broker)
             ├──► Temporal (Workflow Orchestrator)
             ├──► PostgreSQL + pgvector (Vector DB)
             ├──► Redis (Cache & Sessions)
             ├──► OpenTelemetry Collector (Traces Bridge)
             └──► Prometheus (Metrics Collection)
                      │
                      ▼
             ┌──────────────────────────┐
             │    Observabilité         │
             ├──────────────────────────┤
             │ • Grafana (Dashboards)   │
             │ • Jaeger (Traces UI)     │
             │ • Prometheus (Metrics)   │
             └──────────────────────────┘
```

## 🏗️ Étape 1 : Cloner & Builder OverMind-MCP

```bash
# 1. Cloner le repository
git clone https://github.com/DeamonDev888/overmind-mcp.git
cd overmind-mcp

# 2. Installer les dépendances
pnpm install

# 3. Builder le projet
pnpm run build

# 4. Créer le fichier .env
cp .env.example .env
```

## 🔐 Étape 2 : Configuration Environment Variables

Éditez le fichier `.env` avec vos valeurs réelles :

```bash
# ─── OVERMIND WORKSPACE ────────────────────────────────────────────────────────
OVERMIND_WORKSPACE=/path/to/your/workspace

# ─── DATABASE (PostgreSQL + pgvector) ───────────────────────────────────────────
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DATABASE=overmind_memory
POSTGRES_USER=postgres
POSTGRES_PASSWORD=CHANGE_ME_SECURE_PASSWORD
POSTGRES_SSL=false

# ─── MEMORY CONFIGURATION ───────────────────────────────────────────────────────
OVERMIND_MEMORY_TYPE=postgres

# ─── EMBEDDING CONFIGURATION (Qwen 8B - 4096D) ─────────────────────────────────
OVERMIND_EMBEDDING_URL=https://openrouter.ai/api/v1
OVERMIND_EMBEDDING_KEY=sk-or-v1-YOUR_OPENROUTER_KEY_HERE
OVERMIND_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
OVERMIND_EMBEDDING_DIMENSIONS=4096

# ─── MESSAGE BROKER (RabbitMQ) ──────────────────────────────────────────────────
OVERMIND_BROKER=rabbitmq
RABBITMQ_URL=amqp://overmind:overmind_secret_password_change_me@localhost:5672

# ─── WORKFLOW ORCHESTRATOR (Temporal) ───────────────────────────────────────────
OVERMIND_WORKFLOW=temporal
TEMPORAL_ADDRESS=localhost:7233

# ─── OPENTELEMETRY (Observabilité) ───────────────────────────────────────────────
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# ─── DISCORD (Optional - Notifications) ───────────────────────────────────────────
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
DISCORD_CHANNEL_ID=YOUR_CHANNEL_ID_HERE
```

## 🐳 Étape 3 : Déployer l'Infrastructure Docker

### 3.1 Lancer la stack principale

```bash
# Lancer tous les services
docker-compose up -d

# Vérifier que tous les services sont up
docker-compose ps
```

**Services lancés :**
- ✅ RabbitMQ (ports 5672, 15672)
- ✅ Temporal (ports 7233, 8233)
- ✅ PostgreSQL (port 5432)
- ✅ Redis (port 6379)
- ✅ Prometheus (port 9090)
- ✅ Grafana (port 3000)
- ✅ Jaeger (port 16686)
- ✅ OpenTelemetry Collector (ports 4317, 4318)

### 3.2 Lancer les exporters (métriques additionnelles)

```bash
# Lancer RabbitMQ, PostgreSQL, Redis exporters
docker-compose -f docker-compose.exporters.yml up -d
```

### 3.3 Vérifier la santé des services

```bash
# Vérifier les logs
docker-compose logs -f

# Tester RabbitMQ Management UI
# Ouvrir: http://localhost:15672
# User: overmind
# Pass: overmind_secret_password_change_me

# Tester Temporal Web UI
# Ouvrir: http://localhost:8088

# Tester Grafana
# Ouvrir: http://localhost:3000
# User: admin
# Pass: grafana_password_change_me

# Tester Jaeger UI
# Ouvrir: http://localhost:16686

# Tester Prometheus
# Ouvrir: http://localhost:9090
```

## 🚀 Étape 4 : Démarrer OverMind-MCP

### 4.1 Démarrer le serveur MCP

```bash
# Mode développement (avec watch)
pnpm run dev

# Mode production
pnpm run start
```

### 4.2 Démarrer les workers (optionnel)

```bash
# Worker RabbitMQ (si utilisation du broker)
pnpm run worker:rabbitmq

# Worker Temporal (si utilisation des workflows longs)
pnpm run worker:temporal
```

## 🧪 Étape 5 : Tester le Déploiement

### 5.1 Test Message Broker (RabbitMQ)

```bash
# Dans un terminal, tester l'envoi de message
curl -X POST http://localhost:8088/api/v1/namespaces/default/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": {
      "name": "orchestrateAgentsWorkflow",
      "taskQueue": "overmind-agents"
    },
    "input": [{
      "runner": "claude",
      "prompt": "Test RabbitMQ deployment",
      "agentName": "test-agent"
    }]
  }'
```

### 5.2 Test Vector DB (pgvector)

```bash
# Utiliser l'outil MCP memory_store
# Via votre client MCP (Cursor, Claude Code, etc.)

memory_store({
  text: "OverMind-MCP deployment successful",
  source: "deployment",
  agentName: "system"
})
```

### 5.3 Test Observabilité (OpenTelemetry)

```bash
# Exécuter un agent avec tracing
run_agent({
  runner: "claude",
  prompt: "Test observability with tracing",
  agentName: "test-agent"
})

# Vérifier les traces dans Jaeger UI
# http://localhost:16686
# Chercher: service="overmind-mcp"
```

### 5.4 Test Temporal Workflows

```bash
# Lancer un workflow long-running
longRunningWorkflow({
  batches: [{
    id: "test-batch-1",
    tasks: [{
      runner: "claude",
      prompt: "OSINT analysis task 1",
      agentName: "analyst"
    }],
    status: "pending"
  }],
  maxParallelBatches: 3,
  batchTimeout: "1 hour"
})

# Vérifier dans Temporal Web UI
# http://localhost:8088
```

## 📊 Étape 6 : Configurer Grafana Dashboards

### 6.1 Importer les datasources

1. Ouvrir Grafana: http://localhost:3000
2. Aller dans **Configuration → Data Sources**
3. Ajouter **Prometheus**:
   - URL: `http://prometheus:9090`
   - Access: `Server (default)`
4. Ajouter **Jaeger**:
   - URL: `http://jaeger:16686`
   - Access: `Server (default)`

### 6.2 Créer les dashboards

**Dashboard 1: OverMind-MCP Health**
- Panel 1: RAM Usage (Node Exporter)
- Panel 2: RabbitMQ Queue Length
- Panel 3: PostgreSQL Connections
- Panel 4: Temporal Workflow Success Rate

**Dashboard 2: AI Performance**
- Panel 1: LLM Token Consumption (custom metric)
- Panel 2: Agent Execution Time
- Panel 3: Vector DB Search Latency
- Panel 4: Workflow Completion Rate

## 🔧 Étape 7 : Maintenance & Monitoring

### 7.1 Logs & Diagnostics

```bash
# Logs OverMind-MCP
docker-compose logs -f overmind-mcp

# Logs RabbitMQ
docker-compose logs -f rabbitmq

# Logs Temporal
docker-compose logs -f temporal

# Logs PostgreSQL
docker-compose logs -f postgres
```

### 7.2 Backups

```bash
# Backup PostgreSQL (incluant les vecteurs)
docker-compose exec postgres pg_dump -U postgres overmind_memory > backup.sql

# Backup Grafana dashboards
docker-compose exec grafana grafana-cli admin export-dashboards
```

### 7.3 Clean up (si nécessaire)

```bash
# Arrêter tous les services
docker-compose down

# Arrêter + supprimer volumes (données perdues!)
docker-compose down -v

# Relancer après clean up
docker-compose up -d
```

## 🎯 Étape 8 : Workflows Avancés

### 8.1 Lancer un workflow OSINT longue durée

```typescript
import { startLongRunningWorkflow } from 'overmind-mcp';

const workflow = await startLongRunningWorkflow({
  batches: [{
    id: "osint-batch-1",
    tasks: [{
      runner: "claude",
      prompt: "OSINT analysis: Crypto market sentiment analysis",
      agentName: "crypto-analyst"
    }],
    status: "pending"
  }],
  maxParallelBatches: 5,
  batchTimeout: "24 hours"
});

// Surveiller le workflow
const state = await workflow.stateQuery();
console.log('Workflow state:', state);
```

### 8.2 Allocation Swarm dynamique

```typescript
import { createSwarmOrchestrator } from 'overmind-mcp';

const swarm = createSwarmOrchestrator({
  agents: [{
    agentName: "crypto-analyst",
    runner: "claude",
    capabilities: ["analysis", "osint", "crypto"],
    maxConcurrentTasks: 3,
    currentLoad: 0
  }],
  tasks: [{
    id: "task-1",
    type: "analysis",
    prompt: "Analyze BTC price action",
    priority: 10,
    requiresCapabilities: ["analysis", "crypto"]
  }],
  maxParallelTasks: 5,
  enableLoadBalancing: true,
  enableTaskPriority: true
});

const allocations = await swarm.allocateTasks();
console.log('Allocations:', allocations);
```

## 🔐 Sécurité (IMPORTANT)

Avant de passer en production :

1. **Changer tous les mots de passe par défaut**
   - RabbitMQ: `overmind_secret_password_change_me`
   - PostgreSQL: `postgres_password_change_me`
   - Grafana: `grafana_password_change_me`

2. **Configurer SSL/TLS**
   - PostgreSQL: `POSTGRES_SSL=true`
   - RabbitMQ: Activer SSL
   - Temporal: Acturer mTLS

3. **Restreindre l'accès réseau**
   - Utiliser Docker networks privés
   - Exposer seulement les ports nécessaires
   - Configurer firewall/iptables

4. **Activer l'authentification**
   - Grafana: Configurer OAuth/LDAP
   - Temporal: Activer mTLS
   - PostgreSQL: Certificats clients

## 📚 Ressources & Documentation

- **OverMind-MCP**: https://github.com/DeamonDev888/overmind-mcp
- **Temporal**: https://docs.temporal.io
- **RabbitMQ**: https://www.rabbitmq.com/documentation.html
- **Prometheus**: https://prometheus.io/docs
- **Grafana**: https://grafana.com/docs
- **Jaeger**: https://www.jaegertracing.io/docs
- **pgvector**: https://github.com/pgvector/pgvector

## 🆘 Support & Communauté

- **Discord**: https://discord.gg/4AR82phtBz
- **Issues**: https://github.com/DeamonDev888/overmind-mcp/issues

---

**Déploiement terminé !** 🎉

OverMind-MCP est maintenant opérationnel avec :
- ✅ Message Broker (RabbitMQ)
- ✅ Workflow Orchestrator (Temporal)
- ✅ Vector DB (PostgreSQL + pgvector)
- ✅ Observabilité complète (Prometheus, Grafana, Jaeger)
- ✅ Workflows long-running (OSINT, analyses)
- ✅ Allocation Swarm dynamique

**Prochaine étape**: Créer vos agents et workflows personnalisés !
