import { z } from 'zod';
import { GeminiRunner } from '../services/GeminiRunner.js';

export const runGeminiSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent Gemini"),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runGeminiAgent(args: z.infer<typeof runGeminiSchema>): Promise<any> {
  const runner = new GeminiRunner();
  const { prompt, agentName, autoResume, sessionId } = args;

  const result = await runner.runAgent({ prompt, agentName, autoResume, sessionId });

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
      content: [{ type: 'text', text: `❌ Erreur lors de l'exécution: ${result.error}` }],
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
