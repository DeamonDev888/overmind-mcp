import { z } from 'zod';
import { runAgentSchema } from './run_agent.js';
import { dispatchAgents } from '../lib/orchestration/dispatcher.js';

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
      'Liste des agents à lancer en parallèle. Chaque entrée est un appel run_agent complet (runner, prompt, agentName, model, path, mode…).',
    ),
  waitAll: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Si true (défaut), attend que TOUS les agents terminent avant de retourner le résultat. Si false, retourne dès que le premier réussit.',
    ),
});

// ─── Tool ────────────────────────────────────────────────────────────────────

export async function runAgentsParallel(args: z.infer<typeof runAgentsParallelSchema>) {
  const { agents, waitAll } = args;
  return dispatchAgents(agents, { waitAll });
}
