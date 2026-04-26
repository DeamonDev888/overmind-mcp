import { z } from 'zod';
import { ClaudeRunner } from '../services/ClaudeRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';
import { deleteSessionId } from '../lib/sessions.js';

export const runClaudeSchema = z.object({
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
  path: z.string().optional().describe("Répertoire de travail"),
  config: z.string().optional().describe("Répertoire racine Overmind"),
  silent: z.boolean().optional().default(false).describe("Mode silencieux"),
}).passthrough();

export async function runClaudeAgent(args: z.infer<typeof runClaudeSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  sessionId?: string;
}> {
  const runner = new ClaudeRunner();
  const { prompt, agentName, autoResume, sessionId, path: argPath, config: argConfig, silent } = args;

  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();
  
  // Tentative initiale
  let result = await runner.runAgent({ 
    prompt, 
    agentName, 
    autoResume, 
    sessionId,
    cwd: finalPath,
    configPath: finalConfig,
    silent
  });

  // [RETRY LOGIC] - Moved from run_agent.ts to here
  if (result.error?.includes('No conversation found') ||
      result.error?.includes('session') ||
      result.error?.includes('EXIT_CODE_1') ||
      result.error === 'JSON_PARSE_ERROR') {
    
    if (!silent) {
      console.warn(`[run_claude] Session invalide ou erreur JSON, création nouvelle session...`);
    }
    
    // Supprimer la session corrompue si agentName est présent
    if (agentName) {
      await deleteSessionId(agentName, finalConfig);
    }

    result = await runner.runAgent({
      prompt,
      agentName,
      autoResume: false,
      sessionId: undefined,
      cwd: finalPath,
      configPath: finalConfig,
      silent,
    });
  }

  const durationMs = Date.now() - start;

  // Auto-instrument: record every run in OverMind memory
  try {
    storeRun({
      runner: 'claude',
      agentName,
      prompt,
      result: result.result,
      error: result.error,
      durationMs,
      success: !result.error,
      sessionId: result.sessionId,
    });
  } catch {
    /* silent */
  }

  if (result.error === 'INVALID_AGENT') {
    return {
      content: [{ type: 'text' as const, text: `❌ Agent '${agentName}' introuvable.` }],
      isError: true,
    };
  }

  if (result.error) {
    return { content: [{ type: 'text' as const, text: `❌ Erreur Claude: ${result.error}` }], isError: true };
  }

  return {
    content: [
      { type: 'text' as const, text: result.result },
      ...(result.sessionId ? [{ type: 'text' as const, text: `SESSION_ID: ${result.sessionId}` }] : []),
    ],
  };
}
