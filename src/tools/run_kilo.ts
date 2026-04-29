import { z } from 'zod';
import { KiloRunner } from '../services/KiloRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';
import { deleteSessionId } from '../lib/sessions.js';

export const runKiloSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent Kilo"),
  mode: z.enum(['code', 'architect', 'ask', 'debug', 'orchestrator']).optional(),
  agentName: z.string().optional(),
  sessionId: z.string().optional(),
  autoResume: z.boolean().optional().default(false),
  model: z.string().optional().describe("Modèle à utiliser (override env.KILO_MODEL)"),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().optional().default(false),
}).passthrough();

export async function runKiloAgent(args: z.infer<typeof runKiloSchema>) {
  const runner = new KiloRunner();
  const { prompt, agentName, autoResume, sessionId, mode, model, path: argPath, config: argConfig, silent } = args;
  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();
  let result = await runner.runAgent({ prompt, agentName, autoResume, sessionId, mode, model, cwd: finalPath, configPath: finalConfig, silent });

  if (result.error?.includes('session') || result.error?.includes('EXIT_CODE_1') || result.error === 'JSON_PARSE_ERROR') {
    if (agentName) await deleteSessionId(agentName, finalConfig, 'kilo');
    result = await runner.runAgent({ prompt, agentName, autoResume: false, sessionId: undefined, mode, model, cwd: finalPath, configPath: finalConfig, silent });
  }

  const durationMs = Date.now() - start;
  try {
    await storeRun({ runner: 'kilo', agentName, prompt, result: result.result, error: result.error, durationMs, success: !result.error, sessionId: result.sessionId });
  } catch (_e) {
    // Memory store is secondary
  }

  if (result.error?.startsWith('INVALID_AGENT')) {
    return {
      content: [{ type: 'text' as const, text: `❌ Agent Kilo '${agentName}' introuvable.` }],
      isError: true,
    };
  }

  if (result.error) {
    return { content: [{ type: 'text' as const, text: `❌ Erreur Kilo: ${result.error}` }], isError: true };
  }

  return {
    content: [
      { type: 'text' as const, text: result.result },
      ...(result.sessionId ? [{ type: 'text' as const, text: `SESSION_ID: ${result.sessionId}` }] : []),
    ],
  };
}
