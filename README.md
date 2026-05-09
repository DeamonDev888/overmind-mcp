<p align="center">
  <img src="assets/overmind.png" alt="OverMind-MCP Banner" width="293" height="253">
</p>

<div align="center">

# 🧠 OverMind-MCP

</div>

_Orchestrateur universel agents IA multi-modeles via MCP pour piloter Claude-Code, Gemini-cli, QwenCli, Nous Hermes, Kilo/Cline, OpenClaw, GLM, Minimax, Kimi, Ollama et plus sans limite._

<p align="center">
  <a href="https://discord.gg/4AR82phtBz"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://deamondev888.github.io/overmind-mcp/"><img src="https://img.shields.io/badge/Documentation-Live-00fff5?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Live Doc"></a>
</p>

**OverMind-MCP** est une conscience supérieure conçue pour orchestrer, commander et automatiser une flotte illimitée d'agents IA. Compatible avec **Claude-Code, Gemini-cli, QwenCli, Nous Hermes, Kilo/Cline, OpenClaw**, et prêt pour **GLM, Minimax, Kimi, Ollama** et bien d'autres. Plus qu'un simple runner, c'est le **Cortex Central** de votre infrastructure IA.

Il transforme les outils CLI isolés en une force coordonnée, pilotable par API ou par MCP, capable d'exécuter des missions complexes en 2 secondes chrono. de creer et d orchestrer des pipeline de plusieurs agent. il est expert en outils MCP et peu etre scripté pour les faire fonctionner ensemble et les mettre en productions

- 🔌 **Contrôle Total** : Lancez des missions complexes via MCP ou directement via le code (Claude, Gemini, QwenCli, Hermes).
- 🏗️ **Architecture Pro** : Basé sur des services (`AgentManager`, `ClaudeRunner`, `PromptManager`) pour une stabilité maximale.
- 🧠 **Mémoire Haute-Performance (4096D)** : Système RAG intégré via PostgreSQL + `pgvector` supportant les embeddings SOTA (Qwen 8B).
- 🕵️ **Auto-Diagnostic CLI** : Détecte automatiquement les runners manquants et fournit les instructions/liens officiels pour l'installation.
- 🛡️ **Mémoire Ségréguée** : Chaque agent peut posséder ses propres souvenirs isolés tout en ayant accès au socle de connaissances global.
- 🛠️ **Capacités Étendues** : L'agent piloté peut utiliser VOS outils (Base de données, Scrapers, etc.).
- 🤖 **Multi-Agents** : Créez, configurez et gérez des personnalités d'agents isolées (Prompts & Settings dédiés).
- 📦 **Prêt pour l'Intégration** : Importable comme un module NPM dans vos autres projets.

---

## 🚀 Commencer (Guide Facile)

### Option 1 : Installation Globale NPM (Recommandé)

```bash
npm install -g overmind-mcp@2.0.0
```

**🎯 Après Installation NPM :**

Une fois installé, vous avez 2 options :

#### A. Mode Simple (Sans Docker - Recommandé pour débuter)

OverMind fonctionne **immédiatement** sans infrastructure Docker :

```bash
# Créer un agent simple
overmind create-agent --name expert-python --runner claude --prompt "Tu es un expert Python..."

# Lancer une analyse
overmind run-agent --runner claude --prompt "Analyse ce code..."
```

**✅ Avantages :**
- Installation immédiate
- Pas de Docker requis
- Fonctionne tout de suite
- Idéal pour tester et utiliser les features de base

#### B. Mode Avancé (Avec Docker - Recommandé pour Production)

Pour utiliser les **fonctionnalités avancées** (Swarm, Workflows long-running, Observabilité), vous avez besoin de l'infrastructure Docker.

