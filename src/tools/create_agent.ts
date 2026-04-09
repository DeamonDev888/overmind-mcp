import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

import { AgentManager } from '../services/AgentManager.js';

export const createAgentSchema = z.object({
  name: z
    .string()
    .describe(
      "Nom unique de l'agent (ex: 'sniper_analyst'). Ce nom servira d'identifiant pour sa mémoire sémantique isolée.",
    ),
  prompt: z
    .string()
    .describe(
      "Le prompt système OBLIGATOIRE. Tu DOIS y définir le persona de l'agent, ses missions, les outils MCP qu'il est autorisé à utiliser, et lui ordonner de consulter/enrichir systématiquement sa mémoire Overmind.",
    ),
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwen', 'openclaw', 'cline', 'opencode', 'trae'])
    .optional()
    .default('claude')
    .describe('Type de runner pour cet agent (défaut: claude)'),
  model: z
    .string()
    .optional()
    .describe(
      "Surnom original ou Modèle technique (ex: 'The Chaos Prophet', 'claude-3-5-sonnet-20241022'). Le protocole 'Custom-Nickname' d'Overmind permet d'assigner n'importe quel nom ici pour personnaliser votre Cortex. Le runner se chargera automatiquement de mapper ce surnom vers un modèle valide pour l'API.",
    ),
  copyEnvFrom: z
    .string()
    .optional()
    .describe(
      "Chemin vers un settings.json existant pour copier les variables d'environnement (ex: .claude/settingsM.json)",
    ),
  // Options spécifiques à certains runners
  mode: z
    .enum(['code', 'architect', 'ask', 'debug', 'orchestrator', 'plan', 'act'])
    .optional()
    .describe(
      'Mode spécifique pour Kilo (code, architect, ask, debug, orchestrator) ou Cline (plan, act)',
    ),
  cliPath: z
    .string()
    .optional()
    .describe('Chemin vers l\'exécutable CLI (ex: "cline", "opencode", "./trae")'),
});

export async function createAgent(args: z.infer<typeof createAgentSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const manager = new AgentManager();
  const { name, prompt, runner, model, copyEnvFrom, mode, cliPath } = args;

  const currentFileUrl = import.meta.url;
  const currentFilePath = fileURLToPath(currentFileUrl);
  // src/tools/create_agent.ts -> src/tools -> src -> Workflow
  const projectRoot = path.resolve(path.dirname(currentFilePath), '../../');

  const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';

  const result = await manager.createAgent(
    name,
    prompt,
    model || defaultModel,
    copyEnvFrom,
    projectRoot,
    runner,
    mode,
    cliPath,
  );

  if (result.error === 'INVALID_NAME') {
    return {
      content: [
        {
          type: 'text',
          text: `❌ **Nom d'agent invalide**\n\nLe nom '${name}' contient des caractères interdits.\n\n💡 **Règle:** Utilisez uniquement des lettres, chiffres, tirets (-) et underscores (_).\n\nExemple valide: 'agent_finance', 'expert-seo'`,
        },
      ],
      isError: true,
    };
  }

  // Message de succès adapté selon le runner
  const runnerInfo = {
    claude: 'Claude Code',
    gemini: 'Gemini',
    kilo: 'Kilocode',
    qwen: 'Qwen Code',
    openclaw: 'OpenClaw',
    cline: 'Cline',
    opencode: 'OpenCode',
    trae: 'Trae',
  };

  const runnerName = runnerInfo[runner as keyof typeof runnerInfo] || 'Claude Code';

  return {
    content: [
      {
        type: 'text',
        text: `✅ Agent '${name}' créé avec succès pour ${runnerName} !\n\n📂 Fichiers créés :\n- Prompt : ${result.promptPath}\n- Config : ${result.settingsPath}\n\n🚀 Pour lancer cet agent avec le runner ${runner} :\n\`\`\`bash\n# Via l'outil MCP run_agent:\nrun_agent(runner: "${runner}", agentName: "${name}", prompt: "votre prompt")\n\`\`\`\n\n🔧 **Configuration requise :**\n1. Utilise \`config_example\` pour obtenir les exemples de configuration settings.json selon votre fournisseur (GLM/Z.AI, MiniMax, OpenRouter).\n2. Vérifie la config avec \`get_agent_configs(name: "${name}")\` pour voir les 4 fichiers (prompt.md, .mcp.json, settings.json, skill.md).\n3. ⚠️ **IMPORTANT** : Modifiez impérativement les variables d'environnement dans le fichier settings.json. Notez que le champ **Modèle** (ANTHROPIC_MODEL) sert désormais à définir le **Surnom original** de votre agent pour une immersion totale dans le Nexus.\n\n💡 **Runners disponibles:**\n- claude: Claude Code (défaut)\n- gemini: Gemini\n- kilo: Kilocode${mode ? ` (mode: ${mode})` : ''}\n- qwen: Qwen Code\n- openclaw: OpenClaw\n- cline: Cline${mode ? ` (mode: ${mode})` : ''}\n- opencode: OpenCode\n- trae: Trae`,
      },
    ],
  };
}
