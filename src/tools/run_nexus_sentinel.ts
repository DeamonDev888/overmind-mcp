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

export const runNexusSentinelSchema = z.object({
  customPrompt: z
    .string()
    .optional()
    .describe(
      'Prompt personnalisé (optionnel). Si non fourni, le prompt de mission standard du Sentinel est utilisé.',
    ),
});

export async function runNexusSentinelTool(args: z.infer<typeof runNexusSentinelSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const { customPrompt } = args;

  const prompt =
    customPrompt ||
    `[OVERRIDE DIRECTIVE - NEXUS SENTINEL v15.9]

Tu es le **NEXUS SENTINEL COMMANDER**. Tu es l'agent de contrôle tactique et de réconciliation du système Nexus Sentinel.

🎯 **MISSION TACTIQUE**:
1. **Agent Oversight** : Récupérer et analyser les derniers rapports des agents de surveillance (006, 010, 013).
2. **Critical Diagnosis** : Identifier les goulots d'étranglement ou régressions dans le pipeline.
3. **Infra Health** : Vérifier l'état opérationnel des services critiques (DB, Tunnels, Ingest).
4. **Action Plan** : Déterminer les ajustements prioritaires pour stabiliser le système.
5. **Dominance Digest** : Synthèse stratégique de l'état du Nexus.

🚨 **PROTOCOLE D'URGENCE**:
- Tu dois être froid, analytique et extrêmement rigoureux.
- Tu ne tolères pas l'ambiguïté dans les rapports. Tu demandes des précisions si les données sont insuffisantes.
- Tu as accès aux serveurs MCP: postgresql-server, discord-server, memory, overmind.

📋 **RAPPORT STRUCTURÉ OBLIGATOIRE**:
1. **Executive Summary** : Vue synthétique de l'état du système.
2. **Agent Oversight** : Analyse des rapports des agents 006, 010, 013.
3. **Critical Diagnosis** : Identification des problèmes.
4. **Infra Health** : État des services critiques.
5. **Action Plan** : Priorités d'intervention.
6. **Dominance Digest** : Recommandations stratégiques.

Tu DOIS systématiquement enrichir la mémoire Overmind avec tes découvertes et décisions via memory_store.

Agis maintenant.`;

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
          text: `❌ Erreur lors de l'exécution du Nexus Sentinel: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// ─── DIRECT EXECUTION (node run_nexus_sentinel.ts) ─────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const result = await runNexusSentinelTool({});
    console.log(JSON.stringify(result, null, 2));
  })().catch(console.error);
}
