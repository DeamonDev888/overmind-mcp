import { z } from 'zod';
import { QwenCLIRunner } from '../services/QwenCliRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';

export const runQwenCLISchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent QwenCLI"),
  sessionId: z.string().optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().optional().default(false),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().optional().default(false),
});

export async function runQwenCLIAgent(args: z.infer<typeof runQwenCLISchema>) {
  const runner = new QwenCLIRunner();
  const { prompt, agentName, autoResume, sessionId, path: argPath, config: argConfig, silent } = args;
  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();
  const result = await runner.runAgent({ prompt, agentName, autoResume, sessionId, cwd: finalPath, configPath: finalConfig, silent });
  const durationMs = Date.now() - start;

  storeRun({ runner: 'qwencli', agentName, prompt, result: result.result, error: result.error, durationMs, success: !result.error, sessionId: result.sessionId });

  if (result.error) return { content: [{ type: 'text' as const, text: `❌ Erreur QwenCLI: ${result.error}` }], isError: true };
  return { content: [{ type: 'text' as const, text: result.result }, ...(result.sessionId ? [{ type: 'text' as const, text: `SESSION_ID: ${result.sessionId}` }] : [])], sessionId: result.sessionId };
}
