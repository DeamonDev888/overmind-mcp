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
  prompt: z.string().min(1, 'prompt vide interdit').describe("Le prompt a envoyer a l'agent"),
  sessionId: z.string().optional().describe('Session ID'),
  agentName: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, "agentName ne doit contenir que des caractères alphanumériques, tirets ou underscores")
    .optional()
    .describe("Nom de l'agent"),
  autoResume: z
    .boolean()
    .optional()
    .default(false)
    .describe('Auto resume session'),
  mode: z
    .string()
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
    .describe("Nom du modèle. Pour Hermes : priorité OpenAI ou NVIDIA. Pour Kilo (gratuits) : 'tencent/hy3-preview:free' ou 'step 3.5 flash'."),
}).passthrough().superRefine((v, ctx) => {
  const RUNNER_MODES: Record<string, readonly string[] | undefined> = {
    kilo:    ['code', 'architect', 'ask', 'debug', 'orchestrator'],
    cline:   ['plan', 'act'],
    claude:  undefined,
    gemini:  undefined,
    qwencli: undefined,
    openclaw: undefined,
    opencode: undefined,
    hermes:  undefined,
  };
  const allowed = RUNNER_MODES[v.runner];
  if (v.mode && allowed && !allowed.includes(v.mode)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mode'],
      message: `mode "${v.mode}" non supporté par runner "${v.runner}". Autorisés : ${allowed.join('|')}`,
    });
  }
  if (v.mode && !allowed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mode'],
      message: `runner "${v.runner}" n'accepte pas de mode`,
    });
  }
});

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
      return runClaudeAgent(params as Parameters<typeof runClaudeAgent>[0]);
    case 'gemini':
      return runGeminiAgent(params as Parameters<typeof runGeminiAgent>[0]);
    case 'kilo':
      return runKiloAgent(params as Parameters<typeof runKiloAgent>[0]);
    case 'qwencli':
      return runQwenCLIAgent(params as Parameters<typeof runQwenCLIAgent>[0]);
    case 'openclaw':
      return runOpenClawAgent(params as Parameters<typeof runOpenClawAgent>[0]);
    case 'cline':
      return runClineAgent(params as Parameters<typeof runClineAgent>[0]);
    case 'opencode':
      return runOpenCodeAgent(params as Parameters<typeof runOpenCodeAgent>[0]);
    case 'hermes':
      return runHermesAgent(params as Parameters<typeof runHermesAgent>[0]);
    default:
      return {
        content: [{ type: 'text' as const, text: `Runner inconnu: ${runner}` }],
        isError: true,
      };
  }
}
