# 📚 Documentation MCP - OverMind Workflow

**Version:** 1.1.1
**Serveur MCP:** `overmind` (Workflow/dist/bin/cli.js)
**Date:** 2025-02-23

---

## 🎯 Vue d'ensemble

OverMind MCP fournit **10 outils** pour l'orchestration d'agents IA multi-runners avec persistance mémoire. Ce serveur permet de créer, gérer et exécuter des agents IA compatibles avec 8 runners différents.

### 📦 Serveurs MCP

| Nom        | Chemin                                   | Mode                       |
| ---------- | ---------------------------------------- | -------------------------- |
| `overmind` | `Workflow/dist/bin/cli.js`               | Complet (agents + mémoire) |
| `memory`   | `Workflow/dist/bin/cli.js --memory-only` | Mémoire uniquement         |

---

## 🔧 Outils Disponibles

### 1. `run_agent` - Exécuter un Agent IA

**Description:** Exécute une commande sur un agent IA via le runner spécifié.

**Paramètres:**

```typescript
{
  runner: "claude" | "gemini" | "kilo" | "qwen" | "openclaw" | "cline" | "opencode" | "trae",
  agentName?: string,        // Nom de l'agent (pour logging/monitoring)
  prompt: string,            // Prompt à envoyer
  sessionId?: string,        // ID de session pour continuer une conversation
  autoResume?: boolean,      // Reprendre automatiquement la dernière conversation
  mode?: "code" | "architect" | "ask" | "debug" | "orchestrator" | "plan" | "act"
}
```

**Runners Supportés:**

- **claude**: Claude Code (`claude -p`)
- **gemini**: Gemini CLI
- **kilo**: Kilocode (modes: code, architect, ask, debug, orchestrator)
- **qwen**: Qwen Code (`qwen -p`)
- **openclaw**: OpenClaw (`openclaw message send`)
- **cline**: Cline (modes: plan, act)
- **opencode**: OpenCode (`opencode run`)
- **trae**: Trae (`trae solo --headless`)

**Exemples:**

```typescript
// Exécuter avec Claude Code
run_agent({
  runner: 'claude',
  agentName: 'expert_python',
  prompt: 'Analyse ce code et propose des améliorations',
});

// Exécuter avec Kilo en mode architecte
run_agent({
  runner: 'kilo',
  agentName: 'architecte',
  mode: 'architect',
  prompt: 'Conçois une API REST pour une application de gestion de tâches',
});

// Reprendre une conversation existante
run_agent({
  runner: 'claude',
  agentName: 'expert_python',
  sessionId: 'session_abc123',
  prompt: "Continue l'analyse",
});
```

**Critères de Mémoire:**

- Chaque exécution est automatiquement enregistrée dans `memory_runs`
- Utilisez `autoResume: true` pour reprendre automatiquement la dernière session d'un agent

---

### 2. `create_agent` - Créer un Nouvel Agent

**Description:** Crée un nouvel agent (Prompt + Config) compatible avec tous les runners.

**Paramètres:**

```typescript
{
  name: string,              // Nom de l'agent (ex: agent_finance)
  prompt: string,            // Prompt système / instructions
  runner?: "claude" | "gemini" | "kilo" | "qwen" | "openclaw" | "cline" | "opencode" | "trae", // défaut: "claude"
  model?: string,            // Modèle (ex: claude-sonnet-4-5, gpt-4, deepseek-chat)
  copyEnvFrom?: string,      // Chemin vers settings.json existant pour copier les ENV
  mode?: "code" | "architect" | "ask" | "debug" | "orchestrator" | "plan" | "act",
  cliPath?: string           // Chemin vers l'exécutable CLI (ex: "cline", "opencode")
}
```

**Règles de Nommage:**

- Uniquement lettres, chiffres, tirets (-) et underscores (\_)
- Exemples valides: `agent_finance`, `expert-seo`, `senior_dev`

**Exemples:**

```typescript
// Créer un agent Python expert
create_agent({
  name: 'expert_python',
  runner: 'claude',
  prompt:
    'Tu es un expert Python spécialisé en Django et FastAPI. Tu aides à développer, debugger et optimiser des applications Python modernes.',
  model: 'claude-sonnet-4-5',
});

// Créer un agent architecte avec Kilo
create_agent({
  name: 'architecte_solutions',
  runner: 'kilo',
  mode: 'architect',
  prompt:
    'Tu es un architecte logiciel expert. Tu conçois des architectures scalables et mainténables.',
});

// Créer un agent avec variables d'environnement existantes
create_agent({
  name: 'agent_finance',
  runner: 'claude',
  prompt: 'Analyse les données financières...',
  copyEnvFrom: '.claude/settingsM.json',
});
```

