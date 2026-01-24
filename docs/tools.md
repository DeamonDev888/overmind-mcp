# 🛠️ Liste des Outils (Claude-Code MCP Runner)

Ce serveur expose les outils suivants via le protocole MCP.

## 🤖 Gestion des Agents

### `run_agent`

**Description** : Exécute une commande sur l'agent Claude configuré via CLI. C'est l'outil principal pour faire "réfléchir" et "agir" l'agent.

- **Paramètres** :
  - `prompt` (string, requis) : La consigne à envoyer à l'agent.
  - `sessionId` (string, optionnel) : Un identifiant unique pour maintenir le contexte d'une conversation.
  - `agentName` (string, optionnel) : Nom de l'agent (pour logging, monitoring et persistance).
  - `autoResume` (boolean, optionnel, défaut: `false`) : Si `true` (et `agentName` fourni), reprend automatiquement la dernière conversation de cet agent.

### `create_agent`

**Description** : Crée un nouvel agent (structure de fichiers complète) compatible avec ce runner.

- **Paramètres** :
  - `name` (string, requis) : Nom de l'agent (ex: `agent_finance`). Sera utilisé pour les noms de fichiers (`.claude/agents/agent_finance.md`).
  - `prompt` (string, requis) : Le prompt système (instructions) initial de l'agent.
  - `model` (string, optionnel, défaut: `claude-sonnet-4-5`) : Modèle à utiliser. Supporte tous les modèles compatibles avec Claude Code (Anthropic, OpenAI, DeepSeek, Glm, Minimax, etc.).
  - `copyEnvFrom` (string, optionnel) : Chemin vers un fichier settings existant pour copier les clés API.

### `list_agents`

**Description** : Liste tous les agents disponibles dans le projet.

- **Paramètres** :
  - `details` (boolean, optionnel, défaut: `false`) : Si `true`, affiche les détails complets (Modèle utilisé, Serveurs MCP activés, taille du prompt).

### `delete_agent`

**Description** : Supprime définitivement un agent (Prompt `.md` et Config `.json`).

- **Paramètres** :
  - `name` (string, requis) : Nom de l'agent à supprimer.

### `update_agent_config`

**Description** : Met à jour la configuration technique d'un agent existant.

- **Paramètres** :
  - `name` (string, requis) : Nom de l'agent à modifier.
  - `model` (string, optionnel) : Change le modèle IA. Supporte tous les modèles compatibles avec Claude Code (Anthropic, OpenAI, DeepSeek, Glm, Minimax, etc.).
  - `mcpServers` (array<string>, optionnel) : Remplace la liste des serveurs MCP activés (ex: `["postgresql", "news"]`).
  - `env` (object, optionnel) : Ajoute ou écrase des variables d'environnement (ex: `{"API_KEY": "xxx"}`).

## 📝 Gestion des Prompts (Personas)

### `create_prompt`

**Description** : Crée ou écrase un fichier prompt Markdown (Persona) dans `.claude/agents/`.

- **Paramètres** :
  - `name` (string, requis) : Nom du fichier (sans extension).
  - `content` (string, requis) : Contenu Markdown du prompt.

### `edit_prompt`

**Description** : Modifie un prompt existant en remplaçant un bloc de texte spécifique (Search & Replace). Retourne un diff visuel.

- **Paramètres** :
  - `name` (string, requis) : Nom du fichier prompt à modifier.
  - `search` (string, requis) : Le texte exact à rechercher.
  - `replace` (string, requis) : Le nouveau texte de remplacement.
