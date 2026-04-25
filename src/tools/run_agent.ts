import { z } from 'zod';
import { ClaudeRunner } from '../services/ClaudeRunner.js';
import { GeminiRunner } from '../services/GeminiRunner.js';
import { KiloRunner } from '../services/KiloRunner.js';
import { QwenRunner } from '../services/QwenRunner.js';
import { OpenClawRunner } from '../services/OpenClawRunner.js';
import { ClineRunner } from '../services/ClineRunner.js';
import { OpenCodeRunner } from '../services/OpenCodeRunner.js';
import { TraeRunner } from '../services/TraeRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';

// Schéma unifié pour tous les runners
export const runAgentSchema = z.object({
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwen', 'openclaw', 'cline', 'opencode', 'trae'])
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
});

export async function runAgent(args: z.infer<typeof runAgentSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  sessionId?: string;
}> {
  const { runner, prompt, agentName, autoResume = false, sessionId, mode, path: argPath, config: argConfig } = args;

  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();

  // Sélection du runner approprié
  let result: {
    result?: string;
    error?: string;
    sessionId?: string;
    rawOutput?: string;
  };

  try {
    switch (runner) {
      case 'claude': {
        const claudeRunner = new ClaudeRunner();

        // Première tentative avec le sessionId fourni
        result = await claudeRunner.runAgent({
          prompt,
          agentName,
          autoResume,
          sessionId,
          cwd: finalPath,
          configPath: finalConfig,
        });

        // [FIX] Si sessionId invalide, retenter sans sessionId (nouvelle session)
        if (result.error?.includes('No conversation found') ||
            result.error?.includes('session') ||
            result.error?.includes('EXIT_CODE_1')) {
          console.warn(`[run_agent] Session invalide détectée, création nouvelle session...`);
          result = await claudeRunner.runAgent({
            prompt,
            agentName,
            autoResume: false, // Force nouvelle session
            sessionId: undefined, // Pas de sessionId pour nouvelle session
            cwd: finalPath,
            configPath: finalConfig,
          });
        }
        break;
      }

      case 'gemini': {
        const geminiRunner = new GeminiRunner();
        result = await geminiRunner.runAgent({
          prompt,
          agentName,
          autoResume,
          sessionId,
          cwd: finalPath,
          configPath: finalConfig,
        });

        // Retry si session invalide
        if (result.error?.includes('No conversation found') ||
            result.error?.includes('session') ||
            result.error?.includes('EXIT_CODE_1')) {
          console.warn(`[run_agent] Session Gemini invalide, création nouvelle session...`);
          result = await geminiRunner.runAgent({
            prompt,
            agentName,
            autoResume: false,
            sessionId: undefined,
            cwd: finalPath,
            configPath: finalConfig,
          });
        }
        break;
      }

      case 'kilo': {
        const kiloRunner = new KiloRunner();
        const verification = await kiloRunner.verifyInstallation();
        if (!verification.ok) {
          return {
            content: [{ type: 'text', text: verification.message || 'Kilo non configuré.' }],
            isError: true
          };
        }
        result = await kiloRunner.runAgent({
          prompt,
          agentName,
          autoResume,
          sessionId,
          mode: mode as 'code' | 'architect' | 'ask' | 'debug' | 'orchestrator' | undefined,
          cwd: finalPath,
          configPath: finalConfig,
        });

        // Retry si session invalide
        if (result.error?.includes('No conversation found') ||
            result.error?.includes('session') ||
            result.error?.includes('EXIT_CODE_1')) {
          console.warn(`[run_agent] Session Kilo invalide, création nouvelle session...`);
          result = await kiloRunner.runAgent({
            prompt,
            agentName,
            autoResume: false,
            sessionId: undefined,
            mode: mode as 'code' | 'architect' | 'ask' | 'debug' | 'orchestrator' | undefined,
            cwd: finalPath,
            configPath: finalConfig,
          });
        }
        break;
      }

      case 'qwen': {
        const qwenRunner = new QwenRunner();
        result = await qwenRunner.runAgent({
          prompt,
          agentName,
          autoResume,
          sessionId,
          cwd: finalPath,
          configPath: finalConfig,
        });

        // Retry si session invalide
        if (result.error?.includes('No conversation found') ||
            result.error?.includes('session') ||
            result.error?.includes('EXIT_CODE_1')) {
          console.warn(`[run_agent] Session Qwen invalide, création nouvelle session...`);
          result = await qwenRunner.runAgent({
            prompt,
            agentName,
            autoResume: false,
            sessionId: undefined,
            cwd: finalPath,
            configPath: finalConfig,
          });
        }
        break;
      }

      case 'openclaw': {
        const openClawRunner = new OpenClawRunner();
        result = await openClawRunner.runAgent({
          prompt,
          agentName,
          autoResume,
          sessionId,
          cwd: finalPath,
          configPath: finalConfig,
        });

        // Retry si session invalide
        if (result.error?.includes('No conversation found') ||
            result.error?.includes('session') ||
            result.error?.includes('EXIT_CODE_1')) {
          console.warn(`[run_agent] Session OpenClaw invalide, création nouvelle session...`);
          result = await openClawRunner.runAgent({
            prompt,
            agentName,
            autoResume: false,
            sessionId: undefined,
            cwd: finalPath,
            configPath: finalConfig,
          });
        }
        break;
      }

      case 'cline': {
        const clineRunner = new ClineRunner();
        result = await clineRunner.runAgent({
          prompt,
          agentName,
          autoResume,
          sessionId,
          mode: mode as 'plan' | 'act' | undefined,
          cwd: finalPath,
          configPath: finalConfig,
        });

        // Retry si session invalide
        if (result.error?.includes('No conversation found') ||
            result.error?.includes('session') ||
            result.error?.includes('EXIT_CODE_1')) {
          console.warn(`[run_agent] Session Cline invalide, création nouvelle session...`);
          result = await clineRunner.runAgent({
            prompt,
            agentName,
            autoResume: false,
            sessionId: undefined,
            mode: mode as 'plan' | 'act' | undefined,
            cwd: finalPath,
            configPath: finalConfig,
          });
        }
        break;
      }

      case 'opencode': {
        const openCodeRunner = new OpenCodeRunner();
        result = await openCodeRunner.runAgent({
          prompt,
          agentName,
          autoResume,
          sessionId,
          cwd: finalPath,
          configPath: finalConfig,
        });

        // Retry si session invalide
        if (result.error?.includes('No conversation found') ||
            result.error?.includes('session') ||
            result.error?.includes('EXIT_CODE_1')) {
          console.warn(`[run_agent] Session OpenCode invalide, création nouvelle session...`);
          result = await openCodeRunner.runAgent({
            prompt,
            agentName,
            autoResume: false,
            sessionId: undefined,
            cwd: finalPath,
            configPath: finalConfig,
          });
        }
        break;
      }

      case 'trae': {
        const traeRunner = new TraeRunner();
        result = await traeRunner.runAgent({
          prompt,
          agentName,
          autoResume,
          sessionId,
          cwd: finalPath,
          configPath: finalConfig,
        });

        // Retry si session invalide
        if (result.error?.includes('No conversation found') ||
            result.error?.includes('session') ||
            result.error?.includes('EXIT_CODE_1')) {
          console.warn(`[run_agent] Session Trae invalide, création nouvelle session...`);
          result = await traeRunner.runAgent({
            prompt,
            agentName,
            autoResume: false,
            sessionId: undefined,
            cwd: finalPath,
            configPath: finalConfig,
          });
        }
        break;
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `❌ Runner inconnu: ${runner}\n\nRunners disponibles: claude, gemini, kilo, qwen, openclaw, cline, opencode, trae`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ Erreur lors de l'exécution du runner ${runner}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }

  const durationMs = Date.now() - start;

  // Auto-instrument: enregistrer chaque run dans la mémoire OverMind
  Promise.resolve(
    storeRun({
      runner,
      agentName,
      prompt,
      result: result.result,
      error: result.error,
      durationMs,
      success: !result.error,
      sessionId: result.sessionId,
    }),
  ).catch(() => {
    /* silent — la mémoire ne doit jamais bloquer le runner */
  });

  // Gestion des erreurs spécifiques
  if (result.error === 'INVALID_AGENT') {
    return {
      content: [
        {
          type: 'text',
          text: `❌ **Erreur Configuration Agent**\n\nL'agent '${agentName}' est introuvable ou mal configuré.\n\n💡 **Solution:**\nUtilisez l'outil \`create_agent\` pour créer cet agent avant de l'exécuter.`,
        },
      ],
      isError: true,
    };
  }

  if (result.error === 'JSON_PARSE_ERROR') {
    const preview = result.rawOutput?.trim().substring(0, 500);
    return {
      content: [
        {
          type: 'text',
          text: `⚠️ **Réponse Agent Non-Conforme (JSON invalide)**\n\nL'agent '${agentName || 'default'}' a répondu, mais le format JSON est cassé.\n\n🔍 **Début de la réponse reçue:**\n\`\`\`text\n${preview}...\n\`\`\`\n\n💡 **Conseil:** Vérifiez que le prompt demande explicitement une sortie JSON pure.`,
        },
      ],
      isError: true,
    };
  }

  if (result.error) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ Erreur lors de l'exécution du runner ${runner}: ${result.error}${result.rawOutput ? `\n\n🔍 **Détails:**\n\`\`\`text\n${result.rawOutput}\n\`\`\`` : ''}`,
        },
      ],
      isError: true,
    };
  }

  // Formater la réponse de manière propre et structurée
  const responseText = result.result || '';

  return {
    content: [
      { type: 'text', text: responseText },
    ],
    sessionId: result.sessionId,
  };
}
