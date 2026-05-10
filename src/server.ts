/**
 * OverMind-MCP Server
 * ====================
 *
 * Ce fichier enregistre les 13 outils MCP du serveur Overmind.
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
 * ─── LISTE DES 13 OUTILS ─────────────────────────────────────────────────
 *
 *  1. run_agent          → src/tools/run_agent.ts
 *  2. run_agents_parallel → src/tools/run_agents_parallel.ts
 *  3. create_agent      → src/tools/create_agent.ts
 *  4. list_agents       → src/tools/manage_agents.ts
 *  5. delete_agent      → src/tools/manage_agents.ts
 *  6. update_agent_config → src/tools/manage_agents.ts
 *  7. create_prompt     → src/tools/manage_prompts.ts
 *  8. edit_prompt       → src/tools/manage_prompts.ts
 *  9. memory_search     → src/tools/memory_search.ts
 * 10. memory_store      → src/tools/memory_store.ts
 * 11. memory_runs       → src/tools/memory_runs.ts
 * 12. get_agent_configs → src/tools/get_agent_configs.ts
 * 13. config_example    → src/tools/config_example.ts
 */

import { FastMCP } from 'fastmcp';
import { withSpan } from './lib/telemetry.js';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolExecute = (...args: any[]) => Promise<any>;
function wrapExecute(toolName: string, fn: ToolExecute) {
  return (...args: Parameters<ToolExecute>) => withSpan(`tool.${toolName}`, () => fn(...args));
}

export function createServer(name: string = 'OverMind-MCP') {
  const server = new FastMCP({
    name,
    version: '1.0.0',
  });

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
    execute: listAgents,
  });

  // ─── 5. delete_agent ───────────────────────────────────────────────────────
  server.addTool({
    name: 'delete_agent',
    description: 'Supprime définitivement un agent (Prompt et Config)',
    parameters: deleteAgentSchema,
    execute: deleteAgent,
  });

  // ─── 6. update_agent_config ────────────────────────────────────────────────
  server.addTool({
    name: 'update_agent_config',
    description:
      "Modifie la configuration technique d'un agent (Runner, Modèle, Serveurs MCP, Variables d'environnement) OU réécrit entièrement l'un des 4 fichiers (prompt, settings, mcp, skill)",
    parameters: updateAgentConfigSchema,
    execute: updateAgentConfig,
  });

  // ─── 7. create_prompt ───────────────────────────────────────────────────────
  server.addTool({
    name: 'create_prompt',
    description: 'Crée ou écrase un fichier prompt Markdown (Persona)',
    parameters: createPromptSchema,
    execute: createPrompt,
  });

  // ─── 8. edit_prompt ─────────────────────────────────────────────────────────
  server.addTool({
    name: 'edit_prompt',
    description: 'Modifie un prompt existant en remplaçant un bloc de texte spécifique',
    parameters: editPromptSchema,
    execute: editPrompt,
  });

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

  return server;
}
