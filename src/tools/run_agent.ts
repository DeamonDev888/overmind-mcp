import { z } from 'zod';
import { runClaudeAgent } from './run_claude.js';
import { runGeminiAgent } from './run_gemini.js';
import { runKiloAgent } from './run_kilo.js';
import { runQwenCLIAgent } from './run_qwencli.js';
import { runOpenClawAgent } from './run_openclaw.js';
import { runClineAgent } from './run_cline.js';
import { runOpenCodeAgent } from './run_opencode.js';
import { runHermesAgent } from './run_hermes.js';
import { verifyInstallation } from '../lib/InstallHelper.js';
import { withSpan } from '../lib/telemetry.js';

// Schema unified for all runners
export const runAgentSchema = z
  .object({
    runner: z
      .enum(['claude', 'gemini', 'antigravity', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
      .describe('Type de runner a utiliser'),
    prompt: z.string().min(1, 'prompt vide interdit').describe("Le prompt a envoyer a l'agent"),
    sessionId: z.string().optional().describe('Session ID'),
    agentName: z
      .string()
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        'agentName ne doit contenir que des caractères alphanumériques, tirets ou underscores',
      )
      .optional()
      .describe("Nom de l'agent"),
    autoResume: z.boolean().optional().default(false).describe('Auto resume session'),
    mode: z.string().optional().describe('Mode specifique'),
    path: z.string().optional().describe('Working directory'),
    config: z.string().optional().describe('Config directory'),
    silent: z.boolean().optional().default(false).describe('Silent mode'),
    model: z
      .string()
      .optional()
      .describe(
        "Nom du modèle. Pour Hermes : priorité OpenAI ou NVIDIA. Pour Kilo (gratuits) : 'tencent/hy3-preview:free' ou 'step 3.5 flash'.",
      ),
  });

// AbortSignal n'est pas serialisable en JSON Schema (FastMCP rejette z.custom<>).
// On le passe en interne via un type augmente, hors schema MCP.
export type RunAgentInternalArgs = z.infer<typeof runAgentSchema> & { signal?: AbortSignal };

// Validation stricte des paramètres pour chaque runner (remplace les casts dangereux)
const validateAndExtractParams = <T extends Record<string, unknown>>(
  params: Record<string, unknown>,
  schema: z.ZodType<T>,
): T => {
  return schema.parse(params);
};

// Schémas de validation pour chaque runner (basés sur leurs signatures réelles)
const claudeParamsSchema = z.object({
  prompt: z.string(),
  sessionId: z.string().optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().default(false),
  model: z.string().optional(),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().default(false),
  signal: z.custom<AbortSignal>().optional(),
});

const kiloParamsSchema = z.object({
  prompt: z.string(),
  sessionId: z.string().optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().default(false),
  model: z.string().optional(),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().default(false),
  mode: z.enum(['code', 'architect', 'ask', 'debug', 'orchestrator']).optional(),
  signal: z.custom<AbortSignal>().optional(),
});

const clineParamsSchema = z.object({
  prompt: z.string(),
  sessionId: z.string().optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().default(false),
  model: z.string().optional(),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().default(false),
  mode: z.enum(['plan', 'act']).optional(),
  signal: z.custom<AbortSignal>().optional(),
});

const genericParamsSchema = z.object({
  prompt: z.string(),
  sessionId: z.string().optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().default(false),
  model: z.string().optional(),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().default(false),
  mode: z.string().optional(),
  signal: z.custom<AbortSignal>().optional(),
});

const antigravityParamsSchema = z.object({
  prompt: z.string(),
  sessionId: z.string().optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().default(false),
  model: z.string().optional(),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().default(false),
  mode: z.enum(['GENERAL', 'CONTEXT_CHECK', 'PLAN', 'COMMAND', 'CASCADE', 'EVAL', 'ANTIGRAVITY_REVIEW', 'MQUERY', 'COMMIT_MESSAGE', 'CHECKPOINT', 'FAST_APPLY']).default('GENERAL'),
  signal: z.custom<AbortSignal>().optional(),
});

const hermesParamsSchema = z.object({
  prompt: z.string(),
  sessionId: z.string().optional(),
  agentName: z.string().optional(),
  autoResume: z.boolean().default(false),
  model: z.string().optional(),
  path: z.string().optional(),
  config: z.string().optional(),
  silent: z.boolean().default(false),
  signal: z.custom<AbortSignal>().optional(),
});

// Validation manuelle des modes (déplacée ici pour compatibilité FastMCP)
const RUNNER_MODES: Record<string, readonly string[] | undefined> = {
  gemini: ['GENERAL', 'CONTEXT_CHECK', 'PLAN', 'COMMAND', 'CASCADE', 'EVAL', 'ANTIGRAVITY_REVIEW', 'MQUERY', 'COMMIT_MESSAGE', 'CHECKPOINT', 'FAST_APPLY'],
  kilo: ['code', 'architect', 'ask', 'debug', 'orchestrator'],
  cline: ['plan', 'act'],
} as const;

function validateMode(runner: string, mode?: string): void {
  const allowed = RUNNER_MODES[runner];
  if (mode && allowed && !allowed.includes(mode)) {
    throw new Error(
      `mode "${mode}" non supporté par runner "${runner}". Autorisés : ${allowed.join('|')}`,
    );
  }
  if (mode && !allowed) {
    throw new Error(`runner "${runner}" n'accepte pas de mode`);
  }
}

export async function runAgent(args: RunAgentInternalArgs) {
  const { runner, mode, ...params } = args;

  // Validation des modes
  validateMode(runner, mode);

  // Vérification de l'installation avec logging
  const check = await verifyInstallation(runner);
  if (!check.ok) {
    const errorMsg = check.message || `CLI non installée pour runner "${runner}"`;
    console.error(`[runAgent] Installation check failed for ${runner}:`, errorMsg);
    return {
      content: [{ type: 'text' as const, text: errorMsg }],
      isError: true,
    };
  }

  // Exécution avec telemetry
  return withSpan('runAgent.execute', async () => {
    switch (runner) {
      case 'claude':
        return runClaudeAgent(validateAndExtractParams(params, claudeParamsSchema));
case 'gemini':
        return runGeminiAgent(validateAndExtractParams(params, antigravityParamsSchema));
      case 'kilo':
        return runKiloAgent(validateAndExtractParams(params, kiloParamsSchema));
      case 'qwencli':
        return runQwenCLIAgent(validateAndExtractParams(params, genericParamsSchema));
      case 'openclaw':
        return runOpenClawAgent(validateAndExtractParams(params, genericParamsSchema));
      case 'cline':
        return runClineAgent(validateAndExtractParams(params, clineParamsSchema));
      case 'opencode':
        return runOpenCodeAgent(validateAndExtractParams(params, genericParamsSchema));
      case 'hermes':
        return runHermesAgent(validateAndExtractParams(params, hermesParamsSchema));
      default: {
        // Ce cas est théoriquement impossible grâce à la validation Zod de l'enum
        const error = `Runner inconnu: ${runner}`;
        console.error(`[runAgent] ${error}`);
        throw new Error(error);
      }
    }
  }, { runner, agentName: params.agentName || '', mode: mode || '' });
}
