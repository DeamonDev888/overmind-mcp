import { z } from 'zod';
import { KiloRunner } from '../services/KiloRunner.js';
import { storeRun } from '../memory/MemoryFactory.js';
import { getWorkspaceDir } from '../lib/config.js';

export const runKiloSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent Kilocode"),
  mode: z
    .enum(['code', 'architect', 'ask', 'debug', 'orchestrator'])
    .optional()
    .describe('Mode de Kilocode : code (défaut), architect, ask, debug, orchestrator'),
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
  path: z
    .string()
    .optional()
    .describe("Le répertoire de travail (CWD) où l'agent sera lancé"),
  config: z
    .string()
    .optional()
    .describe("Le répertoire racine de l'Overmind (contenant .claude/, .mcp.json, etc.)"),
});

export async function runKiloAgent(args: z.infer<typeof runKiloSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const runner = new KiloRunner();
  
  // 1. Vérification de l'installation et de la version (v7.2.14 requis)
  const verification = await runner.verifyInstallation();
  if (!verification.ok) {
    return {
      content: [
        {
          type: 'text',
          text: verification.message || 'Kilo non configuré.'
        }
      ],
      isError: true,
    };
  }

  const { prompt, agentName, autoResume, sessionId, mode, path: argPath, config: argConfig } = args;
  const finalPath = argPath || getWorkspaceDir();
  const finalConfig = argConfig || getWorkspaceDir();

  const start = Date.now();
  const result = await runner.runAgent({ 
    prompt, 
    agentName, 
    autoResume, 
    sessionId, 
    mode, 
    cwd: finalPath,
    configPath: finalConfig 
  });
  const durationMs = Date.now() - start;

  // Auto-instrumentation via Overmind Memory
  storeRun({
    runner: 'kilo',
    agentName,
    prompt,
    result: result.result,
    error: result.error,
    durationMs,
    success: !result.error,
    sessionId: result.sessionId,
  });

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

  if (result.error) {
    return {
      content: [{ 
        type: 'text', 
        text: `❌ Erreur lors de l'exécution Kilocode: ${result.error}${result.rawOutput ? `\n\n🔍 **Détails:**\n\`\`\`text\n${result.rawOutput}\n\`\`\`` : ''}` 
      }],
      isError: true,
    };
  }

  return {
    content: [
      { type: 'text', text: result.result },
      { type: 'text', text: `RUNNER: kilo` },
      { type: 'text', text: `SESSION_ID: ${result.sessionId || 'N/A'}` },
    ],
  };
}

