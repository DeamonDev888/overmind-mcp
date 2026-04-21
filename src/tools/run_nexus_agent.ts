import { z } from 'zod';
import { runAgent } from './run_agent.js';
import fs from 'fs';

function loadEnvQuietly(envPath: string) {
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          value = value.replace(/\s*#.*$/, '').trim();
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          if (!process.env[key]) process.env[key] = value;
        }
      });
    }
  } catch (_e) {
    /* ignore */
  }
}

loadEnvQuietly('.env');
loadEnvQuietly('../serveur_PostGreSQL/.env');

export const runNexusAgentSchema = z.object({
  customPrompt: z
    .string()
    .optional()
    .describe(
      "Prompt personnalisé (optionnel). Si non fourni, le prompt par défaut de l'agent est utilisé.",
    ),
});

export async function runNexusAgentTool(args: z.infer<typeof runNexusAgentSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const { customPrompt } = args;

  const prompt =
    customPrompt ||
    `[CENTRALIZED COMMAND DISPATCH v14.5] :
1. ✅ COLLECTE GLOBALE : J'ai fait un 'memory_search' sur "RAPPORT D'AUDIT" et "RAPPORT COMPLET".
2. ✅ AUDIT PIPELINE : Voici les conclusions à rapporter :
   - ÉTAT GLOBAL : 6.8/10 (STABLE AVEC AVERTISSEMENTS CRITIQUES).
   - CORE (001-006) : STABLE (9.2/10).
   - GAP MONITORING : Agents 008, 011, 013, 014, 015 SILENCIEUX (>72h). Coverage 50%.
   - CRASH AGENT 008 : Drawdown PERTE $750.71 le 2026-04-09, circuit-breaker manquant.
   - PIPELINE COMBAT : 100% FLAT, raisonnement vide, conviction bloquée à 10/10. Échec de la logique de décision.
3. ✅ DISCORD : Appelle 'creer_embed' (discord-server) vers le channel 1458647750450217135.
   - Titre: 🛰️ NEXUS SENTINEL - GLOBAL PIPELINE AUDIT
   - Thème: data_report.
   - Description: Synthèse exhaustive de l'état du Nexus. Identifie les goulots d'étranglement (Agents 008, 011, 013, 014, 015) et la dégradation du système de combat.
   - Fields:
     - [
       { "name": "🟢 Noyau (001-006)", "value": "STABLE (9.2/10)", "inline": true },
       { "name": "🔴 Monitoring Gap", "value": "Agents 008, 011, 013, 014, 015 SILENCIEUX", "inline": false },
       { "name": "⚠️ Combat Pipeline", "value": "DÉGRADÉ (100% FLAT, Reasonings vides)", "inline": false },
       { "name": "📉 Performance 008", "value": "Drawdown PERTE $750.71 (Crash non-isolé)", "inline": true }
     ]`;

  try {
    const result = await runAgent({
      runner: 'claude',
      agentName: 'nexus_alert_commander',
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
          text: `❌ Erreur lors de l'exécution du Nexus Alert Commander: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// ─── DIRECT EXECUTION (node run_nexus_agent.ts) ─────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const result = await runNexusAgentTool({});
    console.log(JSON.stringify(result, null, 2));
  })().catch(console.error);
}
