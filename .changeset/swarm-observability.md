---
"overmind-mcp": major
---

### 🚀 OverMind-MCP v2.0.0 - Swarm & Observabilité Unifiée

Cette version majeure marque l'achèvement complet de l'infrastructure OverMind-MCP avec des fonctionnalités d'orchestration avancées et une observabilité de niveau production.

#### 🎯 Nouvelles Fonctionnalités Majeures

**Swarm Orchestration (NOUVEAU)**
- Allocation dynamique de tâches aux agents spécialisés
- Load Balancing automatique avec scoring intelligent
- Support de capacités multiples par agent (code, analysis, scraping, etc.)
- Gestion de priorités de tâches (1-10)
- Statistiques en temps réel (completed, failed, running, pending)

**Workflows Long-Running Temporal (NOUVEAU)**
- `longRunningWorkflow` pour tâches stateful (OSINT, analyses complètes)
- Support de workflows jusqu'à 7 jours
- Signaux de contrôle: `cancel`, `pause`, `resume`
- Query d'état temps réel du workflow
- Survit aux crashes (persistance Temporal)

**Infrastructure Docker Complète (NOUVEAU)**
- RabbitMQ (Message Broker) avec Management UI
- Temporal (Workflow Orchestrator) avec Web UI
- PostgreSQL + pgvector (Vector DB 4096D)
- Redis (Cache & Sessions)
- Prometheus (Metrics Collection)
- Grafana (Dashboards)
- Jaeger (Distributed Tracing)
- OpenTelemetry Collector (Traces Bridge)

**Observabilité de Niveau Production (NOUVEAU)**
- Traces distribuées via OpenTelemetry → Jaeger
- Métriques temps réel via Prometheus
- Dashboards Grafana prêts à l'emploi
- Support complet de télémétrie sur tous les runners

#### 📚 Documentation

**Nouveaux Guides**
- `DEPLOYMENT.md` (600+ lignes): Guide déploiement complet
- `SWARM_USAGE.md` (500+ lignes): Guide Swarm Orchestration
- Scripts de déploiement automatiques
- Configuration .env complète

#### 🔧 Améliorations Techniques

- Correction erreur TypeScript dans swarm.ts (possibly undefined)
- Correction warnings ESLint (unused vars, any types)
- Correction mock PostgresMemoryProvider dans tests
- Tous les tests passent (69 passed, 3 skipped)
- Build TypeScript clean
- Linting ESLint clean (0 errors, 0 warnings)

#### 🐳 Docker

- Services: 9 containers
- Configuration Prometheus complète
- Configuration OpenTelemetry Collector
- Script d'initialisation PostgreSQL
- Exporters de métriques

#### 🚨 Breaking Changes

- Version majeure (1.x → 2.0) dû à l'ajout significatif de fonctionnalités
- Nouvelles APIs publiques: Swarm, Long-Running Workflows
- Nouvelle structure de projet (docker/, config/, scripts déploiement)

#### 🔄 Migration

- Aucune migration nécessaire pour les utilisateurs existants
- Les nouvelles fonctionnalités sont opt-in
- Configuration .env étendue (rétro-compatible)

---

**Déploiement 100% terminé !** 🎉
