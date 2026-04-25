import { z } from 'zod';
import { getMemoryProvider } from '../memory/MemoryFactory.js';

export const memoryRunsSchema = z.object({
  runner: z
    .string()
    .optional()
    .describe(
      "Filtrer par runner (ex: 'claude', 'gemini', 'kilo', 'qwen'…). Vide = tous les runners.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Nombre de runs à retourner'),
  stats: z
    .boolean()
    .optional()
    .default(false)
    .describe("Afficher les statistiques globales d'orchestration"),
  agent_name: z
    .string()
    .optional()
    .describe('Filtrer par agent (détecté automatiquement si exécuté via OverMind)'),
});

export async function memoryRunsTool(args: z.infer<typeof memoryRunsSchema>) {
  const provider = getMemoryProvider();
  // Priorité à l'agent détecté (Privacy)
  const effectiveAgentName = process.env.OVERMIND_AGENT_NAME || args.agent_name;

  if (args.stats) {
    const s = await provider.getStats(effectiveAgentName);
    const rows = s.byRunner
      .map(
        (r: { runner: string; count: number; successes: number }) =>
          `  • **${r.runner}** : ${r.count} runs (${r.successes} ✅)`,
      )
      .join('\n');

    const scopeLabel = effectiveAgentName ? `pour l'agent **${effectiveAgentName}**` : 'globales';
    return {
      content: [
        {
          type: 'text' as const,
          text: `📊 **OverMind Statistics (${scopeLabel})**\n\n- Runs totaux : **${s.totalRuns}**\n- Connaissances stockées : **${s.totalKnowledge}**\n\n**Par runner :**\n${rows || '  _(aucun run enregistré)_'}`,
        },
      ],
    };
  }

  const runs = await provider.getRecentRuns({
    runner: args.runner,
    limit: args.limit,
    agentName: effectiveAgentName,
  });

  if (runs.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `📭 Aucun run enregistré${args.runner ? ` pour le runner **${args.runner}**` : ''}.`,
        },
      ],
    };
  }

  const lines = runs.map((r: import('../memory/types.js').AgentRun) => {
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
        type: 'text' as const,
        text: `🕐 **${runs.length} run(s)${args.runner ? ` pour ${args.runner}` : ''}**\n\n${lines.join('\n\n')}`,
      },
    ],
  };
}
