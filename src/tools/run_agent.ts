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
      'Si true (et agentName fourni), reprend automatiquement la dernière conversation de cet agent',
    ),
  // Options spécifiques à certains runners
  mode: z
    .enum(['code', 'architect', 'ask', 'debug', 'orchestrator', 'plan', 'act'])
    .optional()
    .describe(
      'Mode spécifique pour Kilo (code, architect, ask, debug, orchestrator) ou Cline (plan, act)',
    ),
});

export async function runAgent(args: z.infer<typeof runAgentSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const { runner, prompt, agentName, autoResume, sessionId, mode } = args;
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
        result = await claudeRunner.runAgent({ prompt, agentName, autoResume, sessionId });
        break;
      }

      case 'gemini': {
        const geminiRunner = new GeminiRunner();
        result = await geminiRunner.runAgent({ prompt, agentName, autoResume, sessionId });
        break;
      }

      case 'kilo': {
        const kiloRunner = new KiloRunner();
        result = await kiloRunner.runAgent({
          prompt,
          agentName,
          autoResume,
          sessionId,
          mode: mode as 'code' | 'architect' | 'ask' | 'debug' | 'orchestrator' | undefined,
        });
        break;
      }

      case 'qwen': {
        const qwenRunner = new QwenRunner();
        result = await qwenRunner.runAgent({ prompt, agentName, autoResume, sessionId });
        break;
      }

      case 'openclaw': {
        const openClawRunner = new OpenClawRunner();
        result = await openClawRunner.runAgent({ prompt, agentName, autoResume, sessionId });
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
        });
        break;
      }

      case 'opencode': {
        const openCodeRunner = new OpenCodeRunner();
        result = await openCodeRunner.runAgent({ prompt, agentName, autoResume, sessionId });
        break;
      }

      case 'trae': {
        const traeRunner = new TraeRunner();
        result = await traeRunner.runAgent({ prompt, agentName, autoResume, sessionId });
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
  try {
    storeRun({
      runner,
      agentName,
      prompt,
      result: result.result,
      error: result.error,
      durationMs,
      success: !result.error,
      sessionId: result.sessionId,
    });
  } catch {
    /* silent — la mémoire ne doit jamais bloquer le runner */
  }

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
    const debugInfo = result.rawOutput
      ? `\n\n🔍 **Détails Erreur (Raw Output):**\n\`\`\`text\n${result.rawOutput.trim()}\n\`\`\``
      : '';
    return {
      content: [
        {
          type: 'text',
          text: `❌ Erreur lors de l'exécution du runner ${runner}: ${result.error}${debugInfo}`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      { type: 'text', text: result.result || '' },
      { type: 'text', text: `RUNNER: ${runner}` },
      { type: 'text', text: `SESSION_ID: ${result.sessionId}` },
    ],
  };
}
