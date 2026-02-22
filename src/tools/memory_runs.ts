import { z } from 'zod';
import { getMemoryProvider } from '../memory/MemoryFactory.js';

export const memoryRunsSchema = z.object({
  runner: z
    .string()
    .optional()
    .describe("Filtrer par runner (ex: 'claude', 'gemini', 'kilo', 'qwen'…). Vide = tous les runners."),
  limit: z.number().int().min(1).max(100).optional().default(20).describe('Nombre de runs à retourner'),
  stats: z
    .boolean()
    .optional()
    .default(false)
    .describe("Afficher les statistiques globales d'orchestration"),
});

export async function memoryRunsTool(
  args: z.infer<typeof memoryRunsSchema>,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const provider = getMemoryProvider();

  if (args.stats) {
    const s = await provider.getStats();
    const rows = s.byRunner
      .map((r) => `  • **${r.runner}** : ${r.count} runs (${r.successes} ✅)`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `📊 **OverMind Statistics**\n\n- Runs totaux : **${s.totalRuns}**\n- Connaissances stockées : **${s.totalKnowledge}**\n\n**Par runner :**\n${rows || '  _(aucun run enregistré)_'}`,
        },
      ],
    };
  }

  const runs = await provider.getRecentRuns({ runner: args.runner, limit: args.limit });

  if (runs.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `📭 Aucun run enregistré${args.runner ? ` pour le runner **${args.runner}**` : ''}.`,
        },
      ],
    };
  }

  const lines = runs.map((r) => {
    const date = new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19);
    const status = r.success ? '✅' : '❌';
    const dur = r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '?';
    const preview = (r.result ?? r.error ?? '').slice(0, 120);
    const agentLabel = r.agent_name ? ` (${r.agent_name})` : '';
    return `${status} **[${r.runner}${agentLabel}]** — ${date} — ${dur}\n> _${r.prompt.slice(0, 100)}_\n> ${preview}`;
  });

  return {
    content: [
      {
        type: 'text',
        text: `🕐 **${runs.length} run(s)${args.runner ? ` pour ${args.runner}` : ''}**\n\n${lines.join('\n\n')}`,
      },
    ],
  };
}
