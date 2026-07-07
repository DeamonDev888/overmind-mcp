<p align="center">
  <img src="assets/overmind.png" alt="OverMind-MCP Banner" width="293" height="253">
</p>

<div align="center">

# 🧠 OverMind-MCP

</div>

_Orchestrateur universel agents IA multi-modèles via MCP. Pilote Hermes, Claude-Code, Gemini-cli, QwenCli, Kilo/Cline, OpenClaw et plus — avec mémoire vectorielle PostgreSQL + pgvector._

<p align="center">
  <a href="https://discord.gg/4AR82phtBz"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logo-color=white" alt="Discord"></a>
  <a href="https://deamondev888.github.io/overmind-mcp/"><img src="https://img.shields.io/badge/Documentation-Live-00fff5?style=for-the-badge&logo=google-chrome&logo-color=white" alt="Live Doc"></a>
  <a href="https://www.npmjs.com/package/overmind-mcp"><img src="https://img.shields.io/npm/v/overmind-mcp?style=for-the-badge&logo=npm&color=CB383D" alt="NPM"></a>
</p>

**OverMind-MCP** orchestre une flotte illimitée d'agents IA via le Model Context Protocol. Compatible avec **Hermes (natif)**, **Claude-Code**, **Gemini-cli**, **QwenCli**, **Kilo/Cline**, **OpenClaw**, et extensible à tout runner CLI.

---

## ✨ Fonctionnalités

- 🔌 **Multi-Runner** : Hermes natif, Claude-Code, Gemini, Kilo, QwenCli, OpenClaw — 1 commande par runner
- 🧠 **Mémoire Vectorielle** : RAG 4096D via PostgreSQL + pgvector, isolation par agent
- 🏗️ **Architecture v3.1** : Profils Hermes canoniques avec `profile.yaml`, `workspace.yaml`, `state.db`
- 🌉 **Bridge HTTP JSON-RPC** : Orchestration A2A, scénarios, webhooks, sessions multi-tenant
- 🛡️ **Anti-Zombie** : 1 seul process HTTP partagé, processRegistry avec TTL + cleanup auto
- 📋 **14 Outils MCP** : run_agent, create_agent, memory_search/store, agent_control, etc.
- 🧠 **Mémoire par défaut** : tout agent créé via Overmind reçoit automatiquement le MCP `memory` (3 tools: memory_search/store/runs sur :3099). Pour l'accès complet 14 tools, utiliser `overmind` explicitement.
- 🅾️ **HTTP Singleton** : FastMCP httpStream — 1 serveur, tous les agents

---

## 🚀 Installation

### Globale via NPM (Recommandé)

```bash
npm install -g overmind-mcp@latest
```

Le postinstall crée `~/.overmind/` automatiquement :

```
~/.overmind/                              ← racine unique
├── .mcp.json                             ← MCP canonique (1 fichier)
├── .env                                  ← secrets globaux
├── bridge/
│   ├── agents.json                       ← registre sessions unifié
│   └── process-registry.json             ← runtime live
└── hermes/                               ← HERMES_HOME (injecté par HermesRunner)
    └── profiles/                         ← SOURCE homes (unique)
        └── <name>/
            ├── config.yaml               ← Hermes config (model, provider)
            ├── SOUL.md                   ← system prompt
            ├── .env                      ← credentials spécifiques
            ├── state.db                  ← state local (SQLite)
            └── skills/                   ← skills personnalisés
```

### Configuration MCP Client

```json
{
  "mcpServers": {
    "overmind": {
      "type": "http",
      "url": "http://localhost:3099/mcp"
    },
    "postgres": {
      "type": "http",
      "url": "http://localhost:5433/mcp"
    }
  }
}
```

### Lancer le serveur

```bash
# Foreground (dev)
overmind --transport httpStream --port 3099

# Systemd (prod)
overmind-setup  # installe PostgreSQL + pgvector si absent
```

---

## 🔧 Installation Locale (Dev)

```bash
git clone https://github.com/DeamonDev888/overmind-mcp.git
cd overmind-mcp
pnpm install
pnpm run build
pnpm run test
```

---

## 📚 Utilisation

### CLI

```bash
# Démarrer le serveur MCP
overmind --transport httpStream --port 3099

# Bridge (Discord, SMS, webhooks)
overmind-bridge server --port 3001

# Gestion PostgreSQL
overmind-postgres-mcp up     # docker-compose up
overmind-postgres-mcp status # vérifier l'état
```

### Bibliothèque (ESM)

```typescript
import { runAgent, AgentManager } from 'overmind-mcp';

// Créer un agent Hermes
const manager = new AgentManager();
await manager.createAgent({
  name: 'analyst',
  runner: 'hermes',
  prompt: 'Tu es un analyste financier.',
  model: 'MiniMax-M3',
});

// Lancer une mission
const { content, isError } = await runAgent({
  runner: 'hermes',
  agentName: 'analyst',
  prompt: 'Analyse BTCUSDT',
  autoResume: true,
});
```

### Outils MCP (14)

| Outil | Description |
|-------|-------------|
| `run_agent` | Lance un agent (Hermes/Claude/Kilo/etc.) |
| `run_agents_parallel` | Lance N agents en parallèle |
| `create_agent` | Crée un profil Hermes + SOUL.md + profile.yaml |
| `list_agents` | Liste tous les agents (Hermes + Claude) |
| `delete_agent` | Supprime un agent |
| `update_agent_config` | Modifie model, provider, credentials, SOUL.md |
| `get_agent_configs` | Affiche config.yaml + SOUL.md d'un agent |
| `memory_search` | Recherche vectorielle (pgvector) |
| `memory_store` | Stocke un souvenir (avec embedding auto) |
| `memory_runs` | Historique des exécutions |
| `create_prompt` / `edit_prompt` | Gestion des prompts Claude |
| `agent_control` | Status, stream, kill, wait |
| `config_example` | Exemple de configuration |

---

## 📂 Structure du Projet

```
overmind-mcp/
├── src/
│   ├── bin/                # Entrypoints CLI (cli.ts, overmind-bridge.ts)
│   ├── bridge/             # Bridge HTTP JSON-RPC + scénarios + webhooks
│   ├── lib/                # Config, logger, sessions, processRegistry
│   ├── memory/             # Provider PostgreSQL + pgvector
│   ├── services/           # Runners: Hermes, Claude, Gemini, Kilo, etc.
│   ├── tools/              # 14 outils MCP (1 fichier par tool)
│   └── __tests__/          # Tests unitaires (vitest)
├── scripts/                # setup, postgres-manager, postinstall, migration
├── bin/                    # Launchers (bat, sh, launch.cjs)
├── docs/                   # Documentation + site web GitHub Pages
└── assets/                 # Images et ressources
```

---

## 🛡️ Anti-Zombie Architecture

1 seul serveur HTTP FastMCP partagé par tous les agents. Le `processRegistry`
traque les PIDs avec TTL automatique (1h) et cleanup background (5min).

```
Agent 1 ──┐
Agent 2 ──┼──→ Overmind MCP :3099 (1 process FastMCP)
Agent 3 ──┘
         └──→ PostgreSQL :5433 (pgvector)
```

---

## 🔄 Migration v3.1



![Aperçu du Terminal](assets/terminal_preview.png)

_Projet propulsé par DeaMoN888 — 2026_
