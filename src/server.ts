import { FastMCP } from 'fastmcp';
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
import { metadataTool, metadataSchema } from './tools/metadata.js';

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
    execute: runAgent,
  });

  // ─── OUTIL PARALLÈLE MULTI-AGENTS ──────────────────────────────────────────
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
    execute: runAgentsParallel,
  });


  // Outil : Créer un nouvel agent (tous runners supportés)
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

  // ─── METADATA ────────────────────────────────────────────────────────────────

  server.addTool({
    name: 'metadata',
    description: `Retourne les métadonnées projet instantanément : arborescence, fichiers de config, statistiques (fichiers, lignes, langages).

**Paramètres:**
- path: Chemin du projet (défaut: répertoire courant)
- depth: Profondeur de l'arborescence (défaut: 3)
- includeStats: Inclure les statistiques de code (défaut: true)

**Exemple:**
metadata(path: "./my-project", depth: 4, includeStats: true)`,
    parameters: metadataSchema,
    execute: metadataTool,
  });

  return server;
}
