import { FastMCP } from 'fastmcp';
import { runAgent, runAgentSchema } from './tools/run_agent.js';
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
import { shellExecute, shellExecuteSchema } from './tools/shell_execute.js';

export function createServer(name: string = 'OverMind-MCP') {
  const server = new FastMCP({
    name,
    version: '1.0.0',
  });

  // ─── OUTIL UNIFIÉ D'EXÉCUTION D'AGENT ────────────────────────────────────────
  server.addTool({
    name: 'run_agent',
    description: `Exécute une commande sur un agent IA via le runner spécifié.

**Runners disponibles:**
- claude: Claude Code (claude -p)
- gemini: Gemini CLI
- kilo: Kilocode (modes: code, architect, ask, debug, orchestrator)
- qwen: Qwen Code (qwen -p)
- openclaw: OpenClaw (openclaw message send)
- cline: Cline (modes: plan, act)
- opencode: OpenCode (opencode run)
- trae: Trae (trae solo --headless)

**Modèles Kilo (Alias Gratuits):**
| Nom Amical | ID Technique | Description |
| :--- | :--- | :--- |
| **step 3.5 flash** | stepfun/step-3.5-flash:free | Modèle StepFun gratuit (262K context) |
| **grok code** | x-ai/grok-code-fast-1:optimized:free | Grok Optimized gratuit (256K context) |
| **elephant** | openrouter/elephant-alpha | Elephant Alpha gratuit (262K context) |
| **free** | kilo-auto/free | Modèle Kilo Auto gratuit (204K context) |

**Exemples:**
run_agent(runner: "claude", agentName: "expert_python", prompt: "Analyse ce code")
run_agent(runner: "kilo", agentName: "architect", mode: "architect", prompt: "Conçois une API REST")
run_agent(runner: "cline", agentName: "planner", mode: "plan", prompt: "Planifie l'implémentation")`,
    parameters: runAgentSchema,
    execute: runAgent,
  });

  // ─── GESTION DES AGENTS ───────────────────────────────────────────────────────

  // Outil : Créer un nouvel agent (tous runners supportés)
  server.addTool({
    name: 'create_agent',
    description: `Crée un nouvel agent (Prompt + Config) compatible avec tous les runners.

**Runners supportés:** claude, gemini, kilo, qwen, openclaw, cline, opencode, trae

**Exemples:**
create_agent(name: "expert_python", runner: "claude", prompt: "Tu es un expert Python...")
create_agent(name: "architecte", runner: "kilo", mode: "architect", prompt: "Tu es un architecte logiciel...")
create_agent(name: "planner", runner: "cline", mode: "plan", prompt: "Tu es un planificateur de tâches...")`,
    parameters: createAgentSchema,
    execute: createAgent,
  });

  // Outil : Lister les agents
  server.addTool({
    name: 'list_agents',
    description:
      "Liste tous les agents disponibles. Option 'details=true' pour voir la config complète.",
    parameters: listAgentsSchema,
    execute: listAgents,
  });

  // Outil : Supprimer un agent
  server.addTool({
    name: 'delete_agent',
    description: 'Supprime définitivement un agent (Prompt et Config)',
    parameters: deleteAgentSchema,
    execute: deleteAgent,
  });

  // Outil : Mettre à jour la config d'un agent
  server.addTool({
    name: 'update_agent_config',
    description:
      "Modifie la configuration technique d'un agent (Runner, Modèle, Serveurs MCP, Variables d'environnement) OU réécrit entièrement l'un des 4 fichiers (prompt, settings, mcp, skill)",
    parameters: updateAgentConfigSchema,
    execute: updateAgentConfig,
  });

  // ─── GESTION DES PROMPTS ─────────────────────────────────────────────────────

  // Outil : Créer un prompt seul
  server.addTool({
    name: 'create_prompt',
    description: 'Crée ou écrase un fichier prompt Markdown (Persona)',
    parameters: createPromptSchema,
    execute: createPrompt,
  });

  // Outil : Éditer un prompt par search/replace (Diff)
  server.addTool({
    name: 'edit_prompt',
    description: 'Modifie un prompt existant en remplaçant un bloc de texte spécifique',
    parameters: editPromptSchema,
    execute: editPrompt,
  });

  // ─── MÉMOIRE OVERMIND ─────────────────────────────────────────────────────────

  server.addTool({
    name: 'memory_search',
    description:
      'Recherche sémantique + full-text dans la mémoire OverMind (connaissances + historique)',
    parameters: memorySearchSchema,
    execute: memorySearchTool,
  });

  server.addTool({
    name: 'memory_store',
    description: "Mémorise durablement une connaissance, décision ou pattern d'orchestration",
    parameters: memoryStoreSchema,
    execute: memoryStoreTool,
  });

  server.addTool({
    name: 'memory_runs',
    description:
      "Liste l'historique des runs d'agents enregistrés par OverMind (avec stats optionnelles)",
    parameters: memoryRunsSchema,
    execute: memoryRunsTool,
  });

  server.addTool({
    name: 'get_agent_configs',
    description:
      "Affiche les 4 fichiers de configuration d'un agent (prompt.md, .mcp.json, settings.json, skill.md)",
    parameters: getAgentConfigsSchema,
    execute: getAgentConfigs,
  });

  server.addTool({
    name: 'config_example',
    description:
      'Fournit des exemples de configuration settings.json pour différents LLM (GLM, MiniMax, OpenRouter).',
    parameters: configExampleSchema,
    execute: configExample,
  });

  server.addTool({
    name: 'shell_execute',
    description: 'Exécute une commande shell sur le système (git, npm, ls, etc.)',
    parameters: shellExecuteSchema,
    execute: shellExecute,
  });

  return server;
}
