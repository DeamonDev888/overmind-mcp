import { z } from 'zod';
import { ClaudeRunner } from '../services/ClaudeRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';

// export const runAgentSchema = z.object({
//     prompt: z.string().describe("Le prompt à envoyer à l'agent"),
//     sessionId: z.string().optional().describe("ID de session pour continuer une conversation (manuel)"),
//     agentName: z.string().optional().describe("Nom de l'agent (pour logging/monitoring et persistance)"),
//     autoResume: z.boolean().optional().default(false).describe("Si true (et agentName fourni), reprend automatiquement la dernière conversation de cet agent")
// });

export const runAgentSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent"),
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

export async function runClaudeAgent(args: z.infer<typeof runAgentSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const runner = new ClaudeRunner();
  const { prompt, agentName, autoResume, sessionId } = args;

  const start = Date.now();
  const result = await runner.runAgent({ prompt, agentName, autoResume, sessionId });
  const durationMs = Date.now() - start;

  // Auto-instrument: record every run in OverMind memory
  try {
    storeRun({
      runner: 'claude',
      agentName,
      prompt,
      result: result.result,
      error: result.error,
      durationMs,
      success: !result.error,
      sessionId: result.sessionId,
    });
  } catch {
    /* silent — memory must never block the runner */
  }

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

  if (result.error === 'JSON_PARSE_ERROR') {
    const preview = result.rawOutput?.trim().substring(0, 500);
    return {
      content: [
        {
          type: 'text',
          text: `⚠️ **Réponse Agent Non-Conforme (JSON invalide)**\n\nL'agent '${agentName || 'default'}' a répondu, mais le format JSON est cassé.\n\n🔍 **Début de la réponse reçue:**\n\`\`\`text\n${preview}...\n\`\`\`\n\n💡 **Conseil:** Vérifiez que le prompt demande explicitement une sortie JSON pure.`,
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
      { type: 'text', text: `SESSION_ID: ${result.sessionId}` },
    ],
  };
}
