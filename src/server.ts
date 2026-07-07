/**
 * OverMind-MCP Server
 * ====================
 *
 * Ce fichier enregistre les 14 outils MCP du serveur Overmind.
 *
 * ─── ARCHITECTURE ───────────────────────────────────────────────────────────
 *
 * CHAQUE OUTIL MCP VIT DANS SON PROPRE FICHIER sous src/tools/.
 * Cela garantit :
 *   - Maintenabilité : un outil = un fichier, pas de fichier fourre-tout
 *   - Testabilité  : chaque outil peut être importé et testé isolément
 *   - Lisibilité  : server.ts reste un index lisible, pas 500 lignes de code
 *   - DX          : retrouver un tool = grep src/tools/, pas explorer 2000 lignes
 *
 * Convention de nommage :
 *   src/tools/<nom_du_tool>.ts     → contient le schéma Zod ET la fonction execute
 *   src/tools/run_<runner>.ts     → implémentation par runner (pas des outils MCP)
 *
 * Ajout d'un nouvel outil :
 *   1. Créer src/tools/<nom>.ts   → exporter <nom>Schema + <nom>Function
 *   2. L'importer dans server.ts → import { <nom> } from './tools/<nom>.js'
 *   3. Ajouter server.addTool()    → name, description, parameters, execute
 *
 * ─── LISTE DES 14 OUTILS ─────────────────────────────────────────────────
 *
 *  1. run_agent              → src/tools/run_agent.ts
 *  2. run_agents_parallel    → src/tools/run_agents_parallel.ts
 *  3. create_agent           → src/tools/create_agent.ts
 *  4. list_agents            → src/tools/manage_agents.ts
 *  5. delete_agent           → src/tools/manage_agents.ts
 *  6. update_agent_config    → src/tools/manage_agents.ts
 *  7. get_agent_configs      → src/tools/get_agent_configs.ts
 *  8. memory_search          → src/tools/memory_search.ts
 *  9. memory_store           → src/tools/memory_store.ts
 * 10. memory_runs            → src/tools/memory_runs.ts
 * 11. create_prompt          → src/tools/manage_prompts.ts
 * 12. edit_prompt            → src/tools/manage_prompts.ts
 * 13. config_example         → src/tools/config_example.ts
 * 14. agent_control          → src/tools/agent_control.ts  (REMPLACE: get_agent_status, stream_agent_output, kill_agent, wait_agent)
 */

import { FastMCP } from 'fastmcp';
import { withSpan } from './lib/telemetry.js';
import { PKG_VERSION } from './lib/config.js';
import { runAgent, runAgentSchema } from './tools/run_agent.js';
import { runAgentsParallel, runAgentsParallelSchema } from './tools/run_agents_parallel.js';
import { memorySearchTool, memorySearchSchema } from './tools/memory_search.js';
import { memoryStoreTool, memoryStoreSchema } from './tools/memory_store.js';
import { memoryRunsTool, memoryRunsSchema } from './tools/memory_runs.js';
import { createAgent, createAgentSchema } from './tools/create_agent.js';
import {
  createPrompt,
  createPromptSchema,
  editPrompt,
  editPromptSchema,
} from './tools/manage_prompts.js';
import {
  listAgents,
  listAgentsSchema,
  deleteAgent,
  deleteAgentSchema,
  updateAgentConfig,
  updateAgentConfigSchema,
} from './tools/manage_agents.js';
import { getAgentConfigs, getAgentConfigsSchema } from './tools/get_agent_configs.js';
import { configExample, configExampleSchema } from './tools/config_example.js';
import { agentControl, agentControlSchema } from './tools/agent_control.js';
import { a2aHub, a2aHubSchema } from './tools/a2a_hub.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolExecute = (...args: any[]) => Promise<any>;
function wrapExecute(toolName: string, fn: ToolExecute) {
  return (...args: Parameters<ToolExecute>) => withSpan(`tool.${toolName}`, () => fn(...args));
}

