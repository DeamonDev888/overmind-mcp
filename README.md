# 🤖 Claude-Code MCP Runner

_Le Pilote Automatique pour vos Agents IA._

![Architecture du projet](assets/banner_project.png)

## 👋 C'est quoi ?

Il s'agit d'une véritable télécommande universelle pour **Claude-Code** et d'autres outils CLI similaires. Grâce à ce projet, n'importe quel environnement de développement ou client compatible (comme KiloCode, Antigravity, ou même un autre Claude-Code) peut **piloter un Agent IA** de manière autonome via le protocole MCP, sans jamais avoir besoin d'utiliser directement le terminal.

C'est une "passerelle" qui transforme le puissant Claude Code (sans Anthropic) en une flotte d agent simple et efficace à utiliser.

## ✨ Ce que ça fait

- **🔌 Contrôle Total** : Lancez des missions complexes ("Analyse ces fichiers", "Résume cette page") via une simple commande.
- **🛠️ Capacités Étendues** : L'agent piloté peut utiliser VOS outils (Base de données, Scrapers, etc.).
- **🔗 Compatible** : Fonctionne avec tout client compatible MCP (Claude Desktop, Cursor, etc.).
- **🤖 Multi-Agents** : Créez, configurez et gérez plusieurs personnalités d'agents facilement. Lancer un pipeline d'agents a partir d'un script.

---

## 🚀 Commencer (Guide Facile)

### 1. Prérequis

Assurez-vous d'avoir installé sur votre machine :

- **Node.js** (v18 ou plus récent)
- **pnpm** (recommandé) ou npm

### 2. Installation

Ouvrez un terminal dans ce dossier et lancez :

```bash
# 1. Installe tout le nécessaire
pnpm install

# 2. Construit le projet
pnpm run build
```

### 3. Configuration Rapide

Pour que l'agent puisse voir vos autres serveurs MCP, copiez le fichier d'exemple :

```bash
cp .mcp.json.example .mcp.json
```

_(C'est dans ce fichier `.mcp.json` que vous listez les outils que l'agent a le droit d'utiliser !)_

### 4. Lancer le Serveur

Pour démarrer le serveur (commande de base) :

```bash
pnpm start
```

Ou pour lancer le bot configuré pour les News :

```bash
pnpm bot:news
```

---

## 📦 Comment l'utiliser ?

### Via un Client MCP (Claude Code, KiloCode, Cline, Antigravity...)

Ajoutez ceci à votre configuration (ex: `claude_desktop_config.json` ou réglages MCP du client) pour donner à votre Agent IA la capacité de piloter d'autres agents (Inception !) :

```json
{
  "mcpServers": {
    "claude-runner": {
      "command": "node",
      "args": ["CHEMIN_ABSOLU_VERS_CE_DOSSIER/dist/index.js"]
    }
  }
}
```

Une fois configuré, vous aurez accès à de nouveaux outils. Vous pourrez dire à votre agent :

> _"Crée un nouvel agent 'Chatbot' et demande-lui de se connecter au serveur MCP_Chat_bot pour répondre."_

> _"Crée un nouvel agent 'RAG', connecte-le au serveur MCP_RAG et demande-lui de parcourir la base de données pour lister les 10 clients les plus récents, puis de répondre sur SMS_mcp au numéro 0612345678 toutes les 10 minutes et de me faire un résumé de ce qui s'est passé."_

> _"Crée un nouvel agent 'Discord' et connecte-le au serveur MCP_Discord pour répondre sur le salon #bot."_

### Les Outils Principaux

> 📄 **[Voir la liste complète et détaillée des outils](docs/tools.md)**

Voici les commandes magiques à votre disposition :

- **`run_agent`** : Donnez un ordre à l'agent.
  - `prompt`: Votre instruction.
  - `agentName`: (Optionnel) Quel agent doit travailler (ex: "news").
  - `autoResume`: (Optionnel, `true`/`false`) Si Vrai, l'agent se souvient de la conversation précédente !
  - `sessionId`: (Optionnel) Pour forcer la reprise d'une conversation spécifique.
- **`create_agent`** : Créez un nouveau "collègue" virtuel spécialisé.
- **`list_agents`** : Affichez l'équipe d'agents disponibles.
- **`delete_agent`** : Supprimez un agent dont vous n'avez plus besoin.
- **`update_agent_config`** : Modifiez les réglages (modèle, variables) d'un agent.

---

## 📂 Où sont les choses ?

- `assets/` : Les images du projet.
- `dist/` : Le code compilé (ne touchez pas à ça).
- `src/` : Le code source (pour les développeurs curieux).
- `.claude/` : Le dossier où sont stockés les cerveaux (prompts) et réglages de vos agents.
- `.mcp.json` : La carte des serveurs MCP connectés.

---

![Aperçu du Terminal](assets/terminal_preview.png)

_Projet propulsé par DeaMoN888 - 2026_
