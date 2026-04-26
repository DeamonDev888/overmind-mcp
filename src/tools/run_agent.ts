import { z } from 'zod';
import { runClaudeAgent } from './run_claude.js';
import { runGeminiAgent } from './run_gemini.js';
import { runKiloAgent } from './run_kilo.js';
import { runQwenCLIAgent } from './run_qwencli.js';
import { runOpenClawAgent } from './run_openclaw.js';
import { runClineAgent } from './run_cline.js';
import { runOpenCodeAgent } from './run_opencode.js';
import { runHermesAgent } from './run_hermes.js';

// Schema unified for all runners
export const runAgentSchema = z.object({
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
    .describe('Type de runner a utiliser'),
  prompt: z.string().describe("Le prompt a envoyer a l'agent"),
  sessionId: z.string().optional().describe('Session ID'),
  agentName: z.string().optional().describe("Nom de l'agent"),
  autoResume: z
    .boolean()
    .optional()
    .default(false)
    .describe('Auto resume session'),
  mode: z
    .enum(['code', 'architect', 'ask', 'debug', 'orchestrator', 'plan', 'act'])
    .optional()
    .describe('Mode specifique'),
  path: z
    .string()
    .optional()
    .describe("Working directory"),
  config: z
    .string()
    .optional()
    .describe("Config directory"),
  silent: z
    .boolean()
    .optional()
    .default(false)
    .describe('Silent mode'),
  model: z
    .string()
    .optional()
    .describe("Model name"),
}).passthrough();

import { verifyInstallation } from '../lib/InstallHelper.js';

export async function runAgent(args: z.infer<typeof runAgentSchema>) {
  const { runner, ...params } = args;

  const check = await verifyInstallation(runner);
  if (!check.ok) {
    return {
      content: [{ type: 'text' as const, text: check.message || `CLI non installe.` }],
      isError: true,
    };
  }

  switch (runner) {
    case 'claude':
      return runClaudeAgent(params as any);
    case 'gemini':
      return runGeminiAgent(params as any);
    case 'kilo':
      return runKiloAgent(params as any);
    case 'qwencli':
      return runQwenCLIAgent(params as any);
    case 'openclaw':
      return runOpenClawAgent(params as any);
    case 'cline':
      return runClineAgent(params as any);
    case 'opencode':
      return runOpenCodeAgent(params as any);
    case 'hermes':
      return runHermesAgent(params as any);
    default:
      return {
        content: [{ type: 'text' as const, text: `Runner inconnu: ${runner}` }],
        isError: true,
      };
  }
}
