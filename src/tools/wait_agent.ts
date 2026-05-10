import { z } from 'zod';
import { getProcessStatus } from '../lib/processRegistry.js';

export const waitAgentSchema = z.object({
  agentName: z.string().describe('Nom de l agent'),
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
    .optional()
    .describe('Type de runner (optionnel, défaut: any)'),
  timeoutMs: z
    .number()
    .optional()
    .default(900000)
    .describe('Timeout en ms (défaut: 900000 = 15 min)'),
  config: z.string().optional().describe('Chemin du fichier de configuration'),
});

export async function waitAgentTool(args: z.infer<typeof waitAgentSchema>) {
  const { agentName, runner, timeoutMs, config: configPath } = args;

  const start = Date.now();
  const pollInterval = 1000; // 1 second

  while (Date.now() - start < timeoutMs) {
    const entry = await getProcessStatus(agentName, runner, configPath);

    if (!entry) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Agent "${agentName}" n existe plus dans le registre.`,
          },
        ],
        isError: true,
      };
    }

    if (entry.status === 'done') {
      return {
        content: [
          {
            type: 'text' as const,
            text: entry.outputBuffer || 'Agent terminé avec succès.',
          },
        ],
      };
    }

    if (entry.status === 'failed' || entry.status === 'orphaned') {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Agent terminé avec erreur: ${entry.status}\n\nSortie:\n${entry.outputBuffer || 'N/A'}`,
          },
        ],
        isError: true,
      };
    }

    // Still running — wait before next poll
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  // Timeout reached
  return {
    content: [
      {
        type: 'text' as const,
        text: `Timeout de ${timeoutMs}ms atteint. L'agent est toujours en cours d exécution.`,
      },
    ],
    isError: true,
  };
}