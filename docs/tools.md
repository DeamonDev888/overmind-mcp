# 🛠️ Documentation Complète des Outils OverMind MCP

Ce serveur MCP expose des outils d'orchestration multi-agents avec isolation de mémoire sémantique. Compatible avec **8 runners** différents : Claude Code, Gemini, Kilocode, Qwen Code, OpenClaw, Cline, OpenCode et Trae.

---

## 📖 Table des Matières

- [🤖 Exécution d'Agents](#-exécution-dagents)
- [🎨 Gestion des Prompts](#-gestion-des-prompts)
- [🧠 Mémoire OverMind](️-mémoire-overmind)
- [⚙️ Gestion des Agents](️-gestion-des-agents)

---

## 🤖 Exécution d'Agents

### `run_agent` (GÉNÉRIQUE - TOUS RUNNERS)

**Description** : Exécute une commande sur un agent IA via le runner spécifié. C'est l'outil principal d'orchestration.

**Runners supportés** : `claude`, `gemini`, `kilo`, `qwen`, `openclaw`, `cline`, `opencode`, `trae`

**Paramètres** :

- **`runner`** (string, requis) : Type de runner à utiliser
  - Valeurs possibles : `claude`, `gemini`, `kilo`, `qwen`, `openclaw`, `cline`, `opencode`, `trae`
- **`prompt`** (string, requis) : La consigne à envoyer à l'agent
- **`sessionId`** (string, optionnel) : ID de session pour continuer une conversation existante
- **`agentName`** (string, optionnel) : Nom de l'agent (pour logging, monitoring et persistance mémoire)
- **`autoResume`** (boolean, optionnel, défaut: `false`) : Si `true` et `agentName` fourni, reprend automatiquement la dernière conversation de cet agent
- **`mode`** (enum, optionnel) : Mode spécifique pour certains runners :
  - **Kilo** : `code`, `architect`, `ask`, `debug`, `orchestrator`
  - **Cline** : `plan`, `act`

**Exemple d'utilisation** :

```javascript
run_agent({
  runner: 'claude',
  agentName: 'expert_python',
  prompt: 'Analyse ce code et corrige les bugs',
  autoResume: true,
});

run_agent({
  runner: 'kilo',
  agentName: 'architecte',
  mode: 'architect',
  prompt: 'Conçois une API REST scalable',
});
```

**Valeurs de retour** :

- `result` : Résultat de l'exécution (texte)
- `SESSION_ID` : Identifiant de session (pour reprise)
- `RUNNER` : Runner utilisé

---

### `run_claude` (SPÉCIFIQUE CLAUDE CODE)

**Description** : Exécute un agent via Claude Code CLI.

**Paramètres** :

- **`prompt`** (string, requis) : La consigne à envoyer à l'agent
- **`sessionId`** (string, optionnel) : ID de session pour continuer une conversation
- **`agentName`** (string, optionnel) : Nom de l'agent (pour logging et persistance)
- **`autoResume`** (boolean, optionnel, défaut: `false`) : Si `true`, reprend automatiquement la dernière conversation de l'agent

**Exemple** :

```javascript
run_claude({
  agentName: 'code_reviewer',
  prompt: 'Review ce PR et suggère des améliorations',
  autoResume: true,
});
```

---

### `run_gemini` (SPÉCIFIQUE GEMINI)

**Description** : Exécute un agent via Gemini CLI.

**Paramètres** :

- **`prompt`** (string, requis) : La consigne à envoyer à l'agent
- **`sessionId`** (string, optionnel) : ID de session pour continuer une conversation
- **`agentName`** (string, optionnel) : Nom de l'agent
- **`autoResume`** (boolean, optionnel, défaut: `false`) : Reprendre la conversation

---

### `run_kilo` (SPÉCIFIQUE KILOCODE)

**Description** : Exécute un agent via Kilocode CLI avec modes avancés.

**Paramètres** :

- **`prompt`** (string, requis) : La consigne à envoyer à l'agent
- **`mode`** (enum, optionnel) : Mode de fonctionnement
  - `code` : Mode code standard (défaut)
  - `architect` : Mode architecture logicielle
  - `ask` : Mode questions-réponses
  - `debug` : Mode débogage
  - `orchestrator` : Mode orchestration multi-tâches
- **`sessionId`** (string, optionnel) : ID de session
- **`agentName`** (string, optionnel) : Nom de l'agent
- **`autoResume`** (boolean, optionnel, défaut: `false`) : Reprendre la conversation

**Exemple** :

```javascript
run_kilo({
  agentName: 'senior_architect',
  mode: 'architect',
  prompt: 'Conçois une architecture micro-services pour cette application',
});
```

---

### `run_qwen` (SPÉCIFIQUE QWEN CODE)

**Description** : Exécute un agent via Qwen Code CLI.

**Paramètres** :

- **`prompt`** (string, requis) : La consigne à envoyer à l'agent
- **`sessionId`** (string, optionnel) : ID de session
- **`agentName`** (string, optionnel) : Nom de l'agent
- **`autoResume`** (boolean, optionnel, défaut: `false`) : Reprendre la conversation

---

### `run_openclaw` (SPÉCIFIQUE OPENCLAW)

**Description** : Exécute un agent via OpenClaw CLI.

**Paramètres** :

- **`prompt`** (string, requis) : La consigne à envoyer à l'agent
- **`sessionId`** (string, optionnel) : ID de session
- **`agentName`** (string, optionnel) : Nom de l'agent
- **`autoResume`** (boolean, optionnel, défaut: `false`) : Reprendre la conversation

---

### `run_cline` (SPÉCIFIQUE CLINE)

**Description** : Exécute un agent via Cline CLI avec modes planification/action.

**Paramètres** :

- **`prompt`** (string, requis) : La consigne à envoyer à l'agent
- **`mode`** (enum, optionnel) : Mode de fonctionnement
  - `plan` : Mode planification (stratégie)
  - `act` : Mode action (exécution autonome)
- **`sessionId`** (string, optionnel) : ID de session
- **`agentName`** (string, optionnel) : Nom de l'agent
- **`autoResume`** (boolean, optionnel, défaut: `false`) : Reprendre la conversation

**Exemple** :

```javascript
run_cline({
  agentName: 'planner_dev',
  mode: 'plan',
  prompt: "Planifie l'implémentation d'un système d'auth",
});

run_cline({
  agentName: 'executor_bot',
  mode: 'act',
  prompt: 'Implémente les endpoints API définis',
});
```

---

### `run_opencode` (SPÉCIFIQUE OPENCODE)

**Description** : Exécute un agent via OpenCode CLI.

**Paramètres** :

- **`prompt`** (string, requis) : La consigne à envoyer à l'agent
- **`sessionId`** (string, optionnel) : ID de session
- **`agentName`** (string, optionnel) : Nom de l'agent
- **`autoResume`** (boolean, optionnel, défaut: `false`) : Reprendre la conversation

---

### `run_trae` (SPÉCIFIQUE TRAE)

**Description** : Exécute un agent via Trae CLI.

**Paramètres** :

- **`prompt`** (string, requis) : La consigne à envoyer à l'agent
- **`sessionId`** (string, optionnel) : ID de session
- **`agentName`** (string, optionnel) : Nom de l'agent
- **`autoResume`** (boolean, optionnel, défaut: `false`) : Reprendre la conversation

---

## 🎨 Gestion des Prompts

### `create_prompt`

**Description** : Crée un nouveau fichier prompt Markdown (Persona) dans `.claude/agents/`.

**Paramètres** :

- **`name`** (string, requis) : Nom du fichier sans extension (ex: `analyse_financiere`)
- **`content`** (string, requis) : Contenu Markdown complet du prompt

**Exemple** :

```javascript
create_prompt({
  name: 'expert_crypto',
  content: `# Expert Cryptocurrency Analyst

Tu es un expert en analyse de marchés crypto.
Spécialités: DeFi, NFTs, trading algorithms.
...`,
});
```

**Valeur de retour** :

```
✅ Prompt 'expert_crypto' créé avec succès.
📍 /chemin/vers/.claude/agents/expert_crypto.md
```

---

### `edit_prompt`

**Description** : Modifie un prompt existant en remplaçant un bloc de texte spécifique (Search & Replace).

**Paramètres** :

- **`name`** (string, requis) : Nom du fichier prompt à modifier (sans extension)
- **`search`** (string, requis) : Le texte exact à rechercher
- **`replace`** (string, requis) : Le nouveau texte de remplacement

**Exemple** :

```javascript
edit_prompt({
  name: 'expert_crypto',
  search: 'Spécialités: DeFi, NFTs, trading algorithms.',
  replace: 'Spécialités: DeFi, NFTs, trading algorithms, AI analysis.',
});
```

**Valeur de retour** :

```
✅ Prompt 'expert_crypto' modifié avec succès.

🔻 Avant :
Spécialités: DeFi, NFTs, trading algorithms.

🔺 Après :
Spécialités: DeFi, NFTs, trading algorithms, AI analysis.
```

---

## 🧠 Mémoire OverMind

La mémoire OverMind permet une **isolation sémantique par agent** avec recherche vectorielle et historique des exécutions.

### `memory_store`

**Description** : Mémorise durablement une connaissance, décision ou pattern dans la base de données vectorielle.

**Paramètres** :

- **`text`** (string, requis, min 1 caractère) : Texte ou connaissance à mémoriser
- **`source`** (enum, optionnel, défaut: `user`) : Type de connaissance
  - `user` : Connaissance manuelle (entrée par l'utilisateur)
  - `agent` : Connaissance automatique (générée par un agent)
  - `pattern` : Pattern de workflow réutilisable
  - `error` : Bug connu et solution
  - `decision` : Choix architectural important
- **`agent_name`** (string, optionnel) : Nom de l'agent (détecté automatiquement si exécuté via OverMind)

**Exemple** :

```javascript
memory_store({
  text: "Le projet utilise PostgreSQL avec l'extension pgvector pour la recherche sémantique. La configuration est dans docker-compose.yml",
  source: 'decision',
  agent_name: 'senior_dev',
});
```

**Valeur de retour** :

```
✅ Souvenir mémorisé [decision]
ID: 550e8400-e29b-41d4-a716-446655440000

"Le projet utilise PostgreSQL avec l'extension pgvector..."
```

---

### `memory_search`

**Description** : Recherche hybride (sémantique + full-text) dans la mémoire OverMind.

**Paramètres** :

- **`query`** (string, requis) : Requête de recherche
- **`limit`** (integer, optionnel, défaut: 10, min: 1, max: 50) : Nombre maximum de résultats
- **`include_runs`** (boolean, optionnel, défaut: `false`) : Inclure l'historique des exécutions d'agents
- **`agent_name`** (string, optionnel) : Filtrer par nom d'agent (détecté automatiquement si exécuté via OverMind)

**Exemple** :

```javascript
memory_search({
  query: 'configuration PostgreSQL pgvector',
  limit: 5,
  include_runs: false,
});
```

**Valeur de retour** :

```
🧠 3 résultat(s) trouvé(s) pour "configuration PostgreSQL pgvector"

1. [decision] (score: 0.892) — 2025-01-15
Le projet utilise PostgreSQL avec l'extension pgvector...

---

2. [pattern] (score: 0.845) — 2025-01-10
Pattern de connexion PostgreSQL avec pool...

---

3. [error] (score: 0.781) — 2025-01-08
Erreur pgvector extension not found...
```

---

### `memory_runs`

**Description** : Liste l'historique des exécutions d'agents enregistrées par OverMind avec statistiques.

**Paramètres** :

- **`runner`** (string, optionnel) : Filtrer par runner (ex: `claude`, `gemini`, `kilo`). Vide = tous les runners
- **`limit`** (integer, optionnel, défaut: 20, min: 1, max: 100) : Nombre de runs à retourner
- **`stats`** (boolean, optionnel, défaut: `false`) : Afficher les statistiques globales d'orchestration
- **`agent_name`** (string, optionnel) : Filtrer par agent (détecté automatiquement)

**Exemples** :

```javascript
// Liste les derniers runs
memory_runs({
  runner: 'claude',
  limit: 10,
});

// Affiche les statistiques
memory_runs({
  stats: true,
});
```

**Valeur de retour (liste)** :

```
🕐 10 run(s) pour claude

✅ **[claude] (expert_python)** — 2025-01-15 14:30:22 — 2.3s
> Analyse ce code Python
> Le code utilise asyncio avec une approche producteur-consommateur...

---

❌ **[claude]** — 2025-01-15 14:25:10 — 0.8s
> Bug dans la fonction de tri
> TypeError: 'NoneType' object is not iterable...
```

**Valeur de retour (stats)** :

```
📊 OverMind Statistics (pour l'agent expert_python)

- Runs totaux : 156
- Connaissances stockées : 42

Par runner :
  • claude : 89 runs (87 ✅)
  • kilo : 45 runs (43 ✅)
  • gemini : 22 runs (20 ✅)
```

---

## ⚙️ Gestion des Agents

### `create_agent`

**Description** : Crée un nouvel agent complet (Prompt + Config) compatible avec tous les runners.

**Paramètres** :

- **`name`** (string, requis) : Nom unique de l'agent (ex: `sniper_analyst`, `expert_python`)
  - **Règle** : Lettres, chiffres, tirets (-) et underscores (\_) uniquement
  - Ce nom servira d'identifiant pour sa mémoire sémantique isolée
- **`prompt`** (string, requis) : Le prompt système OBLIGATOIRE
  - Définit le persona de l'agent
  - Spécifie ses missions
  - Liste les outils MCP autorisés
  - Ordonne de consulter/enrichir systématiquement sa mémoire OverMind
- **`runner`** (enum, optionnel, défaut: `claude`) : Type de runner
  - Valeurs : `claude`, `gemini`, `kilo`, `qwen`, `openclaw`, `cline`, `opencode`, `trae`
- **`model`** (string, optionnel) : Modèle IA à utiliser
  - Exemples : `z.ai/glm-4.7`, `MiniMax-Text-01`, `deepseek-reasoner`, `moonshot-v1-32k`
  - Défaut : Modèle configuré dans les variables d'environnement
- **`copyEnvFrom`** (string, optionnel) : Chemin vers un settings.json existant pour copier les variables d'environnement
  - Exemple : `.claude/settingsM.json`
- **`mode`** (enum, optionnel) : Mode spécifique pour Kilo ou Cline
  - **Kilo** : `code`, `architect`, `ask`, `debug`, `orchestrator`
  - **Cline** : `plan`, `act`
- **`cliPath`** (string, optionnel) : Chemin vers l'exécutable CLI
  - Exemple : `"cline"`, `"opencode"`, `"./trae"`

**Exemples** :

```javascript
// Agent simple Claude
create_agent({
  name: 'code_reviewer',
  runner: 'claude',
  prompt: `Tu es un expert en revue de code.

Ton rôle :
- Analyser le code pour les bugs de sécurité
- Suggérer des optimisations de performance
- Vérifier les best pratiques du langage

Outils MCP autorisés :
- postgresql: pour requêter la base de données
- memory: pour consulter ta mémoire des projets passés`,
});

// Agent Kilo avec mode architect
create_agent({
  name: 'system_architect',
  runner: 'kilo',
  mode: 'architect',
  prompt: 'Tu es un architecte logiciel senior...',
  copyEnvFrom: '.claude/settingsProd.json',
});

// Agent Cline avec mode plan
create_agent({
  name: 'planner',
  runner: 'cline',
  mode: 'plan',
  prompt: 'Tu es un planificateur de tâches...',
});
```

**Valeur de retour** :

````
✅ Agent 'code_reviewer' créé avec succès pour Claude Code !

📂 Fichiers créés :
- Prompt : /path/to/.claude/agents/code_reviewer.md
- Config : /path/to/.claude/agents/code_reviewer.json

🚀 Pour lancer cet agent avec le runner claude :
```bash
# Via l'outil MCP run_agent:
run_agent(runner: "claude", agentName: "code_reviewer", prompt: "votre prompt")
````

💡 Runners disponibles:

- claude: Claude Code (défaut)
- gemini: Gemini
- kilo: Kilocode
- qwen: Qwen Code
- openclaw: OpenClaw
- cline: Cline
- opencode: OpenCode
- trae: Trae

````

**Erreurs possibles** :
- `INVALID_NAME` : Le nom contient des caractères interdits
- Utilisez uniquement lettres, chiffres, tirets et underscores

---

### `list_agents`

**Description** : Liste tous les agents disponibles dans le projet.

**Paramètres** :
- **`details`** (boolean, optionnel, défaut: `false`) : Si `true`, affiche les détails complets
  - Modèle utilisé
  - Serveurs MCP activés
  - Taille du prompt
  - Mode spécifique (si applicable)

**Exemples** :

```javascript
// Liste simple
list_agents({})

// Liste détaillée
list_agents({ details: true })
````

**Valeur de retour (simple)** :

```
📋 Liste des Agents Disponibles (3) :

1. code_reviewer (Claude Code)
2. expert_crypto (Kilocode - mode: architect)
3. planner_dev (Cline - mode: plan)
```

**Valeur de retour (détaillée)** :

```
📋 Liste des Agents Disponibles (3) :

1. **code_reviewer** (Claude Code)
   - Modèle: claude-3-5-sonnet-20241022
   - Serveurs MCP: postgresql, memory
   - Taille prompt: 2456 caractères

2. **expert_crypto** (Kilocode)
   - Mode: architect
   - Modèle: z.ai/glm-4.7
   - Serveurs MCP: postgresql, news
   - Taille prompt: 1823 caractères

3. **planner_dev** (Cline)
   - Mode: plan
   - Modèle: gpt-4
   - Serveurs MCP: memory
   - Taille prompt: 956 caractères
```

---

### `delete_agent`

**Description** : Supprime définitivement un agent (fichier Prompt `.md` et Config `.json`).

**Paramètres** :

- **`name`** (string, requis) : Nom de l'agent à supprimer

**Exemple** :

```javascript
delete_agent({
  name: 'old_agent',
});
```

**Valeur de retour** (succès) :

```
🗑️ Suppression de l'agent 'old_agent'

✅ Fichiers supprimés :
- old_agent.md
- old_agent.json
```

**Valeur de retour** (erreur) :

```
⚠️ Agent 'unknown_agent' introuvable (ni prompt, ni settings).
```

**⚠️ Attention** : Cette opération est irréversible. Les fichiers sont définitivement supprimés.

---

### `update_agent_config`

**Description** : Met à jour la configuration technique d'un agent existant sans modifier son prompt.

**Paramètres** :

- **`name`** (string, requis) : Nom de l'agent à modifier
- **`model`** (string, optionnel) : Change le modèle IA
  - Exemples : `z.ai/glm-4.7`, `MiniMax-Text-01`, `deepseek-chat`, `moonshot-v1-128k`
- **`mcpServers`** (array<string>, optionnel) : Remplace la liste des serveurs MCP activés
  - Exemple : `["postgresql", "news", "memory"]`
  - **Note** : Remplace TOUTE la liste existante
- **`env`** (object<string, string>, optionnel) : Ajoute ou écrase des variables d'environnement
  - Exemple : `{"API_KEY": "sk-xxx", "ENDPOINT": "https://api.example.com"}`

**Exemples** :

```javascript
// Changer le modèle
update_agent_config({
  name: 'expert_crypto',
  model: 'claude-opus-4-6',
});

// Mettre à jour les serveurs MCP
update_agent_config({
  name: 'data_analyst',
  mcpServers: ['postgresql', 'memory', 'news'],
});

// Ajouter des variables d'environnement
update_agent_config({
  name: 'api_client',
  env: {
    API_ENDPOINT: 'https://api.production.com',
    RATE_LIMIT: '100',
  },
});

// Tout mettre à jour en une fois
update_agent_config({
  name: 'full_stack_agent',
  model: 'gpt-4',
  mcpServers: ['postgresql', 'memory', 'discord-server'],
  env: {
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
  },
});
```

**Valeur de retour** (succès) :

```
✅ Configuration de l'agent 'expert_crypto' mise à jour :

- Modèle changé pour: claude-opus-4-6
```

**Valeur de retour** (erreur) :

```
❌ Agent Introuvable

Impossible de modifier la configuration pour 'unknown_agent' car le fichier settings est introuvable.

💡 Solution: Vérifiez le nom de l'agent avec `list_agents`.
```

**Valeur de retour** (aucune modification) :

```
⚠️ Aucune modification demandée pour l'agent 'expert_crypto'.
```

---

## 🔄 Workflow Typique

Voici un workflow d'utilisation typique des outils OverMind :

```javascript
// 1. Créer un agent spécialisé
create_agent({
  name: 'crypto_analyst',
  runner: 'claude',
  prompt: 'Tu es un expert en analyse de marchés cryptos...',
  model: 'claude-3-5-sonnet-20241022',
});

// 2. Mémoriser des connaissances de base
memory_store({
  text: 'Bitcoin utilise un algorithme SHA-256 pour le minage',
  source: 'decision',
});

// 3. Lancer l'agent sur une tâche
run_agent({
  runner: 'claude',
  agentName: 'crypto_analyst',
  prompt: 'Analyse les tendances actuelles du marché BTC',
  autoResume: true,
});

// 4. Rechercher dans la mémoire
memory_search({
  query: 'tendances Bitcoin',
  limit: 5,
});

// 5. Consulter l'historique des exécutions
memory_runs({
  agent_name: 'crypto_analyst',
  limit: 10,
});

// 6. Modifier la configuration si nécessaire
update_agent_config({
  name: 'crypto_analyst',
  mcpServers: ['news', 'postgresql', 'memory'],
});
```

---

## 📚 Notes Importantes

### Isolation de Mémoire

- Chaque agent possède sa propre base de données PostgreSQL isolée
- La mémoire sémantique est **privée et sécurisée** par agent
- L'auto-détection de l'agent se fait via la variable d'environnement `OVERMIND_AGENT_NAME`

### Gestion des Sessions

- **`sessionId`** : Pour continuer manuellement une conversation spécifique
- **`autoResume`** : Pour reprendre AUTOMATIQUEMENT la dernière conversation d'un agent nommé
- Les sessions sont persistantes entre les exécutions

### Modes Spéciaux

- **Kilo Modes** :
  - `code` : Développement standard
  - `architect` : Architecture et design
  - `ask` : Questions-réponses techniques
  - `debug` : Chasse aux bugs
  - `orchestrator` : Orchestration multi-tâches

- **Cline Modes** :
  - `plan` : Planification stratégique
  - `act` : Exécution autonome

### Erreurs Courantes

1. **`INVALID_AGENT`** : L'agent n'existe pas. Utilisez `create_agent` d'abord.
2. **`JSON_PARSE_ERROR`** : Le runner a retourné un JSON invalide. Vérifiez le prompt.
3. **`SEARCH_NOT_FOUND`** (edit_prompt) : Le texte à remplacer n'existe pas.

---

## 🚀 Démarrage Rapide

```javascript
// Créer et exécuter votre premier agent
create_agent({
  name: 'hello_agent',
  prompt: 'Tu es un assistant amical qui dit bonjour.',
});

run_agent({
  runner: 'claude',
  agentName: 'hello_agent',
  prompt: 'Dis-moi bonjour !',
});

// Résultat attendu
// "Bonjour ! Je suis ravi de vous rencontrer. Comment puis-je vous aider aujourd'hui ?"
```

---

**Version** : 1.3.6
**Auteur** : DeaMoN888
**License** : MIT
**Repository** : [GitHub](https://github.com/DeamonDev888/overmind-mcp)
