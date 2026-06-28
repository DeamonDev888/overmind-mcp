import { z } from 'zod';
import { HermesRunner } from '../services/HermesRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';
import { deleteSessionId } from '../lib/sessions.js';

export const runHermesSchema = z
  .object({
    prompt: z.string().describe("Le prompt à envoyer à l'agent Hermes"),
    sessionId: z.string().optional(),
    agentName: z.string().optional(),
    autoResume: z.boolean().optional().default(false),
    path: z.string().optional(),
    config: z.string().optional(),
    silent: z.boolean().optional().default(false),
    model: z
      .string()
      .optional()
      .describe(
        'Model override (optional — the profile config.yaml is the default)',
      ),
    provider: z
      .string()
      .optional()
      .describe(
        'Provider override (optional — the profile config.yaml is the default)',
      ),
    signal: z.custom<AbortSignal>().optional().describe("AbortSignal pour annuler l'agent"),
    /** Quand true, skip storeRun() — utilisé par Overmind MCP (le stockage est fait cote MCP Server) */
    overmindMode: z.boolean().optional().default(false),
  })
  .passthrough();

import { verifyInstallation } from '../lib/InstallHelper.js';

export async function runHermesAgent(args: z.infer<typeof runHermesSchema>) {
  const { runner: runnerKey } = { runner: 'hermes' }; // Identification
  const check = await verifyInstallation(runnerKey);
  if (!check.ok) {
    return {
      content: [{ type: 'text' as const, text: check.message || `CLI hermes non installé.` }],
      isError: true,
    };
  }

  const runner = new HermesRunner();
  const {
    prompt,
    agentName,
    autoResume,
    sessionId,
    path: argPath,
    config: argConfig,
    silent,
    model,
    provider,
    signal,
    overmindMode,
  } = args;
  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();
  let result = await runner.runAgent({
    prompt,
    agentName,
    autoResume,
    sessionId,
    cwd: finalPath,
    configPath: finalConfig,
    silent,
    model,
    provider,
    signal,
  });

  // Retry if session invalid
  if (result.error?.includes('session') || result.error?.includes('EXIT_CODE_1')) {
    if (agentName) await deleteSessionId(agentName, finalConfig, 'hermes');
    result = await runner.runAgent({
      prompt,
      agentName,
      autoResume: false,
      sessionId: undefined,
      cwd: finalPath,
      configPath: finalConfig,
      silent,
      model,
      provider,
      signal,
    });
  }

  const durationMs = Date.now() - start;
  // En mode Overmind (appel MCP), le run est déjà stocké par le MCP Server via memory_runs
  // Skip storeRun pour éviter le double-stockage ET les erreurs de connexion postgres
  if (!overmindMode) {
    try {
      await storeRun({
        runner: 'hermes',
        agentName,
        prompt,
        result: result.result,
        error: result.error,
        durationMs,
        success: !result.error,
        sessionId: result.sessionId,
      });
    } catch (e) {
      // En mode Overmind on skip, mais en mode normal on log seulement (ne fail pas l'agent)
      console.error(`[run_hermes] ⚠️ Memory store failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (result.error)
    return {
      content: [{ type: 'text' as const, text: `❌ Erreur Hermes: ${result.error}` }],
      isError: true,
    };
  return {
    content: [
      { type: 'text' as const, text: result.result },
      ...(result.sessionId
        ? [{ type: 'text' as const, text: `SESSION_ID: ${result.sessionId}` }]
        : []),
    ],
  };
}