**Fichiers Créés:**

- `Workflow/.claude/agents/{name}.md` - Prompt/Persona
- `Workflow/.claude/settings_{name}.json` - Configuration

---

### 3. `list_agents` - Lister les Agents

**Description:** Liste tous les agents disponibles avec option de détails complets.

**Paramètres:**

```typescript
{
  details?: boolean  // défaut: false - Si true, affiche modèle, config, etc.
}
```

**Exemple:**

```typescript
// Liste simple
list_agents({});

// Liste avec détails complets
list_agents({ details: true });
```

**Réponse Typique:**

```
📋 Liste des Agents Disponibles (3)

1. expert_python
   - Runner: claude
   - Modèle: claude-sonnet-4-5
   - Créé: 2025-02-23

2. architecte_solutions
   - Runner: kilo (mode: architect)
   - Modèle: gpt-4
   - Créé: 2025-02-22

3. agent_finance
   - Runner: claude
   - MCP Servers: postgresql, discord-server
   - Créé: 2025-02-21
```

---

### 4. `delete_agent` - Supprimer un Agent

**Description:** Supprime définitivement un agent (Prompt et Config).

**Paramètres:**

```typescript
{
  name: string; // Nom de l'agent à supprimer
}
```

**Exemple:**

```typescript
delete_agent({ name: 'old_agent' });
```

**⚠️ Attention:** Cette action est irréversible. Le prompt et la configuration sont définitivement supprimés.

---

### 5. `update_agent_config` - Modifier la Configuration

**Description:** Modifie la configuration technique d'un agent (Runner, Modèle, MCP, ENV).

**Paramètres:**

```typescript
{
  name: string,              // Nom de l'agent à modifier
  model?: string,            // Nouveau modèle
  mcpServers?: string[],     // Liste complète des serveurs MCP (remplace l'existant)
  env?: Record<string, string>  // Variables d'environnement supplémentaires
}
```

**Exemples:**

```typescript
// Changer le modèle
update_agent_config({
  name: 'expert_python',
  model: 'claude-opus-4-6',
});

// Ajouter des serveurs MCP
update_agent_config({
  name: 'agent_finance',
  mcpServers: ['postgresql', 'discord-server', 'overmind'],
});

// Ajouter des variables d'environnement
update_agent_config({
  name: 'expert_python',
  env: {
    API_KEY: '12345',
    DEBUG: 'true',
  },
});
```

**⚠️ Note:** `mcpServers` remplace complètement la liste existante, ne pas oublier d'inclure tous les serveurs nécessaires.

---

### 6. `regenerate_mcp_files` - Régénérer les Fichiers MCP

**Description:** Régénère les fichiers MCP individuels pour tous les agents.

**Paramètres:**

```typescript
{
  force?: boolean  // défaut: false - Si true, régénère même pour les agents utilisant tous les MCPs
}
```

**Quand l'utiliser:**

- Après modification de `.mcp.local.json`
- Après ajout/suppression de serveurs MCP globaux
- Pour synchroniser les configurations

**Exemple:**

```typescript
// Régénérer uniquement si nécessaire
regenerate_mcp_files({});

// Forcer la régénération complète
regenerate_mcp_files({ force: true });
```

---

### 7. `create_prompt` - Créer un Prompt

**Description:** Crée ou écrase un fichier prompt Markdown (Persona).

**Paramètres:**

```typescript
{
  name: string,      // Nom du fichier prompt (sans extension)
  content: string    // Contenu Markdown du prompt
}
```

**Exemple:**

```typescript
create_prompt({
  name: 'expert_react',
  content: `# Expert React

Tu es un expert React spécialisé en:
- Hooks avancés
- Performance optimisation
- Testing avec Jest et React Testing Library
- State management (Redux, Zustand, Jotai)

## Directives
- Toujours utiliser les fonctionnalités modernes de React
- Préférer les composants fonctionnels avec hooks
- Écrire du code testable et maintenable
`,
});
```

**Fichier créé:** `Workflow/.claude/prompts/{name}.md`

---

### 8. `edit_prompt` - Modifier un Prompt

**Description:** Modifie un prompt existant en remplaçant un bloc de texte spécifique.

**Paramètres:**

```typescript
{
  name: string,      // Nom du fichier prompt à modifier
  search: string,    // Texte exact à rechercher et remplacer
  replace: string    // Nouveau texte de remplacement
}
```

**Exemple:**

```typescript
edit_prompt({
  name: 'expert_react',
  search: '## Directives\n- Toujours utiliser les fonctionnalités modernes de React',
  replace:
    '## Directrices\n- Prioriser TypeScript pour tous les nouveaux projets\n- Utiliser les fonctionnalités modernes de React',
});
```

