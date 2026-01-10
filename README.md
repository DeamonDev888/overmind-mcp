# 🤖 Claude-Code MCP Runner

![Architecture du projet](assets/banner_project.png)

## 📋 Présentation

**Claude-Code MCP Runner** est un serveur **MCP (Model Context Protocol)** puissant, construit avec **FastMCP** (TypeScript/Node.js). Il agit comme une passerelle universelle permettant à d'autres agents ou interfaces (comme Discord, n8n, ou Claude Desktop) de piloter le CLI **Claude Code** (Anthropic).

Son but est d'encapsuler la puissance de l'agent autonome d'Anthropic dans un outil standardisé MCP, utilisable via une simple connexion.

### ✨ Fonctionnalités Clés

- **🔌 Outil MCP (`run_agent`)** : Exécutez des prompts complexes sur l'agent Claude via un simple appel d'outil standardisé.
- **🛠️ Support .mcp.json** : L'agent piloté a lui-même accès à tous vos autres serveurs MCP (PostgreSQL, Scraping, etc.) définis localement.
- **🧠 Introspection** : Outil de prompt (`inspect_agent_config`) pour vérifier quel agent est chargé et ses directives.
- **� FastMCP** : Architecture moderne, modulaire et légère, remplaçant l'ancienne API REST.

---

## 🏗️ Architecture

![MCP Orchestration Hub](assets/orchestration_hub.png)

Le projet utilise **FastMCP** pour exposer des outils via `stdio` :

1.  **MCP Server** : Reçoit la demande d'exécution via le protocole MCP.
2.  **Config Loader** : Charge dynamiquement le profil de l'agent (`settingsM.json`, `.mcp.json`).
3.  **Claude Process** : Lance une instance isolée et sécurisée de `claude` (CLI) avec le contexte précis.
4.  **Feedback Loop** : Capture la sortie JSON structurée de Claude et la retourne comme résultat de l'outil.

---

## 🚀 Guide d'Utilisation

### 1. Installation

```bash
# Installer les dépendances
pnpm install

# Compiler le projet TypeScript
pnpm build
```

### 2. Configuration

Pour permettre au runner d'accéder à vos autres serveurs MCP (PostgreSQL, Discord, etc.), dupliquez le fichier d'exemple :

```bash
# Copier le fichier de configuration exemple
cp .mcp.json.example .mcp.json
```

Ouvrez ensuite `.mcp.json` et adaptez les chemins d'accès vers vos serveurs locaux si nécessaire.

### 3. Démarrer un Agent (Exemple : Bot News)

![Agent News Visual](assets/agent_news_visual.png)

Le projet inclut un lanceur dédié pour l'"Agent News" (spécialiste finance).

```bash
pnpm bot:news
```

Cela démarre le serveur MCP sur l'entrée/sortie standard (stdio).

### 4. Utilisation avec MCP Inspector

Pour tester votre serveur et ses outils via une interface web graphique :

```bash
npx @modelcontextprotocol/inspector node dist/start_bot.js
```

### 5. Intégration dans Claude Desktop

Ajoutez ce serveur à votre configuration globale Claude Desktop (`claude_desktop_config.json`) pour permettre à Claude de se piloter lui-même (Inception !) :

```json
{
  "mcpServers": {
    "claude-code-runner": {
      "command": "node",
      "args": [
        "C:/Users/Deamon/Desktop/Backup/Serveur MCP/Workflow/dist/index.js"
      ]
    }
  }
}
```

---

## 📦 Outils Disponibles

> 📄 **[Voir la documentation détaillée des outils](docs/tools.md)**

### `run_agent`

L'outil principal pour interagir avec le CLI.

- **prompt** (string): La consigne à donner à l'agent (ex: "Analyse les dernières news ZoneBourse").
- **sessionId** (string, optionnel): ID pour reprendre une conversation existante.
- **agentName** (string, optionnel): Tag pour les logs.

### `inspect_agent_config` (Prompt)

Permet de lire la configuration active (settings + prompt système) pour le débogage.

---

## 📂 Structure du Projet

```text
Workflow/
├── assets/                   # Images et ressources graphiques
├── dist/                     # Code compilé (ESM)
├── src/
│   ├── index.ts              # Serveur FastMCP Générique
│   ├── start_bot.ts          # Lanceur Spécifique (News)
│   ├── tools/                # Définition des outils (run_claude)
│   ├── prompts/              # Définition des prompts (inspect)
│   └── lib/                  # Utilitaires (Config)
├── .claude/                  # Configuration de l'Agent News
├── .mcp.json                 # Configuration des sous-serveurs MCP
└── package.json
```

![Terminal Preview](assets/terminal_preview.png)

---

_Propulsé par DeaMoN888 - 2026_
