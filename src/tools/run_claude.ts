import { z } from 'zod';
import { ClaudeRunner } from '../services/ClaudeRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';
import { deleteSessionId } from '../lib/sessions.js';
import { classifyError } from '../lib/errorClassifier.js';

export const runClaudeSchema = z
  .object({
    prompt: z.string().describe("Le prompt à envoyer à l'agent Claude"),
    sessionId: z.string().optional(),
    agentName: z
      .string()
      .optional()
      .describe("Nom de l'agent (pour logging/monitoring et persistance)"),
    autoResume: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Si true (et agentName fourni), reprend automatiquement la dernière conversation de cet agent',
      ),
    model: z.string().optional().describe('Modèle à utiliser (override env.ANTHROPIC_MODEL)'),
    path: z.string().optional().describe('Répertoire de travail'),
    config: z.string().optional().describe('Répertoire racine Overmind'),
    silent: z.boolean().optional().default(false).describe('Mode silencieux'),
  })
  .passthrough();

export async function runClaudeAgent(args: z.infer<typeof runClaudeSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const runner = new ClaudeRunner();
  const {
    prompt,
    agentName,
    autoResume,
    sessionId,
    model,
    path: argPath,
    config: argConfig,
    silent,
  } = args;

  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();

  let result = await runner.runAgent({
    prompt,
    agentName,
    autoResume,
    sessionId,
    model,
    cwd: finalPath,
    configPath: finalConfig,
    silent,
  });

  if (result.error) {
    const classified = classifyError(result.error, null);
    // Auto-retry for retryable session errors
    if (classified.code === 'SESSION_ERROR' || classified.code === 'RATE_LIMIT') {
      if (!silent) {
        console.warn(`[run_claude] Erreur récurrent: ${classified.code}, création nouvelle session...`);
      }
      if (agentName) await deleteSessionId(agentName, finalConfig, 'claude');
      result = await runner.runAgent({
        prompt,
        agentName,
        autoResume: false,
        sessionId: undefined,
        model,
        cwd: finalPath,
        configPath: finalConfig,
        silent,
      });
    }
  }

  const durationMs = Date.now() - start;

  // Auto-instrument: record every run in OverMind memory
  try {
    await storeRun({
      runner: 'claude',
      agentName,
      prompt,
      result: result.result,
      error: result.error,
      durationMs,
      success: !result.error,
      sessionId: result.sessionId,
    });
  } catch (_e) {
    // Memory store is secondary, don't crash if it fails
  }

  if (result.error?.includes('INVALID_AGENT') || result.error?.includes('❌ **[INVALID_AGENT]**')) {
    return {
      content: [{ type: 'text' as const, text: `❌ Agent '${agentName}' introuvable.` }],
      isError: true,
    };
  }

  if (result.error)
    return {
      content: [{ type: 'text' as const, text: `❌ Erreur Claude: ${result.error}` }],
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
