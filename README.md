# OverMind-MCP

Orchestrateur universel d'agents IA multi-modèles via MCP (Model Context Protocol).

## 🚀 Démarrage Rapide

```bash
# Installation
npm install -g overmind-mcp

# Setup initial (interactif)
overmind-setup

# Lancer un agent
overmind run-agent --runner claude --agent-name mon-agent --prompt "Explique ce code"
```

## 📚 Documentation

Toute la documentation est centralisée dans le dossier [`docs/`](./docs/) :

### Guides Utilisateur
- **[README](./docs/guides/README.md)** - Guide principal
- **[DEPLOYMENT](./docs/guides/DEPLOYMENT.md)** - Guide de déploiement complet
- **[SWARM_USAGE](./docs/guides/SWARM_USAGE.md)** - Guide d'orchestration Swarm

### Infrastructure
- **[`docker-compose.yml`](./docker-compose.yml)** - Stack principale (9 services)
- **[`docker-compose.exporters.yml`](./docker-compose.exporters.yml)** - Exporters de métriques
- **[`scripts/`](./scripts/)** - Scripts d'installation et gestion

### API & Référence
- **[Prompts](./docs/api/prompt/)** - Documentation des prompts système
- **[Tools](./docs/tools.md)** - Référence des outils MCP

### Changelog
- **[CHANGELOG](./docs/changelog/CHANGELOG.md)** - Historique des versions
- **[CHANGELOG.add](./docs/changelog/CHANGELOG.add.md)** - Notes de version v2.0.0

## 🎯 Fonctionnalités Principales

- **Multi-Runners** : Claude, Gemini, Kilo, Hermes, OpenClaw, Cline, OpenCode, QwenCLI
- **Fallback Tokens** : Rotation automatique sur quota exhausted (AUTH_FALLBACK_1/2/3)
- **Swarm Orchestration** : Allocation dynamique de tâches aux agents spécialisés
- **Long-Running Workflows** : Workflows Temporal jusqu'à 7 jours
- **Observabilité** : OpenTelemetry, Prometheus, Grafana, Jaeger
- **Vector DB** : PostgreSQL + pgvector (4096D)

## 📦 Scripts NPM

```bash
# Build
npm run build
npm run rebuild

# Qualité
npm run lint
npm run format
npm run check-types
npm run test

# Infrastructure
npm run deploy:infra      # Docker Compose stack principale
npm run deploy:exporters  # Exporters de métriques
npm run deploy:all        # Tout démarrer
npm run deploy:logs       # Logs des services
npm run deploy:status     # État des services

# Setup
npm run setup             # Setup interactif complet
npm run setup:full        # Setup avec toutes les dépendances
npm run setup:deps        # Installation dépendances Docker uniquement
```

## 🔧 Configuration

Le fichier `.env` à la racine du projet contient toute la configuration :

```bash
# Modèles AI
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_AUTH_TOKEN=sk-ant-...
AUTH_FALLBACK_1=sk-ant-...
AUTH_FALLBACK_2=sk-ant-...

# OverMind
OVERMIND_WORKSPACE=/chemin/vers/workspace

# OpenTelemetry (optionnel)
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## 🏗️ Architecture

```
Workflow/
├── src/
│   ├── services/       # Runners (Claude, Gemini, Kilo, etc.)
│   ├── tools/          # Outils MCP (run_agent, create_agent, etc.)
│   ├── lib/            # Bibliothèques internes
│   └── bin/            # Binaires CLI
├── docs/               # Documentation centralisée
├── scripts/            # Scripts NPM (lien vers docs/infrastructure/scripts)
└── dist/               # Build output
```

## 📖 Aide

```bash
# Aide générale
overmind --help

# Aide sur une commande spécifique
overmind run-agent --help

# Lister les agents disponibles
overmind list-agents

# Voir la config d'un agent
overmind get-config --name mon-agent
```

## 🤝 Contribution

Ce projet utilise Changesets pour la gestion des versions :

```bash
# Créer un changeset
pnpm changeset

# Versionner (après changesets)
pnpm changeset version

# Publier
pnpm release
```

## 📄 Licence

MIT

---

**Documentation complète :** [`docs/`](./docs/)
