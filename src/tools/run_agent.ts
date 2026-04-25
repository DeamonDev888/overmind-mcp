import { z } from 'zod';
import { runClaudeAgent } from './run_claude.js';
import { runGeminiAgent } from './run_gemini.js';
import { runKiloAgent } from './run_kilo.js';
import { runQwenCLIAgent } from './run_qwencli.js';
import { runOpenClawAgent } from './run_openclaw.js';
import { runClineAgent } from './run_cline.js';
import { runOpenCodeAgent } from './run_opencode.js';
import { runHermesAgent } from './run_hermes.js';

// Schéma unifié pour tous les runners
export const runAgentSchema = z.object({
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
    .describe('Type de runner à utiliser'),
  prompt: z.string().describe("Le prompt à envoyer à l'agent"),
  sessionId: z
    .string()
    .optional()
    .describe('ID de session pour continuer une conversation (manuel)'),
  agentName: z
    .string()
    .optional()
    .describe("Nom de l'agent (pour logging/monitoring et persistance)"),
  autoResume: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'CORE: --output-format json, si true (et agentName fourni), reprend automatiquement la dernière conversation de cet agent',
    ),
  // Options spécifiques à certains runners
  mode: z
    .enum(['code', 'architect', 'ask', 'debug', 'orchestrator', 'plan', 'act'])
    .optional()
    .describe(
      'Mode spécifique pour Kilo (code, architect, ask, debug, orchestrator) ou Cline (plan, act)',
    ),
  path: z
    .string()
    .optional()
    .describe("Le répertoire de travail (CWD) où l'agent sera lancé (par défaut: dossier Overmind)"),
  config: z
    .string()
    .optional()
    .describe("Le répertoire racine de l'Overmind (contenant .claude/, .mcp.json, etc.) (par défaut: dossier Overmind)"),
  silent: z
    .boolean()
    .optional()
    .default(false)
    .describe('Désactive les logs de debug sur stderr'),
  model: z
    .string()
    .optional()
    .describe("Modèle spécifique à utiliser (ex: tencent/hy3-preview pour hermes)"),
});

import { verifyInstallation } from '../lib/InstallHelper.js';

/**
 * ORCHESTRATEUR CENTRAL
 * Redirige l'exécution vers le module spécifique approprié.
 */
export async function runAgent(args: z.infer<typeof runAgentSchema>) {
  const { runner, ...params } = args;

  // --- VÉRIFICATION DE L'INSTALLATION ---
  const check = await verifyInstallation(runner);
  if (!check.ok) {
    return {
      content: [{ type: 'text' as const, text: check.message || `CLI non installé.` }],
      isError: true,
    };
  }

  switch (runner) {
    case 'claude':
      return runClaudeAgent(params);
    case 'gemini':
      return runGeminiAgent(params);
    case 'kilo':
      return runKiloAgent(params);
    case 'qwencli':
      return runQwenCLIAgent(params);
    case 'openclaw':
      return runOpenClawAgent(params);
    case 'cline':
      return runClineAgent(params);
    case 'opencode':
      return runOpenCodeAgent(params);
    case 'hermes':
      return runHermesAgent(params);
    default:
      return {
        content: [{ type: 'text' as const, text: `❌ Runner inconnu: ${runner}` }],
        isError: true,
      };
  }
}
