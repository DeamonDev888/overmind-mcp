import { z } from 'zod';
import { getMemoryProvider } from '../memory/MemoryFactory.js';

export const memoryStoreSchema = z.object({
  text: z.string().min(1).describe('Texte ou connaissance à mémoriser durablement'),
  source: z
    .enum(['user', 'agent', 'pattern', 'error', 'decision'])
    .optional()
    .default('user')
    .describe(
      'Type de connaissance : user (manuel), agent (auto), pattern (workflow), error (bug connu), decision (choix architectural)',
    ),
  agent_name: z
    .string()
    .optional()
    .describe("Nom de l'agent (détecté automatiquement si exécuté via OverMind)"),
});

export async function memoryStoreTool(args: z.infer<typeof memoryStoreSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    const provider = getMemoryProvider();
    // Priorité à l'agent détecté (Privacy)
    const effectiveAgentName = process.env.OVERMIND_AGENT_NAME || args.agent_name;

    const id = await provider.storeKnowledge({
      text: args.text,
      source: args.source,
      agentName: effectiveAgentName,
    });
    return {
      content: [
        {
          type: 'text',
          text: `✅ **Souvenir mémorisé** [${args.source}]\nID: \`${id}\`\n\n_"${args.text.slice(0, 200)}${args.text.length > 200 ? '…' : ''}"_`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ Erreur de mémorisation: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
