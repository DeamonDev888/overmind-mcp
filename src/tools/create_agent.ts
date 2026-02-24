import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

import { AgentManager } from '../services/AgentManager.js';
import { getAgentMcpGenerator } from '../services/AgentMcpGenerator.js';

export const createAgentSchema = z.object({
  name: z
    .string()
    .describe("Nom de l'agent (ex: agent_finance). Sera utilisé pour les noms de fichiers."),
  prompt: z.string().describe("Le prompt système (instructions) de l'agent."),
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwen', 'openclaw', 'cline', 'opencode', 'trae'])
    .optional()
    .default('claude')
    .describe('Type de runner pour cet agent (défaut: claude)'),
  model: z
    .string()
    .optional()
    .describe(
      'Modèle à utiliser. Supporte tous les modèles compatibles avec le runner choisi. Pour Claude: claude-sonnet-4-5, gpt-4, deepseek-chat, etc.',
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

  const result = await manager.createAgent(
    name,
    prompt,
    model || 'claude-sonnet-4-5',
    copyEnvFrom,
    projectRoot,
    runner,
    mode,
    cliPath,
  );

  // Générer le fichier MCP individuel pour l'agent
  if (!result.error) {
    try {
      const mcpGen = getAgentMcpGenerator();
      mcpGen.generateAgentMcp(name);
    } catch (err) {
      console.warn(`[createAgent] Impossible de générer le fichier MCP pour ${name}:`, err);
    }
  }

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
        text: `✅ Agent '${name}' créé avec succès pour ${runnerName} !\n\n📂 Fichiers créés :\n- Prompt : ${result.promptPath}\n- Config : ${result.settingsPath}\n\n🚀 Pour lancer cet agent avec le runner ${runner} :\n\`\`\`bash\n# Via l'outil MCP run_agent:\nrun_agent(runner: "${runner}", agentName: "${name}", prompt: "votre prompt")\n\`\`\`\n\n💡 **Runners disponibles:**\n- claude: Claude Code (défaut)\n- gemini: Gemini\n- kilo: Kilocode${mode ? ` (mode: ${mode})` : ''}\n- qwen: Qwen Code\n- openclaw: OpenClaw\n- cline: Cline${mode ? ` (mode: ${mode})` : ''}\n- opencode: OpenCode\n- trae: Trae`,
      },
    ],
  };
}
