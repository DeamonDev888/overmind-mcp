import { z } from 'zod';
import { ClineRunner } from '../services/ClineRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';
import { deleteSessionId } from '../lib/sessions.js';

export const runClineSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent Cline"),
  mode: z.enum(['plan', 'act']).optional(),
  sessionId: z.string().optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().optional().default(false),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().optional().default(false),
});

export async function runClineAgent(args: z.infer<typeof runClineSchema>) {
  const runner = new ClineRunner();
  const { prompt, agentName, autoResume, sessionId, mode, path: argPath, config: argConfig, silent } = args;
  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();
  let result = await runner.runAgent({ prompt, agentName, autoResume, sessionId, mode, cwd: finalPath, configPath: finalConfig, silent });

  // Retry if session invalid
  if (result.error?.includes('session') || result.error?.includes('EXIT_CODE_1')) {
    if (agentName) await deleteSessionId(agentName, finalConfig, 'cline');
    result = await runner.runAgent({ prompt, agentName, autoResume: false, sessionId: undefined, mode, cwd: finalPath, configPath: finalConfig, silent });
  }

  const durationMs = Date.now() - start;
  try {
    await storeRun({ runner: 'cline', agentName, prompt, result: result.result, error: result.error, durationMs, success: !result.error, sessionId: result.sessionId });
  } catch (_e) {
    // Silent
  }

  if (result.error) return { content: [{ type: 'text' as const, text: `❌ Erreur Cline: ${result.error}` }], isError: true };
  return { content: [{ type: 'text' as const, text: result.result }, ...(result.sessionId ? [{ type: 'text' as const, text: `SESSION_ID: ${result.sessionId}` }] : [])] };
}
