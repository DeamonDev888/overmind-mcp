import { z } from 'zod';
import { KiloRunner } from '../services/KiloRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';
import { deleteSessionId } from '../lib/sessions.js';

export const runKiloSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent Kilo"),
  mode: z.enum(['code', 'architect', 'ask', 'debug', 'orchestrator']).optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().optional().default(false),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().optional().default(false),
}).passthrough();

export async function runKiloAgent(args: z.infer<typeof runKiloSchema>) {
  const runner = new KiloRunner();
  const { prompt, agentName, autoResume, mode, path: argPath, config: argConfig, silent } = args;
  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();
  let result = await runner.runAgent({ prompt, agentName, autoResume, mode, cwd: finalPath, configPath: finalConfig, silent });

  // Retry if session invalid
  if (result.error?.includes('session') || result.error?.includes('EXIT_CODE_1')) {
    if (agentName) await deleteSessionId(agentName, finalConfig);
    result = await runner.runAgent({ prompt, agentName, autoResume: false, mode, cwd: finalPath, configPath: finalConfig, silent });
  }

  const durationMs = Date.now() - start;
  storeRun({ runner: 'kilo', agentName, prompt, result: result.result, error: result.error, durationMs, success: !result.error, sessionId: result.sessionId });

  if (result.error === 'INVALID_AGENT') {
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
