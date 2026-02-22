import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

import { AgentManager } from '../services/AgentManager.js';

export const createAgentSchema = z.object({
  name: z
    .string()
    .describe("Nom de l'agent (ex: agent_finance). Sera utilisé pour les noms de fichiers."),
  prompt: z.string().describe("Le prompt système (instructions) de l'agent."),
  model: z
    .string()
    .optional()
    .default('claude-sonnet-4-5')
    .describe(
      'Modèle à utiliser. Supporte tous les modèles compatibles avec Claude Code (Anthropic, OpenAI, DeepSeek, Glm, Minimax, etc.). Ex: claude-sonnet-4-5, gpt-4, deepseek-chat',
    ),
  copyEnvFrom: z
    .string()
    .optional()
    .describe(
      "Chemin vers un settings.json existant pour copier les variables d'environnement (ex: .claude/settingsM.json)",
    ),
});

export async function createAgent(
  args: z.infer<typeof createAgentSchema>,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const manager = new AgentManager();
  const { name, prompt, model, copyEnvFrom } = args;

  const currentFileUrl = import.meta.url;
  const currentFilePath = fileURLToPath(currentFileUrl);
  // src/tools/create_agent.ts -> src/tools -> src -> Workflow
  const projectRoot = path.resolve(path.dirname(currentFilePath), '../../');

  const result = await manager.createAgent(name, prompt, model, copyEnvFrom, projectRoot);

  if (result.error === 'INVALID_NAME') {
    return {
      content: [
        {
          type: 'text',
          text: `❌ **Nom d'agent invalide**\n\nLe nom '${name}' contient des caractères interdits.\n\n💡 **Règle:** Utilisez uniquement des lettres, chiffres, tirets (-) et underscores (_).\n\nExemple valide: 'agent_finance', 'expert-seo'`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `✅ Agent '${name}' créé avec succès !\n\n📂 Fichiers :\n- Prompt : ${result.promptPath}\n- Config : ${result.settingsPath}\n\n🚀 Pour lancer cet agent :\nnode dist/bin/cli.js --settings .claude/settings_${name}.json`,
      },
    ],
  };
}
