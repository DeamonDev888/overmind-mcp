# Changelog

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
