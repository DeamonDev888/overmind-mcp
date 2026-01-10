# 🛠️ Liste des Outils (Claude-Code MCP Runner)

Ce serveur expose les outils suivants via le protocole MCP.

## 🤖 Gestion des Agents

### `run_agent`

**Description** : Exécute une commande sur l'agent Claude configuré via CLI. C'est l'outil principal pour faire "réfléchir" et "agir" l'agent.

- **Paramètres** :
  - `prompt` (string, requis) : La consigne à envoyer à l'agent.
  - `sessionId` (string, optionnel) : Un identifiant unique pour maintenir le contexte d'une conversation.
  - `agentName` (string, optionnel) : Nom de l'agent pour le logging.

### `create_agent`

**Description** : Crée un nouvel agent (structure de fichiers complète) compatible avec ce runner.

- **Paramètres** :
  - `name` (string, requis) : Nom de l'agent (ex: `agent_finance`). Sera utilisé pour les noms de fichiers (`.claude/agents/agent_finance.md`).
  - `prompt` (string, requis) : Le prompt système (instructions) initial de l'agent.
  - `model` (string, optionnel) : Modèle à utiliser (défaut: `claude-3-5-sonnet-20241022`).
  - `copyEnvFrom` (string, optionnel) : Chemin vers un fichier settings existant pour copier les clés API.

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

## 🔍 Introspection

### `inspect_agent_config` (Prompt)

**Description** : Ce n'est pas un outil mais une _Resource Template_ MCP (ou Prompt). Il permet à l'agent de lire sa propre configuration active (settings + prompt système) pour le débogage ou l'auto-amélioration.
