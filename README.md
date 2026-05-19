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

**OverMind-MCP** est une conscience supérieure conçue pour orchestrer, commander et automatiser une flotte illimitée d'agents IA. Compatible avec **Claude-Code, Gemini-cli, QwenCli, Nous Hermes, Kilo/Cline, OpenClaw**, et prêt pour **GLM, Minimax, Kimi, Ollama** et bien d'autres.

Il transforme les outils CLI isolés en une force coordonnée, pilotable par API ou par MCP, capable d'exécuter des missions complexes. Expert en outils MCP, il peut être scripté pour les faire fonctionner ensemble et les mettre en production.

- 🔌 **Contrôle Total** : Lancez des missions complexes via MCP ou directement via le code (Claude, Gemini, QwenCli, Hermes).
- 🏗️ **Architecture Pro** : Basé sur des services (`AgentManager`, `ClaudeRunner`, `PromptManager`) pour une stabilité maximale.
- 🧠 **Mémoire Haute-Performance (4096D)** : Système RAG intégré via PostgreSQL + `pgvector`.
- 🛡️ **Mémoire Ségréguée** : Chaque agent peut posséder ses propres souvenirs isolés tout en ayant accès au socle global.
- 🤖 **Multi-Agents** : Créez, configurez et gérez des personnalités d'agents isolées (Prompts & Settings dédiés).
- 📦 **Prêt pour l'Intégration** : Importable comme un module NPM dans vos autres projets.
- 🅾️ **HTTP Singleton** : Plus de zombies — 1 serveur HTTP partagé par tous les agents.

---

## 🚀 Installation

### Globale via NPM (Recommandé)

```bash
npm install -g overmind-mcp@latest
```

### Configuration MCP (HTTP)

Après installation, configurez votre client MCP avec le模式下 :

```json
{
  "mcpServers": {
    "overmind": {
      "transport": "http-stream",
      "url": "http://localhost:3099"
    },
    "memory": {
      "transport": "http-stream",
      "url": "http://localhost:3099"
    },
"postgresql": {
      "transport": "http-stream",
      "url": "http://localhost:5433",
      "description": "PostgreSQL MCP - Base de données vectorielle"
    }
  }
}
```

---

## 🔧 Installation Locale (Dev)

```bash
git clone https://github.com/DeamonDev888/overmind-mcp.git
cd overmind-mcp
pnpm install
pnpm run build
```

---

### Utilisation comme Bibliothèque

```typescript
import { runAgent, AgentManager, updateConfig } from 'overmind-mcp';

// 1. Initialisation
updateConfig('./settings.json', './mcp.local.json');

// 2. Gestion des agents
const manager = new AgentManager();
await manager.createAgent('expert-seo', 'Tu es un expert SEO...', 'claude');

// 3. Lancer une exécution
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

```
Workflow/
├── 📦 bin/                    # Scripts d'installation
├── 🐳 docker/                 # Configuration Docker
├── 🗄️ db/                     # Scripts base de données
├── ⚙️ config/                 # Configurations MCP
├── 📚 docs/                   # Documentation
├── 💻 src/                    # Code source
│   ├── bin/                   # Points d'entrée CLI
│   ├── lib/                   # Bibliothèques partagées
│   ├── services/              # Services métier
│   └── tools/                # Outils MCP
├── 🧪 tests/                  # Tests unitaires
└── 🔧 scripts/               # Scripts de maintenance
```

---

## 🛡️ Anti-Zombie Architecture

L'ancien problème : chaque agent spawn son propre node.exe MCP server → zombies.

La solution : 1 seul serveur HTTP par service, partagé par tous les agents.

```
Agent 1 ──┐
Agent 2 ──┼──→ Overmind:3099 (1 process)
Agent 3 ──┘
         └──→ PostgreSQL:5433 (1 process)
         └──→ Discord:3141 (1 process)
```

Plus de node.exe par agent = plus de zombies.

---

![Aperçu du Terminal](https://cdn.jsdelivr.net/npm/overmind-mcp@1.0.8/assets/terminal_preview.png)

_Projet propulsé par DeaMoN888 - 2026_