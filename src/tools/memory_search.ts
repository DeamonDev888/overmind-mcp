import { z } from 'zod';
import { searchMemory } from '../memory/OverMindMemory.js';

export const memorySearchSchema = z.object({
  query: z.string().describe('Requête de recherche (sémantique + full-text)'),
  limit: z.number().int().min(1).max(50).optional().default(10).describe('Nombre max de résultats'),
  include_runs: z
    .boolean()
    .optional()
    .default(false)
    .describe("Inclure l'historique des runs d'agents dans la recherche"),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function memorySearchTool(args: z.infer<typeof memorySearchSchema>): Promise<any> {
  const results = await searchMemory({
    query: args.query,
    limit: args.limit,
    includeRuns: args.include_runs,
  });

  if (results.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `🔍 Aucun souvenir trouvé pour : _"${args.query}"_\n\nUtilisez \`memory_store\` pour ajouter des connaissances.`,
        },
      ],
    };
  }

  const lines = results.map(
    (r, i) =>
      `**${i + 1}.** [${r.source}] (score: ${r.score.toFixed(3)}) — ${new Date(r.created_at).toISOString().slice(0, 10)}\n${r.text.slice(0, 500)}`,
  );

  return {
    content: [
      {
        type: 'text',
        text: `🧠 **${results.length} résultat(s) trouvé(s) pour "${args.query}"**\n\n${lines.join('\n\n---\n\n')}`,
      },
    ],
  };
}
