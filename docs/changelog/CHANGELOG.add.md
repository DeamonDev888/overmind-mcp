# Changelog

## [2.1.0] - 2026-05-10

### 🎯 agent_control — Outil Unifié de Contrôle du Cycle de Vie

Cette version unifie 4 outils MCP en un seul (`agent_control`) et introduit le **Process Registry** persistant pour le suivi des agents par PID.

#### Nouvelles Fonctionnalités

**Process Registry (`src/lib/processRegistry.ts`)**
- Mapping persistant `pid ↔ sessionId ↔ agentName ↔ runner`
- Stockage dans `.claude/sessions.json`
- TTL automatique (1h après terminaison)
- Détection des processus orphelins (`isPidAlive`)
- Cleanup périodique des entrées expirées

**Outil unifié `agent_control` (`src/tools/agent_control.ts`)**
- Remplace 4 outils distincts : `get_agent_status`, `stream_agent_output`, `kill_agent`, `wait_agent`
- 4 actions : `status`, `stream`, `kill`, `wait`
- Codes d'erreur structurés : `AGENT_NOT_FOUND`, `AGENT_NOT_RUNNING`, `KILL_FAILED`, `WAIT_TIMEOUT`, `ORPHANED_PROCESS`
- Documentation complète avec 5 patterns async

**Intégration dans les 8 Runners**
- `ClaudeRunner`, `KiloRunner`, `GeminiRunner`, `QwenCliRunner`, `OpenClawRunner`, `ClineRunner`, `OpenCodeRunner`, `NousHermesRunner`
- `registerProcess()` appelé post-spawn
- `appendOutput()` dans `stdout.on('data')`
- `linkSessionToPid()` quand sessionId détecté
- `updateProcessStatus()` dans `child.on('close')`

#### 🔧 Améliorations Techniques

- Tous les runners utilisent le Process Registry
- Mutex (`async-mutex`) pour protéger les lectures/écritures concurrentes
- Support `AbortSignal` dans les runners
- `killProcessTree` pour Windows (`taskkill /F /T /PID`)

#### 📚 Documentation

**Nouvelle documentation** : `docs/agent_control.md` (400+ lignes)
- Architecture du Process Registry
- Détail des 4 actions avec exemples
- Patterns async : fire & forget, blocking wait, orchestration séquentielle, fan-out, resume après crash
- Tracker PID ↔ Session ↔ Agent avec lookup par timestamp/PID/sessionId
- Dashboard temps réel (CLI + HTML)
- Flux complet de debug

#### 🚨 Breaking Changes

- **4 outils supprimés** : `get_agent_status`, `stream_agent_output`, `kill_agent`, `wait_agent`
- **Nouvel outil** : `agent_control` avec action explicite
- server.ts : 14 outils au lieu de 17

#### 🔄 Migration

```javascript
// AVANT (4 appels distincts)
get_agent_status({ agentName: "x", runner: "kilo" })
stream_agent_output({ agentName: "x", runner: "kilo" })
kill_agent({ agentName: "x", runner: "kilo" })
wait_agent({ agentName: "x", runner: "kilo", timeoutMs: 300000 })

// APRÈS (1 seul appel avec action)
agent_control({ agentName: "x", runner: "kilo", action: "status" })
agent_control({ agentName: "x", runner: "kilo", action: "stream" })
agent_control({ agentName: "x", runner: "kilo", action: "kill" })
agent_control({ agentName: "x", runner: "kilo", action: "wait", timeoutMs: 300000 })
```

---

## [2.0.0] - 2026-05-09

### 🚀 OverMind-MCP v2.0.0 - Swarm & Observabilité Unifiée

Cette version majeure marque l'achèvement complet de l'infrastructure OverMind-MCP avec des fonctionnalités d'orchestration avancées et une observabilité de niveau production.

#### 🎯 Nouvelles Fonctionnalités Majeures

**Swarm Orchestration (NOUVEAU)**
- Allocation dynamique de tâches aux agents spécialisés
- Load Balancing automatique avec scoring intelligent
- Support de capacités multiples par agent (code, analysis, scraping, etc.)
- Gestion de priorités de tâches (1-10)
- Statistiques en temps réel (completed, failed, running, pending)
- `createSwarmOrchestrator()` avec API complète
- Fichier: `src/lib/orchestration/swarm.ts`

