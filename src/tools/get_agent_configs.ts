import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { AgentManager } from '../services/AgentManager.js';

export const getAgentConfigsSchema = z.object({
  name: z.string().describe("Nom de l'agent dont on veut voir les configurations."),
});

export async function getAgentConfigs(args: z.infer<typeof getAgentConfigsSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const manager = new AgentManager();
  const { name } = args;

  try {
    const configs = await manager.getDetailedConfigs(name);
    
    let response = `📄 **Configurations de l'agent '${name}'** :\n\n`;
    
    for (const [file, content] of Object.entries(configs)) {
      response += `### 📂 ${file}\n`;
      if (content === 'MISSING') {
        response += `*⚠️ Fichier non trouvé.*\n\n`;
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
