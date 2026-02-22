import { z } from 'zod';
import { getMemoryProvider } from '../memory/MemoryFactory.js';

export const memorySearchSchema = z.object({
  query: z.string().describe('Requête de recherche (sémantique + full-text)'),
  limit: z.number().int().min(1).max(50).optional().default(10).describe('Nombre max de résultats'),
  include_runs: z
    .boolean()
    .optional()
    .default(false)
    .describe("Inclure l'historique des runs d'agents dans la recherche"),
  agent_name: z
    .string()
    .optional()
    .describe("Filtrer par nom d'agent (pour ses propres souvenirs)"),
});

export async function memorySearchTool(args: z.infer<typeof memorySearchSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const provider = getMemoryProvider();
  const results = await provider.searchMemory({
    query: args.query,
    limit: args.limit,
    includeRuns: args.include_runs,
    agentName: args.agent_name,
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
