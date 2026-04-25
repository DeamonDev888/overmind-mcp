import { z } from 'zod';
import { AgentManager } from '../services/AgentManager.js';

export const getAgentConfigsSchema = z.object({
  name: z.string().describe("Nom de l'agent dont on veut voir les configurations."),
});

export async function getAgentConfigs(args: z.infer<typeof getAgentConfigsSchema>) {
  const manager = new AgentManager();
  const { name } = args;

  try {
    const configs = await manager.getDetailedConfigs(name);

    let response = `🧠 **CONFIGURATION HUB — AGENT : ${name.toUpperCase()}**\n\n`;

    for (const [file, content] of Object.entries(configs)) {
      response += `#### 📂 ${file}\n`;
      if (content === 'MISSING') {
        const solution =
          file === '.mcp.json'
            ? `Utilisez 'update_agent_config' pour synchroniser les serveurs MCP.`
            : `Utilisez 'create_agent' pour initialiser cet agent.`;
        response += `> [!CAUTION]\n`;
        response += `> **Fichier non trouvé.**\n`;
        response += `> 💡 Suggestion: ${solution}\n\n`;
      } else {
        const ext = file.endsWith('.md') ? 'markdown' : 'json';
        response += `\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
      }
    }

    return {
      content: [{ type: 'text' as const, text: response }],
    };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur lors de la récupération des configs pour ${name} : ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
}