**⚠️ Note:** Le texte de recherche doit correspondre exactement, y compris la ponctuation et les espaces.

---

### 9. `memory_search` - Rechercher dans la Mémoire

**Description:** Recherche sémantique + full-text dans la mémoire OverMind (connaissances + historique).

**Paramètres:**

```typescript
{
  query: string,         // Requête de recherche
  limit?: number,        // défaut: 10 - Nombre max de résultats (1-50)
  include_runs?: boolean, // défaut: false - Inclure l'historique des runs
  agent_name?: string    // Filtrer par nom d'agent
}
```

**Exemples:**

```typescript
// Recherche simple
memory_search({
  query: 'comment optimiser une requête SQL',
});

// Recherche avec plus de résultats
memory_search({
  query: 'patterns de conception',
  limit: 20,
});

// Recherche dans l'historique complet
memory_search({
  query: 'erreur segmentation fault',
  include_runs: true,
});

// Recherche spécifique à un agent
memory_search({
  query: 'stratégie de test',
  agent_name: 'expert_python',
});
```

**Réponse Typique:**

```
🧠 3 résultat(s) trouvé(s) pour "optimiser SQL"

**1.** [pattern] (score: 0.892) — 2025-02-23
Pour optimiser les requêtes SQL: utiliser des index sur les colonnes fréquemment filtrées, éviter SELECT *, et utiliser EXPLAIN ANALYZE pour identifier les goulots d'étranglement.

**2.** [agent] (score: 0.761) — 2025-02-22
L'agent expert_python a suggéré d'utiliser des prepared statements pour éviter les injections SQL et améliorer les performances...

**3.** [user] (score: 0.698) — 2025-02-21
N'oublie pas de configurer correctement le connection_pool dans PostgreSQL...
```

---

### 10. `memory_store` - Stocker dans la Mémoire

**Description:** Mémorise durablement une connaissance, décision ou pattern d'orchestration.

**Paramètres:**

```typescript
{
  text: string,                    // Texte ou connaissance à mémoriser
  source?: "user" | "agent" | "pattern" | "error" | "decision",  // défaut: "user"
  agent_name?: string              // Nom de l'agent si spécifique
}
```

**Types de Sources:**

- **user**: Connaissance manuelle (utilisateurs, documentation)
- **agent**: Connaissance générée par un agent
- **pattern**: Workflow ou pattern réutilisable
- **error**: Bug connu et solution
- **decision**: Choix architectural ou technique

**Exemples:**

```typescript
// Stocker une connaissance manuelle
memory_store({
  text: "Toujours utiliser les transactions PostgreSQL pour les opérations critiques afin de garantir l'ACIDité",
  source: 'user',
});

// Stocker un pattern de workflow
memory_store({
  text: 'Pour déboguer une erreur TypeScript: 1) Vérifier les types avec tsc --noEmit, 2) Utiliser ts-expect-error pour les cas limites, 3) Documenter les contournements',
  source: 'pattern',
});

// Stocker une erreur connue
memory_store({
  text: "Erreur 'Cannot find module' avec pnpm: Résolution = supprimer node_modules et pnpm-lock.yaml, puis réinstaller",
  source: 'error',
});

// Stocker une décision d'agent
memory_store({
  text: "L'agent expert_python a recommandé d'utiliser FastAPI au lieu de Django pour ce projet microservices",
  source: 'agent',
  agent_name: 'expert_python',
});
```

---

### 11. `memory_runs` - Historique des Exécutions

**Description:** Liste l'historique des runs d'agents enregistrés par OverMind.

**Paramètres:**

```typescript
{
  limit?: number,        // défaut: 20 - Nombre de runs à retourner (1-100)
  stats?: boolean,       // défaut: false - Afficher les statistiques globales
  agent_name?: string,   // Filtrer par agent spécifique
  runner?: string        // Filtrer par runner (claude, gemini, kilo, etc.)
}
```

**Exemples:**

```typescript
// Liste les 20 derniers runs
memory_runs({ limit: 20, stats: false });

// Statistiques globales
memory_runs({ limit: 20, stats: true });

// Runs d'un agent spécifique
memory_runs({ agent_name: 'expert_python', limit: 10 });

// Runs d'un runner spécifique
memory_runs({ runner: 'claude', limit: 15 });
```

**Réponse Typique (avec stats):**

```
📊 Statistiques Globales d'Orchestration

Total des runs: 156
├── claude: 89 (57%)
├── kilo: 34 (22%)
├── gemini: 18 (11%)
├── qwen: 10 (6%)
└── autres: 5 (3%)

Top Agents:
1. expert_python: 45 runs
2. architecte_solutions: 32 runs
3. agent_finance: 28 runs
```

