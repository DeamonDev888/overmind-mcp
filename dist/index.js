import { FastMCP } from 'fastmcp';
import { runClaudeAgent, runAgentSchema } from './tools/run_claude.js';
import { createAgent, createAgentSchema } from './tools/create_agent.js';
import { createPrompt, createPromptSchema, editPrompt, editPromptSchema } from './tools/manage_prompts.js';
import { listAgents, listAgentsSchema, deleteAgent, deleteAgentSchema, updateAgentConfig, updateAgentConfigSchema } from './tools/manage_agents.js';
import { updateConfig } from './lib/config.js';
import { fileURLToPath } from 'url';
export function createServer(name = "Claude-Code MCP Runner") {
    const server = new FastMCP({
        name,
        version: "1.0.0"
    });
    // Outil principal : Exécuter l'agent
    server.addTool({
        name: "run_agent",
        description: "Exécute une commande sur l'agent Claude configuré via CLI",
        parameters: runAgentSchema,
        execute: runClaudeAgent
    });
    // Outil : Créer un nouvel agent
    server.addTool({
        name: "create_agent",
        description: "Crée un nouvel agent (Prompt + Config) compatible avec ce runner",
        parameters: createAgentSchema,
        execute: createAgent
    });
    // Outil : Lister les agents
    server.addTool({
        name: "list_agents",
        description: "Liste tous les agents disponibles. Option 'details=true' pour voir la config complète.",
        parameters: listAgentsSchema,
        execute: listAgents
    });
    // Outil : Supprimer un agent
    server.addTool({
        name: "delete_agent",
        description: "Supprime définitivement un agent (Prompt et Config)",
        parameters: deleteAgentSchema,
        execute: deleteAgent
    });
    // Outil : Mettre à jour la config d'un agent
    server.addTool({
        name: "update_agent_config",
        description: "Modifie la configuration technique d'un agent (Modèle, Serveurs MCP, Variables d'environnement)",
        parameters: updateAgentConfigSchema,
        execute: updateAgentConfig
    });
    // Outil : Créer un prompt seul
    server.addTool({
        name: "create_prompt",
        description: "Crée ou écrase un fichier prompt Markdown (Persona)",
        parameters: createPromptSchema,
        execute: createPrompt
    });
    // Outil : Éditer un prompt par search/replace (Diff)
    server.addTool({
        name: "edit_prompt",
        description: "Modifie un prompt existant en remplaçant un bloc de texte spécifique",
        parameters: editPromptSchema,
        execute: editPrompt
    });
    // Prompt : Inspecter la config
    // server.addPrompt({
    //     name: "inspect_agent_config",
    //     description: "Affiche la configuration actuelle de l'agent",
    //     load: async () => {
    //         const content = await getAgentPrompt();
    //         return {
    //             messages: [{ 
    //                 role: 'user' as const, 
    //                 content: { type: 'text', text: content } 
    //             }]
    //         };
    //     }
    // });
    return server;
}
// Auto-start si exécuté directement
// node dist/index.js --settings ...
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
    const args = process.argv.slice(2);
    let settingsPath, mcpPath;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--settings' && args[i + 1]) {
            settingsPath = args[i + 1];
            i++;
        }
        else if (args[i] === '--mcp-config' && args[i + 1]) {
            mcpPath = args[i + 1];
            i++;
        }
    }
    if (settingsPath || mcpPath) {
        updateConfig(settingsPath, mcpPath);
        console.error(`🔧 Config surchargée : Settings=${settingsPath}, MCP=${mcpPath}`);
    }
    const server = createServer();
    server.start({ transportType: 'stdio' });
}
