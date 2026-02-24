import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { AgentManager } from '../services/AgentManager.js';
import { getAgentMcpGenerator } from '../services/AgentMcpGenerator.js';

// --- Schemas ---

export const listAgentsSchema = z.object({
  details: z
    .boolean()
    .optional()
    .default(false)
    .describe('Si true, affiche les détails complets (modèle, config) de chaque agent.'),
});

export const deleteAgentSchema = z.object({
  name: z.string().describe("Nom de l'agent à supprimer (ex: agent_finance)"),
});

export const updateAgentConfigSchema = z.object({
  name: z.string().describe("Nom de l'agent à modifier"),
  model: z
    .string()
    .optional()
    .describe(
      'Nouveau modèle à utiliser. Supporte tous les modèles compatibles avec Claude Code (Anthropic, OpenAI, DeepSeek, Glm, Minimax, etc.). Ex: claude-sonnet-4-5, gpt-4, deepseek-chat',
    ),
  mcpServers: z
    .array(z.string())
    .optional()
    .describe(
      "Liste complète des serveurs MCP à activer (remplace la liste existante). Ex: ['postgresql', 'news']",
    ),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Variables d'environnement supplémentaires à définir ou écraser (ex: { 'API_KEY': '123' })",
    ),
});

export const regenerateMcpFilesSchema = z.object({
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe('Si true, régénère même pour les agents qui utilisent tous les MCPs'),
});

// --- Tools ---

export async function listAgents(args: z.infer<typeof listAgentsSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const manager = new AgentManager();
  try {
    const agentsList = await manager.listAgents(args.details);

    if (agentsList.length === 0) {
      return {
        content: [{ type: 'text', text: '📂 Aucun agent trouvé.' }],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `📋 **Liste des Agents Disponibles (${agentsList.length})** :\n\n${agentsList.join('\n\n')}`,
        },
      ],
    };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `❌ Erreur lors du listing des agents : ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
}

export async function deleteAgent(args: z.infer<typeof deleteAgentSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const manager = new AgentManager();
  const { name } = args;

  const result = await manager.deleteAgent(name);

  // Supprimer aussi le fichier MCP individuel
  try {
    const mcpGen = getAgentMcpGenerator();
    const mcpPath = mcpGen.getAgentMcpPath(name);
    if (mcpPath) {
      fs.unlinkSync(mcpPath);
      result.deletedFiles.push(mcpPath);
    }
  } catch (err) {
    console.warn(`[deleteAgent] Impossible de supprimer le fichier MCP de ${name}:`, err);
  }

  if (result.deletedFiles.length === 0 && result.errors.length === 0) {
    return {
      isError: true,
      content: [{ type: 'text', text: `⚠️ Agent '${name}' introuvable (ni prompt, ni settings).` }],
    };
  }

  let response = `🗑️ **Suppression de l'agent '${name}'**\n`;
  if (result.deletedFiles.length > 0) {
    response += `\n✅ Fichiers supprimés :\n${result.deletedFiles.map((f: string) => `- ${path.basename(f)}`).join('\n')}`;
  }
  if (result.errors.length > 0) {
    response += `\n\n❌ Erreurs :\n${result.errors.join('\n')}`;
  }

  return {
    content: [{ type: 'text', text: response }],
  };
}

export async function updateAgentConfig(args: z.infer<typeof updateAgentConfigSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const manager = new AgentManager();
  const { name, model, mcpServers, env } = args;

  try {
    const changes = await manager.updateAgentConfig(name, { model, mcpServers, env });

    if (changes.length === 0) {
      return {
        content: [
          { type: 'text', text: `⚠️ Aucune modification demandée pour l'agent '${name}'.` },
        ],
      };
    }

    // Régénérer le fichier MCP individuel si les serveurs MCP ont changé
    try {
      const mcpGen = getAgentMcpGenerator();
      mcpGen.generateAgentMcp(name);
    } catch (err) {
      console.warn(`[updateAgentConfig] Impossible de régénérer le fichier MCP pour ${name}:`, err);
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Configuration de l'agent '${name}' mise à jour :\n${changes.join('\n')}`,
        },
      ],
    };
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `❌ **Agent Introuvable**\n\nImpossible de modifier la configuration pour '${name}' car le fichier settings est introuvable.\n\n💡 **Solution:** Vérifiez le nom de l'agent avec \`list_agents\`.`,
          },
        ],
      };
    }
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `❌ Erreur lors de la mise à jour de '${name}': ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
}
export async function regenerateMcpFiles(_args: z.infer<typeof regenerateMcpFilesSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  // Le paramètre 'force' est disponible dans args mais la méthode regenerateAll() ne l'utilise pas encore

  try {
    const mcpGen = getAgentMcpGenerator();
    const result = mcpGen.regenerateAll();

    return {
      content: [
        {
          type: 'text',
          text: `✅ **Fichiers MCP régénérés avec succès !**\n\n📊 Statistiques :\n- ✅ Générés : ${result.generated}\n- ⏭️  Ignorés : ${result.skipped}\n- ❌ Erreurs : ${result.errors}\n\n📂 Les fichiers sont dans : Workflow/.claude/`,
        },
      ],
    };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `❌ Erreur lors de la régénération des fichiers MCP : ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
}