export function createServer(
  name: string = 'OverMind-MCP',
  memoryOnly = false,
  memoryToolsOnly = false,
) {
  const server = new FastMCP({
    name: memoryOnly ? `${name}-Memory` : memoryToolsOnly ? `${name}-MemoryTools` : name,
    version: PKG_VERSION as `${number}.${number}.${number}`,
  });

  if (!memoryOnly && !memoryToolsOnly) {
    // ─── 1. run_agent ─────────────────────────────────────────────────────────────
    server.addTool({
      name: 'run_agent',
      description: `Exécute une commande sur un agent IA via le runner spécifié.

**Runners disponibles:**
 - claude: Claude Code (Nécessite 'create_agent' au préalable)
 - gemini: Gemini CLI
 - kilo: Kilocode (modes: code, architect, ask, debug, orchestrator)
 - qwencli: Qwen Code CLI (qwen -p)
 - openclaw: OpenClaw (openclaw message send)
 - cline: Cline (modes: plan, act)
 - opencode: OpenCode (opencode run)
 - hermes: Nous Hermes Agent (Nécessite 'create_agent' au préalable)

**Modèles recommandés :**
| Fournisseur | Modèle recommandé | Usage |
| :--- | :--- | :--- |
| **Mistral** | **Devstral 2** (\`codestral-latest\`) | Expert Coding & Développement |
| **Mistral** | **Mistral Large 3** (\`mistral-large-latest\`) | Raisonnement & Architecture |
| **Kilo** | **step 3.5 flash** | Polyvalent (262K context) |
| **Kilo** | **free** | Modèle par défaut gratuit |

**Parameters:**
- runner: Type de runner (claude, gemini, etc.)
- prompt: Instruction à envoyer à l'agent
- agentName: Nom de l'agent (optionnel)
- path: Répertoire de travail (CWD). Par défaut: dossier Overmind.
- config: Répertoire racine de l'Overmind. Par défaut: dossier Overmind.

**Exemples:**
run_agent(runner: "claude", agentName: "expert_python", prompt: "Analyse ce code")
run_agent(runner: "kilo", agentName: "architect", mode: "architect", prompt: "Conçois une API REST", path: "./my-project")
run_agent(runner: "cline", agentName: "planner", mode: "plan", prompt: "Planifie l'implémentation")`,
      parameters: runAgentSchema,
      execute: wrapExecute('run_agent', runAgent),
    });

    // ─── 2. run_agents_parallel ─────────────────────────────────────────────────
    server.addTool({
      name: 'run_agents_parallel',
      description: `🚀 Lance plusieurs agents IA EN PARALLÈLE depuis un seul appel MCP. Polyglotte (mixe runners/modèles). Retourne les résultats consolidés une fois tous terminés.

**Cas d'usage :** Orchestration de flotte, rotation de tokens, tâches indépendantes simultanées.

**Exemple :**
run_agents_parallel(agents: [
  { taskId: "build",  runner: "kilo", agentName: "mistral_1", prompt: "npm run build", path: "./project" },
  { taskId: "lint",   runner: "kilo", agentName: "mistral_2", prompt: "npm run lint",  path: "./project" },
  { taskId: "test",   runner: "kilo", agentName: "mistral_3", prompt: "npm test",      path: "./project" },
  { taskId: "audit",  runner: "kilo", agentName: "mistral_4", prompt: "Analyse le fichier audit.md", path: "./project" },
])

**Options :**
- waitAll (défaut: true) : attend tous les agents avant de retourner.
- waitAll: false : retourne dès que le premier agent réussit (race mode).`,
      parameters: runAgentsParallelSchema,
      execute: wrapExecute('run_agents_parallel', runAgentsParallel),
    });

    // ─── 3. create_agent ────────────────────────────────────────────────────────
    server.addTool({
      name: 'create_agent',
      description: `Crée un nouvel agent (Prompt + Config) compatible avec tous les runners.

**Runners supportés:** claude, gemini, kilo, qwencli, openclaw, cline, opencode, hermes

**Exemples:**
create_agent(name: "expert_python", runner: "claude", prompt: "Tu es un expert Python...")
create_agent(name: "architecte", runner: "kilo", mode: "architect", prompt: "Tu es un architecte logiciel...")
create_agent(name: "planner", runner: "cline", mode: "plan", prompt: "Tu es un planificateur de tâches...")`,
      parameters: createAgentSchema,
      execute: createAgent,
    });

    // ─── 4. list_agents ─────────────────────────────────────────────────────────
    server.addTool({
      name: 'list_agents',
      description:
        "Liste tous les agents disponibles. Option 'details=true' pour voir la config complète.",
      parameters: listAgentsSchema,
      execute: wrapExecute('list_agents', listAgents),
    });

    // ─── 5. delete_agent ───────────────────────────────────────────────────────
    server.addTool({
      name: 'delete_agent',
      description: 'Supprime définitivement un agent (Prompt et Config)',
      parameters: deleteAgentSchema,
      execute: wrapExecute('delete_agent', deleteAgent),
    });

    // ─── 6. update_agent_config ────────────────────────────────────────────────
    server.addTool({
      name: 'update_agent_config',
      description:
        "Modifie la configuration technique d'un agent (Runner, Modèle, Serveurs MCP, Variables d'environnement) OU réécrit entièrement l'un des 4 fichiers (prompt, settings, mcp, skill)",
      parameters: updateAgentConfigSchema,
      execute: wrapExecute('update_agent_config', updateAgentConfig),
    });

    // ─── 7. create_prompt ───────────────────────────────────────────────────────
    server.addTool({
      name: 'create_prompt',
      description: 'Crée ou écrase un fichier prompt Markdown (Persona)',
      parameters: createPromptSchema,
      execute: wrapExecute('create_prompt', createPrompt),
    });

    // ─── 8. edit_prompt ─────────────────────────────────────────────────────────
    server.addTool({
      name: 'edit_prompt',
      description: 'Modifie un prompt existant en remplaçant un bloc de texte spécifique',
      parameters: editPromptSchema,
      execute: wrapExecute('edit_prompt', editPrompt),
    });
  }

  // ─── 9. memory_search ──────────────────────────────────────────────────────
  server.addTool({
    name: 'memory_search',
    description:
      'Recherche sémantique + full-text dans la mémoire OverMind (connaissances + historique)',
    parameters: memorySearchSchema,
    execute: memorySearchTool,
  });

  // ─── 10. memory_store ───────────────────────────────────────────────────────
  server.addTool({
    name: 'memory_store',
    description: "Mémorise durablement une connaissance, décision ou pattern d'orchestration",
    parameters: memoryStoreSchema,
    execute: memoryStoreTool,
  });

  // ─── 11. memory_runs ───────────────────────────────────────────────────────
  server.addTool({
    name: 'memory_runs',
    description:
      "Liste l'historique des runs d'agents enregistrés par OverMind (avec stats optionnelles)",
    parameters: memoryRunsSchema,
    execute: memoryRunsTool,
  });

  if (!memoryOnly && !memoryToolsOnly) {
    // ─── 12. get_agent_configs ─────────────────────────────────────────────────
    server.addTool({
      name: 'get_agent_configs',
      description:
        "Affiche les 4 fichiers de configuration d'un agent (prompt.md, .mcp.json, settings.json, skill.md)",
      parameters: getAgentConfigsSchema,
      execute: getAgentConfigs,
    });

    // ─── 13. config_example ─────────────────────────────────────────────────────
    server.addTool({
      name: 'config_example',
      description:
        'Fournit des exemples de configuration settings.json pour différents LLM (GLM, MiniMax, OpenRouter).',
      parameters: configExampleSchema,
      execute: configExample,
    });

    // ─── 14. agent_control ─────────────────────────────────────────────────────────
    server.addTool({
      name: 'agent_control',
      description: `Outil MCP unifié pour contrôler le cycle de vie des agents OverMind.

REMPLACE les 4 outils précédents : get_agent_status, stream_agent_output, kill_agent, wait_agent.
L'unification simplifie la toolbox client et assure un comportement déterministe.

**Actions disponibles :**

status ─── Lecture pure, zero side-effect
  → Retourne l'état du process (pid, status, sessionId, outputBuffer)
  → Use-case : dashboard, diagnostic, polling léger

stream ─── Lecture + indicateur de complétude
  → Retourne outputBuffer + isComplete flag
  → Use-case : récupérer la sortie en temps réel sans savoir si c'est fini
  → Option sinceTimestamp pour output après un timestamp

kill ─── Action destructive, irréversible
  → Tue le process tree via taskkill /F /T (Windows) ou kill -9 (Unix)
  → Use-case : abort d'urgence, kill-switch

wait ─── Blocage async avec polling
  → Poll toutes les 1s jusqu'à status !== 'running' ou timeout
  → Use-case : synchronisation dans un workflow d'orchestration

**États du process :**
  running  — Process actif, PID valide
  done     — Terminé avec code 0
  failed   — Terminé avec erreur (exit code != 0)
  orphaned — Parent mort mais child tourne encore

**Erreurs structurées :**
  AGENT_NOT_FOUND    — Agent absent du registry (jamais lancé ou nettoyé)
  AGENT_NOT_RUNNING  — Action "kill" sur un agent déjà terminé
  KILL_FAILED        — taskkill/kill a échoué
  WAIT_TIMEOUT       — Timeout atteint sans terminaison
  ORPHANED_PROCESS   — Process zombie détecté

**Exemples :**
agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "status" })
agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "stream" })
agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "kill" })
agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "wait", timeoutMs: 300000 })`,
      parameters: agentControlSchema,
      execute: wrapExecute('agent_control', agentControl),
    });

    // ─── 15. a2a_hub ──────────────────────────────────────────────────────────
    server.addTool({
      name: 'a2a_hub',
      description: `🌐 **A2A Hub — Communication Agent-to-Agent unifiée**

Découvre automatiquement tous les agents persistants du système et permet de communiquer avec eux.

**Actions disponibles:**

discover — Liste TOUS les agents avec leur status temps réel, modèle, skills, description
  → a2a_hub(action: "discover")

status — État détaillé d'un agent (runs, erreurs, A2A count, session)
  → a2a_hub(action: "status", target: "sniperbot_analyst")

send — Message synchrone A→B (attend la réponse)
  → a2a_hub(action: "send", target: "tradingview_analyst", message: "Analyse BTCUSDT")

delegate — Tâche async (retourne immédiatement avec taskId + callback optionnel)
  → a2a_hub(action: "delegate", target: "sniperbot_analyst", message: "Prépare un plan", callbackUrl: "http://...")

pipeline — Chaîne séquentielle A→B→C (output de l'un = input du suivant)
  → a2a_hub(action: "pipeline", message: "Analyse le marché", steps: [{agentName: "tradingview_analyst"}, {agentName: "sniperbot_analyst"}])

fanout — 1→N parallèle + merge (concat|best|vote|first_success)
  → a2a_hub(action: "fanout", targets: ["agent_a", "agent_b"], message: "Quelle stratégie?", mergeStrategy: "best")

query — Question rapide multi-agents (tous répondent en parallèle)
  → a2a_hub(action: "query", targets: ["agent_a", "agent_b"], message: "Prix actuel BTC?")

broadcast — Message global à tous les agents online
  → a2a_hub(action: "broadcast", message: "Alerte marché!")
  → a2a_hub(action: "broadcast", message: "Premier qui répond!", race: true)

**Auto-discovery:** L'outil scanne ~/.overmind/hermes/profiles/ automatiquement.
Aucune configuration manuelle nécessaire — il connaît tous les agents du système.`,
      parameters: a2aHubSchema,
      execute: wrapExecute('a2a_hub', a2aHub),
    });
  }

  return server;
}
