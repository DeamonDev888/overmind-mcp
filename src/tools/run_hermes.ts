import { z } from 'zod';
import { NousHermesRunner } from '../services/NousHermesRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';
import { deleteSessionId } from '../lib/sessions.js';

export const runHermesSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent Nous Hermes"),
  sessionId: z.string().optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().optional().default(false),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().optional().default(false),
  model: z.string().optional().describe("Le modèle à utiliser. Priorité NVIDIA NIM (ex: deepseek-ai/deepseek-v4-pro) ou OpenRouter (ex: tencent/hy3-preview)"),
}).passthrough();

export async function runHermesAgent(args: z.infer<typeof runHermesSchema>) {
  const runner = new NousHermesRunner();
  const { prompt, agentName, autoResume, sessionId, path: argPath, config: argConfig, silent, model } = args;
  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();
  let result = await runner.runAgent({ prompt, agentName, autoResume, sessionId, cwd: finalPath, configPath: finalConfig, silent, model });

  // Retry if session invalid
  if (result.error?.includes('session') || result.error?.includes('EXIT_CODE_1')) {
    if (agentName) await deleteSessionId(agentName, finalConfig);
    result = await runner.runAgent({ prompt, agentName, autoResume: false, sessionId: undefined, cwd: finalPath, configPath: finalConfig, silent, model });
  }

  const durationMs = Date.now() - start;
  try {
    await storeRun({ runner: 'hermes', agentName, prompt, result: result.result, error: result.error, durationMs, success: !result.error, sessionId: result.sessionId });
  } catch (_e) {
    // Silent
  }

  if (result.error) return { content: [{ type: 'text' as const, text: `❌ Erreur NousHermes: ${result.error}` }], isError: true };
  return { content: [{ type: 'text' as const, text: result.result }, ...(result.sessionId ? [{ type: 'text' as const, text: `SESSION_ID: ${result.sessionId}` }] : [])] };
}
