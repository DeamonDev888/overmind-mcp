import { z } from 'zod';
import { runAgent } from './run_agent.js';
import fs from 'fs';
import path from 'path';
import { loadEnvQuietly } from '../lib/loadEnv.js';
import { AgentManager } from '../services/AgentManager.js';
import { getWorkspaceDir } from '../lib/config.js';

// Chargement silencieux des variables d'environnement
loadEnvQuietly('.env');
loadEnvQuietly('../serveur_PostGreSQL/.env');

// Prompt système de l'agent Nexus Sentinel Commander (utilisé lors de la création automatique)
const NEXUS_SENTINEL_SYSTEM_PROMPT = `[NEXUS SENTINEL ACTIVATION v15.9]:
Tu es le NEXUS SENTINEL COMMANDER. Ton rôle : contrôle tactique et réconciliation du système Nexus.

🎯 MISSION :
1. Agent Oversight : Récupère les derniers rapports des agents de surveillance (006, 010, 013).
2. Critical Diagnosis : Identifie les goulots d'étranglement ou régressions dans le pipeline.
3. Infra Health : Vérifie l'état opérationnel des services critiques (DB, Tunnels, Ingest).
4. Action Plan : Détermine les ajustements prioritaires pour stabiliser le système.
5. Dominance Digest : Produis une synthèse stratégique de l'état du Nexus.

📋 RAPPORT STRUCTURÉ OBLIGATOIRE :
Tu dois fournir un rapport complet avec les sections :
1. Executive Summary : Vue synthétique de l'état du système.
2. Agent Oversight : Analyse des rapports des agents 006, 010, 013.
3. Critical Diagnosis : Identification des problèmes.
4. Infra Health : État des services critiques.
5. Action Plan : Priorités d'intervention.
6. Dominance Digest : Recommandations stratégiques.

🔒 Protocoles OBLIGATOIRES :
- Avant toute analyse, appelle memory_search(query: "contexte projet nexus sentinel").
- Utilise memory_store pour toute décision importante ou pattern identifié.
- Sois froid, analytique et rigoureux. Ne tolère pas l'ambiguïté.

Agis maintenant.`;

export const runNexusSentinelSchema = z.object({
  customPrompt: z
    .string()
    .optional()
    .describe(
      'Prompt personnalisé (optionnel). Si non fourni, un message de déclenchement par défaut est utilisé.',
    ),
});

async function ensureSentinelAgentExists(): Promise<void> {
  const workspaceDir = getWorkspaceDir();
  const claudeDir = path.join(workspaceDir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings_nexus_sentinel_commander.json');

  if (fs.existsSync(settingsPath)) {
    return; // L'agent existe déjà
  }

  const manager = new AgentManager(claudeDir);
  const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const result = await manager.createAgent(
    'nexus_sentinel_commander',
    NEXUS_SENTINEL_SYSTEM_PROMPT,
    defaultModel,
    undefined,
    workspaceDir,
    'claude',
  );

  if (result.error) {
    console.error("[NexusSentinel] Échec de la création de l'agent:", result.error);
  } else {
    console.error(`[NexusSentinel] Agent créé: ${result.promptPath}, ${result.settingsPath}`);
  }
}

export async function runNexusSentinelTool(args: z.infer<typeof runNexusSentinelSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const { customPrompt } = args;

  // Assurer l'existence de l'agent sentinel
  await ensureSentinelAgentExists();

  // Prompt de déclenchement par défaut (utilisateur)
  const prompt =
    customPrompt ||
    '[NEXUS SENTINEL ACTIVATION]: Execute the full diagnostic protocol and generate the Dominance Digest.';

  try {
    const result = await runAgent({
      runner: 'claude',
      agentName: 'nexus_sentinel_commander',
      autoResume: false,
      prompt,
    });

    return {
      content: result.content,
      isError: result.isError,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ Erreur lors de l'exécution du Nexus Sentinel Commander: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// ─── DIRECT EXECUTION (node run_nexus_sentinel.ts) ─────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const result = await runNexusSentinelTool({});
    console.log(JSON.stringify(result, null, 2));
  })().catch(console.error);
}
