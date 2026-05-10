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

## 🚀 Installation

### Globale via NPM (Recommandé)

```bash
npm install -g overmind-mcp@latest
```

**🎯 Ce qui est installé automatiquement :**

1. **Détection Docker** - Compatible avec Docker Desktop, Podman, Rancher Desktop, Colima, OrbStack
2. **PostgreSQL + pgvector** - Container Docker avec extension vectorielle (si absent)
3. **overmind-postgres-mcp** - Serveur MCP PostgreSQL vectoriel installé automatiquement
4. **Configuration complète** - Fichiers .env et .mcp.json générés automatiquement
5. **Base de données initialisée** - Tables OverMind créées automatiquement

**✅ Installation ultra-simplifiée :**
- 📦 **Taille** : 1-5 GB (au lieu de 8 GB)
- ⚡ **Rapide** : ~15 secondes chrono
- 🎯 **Automatique** : Tout configuré pour vous
- 🛡️ **Sécurisé** - Vos containers personnels sont protégés

### Configuration MCP

Pour utiliser OverMind dans votre IDE ou CLI préféré :

```json
{
  "mcpServers": {
    "overmind": {
      "command": "npx",
      "args": ["-y", "overmind-mcp@latest"]
    }
  }
}
```

---

## 🔧 Installation Locale (Dev)

Si vous souhaitez contribuer au projet :

```bash
# Cloner le repo
git clone https://github.com/DeamonDev888/overmind-mcp.git
cd overmind-mcp

# Installer les dépendances
pnpm install

# Builder le projet
pnpm run build
```

---

### Utilisation comme Bibliothèque

Vous pouvez utiliser OverMind-MCP comme un module dans vos propres projets TypeScript/JavaScript :

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
