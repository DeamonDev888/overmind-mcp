import { z } from 'zod';
import { getProcessStatus } from '../lib/processRegistry.js';

export const streamAgentOutputSchema = z.object({
  agentName: z.string().describe('Nom de l agent'),
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
    .optional()
    .describe('Type de runner (optionnel, défaut: any)'),
  sinceTimestamp: z
    .number()
    .optional()
    .describe('Ne retourner que la sortie après ce timestamp (ms)'),
  config: z.string().optional().describe('Chemin du fichier de configuration'),
});

export async function streamAgentOutputTool(args: z.infer<typeof streamAgentOutputSchema>) {
  const { agentName, runner, sinceTimestamp, config: configPath } = args;

  const entry = await getProcessStatus(agentName, runner, configPath);

  if (!entry) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Agent "${agentName}" non trouvé dans le registre.`,
        },
      ],
    };
  }

  const isComplete = entry.status === 'done' || entry.status === 'failed' || entry.status === 'orphaned';
  const output = entry.outputBuffer || '';

  if (sinceTimestamp && entry.lastOutputAt && entry.lastOutputAt > sinceTimestamp) {
    // For now, return all output if there was output after the timestamp
    // (per-chunk timestamps not yet implemented)
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: output || '(no output yet)',
      },
    ],
    isError: isComplete && entry.status === 'failed',
  };
}