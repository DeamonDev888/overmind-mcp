import { z } from 'zod';
import { runAgent, runAgentSchema } from './run_agent.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const AgentTaskSchema = runAgentSchema.extend({
  taskId: z
    .string()
    .optional()
    .describe("Identifiant optionnel pour la tâche (ex: 'build', 'lint', 'test')"),
});

export const runAgentsParallelSchema = z.object({
  agents: z
    .array(AgentTaskSchema)
    .min(1, 'Au moins un agent requis.')
    .max(10, 'Maximum 10 agents en parallèle.')
    .describe(
      "Liste des agents à lancer en parallèle. Chaque entrée est un appel run_agent complet (runner, prompt, agentName, model, path, mode…)."
    ),
  waitAll: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Si true (défaut), attend que TOUS les agents terminent avant de retourner le résultat. Si false, retourne dès que le premier réussit."
    ),
});

type AgentTaskInput = z.infer<typeof AgentTaskSchema>;

// ─── Tool ────────────────────────────────────────────────────────────────────

export async function runAgentsParallel(args: z.infer<typeof runAgentsParallelSchema>) {
  const { agents, waitAll } = args;
  const startTime = Date.now();

  // Lance tous les agents en parallèle
  const promises = agents.map(async (agentArgs: AgentTaskInput, index: number) => {
    const label = agentArgs.taskId || agentArgs.agentName || `task_${index + 1}`;
    const taskStart = Date.now();

    try {
      const result = await runAgent(agentArgs);
      const elapsed = ((Date.now() - taskStart) / 1000).toFixed(1);

      // Extrait le texte du résultat
      const text =
        Array.isArray(result?.content)
          ? result.content
              .filter((c: { type: string }) => c.type === 'text')
              .map((c: { text: string }) => c.text)
              .join('\n')
          : String(result);

      return {
        label,
        runner: agentArgs.runner,
        agentName: agentArgs.agentName,
        status: result?.isError ? 'error' : 'success',
        elapsed: `${elapsed}s`,
        result: text.slice(0, 2000), // Tronquer pour éviter les réponses géantes
      };
    } catch (err: unknown) {
      const elapsed = ((Date.now() - taskStart) / 1000).toFixed(1);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        label,
        runner: agentArgs.runner,
        agentName: agentArgs.agentName,
        status: 'error',
        elapsed: `${elapsed}s`,
        result: msg,
      };
    }
  });

  // Attendre tous les résultats ou le premier succès
  let results: Awaited<typeof promises[number]>[];

  if (waitAll) {
    // Promise.allSettled : on attend tous, même si certains échouent
    const settled = await Promise.allSettled(promises);
    results = settled.map((s, i) => {
      const label = agents[i].taskId || agents[i].agentName || `task_${i + 1}`;
      if (s.status === 'fulfilled') return s.value;
      return {
        label,
        runner: agents[i].runner,
        agentName: agents[i].agentName,
        status: 'error' as const,
        elapsed: '?',
        result: s.reason instanceof Error ? s.reason.message : String(s.reason),
      };
    });
  } else {
    // Promise.race : retourne dès que le premier se résout
    const firstResult = await Promise.race(promises);
    results = [firstResult];
  }

  // ─── Résumé formaté ────────────────────────────────────────────────────────
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  const summary = [
    `⚡ run_agents_parallel — ${results.length} agent(s) | ✅ ${successCount} succès | ❌ ${errorCount} erreurs | 🕐 ${totalElapsed}s total`,
    '',
    ...results.map(r => {
      const icon = r.status === 'success' ? '✅' : '❌';
      const header = `${icon} [${r.label}] ${r.runner}${r.agentName ? `/${r.agentName}` : ''} (${r.elapsed})`;
      return `${header}\n${r.result}`;
    }),
  ].join('\n---\n');

  return {
    content: [
      { type: 'text' as const, text: summary },
    ],
    isError: errorCount === results.length, // Erreur globale seulement si TOUS ont échoué
  };
}