**Suivez le guide d'installation :**
- 📄 [Windows avec PostgreSQL existant](https://github.com/DeamonDev888/overmind-mcp/blob/main/SETUP_WINDOWS.md)
- 📄 [Guide de déploiement complet](https://github.com/DeamonDev888/overmind-mcp/blob/main/DEPLOYMENT.md)

**Résumé du setup Docker :**
1. Installer Docker Desktop
2. Télécharger `docker-compose.overmind.yml` depuis [GitHub](https://github.com/DeamonDev888/overmind-mcp/blob/main/docker-compose.overmind.yml)
3. Lancer : `docker-compose -f docker-compose.overmind.yml up -d`

**✅ Avantages du Mode Avancé :**
- 🐳 RabbitMQ (Message Broker)
- ⏱️ Temporal (Workflows long-running)
- 📊 Observabilité (Prometheus, Grafana, Jaeger)
- 🧠 Vector DB (PostgreSQL + pgvector)

---

### Option 2 : Installation Locale (Développement)

Si vous souhaitez contribuer ou avoir la toute dernière version :

```bash
# 1. Cloner le repo
git clone https://github.com/DeamonDev888/overmind-mcp.git
cd overmind-mcp

# 2. Installer les dépendances
pnpm install

# 3. Build le projet
pnpm run build

# 4. Optionnel : Setup Windows automatique
node scripts/setup-windows.js
```

---

## 🎯 Mode d'Emploi

| Mode | Installation | Infrastructure | Features |
|------|-------------|----------------|----------|
| **Simple** | `npm install -g` | Aucune | OverMind base (agents, mémoire locale) |
| **Avancé** | `npm install -g` + Docker | Docker Desktop | Toutes les features (Swarm, Workflows, Observabilité) |
| **Dév** | Clone repo + `pnpm install` | Docker + PostgreSQL local | Toutes les features + accès au code source |

**Recommandation :** Commencez par le **Mode Simple**, puis passez au **Mode Avancé** quand vous avez besoin des fonctionnalités avancées !

---

### Option 3 : Utilisation comme Bibliothèque

Vous pouvez utiliser OverMind-MCP comme un module dans vos propres projets :

```typescript
import { runAgent, AgentManager, createSwarmOrchestrator } from 'overmind-mcp';

// 1. Initialisation
const manager = new AgentManager();
await manager.createAgent('expert-seo', 'Tu es un expert SEO...', 'claude');

// 2. Lancer une analyse
const { content, isError } = await runAgent({
  runner: 'claude',
  agentName: 'expert-seo',
  prompt: 'Analyse le site example.com',
});

// 3. Swarm Orchestration (mode avancé avec Docker)
const swarm = createSwarmOrchestrator({
  agents: [...],
  tasks: [...],
  maxParallelTasks: 5,
});
```

---
      "args": ["-y", "overmind-mcp@latest"]
    }
  }
}
```

---

### Option 2 : Installation Locale (Développement ou hébergement précis)

```bash
# 1. Cloner le repo localement
git clone https://github.com/DeamonDev888/overmind-mcp overmind-mcp
cd overmind-mcp

# 2. Installer les dépendances
pnpm install

# 3. Build le projet
pnpm run build
```

Pour que l'agent puisse voir vos autres serveurs MCP locaux, copiez le fichier d'exemple :

```bash
cp .mcp.json.example .mcp.json
```

**Configuration MCP (Client) pour l'Option 2 :**
Pour connecter ce runner à un client en pointant vers votre version locale compilée :

```json
{
  "mcpServers": {
    "overmind": {
      "command": "node",
      "args": ["/LE_CHEMIN_ABSOLU_VERS_LE_DOSSIER_CLONE/dist/bin/cli.js"]
    }
  }
}
```

---

## 📦 Utilisation comme Bibliothèque

Vous pouvez désormais importer le moteur du runner dans vos propres scripts :

```typescript
import { runAgent, AgentManager, updateConfig } from 'overmind-mcp';

// 1. Initialisation
updateConfig('./settings.json', './mcp.local.json');

// 2. Gestion des agents
const manager = new AgentManager();
await manager.createAgent('expert-seo', 'Tu es un expert SEO...', 'claude-4-6-sonnet');

// 3. Lancer une exécution via l'Orchestrateur Unifié
const { content, isError } = await runAgent({
  runner: 'claude',
  agentName: 'expert-seo',
  prompt: 'Analyse le site example.com',
  autoResume: true,
});

if (!isError) {
  console.log('🤖 Résultat:', content[0].text);
}
```

---

## 📂 Structure du Projet

- `src/services/` : Le cœur du système (Logique métier isolée en services).
- `src/tools/` : Les outils MCP qui appellent les services.
- `src/bin/cli.ts` : Le point d'entrée exécutable pour le terminal.
- `src/server.ts` : La définition du serveur FastMCP.
- `src/index.ts` : Les exports publics (API de la bibliothèque).
- `.claude/` : Stockage des agents (Prompts `.md` et Settings `.json`).

---

![Aperçu du Terminal](https://cdn.jsdelivr.net/npm/overmind-mcp@1.0.8/assets/terminal_preview.png)

_Note : L'**OverMind** punit et martyrise les **OpenClaw** qui n'écoutent pas._ 😈

_Projet propulsé par DeaMoN888 - 2026_
