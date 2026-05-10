# Documentation OverMind-MCP

Bienvenue dans la documentation centralisée d'OverMind-MCP.

> **Note** : Le site web cyberpunk avec animations est disponible dans ce dossier. Ce fichier INDEX.md sert de table des matières pour la documentation technique.

## 📑 Structure

```
Workflow/
├── dock../docker/docker-compose.yml              # Stack principale (9 services)
├── docker-compose.exporters.yml    # Exporters métriques
├── scripts/                        # Scripts setup/gestion
│   ├── setup.mjs
│   ├── install-dependencies.mjs
│   └── docker-manager.mjs
│
└── docs/                   # Documentation
    ├── index.html          # Site web cyberpunk
    ├── INDEX.md            # Ce fichier (table des matières)
    ├── guides/             # Guides utilisateur
    │   ├── README.md       # Guide principal
    │   ├── DEPLOYMENT.md   # Guide déploiement
    │   └── SWARM_USAGE.md  # Guide Swarm
    ├── api/                # Documentation API
    │   ├── prompt/         # Prompts système
    │   └── tools.md        # Référence outils
    └── changelog/          # Historique versions
        ├── CHANGELOG.md
        └── CHANGELOG.add.md
```

## 🚀 Par où commencer ?

1. **Nouveau utilisateur ?** → Commencez par [`guides/README.md`](./guides/README.md)
2. **Veut déployer en production ?** → Voir [`guides/DEPLOYMENT.md`](./guides/DEPLOYMENT.md)
3. **Intéressé par le Swarm ?** → Lire [`guides/SWARM_USAGE.md`](./guides/SWARM_USAGE.md)
4. **Besoin de la référence API ?** → Consulter [`api/tools.md`](./api/tools.md)

## 📚 Guides Utilisateur

### [`guides/README.md`](./guides/README.md)
Guide principal d'utilisation :
- Installation et setup
- Configuration des agents
- Utilisation des runners
- Exemples pratiques

### [`guides/DEPLOYMENT.md`](./guides/DEPLOYMENT.md)
Guide complet de déploiement :
- Prérequis système
- Configuration Docker Compose
- Setup infrastructure (PostgreSQL, RabbitMQ, Temporal)
- Sécurité et maintenance
- Monitoring avec Prometheus/Grafana

### [`guides/SWARM_USAGE.md`](./guides/SWARM_USAGE.md)
Guide d'orchestration Swarm :
- Configuration du swarm
- Allocation dynamique de tâches
- Workflows long-running
- Exemples concrets
- Monitoring et debug

## 🏗️ Infrastructure

### Docker Compose
- **[`../dock../docker/docker-compose.yml`](../dock../docker/docker-compose.yml)** - Stack principale (9 services)
  - RabbitMQ (Message Broker)
  - Temporal (Workflow Orchestrator)
  - PostgreSQL + pgvector (Vector DB)
  - Redis (Cache)
  - Prometheus (Metrics)
  - Grafana (Dashboards)
  - Jaeger (Tracing)
  - OpenTelemetry Collector
  - Node Exporter

- **[`../docker-compose.exporters.yml`](../docker-compose.exporters.yml)** - Exporters de métriques
  - RabbitMQ Exporter
  - PostgreSQL Exporter
  - Redis Exporter

### Scripts Setup
Voir [`../scripts/`](../scripts/) :
- `setup.mjs` - Setup interactif complet
- `install-dependencies.mjs` - Installation Docker/PostgreSQL
- `docker-manager.mjs` - Gestion infrastructure (up/down/logs/status)
- `postinstall.mjs` - Post-installation NPM

## 🔌 API & Référence

### [`api/prompt/`](./api/prompt/)
Documentation des prompts système pour chaque runner :
- Claude Code
- Kilo (code, architect, ask, debug)
- Hermes
- Minimax 4

## 🛠️ Reference des Outils

### [`agent_control.md`](./agent_control.md)
Contrôle unifié du cycle de vie des agents OverMind via le Process Registry.
- Remplace les 4 outils précédents : get_agent_status, stream_agent_output, kill_agent, wait_agent
- Patterns async : fire & forget, blocking wait, orchestration séquentielle, fan-out parallèle
- Dashboard temps réel par PID
- Lookup par sessionId, timestamp, PID
- Codes d'erreur structurés

### [`api/tools.md`](./api/tools.md)
Référence complète des outils MCP (14 outils)

## 📝 Changelog

### [`changelog/CHANGELOG.md`](./changelog/CHANGELOG.md)
Historique complet des versions :
- Toutes les versions de 1.x à 2.0.0
- Features, bug fixes, breaking changes
- Notes de migration

### [`changelog/CHANGELOG.add.md`](./changelog/CHANGELOG.add.md)
Notes détaillées de la v2.0.0 :
- Swarm Orchestration
- Long-Running Workflows
- Infrastructure Docker complète
- Observabilité de niveau production

## 🔍 Recherche Rapide

### Je veux...

- **Installer OverMind** → [`guides/README.md`](./guides/README.md)
- **Déployer en production** → [`guides/DEPLOYMENT.md`](./guides/DEPLOYMENT.md)
- **Créer un agent** → [`guides/README.md`](./guides/README.md)
- **Utiliser le Swarm** → [`guides/SWARM_USAGE.md`](./guides/SWARM_USAGE.md)
- **Voir la référence API** → [`tools.md`](./tools.md)
- **Setup Docker** → [`../dock../docker/docker-compose.yml`](../dock../docker/docker-compose.yml)
- **Voir les nouveautés** → [`changelog/CHANGELOG.md`](./changelog/CHANGELOG.md)
- **Debug un problème** → [`guides/DEPLOYMENT.md`](./guides/DEPLOYMENT.md) (section Monitoring)

## 📖 Ressources Externes

- **GitHub** : https://github.com/DeamonDev888/overmind-mcp
- **Discord** : https://discord.gg/4AR82phtBz
- **Site Web** : https://deamondev888.github.io/overmind-mcp/

---

**Retour au README principal** : [`../README.md`](../README.md)
