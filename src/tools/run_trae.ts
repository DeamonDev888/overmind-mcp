import { z } from 'zod';
import { TraeRunner } from '../services/TraeRunner.js';

export const runTraeSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent Trae (mode SOLO)"),
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
export async function runTraeAgent(args: z.infer<typeof runTraeSchema>): Promise<any> {
  const runner = new TraeRunner();
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
      content: [
        {
          type: 'text',
          text: `❌ Erreur lors de l'exécution Trae: ${result.error}\n\n💡 **Note:** Trae requiert une installation locale (trae.ai/download). Vérifiez que le binaire \`trae\` est dans votre PATH.`,
        },
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
