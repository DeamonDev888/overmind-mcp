import { z } from 'zod';
import { getMemoryProvider } from '../memory/MemoryFactory.js';

export const memoryStoreSchema = z.object({
  text: z.string().min(1).describe('Texte ou connaissance à mémoriser durablement'),
  source: z
    .enum(['user', 'agent', 'pattern', 'error', 'decision'])
    .optional()
    .default('user')
    .describe('Type de connaissance : user (manuel), agent (auto), pattern (workflow), error (bug connu), decision (choix architectural)'),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function memoryStoreTool(args: z.infer<typeof memoryStoreSchema>): Promise<any> {
  try {
    const provider = getMemoryProvider();
    const id = await provider.storeKnowledge({ text: args.text, source: args.source });
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
