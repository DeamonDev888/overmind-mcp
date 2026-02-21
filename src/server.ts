import { FastMCP } from 'fastmcp';
import { runClaudeAgent, runAgentSchema } from './tools/run_claude.js';
import { runGeminiAgent, runGeminiSchema } from './tools/run_gemini.js';
import { runKiloAgent, runKiloSchema } from './tools/run_kilo.js';
import { runQwenAgent, runQwenSchema } from './tools/run_qwen.js';
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

export function createServer(name: string = 'OverMind-MCP') {
  const server = new FastMCP({
    name,
    version: '1.0.0',
  });

  // Outil principal : Exécuter l'agent Claude
  server.addTool({
    name: 'run_agent',
    description: "Exécute une commande sur l'agent Claude configuré via CLI",
    parameters: runAgentSchema,
    execute: runClaudeAgent,
  });

  // Outil : Exécuter l'agent Gemini
  server.addTool({
    name: 'run_gemini',
    description: "Exécute une commande sur l'agent Gemini configuré via CLI",
    parameters: runGeminiSchema,
    execute: runGeminiAgent,
  });

  // Outil : Exécuter l'agent Kilocode
  server.addTool({
    name: 'run_kilo',
    description:
      "Exécute une commande sur l'agent Kilocode via CLI. Supporte les modes : code, architect, ask, debug, orchestrator",
    parameters: runKiloSchema,
    execute: runKiloAgent,
  });

  // Outil : Exécuter l'agent Qwen Code
  server.addTool({
    name: 'run_qwen',
    description: "Exécute une commande sur l'agent Qwen Code via CLI (qwen -p)",
    parameters: runQwenSchema,
    execute: runQwenAgent,
  });

  // Outil : Créer un nouvel agent
  server.addTool({
    name: 'create_agent',
    description: 'Crée un nouvel agent (Prompt + Config) compatible avec ce runner',
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
      "Modifie la configuration technique d'un agent (Modèle, Serveurs MCP, Variables d'environnement)",
    parameters: updateAgentConfigSchema,
    execute: updateAgentConfig,
  });

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

  return server;
}
