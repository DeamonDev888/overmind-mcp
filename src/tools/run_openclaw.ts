import { z } from 'zod';
import { OpenClawRunner } from '../services/OpenClawRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';

export const runOpenClawSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent OpenClaw"),
  sessionId: z
    .string()
    .optional()
    .describe('ID de session pour continuer une conversation (manuel)'),
  agentName: z
    .string()
    .optional()
    .describe("Nom de l'agent (pour logging/monitoring et persistance)"),
  autoResume: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Si true (et agentName fourni), reprend automatiquement la dernière conversation de cet agent',
    ),
});

export async function runOpenClawAgent(
  args: z.infer<typeof runOpenClawSchema>,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const runner = new OpenClawRunner();
  const { prompt, agentName, autoResume, sessionId } = args;

  const start = Date.now();
  const result = await runner.runAgent({ prompt, agentName, autoResume, sessionId });
  const durationMs = Date.now() - start;

  // Auto-instrumentation
  storeRun({
    runner: 'openclaw',
    agentName,
    prompt,
    result: result.result,
    error: result.error,
    durationMs,
    success: !result.error,
    sessionId: result.sessionId,
  });

  if (result.error === 'INVALID_AGENT') {
    return {
      content: [
        {
          type: 'text',
          text: `❌ **Erreur Configuration Agent**\n\nL'agent '${agentName}' est introuvable ou mal configuré.\n\n💡 **Solution:**\nUtilisez l'outil \`create_agent\` pour créer cet agent avant de l'exécuter.`,
        },
      ],
      isError: true,
    };
  }

  if (result.error) {
    return {
      content: [
        { type: 'text', text: `❌ Erreur lors de l'exécution OpenClaw: ${result.error}\n\n⚡ _L'OverMind surveille les OpenClaw qui n'obéissent pas._` },
      ],
      isError: true,
    };
  }

  return {
    content: [
      { type: 'text', text: result.result },
      { type: 'text', text: `RAW: ${result.rawOutput}` },
    ],
  };
}
