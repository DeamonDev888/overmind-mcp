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
    .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
    .optional()
    .default('claude')
    .describe('Type de runner pour cet agent (défaut: claude)'),
  model: z
    .string()
    .optional()
    .describe(
      "Surnom original ou Modèle technique (ex: 'The Chaos Prophet', 'claude-sonnet-4-6'). Le protocole 'Custom-Nickname' d'Overmind permet d'assigner n'importe quel nom ici pour personnaliser votre Cortex. Le runner se chargera automatiquement de mapper ce surnom vers un modèle valide pour l'API.",
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
    .describe('Chemin vers l\'exécutable CLI (ex: "cline", "opencode")'),
});

export async function createAgent(args: z.infer<typeof createAgentSchema>) {
  const manager = new AgentManager();
  const { name, prompt, runner, model, copyEnvFrom, mode, cliPath } = args;

  const currentFileUrl = import.meta.url;
  const currentFilePath = fileURLToPath(currentFileUrl);
  const projectRoot = path.resolve(path.dirname(currentFilePath), '../../');

  const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

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
          type: 'text' as const,
          text: `❌ **Nom d'agent invalide**\n\nLe nom '${name}' contient des caractères interdits.`,
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
    qwencli: 'Qwen CLI',
    openclaw: 'OpenClaw',
    cline: 'Cline',
    opencode: 'OpenCode',
    hermes: 'Nous Hermes',
  };

  const runnerName = runnerInfo[runner as keyof typeof runnerInfo] || 'Claude Code';

  return {
    content: [
      {
        type: 'text' as const,
        text: `✅ Agent '${name}' créé avec succès pour ${runnerName} !\n\n📂 Fichiers créés :\n- Prompt : ${result.promptPath}\n- Config : ${result.settingsPath}\n\n🚀 Pour lancer cet agent avec le runner ${runner} :\n\`\`\`bash\n# Via l'outil MCP run_agent:\nrun_agent(runner: "${runner}", agentName: "${name}", prompt: "votre prompt")\n\`\`\`\n\n💡 **Runners disponibles:**\n- claude: Claude Code (défaut)\n- gemini: Gemini\n- kilo: Kilocode${mode ? ` (mode: ${mode})` : ''}\n- qwencli: Qwen CLI\n- openclaw: OpenClaw\n- cline: Cline${mode ? ` (mode: ${mode})` : ''}\n- opencode: OpenCode\n- hermes: Nous Hermes`,
      },
    ],
  };
}
