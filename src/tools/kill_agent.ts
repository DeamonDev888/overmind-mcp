import { z } from 'zod';
import { killAgent } from '../lib/processRegistry.js';

export const killAgentSchema = z.object({
  agentName: z.string().describe('Nom de l agent à tuer'),
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
    .optional()
    .describe('Type de runner (optionnel, défaut: any)'),
  config: z.string().optional().describe('Chemin du fichier de configuration'),
});

export async function killAgentTool(args: z.infer<typeof killAgentSchema>) {
  const { agentName, runner, config: configPath } = args;

  const result = await killAgent(agentName, runner, configPath);

  if (!result.killed) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Agent "${agentName}" (runner: ${runner || 'any'}) n est pas en cours d exécution ou déjà terminé.`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: `Agent "${agentName}" tué avec succès (PID: ${result.pid}).`,
      },
    ],
  };
}