---

## 🧠 Critères de Mémoire et Persistance

### Isolation des Agents

Chaque agent possède sa propre base de données PostgreSQL isolée :

- **Format:** `agent_{agent_name}`
- **Exemple:** `agent_expert_python`

### Mémoire Core vs Mémoire Agent

| Type      | Base de données | Usage                                       |
| --------- | --------------- | ------------------------------------------- |
| **Core**  | `overmind_core` | Connaissances globales, patterns, décisions |
| **Agent** | `agent_{name}`  | Mémoire spécifique à un agent               |

### Persistance des Exécutions

Toutes les exécutions d'agents sont automatiquement enregistrées avec :

- Timestamp
- Runner utilisé
- Agent name
- Prompt et réponse
- Durée d'exécution

### Recherche Hybride

La recherche utilise **pgvector** pour :

1. **Recherche sémantique** (embeddings vectoriels)
2. **Recherche full-text** (PostgreSQL tsvector)
3. **Score de pertinence** combinant les deux

---

## 🚀 Bonnes Pratiques pour les Agents Codeurs

### 1. Création d'Agents

```typescript
// ✅ BON - Agent bien défini
create_agent({
  name: 'senior_react_dev',
  runner: 'claude',
  model: 'claude-sonnet-4-5',
  prompt: `# Senior React Developer

Tu es un développeur React senior avec 10+ ans d'expérience.

## Expertises
- React 18+ avec Hooks et Concurrent Features
- TypeScript avancé
- Next.js, Remix, Vite
- State Management: Zustand, Redux Toolkit, Jotai
- Testing: Vitest, React Testing Library, Playwright

## Standards de Code
- Components fonctionnels avec hooks
- TypeScript strict mode
- Props typées avec interfaces
- Error boundaries pour la résilience

## Workflow
1. Analyser les requirements
2. Proposer l'architecture
3. Implémenter avec tests
4. Documenter le code
`,
});
```

### 2. Utilisation de la Mémoire

```typescript
// ✅ Avant d'exécuter une tâche, chercher d'abord
const previousWork = await memory_search({
  query: 'implémentation pagination React',
  agent_name: 'senior_react_dev',
});

// ✅ Après une résolution importante, mémoriser
await memory_store({
  text: 'Pattern de pagination optimisée: utiliser useInfiniteQuery de TanStack Query avec cursor-based pagination pour meilleures performances',
  source: 'pattern',
  agent_name: 'senior_react_dev',
});
```

### 3. Gestion des Sessions

```typescript
// ✅ Utiliser autoResume pour continuer le travail
const result = await run_agent({
  runner: 'claude',
  agentName: 'senior_react_dev',
  prompt: "Continue l'implémentation de la pagination",
  autoResume: true, // Reprend la dernière conversation
});
```

### 4. Mises à jour de Configuration

```typescript
// ✅ Mettre à jour un agent avec de nouveaux MCPs
await update_agent_config({
  name: 'senior_react_dev',
  mcpServers: [
    'overmind', // Pour mémoire
    'postgresql', // Pour données
    'discord-server', // Pour notifications
  ],
});
```

---

## 📊 Référence Rapide des Outils

| Outil                  | Usage              | Clé                 |
| ---------------------- | ------------------ | ------------------- |
| `run_agent`            | Exécuter une tâche | Runner requis       |
| `create_agent`         | Créer nouvel agent | Nom unique          |
| `list_agents`          | Lister agents      | details=true        |
| `delete_agent`         | Supprimer agent    | ⚠️ Irréversible     |
| `update_agent_config`  | Modifier config    | Remplace MCPs       |
| `regenerate_mcp_files` | Sync MCP           | Après modifications |
| `create_prompt`        | Créer prompt       | Persona             |
| `edit_prompt`          | Modifier prompt    | Search/replace      |
| `memory_search`        | Rechercher         | Sémantique + text   |
| `memory_store`         | Mémoriser          | 5 types             |
| `memory_runs`          | Historique         | Stats disponibles   |

---

## 🔗 Ressources Connexes

- **Package NPM:** [overmind-mcp](https://www.npmjs.com/package/overmind-mcp)
- **GitHub:** [DeamonDev888/overmind-mcp](https://github.com/DeamonDev888/overmind-mcp)
- **Discord:** [Serveur Support](https://discord.gg/4AR82phtBz)

---

## 📝 Changelog

### v1.1.1 (2025-02-23)

- ✅ 10 outils MCP opérationnels
- ✅ Support de 8 runners IA
- ✅ Mémoire persistante avec pgvector
- ✅ Isolation des agents par DB
- ✅ Recherche hybride sémantique + full-text

---

**Document généré automatiquement par OverMind MCP Scanner**
