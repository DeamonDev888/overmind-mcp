import { z } from 'zod';
import { getProcessStatus } from '../lib/processRegistry.js';

export const getAgentStatusSchema = z.object({
  agentName: z.string().describe('Nom de l agent'),
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
    .optional()
    .describe('Type de runner (optionnel, défaut: any)'),
  config: z.string().optional().describe('Chemin du fichier de configuration'),
});

export async function getAgentStatusTool(args: z.infer<typeof getAgentStatusSchema>) {
  const { agentName, runner, config: configPath } = args;

  const entry = await getProcessStatus(agentName, runner, configPath);

  if (!entry) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Agent "${agentName}" (runner: ${runner || 'any'}) n est pas trouvé dans le registre. Il n est pas en cours d exécution ou a été nettoyé.`,
        },
      ],
    };
  }

  const lines = [
    `**Agent:** ${entry.agentName}`,
    `**Runner:** ${entry.runner || 'unknown'}`,
    `**Status:** ${entry.status}`,
    `**Started:** ${new Date(entry.ts).toISOString()}`,
    entry.pid ? `**PID:** ${entry.pid}` : null,
    entry.id ? `**Session ID:** ${entry.id}` : null,
    entry.exitCode !== null && entry.exitCode !== undefined ? `**Exit Code:** ${entry.exitCode}` : null,
    `**Last Output At:** ${entry.lastOutputAt ? new Date(entry.lastOutputAt).toISOString() : 'N/A'}`,
    entry.outputBuffer ? `\n**Output Buffer (${entry.outputBuffer.length} chars):**\n\`\`\`\n${entry.outputBuffer.slice(-2000)}\n\`\`\`` : null,
  ].filter(Boolean);

  return {
    content: [
      {
        type: 'text' as const,
        text: lines.join('\n'),
      },
    ],
    isError: entry.status === 'failed' || entry.status === 'orphaned',
  };
}