**Workflows Long-Running Temporal (NOUVEAU)**
- `longRunningWorkflow` pour tâches stateful (OSINT, analyses complètes)
- Support de workflows jusqu'à 7 jours
- Signaux de contrôle: `cancel`, `pause`, `resume`
- Query d'état temps réel du workflow
- Survit aux crashes (persistance Temporal)
- API enrichie: `startLongRunningWorkflow()`, `getLongRunningWorkflowHandle()`
- Fichiers: `src/lib/workflow/temporal/workflows.ts`, `client.ts`

**Infrastructure Docker Complète (NOUVEAU)**
- `docker-compose.yml`: Stack principale (9 services)
  - RabbitMQ (Message Broker) avec Management UI
  - Temporal (Workflow Orchestrator) avec Web UI
  - PostgreSQL + pgvector (Vector DB 4096D)
  - Redis (Cache & Sessions)
  - Prometheus (Metrics Collection)
  - Grafana (Dashboards)
  - Jaeger (Distributed Tracing)
  - OpenTelemetry Collector (Traces Bridge)
  - Node Exporter (Host metrics)
- `docker-compose.exporters.yml`: Exporters de métriques
  - RabbitMQ Exporter
  - PostgreSQL Exporter
  - Redis Exporter
- `init-db.sql`: Script d'initialisation PostgreSQL
- `config/prometheus.yml`: Configuration Prometheus
- `config/otel-collector.yml`: Configuration OpenTelemetry Collector

**Observabilité de Niveau Production (NOUVEAU)**
- Traces distribuées via OpenTelemetry → Jaeger
- Métriques temps réel via Prometheus
- Dashboards Grafana prêts à l'emploi
- Support complet de télémétrie sur tous les runners
- Scripts NPM ajoutés: `deploy:infra`, `deploy:exporters`, `deploy:all`, `deploy:logs`, `deploy:status`

#### 📚 Documentation

**Nouveaux Guides**
- `DEPLOYMENT.md` (600+ lignes): Guide déploiement complet
  - Prérequis, configuration, Docker Compose setup
  - Tests & validation, sécurité & maintenance
  - Workflows avancés, monitoring
- `SWARM_USAGE.md` (500+ lignes): Guide Swarm Orchestration
  - Configuration du swarm, allocation de tâches
  - Workflows long-running, exemples pratiques
  - Monitoring & debug
- Configuration .env étendue avec toutes les variables

#### 🔧 Améliorations Techniques

- **Correction TypeScript**: `swarm.ts` (possibly undefined values)
- **Correction ESLint**: Suppression warnings (unused vars, any types)
- **Correction Tests**: Mock `registerMemoryAlertCallback` dans tests
- **Tests**: 69 passed, 3 skipped (100% succès)
- **Build**: TypeScript compilation clean
- **Linting**: ESLint clean (0 errors, 0 warnings)

#### 🚨 Breaking Changes

- **Version majeure** (1.x → 2.0) dû à l'ajout significatif de fonctionnalités
- **Nouvelles APIs publiques**: Swarm, Long-Running Workflows
- **Nouvelle structure de projet**: `docker/`, `config/`, scripts déploiement
- **Configuration .env**: Variables étendues (rétro-compatible)

#### 🔄 Migration

- Aucune migration nécessaire pour les utilisateurs existants
- Les nouvelles fonctionnalités sont opt-in
- Configuration .env étendue (rétro-compatible)

#### 📦 Dependencies

Mises à jour mineures de dépendances

---

**Déploiement 100% terminé !** 🎉

OverMind-MCP est maintenant un orchestrateur d'agents IA complet avec:
- ✅ Message Broker RabbitMQ
- ✅ Vector DB pgvector (4096D)
- ✅ Temporal Workflows long-running
- ✅ Swarm Orchestration avec allocation dynamique
- ✅ Observabilité complète (Prometheus, Grafana, Jaeger)
- ✅ Documentation production-ready

**Prêt pour la production** 🚀
