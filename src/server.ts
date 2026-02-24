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
  regenerateMcpFiles,
  regenerateMcpFilesSchema,
} from './tools/manage_agents.js';

export function createServer(name: string = 'OverMind-MCP', memoryOnly: boolean = false) {
  const server = new FastMCP({
    name,
    version: '1.0.0',
  });

  if (!memoryOnly) {
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
        "Modifie la configuration technique d'un agent (Runner, Modèle, Serveurs MCP, Variables d'environnement)",
      parameters: updateAgentConfigSchema,
      execute: updateAgentConfig,
    });

    // Outil : Régénérer tous les fichiers MCP individuels
    server.addTool({
      name: 'regenerate_mcp_files',
      description:
        'Régénère les fichiers MCP individuels pour tous les agents (après modification de .mcp.local.json par exemple)',
      parameters: regenerateMcpFilesSchema,
      execute: regenerateMcpFiles,
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
  }

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

  return server;
}
