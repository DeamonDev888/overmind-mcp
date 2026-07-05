import { z } from 'zod';
import path from 'path';
import { AgentManager } from '../services/AgentManager.js';

// --- Schemas ---

export const listAgentsSchema = z.object({
  details: z
    .boolean()
    .optional()
    .default(false)
    .describe('Si true, affiche les détails complets (modèle, config) de chaque agent.'),
});

export const deleteAgentSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Agent name must only contain alphanumeric, underscores, and hyphens',
    )
    .describe("Nom de l'agent à supprimer (ex: agent_finance)"),
});

export const updateAgentConfigSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Agent name must only contain alphanumeric, underscores, and hyphens',
    )
    .describe("Nom de l'agent à modifier"),
  model: z
    .string()
    .optional()
    .describe(
      'Modèle à utiliser (ex: z.ai/glm-4.7, MiniMax-Text-01, deepseek-reasoner, moonshot-v1-32k)',
    ),
  mcpServers: z
    .array(z.string())
    .optional()
    .describe(
      "Liste complète des serveurs MCP à activer (remplace la liste existante). Ex: ['overmind']",
    ),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Variables d'environnement supplémentaires à définir ou écraser (ex: { 'API_KEY': '123' })",
    ),
  runner: z
    .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
    .optional()
    .describe('Type de runner pour cet agent'),
  mode: z
    .enum(['code', 'architect', 'ask', 'debug', 'orchestrator', 'plan', 'act'])
    .optional()
    .describe('Mode spécifique pour Kilo ou Cline'),
  cliPath: z
    .string()
    .refine(
      (val) => !val.includes('..') && (path.isAbsolute(val) || /^[a-zA-Z0-9_-]+$/.test(val)),
      'cliPath must be a simple command name or absolute path',
    )
    .optional()
    .describe("Chemin vers l'exécutable CLI (pour runners spécifiques)"),
  file: z
    .enum(['prompt.md', 'settings.json', '.mcp.json', 'skill.md'])
    .optional()
    .describe('Fichier spécifique à réécrire ENTIÈREMENT'),
  content: z
    .string()
    .optional()
    .describe('Nouveau contenu complet du fichier (si "file" est spécifié)'),
});

// --- Tools ---

export async function listAgents(args: z.infer<typeof listAgentsSchema>) {
  const manager = new AgentManager();
  try {
    const agentsList = await manager.listAgents(args.details);

    if (agentsList.length === 0) {
      return {
        content: [{ type: 'text' as const, text: '📂 Aucun agent trouvé.' }],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `📋 **Liste des Agents Disponibles (${agentsList.length})** :\n\n${agentsList.join('\n\n')}`,
        },
      ],
    };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur lors du listing des agents : ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
}

export async function deleteAgent(args: z.infer<typeof deleteAgentSchema>) {
  const manager = new AgentManager();
  const { name } = args;

  const result = await manager.deleteAgent(name);

  if (result.deletedFiles.length === 0 && result.errors.length === 0) {
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: `⚠️ Agent '${name}' introuvable (ni prompt, ni settings).` },
      ],
    };
  }

  let response = `🗑️ **Suppression de l'agent '${name}'**\n`;
  if (result.deletedFiles.length > 0) {
    response += `\n✅ Fichiers supprimés :\n${result.deletedFiles.map((f: string) => `- ${path.basename(f)}`).join('\n')}`;
  }
  if (result.errors.length > 0) {
    response += `\n\n❌ Erreurs :\n${result.errors.join('\n')}`;
  }

  return {
    content: [{ type: 'text' as const, text: response }],
  };
}

export async function updateAgentConfig(args: z.infer<typeof updateAgentConfigSchema>) {
  const manager = new AgentManager();
  const { name, model, mcpServers, env, runner, mode, cliPath, file, content } = args;

  // (a) Avertissement explicite quand 'runner' est omis alors qu'une mise à jour unitaire
  // est demandée : sans runner explicite, run_agent ne peut pas dispatcher de façon fiable.
  const isUnitUpdate = !!(model || mcpServers || env || mode || cliPath);
  const isFileRewrite = !!(file && content);
  if (isUnitUpdate && !isFileRewrite && !runner) {
    const detected = await manager.peekRunner(name); // (b) lecture du runner déjà en place
    const detectedTxt = detected
      ? `**${detected}**`
      : '**non défini** (sera initialisé à `claude`)';
    return {
      content: [
        {
          type: 'text' as const,
          text:
            `⚠️ **Runner non spécifié** pour l'agent '${name}'.\n\n` +
            `Le paramètre \`runner\` est omis : \`update_agent_config\` ne le modifiera pas, et ` +
            `la valeur existante dans \`settings_${name}.json\` restera en place.\n\n` +
            `🔎 Runner actuellement détecté : ${detectedTxt}\n\n` +
            `💡 **Recommandation** : passer explicitement \`runner\` à l'appel pour éviter tout ` +
            `dispatch ambigu vers run_agent. Valeurs valides : ` +
            `claude | gemini | kilo | qwencli | openclaw | cline | opencode | hermes.\n\n` +
            `➡️ Relance avec : \`update_agent_config(name: "${name}", runner: "le_bon_runner", ...)\``,
        },
      ],
    };
  }

  try {
    const changes = await manager.updateAgentConfig(name, {
      model,
      mcpServers,
      env,
      runner: runner as Parameters<typeof manager.updateAgentConfig>[1]['runner'],
      mode: mode as Parameters<typeof manager.updateAgentConfig>[1]['mode'],
      cliPath,
      file,
      content,
    });

    // (b) Validation runtime : on confirme le runner effectif après update
    const effectiveRunner = await manager.peekRunner(name);
    const runnerNotice = effectiveRunner
      ? `\n\n🏃 Runner effectif : **${effectiveRunner}**`
      : `\n\n⚠️ Aucun runner détectable — un futur run_agent risque d'échouer.`;

    if (changes.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `⚠️ Aucune modification demandée pour l'agent '${name}'.${runnerNotice}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `✅ Configuration de l'agent '${name}' mise à jour :\n${changes.join('\n')}${runnerNotice}`,
        },
      ],
    };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `❌ **Agent Introuvable**\n\nImpossible de modifier la configuration pour '${name}' car le fichier settings est introuvable.\n\n💡 **Solution:** Vérifiez le nom de l'agent avec \`list_agents\`.`,
          },
        ],
      };
    }
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur lors de la mise à jour de '${name}': ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
}
