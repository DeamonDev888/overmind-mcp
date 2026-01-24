import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG, resolveConfigPath } from '../lib/config.js';

export const createAgentSchema = z.object({
    name: z.string().describe("Nom de l'agent (ex: agent_finance). Sera utilisé pour les noms de fichiers."),
    prompt: z.string().describe("Le prompt système (instructions) de l'agent."),
    model: z.string().optional().default("claude-sonnet-4-5").describe("Modèle à utiliser. Supporte tous les modèles compatibles avec Claude Code (Anthropic, OpenAI, DeepSeek, Glm, Minimax, etc.). Ex: claude-sonnet-4-5, gpt-4, deepseek-chat"),
    copyEnvFrom: z.string().optional().describe("Chemin vers un settings.json existant pour copier les variables d'environnement (ex: .claude/settingsM.json)")
});

export async function createAgent(args: z.infer<typeof createAgentSchema>): Promise<any> {
    const { name, prompt, model, copyEnvFrom } = args;

    // Helper (Inline for simplicity)
    const getAvailableMcpServers = async () => {
        try {
            const mcpPath = resolveConfigPath(CONFIG.CLAUDE.PATHS.MCP);
            const content = await fs.readFile(mcpPath, 'utf-8');
            const json = JSON.parse(content);
            return Object.keys(json.mcpServers || {});
        } catch (e) { return []; }
    };

    // Validation du nom (sécurité système de fichiers)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return {
            content: [{ type: 'text', text: `❌ **Nom d'agent invalide**\n\nLe nom '${name}' contient des caractères interdits.\n\n💡 **Règle:** Utilisez uniquement des lettres, chiffres, tirets (-) et underscores (_).\n\nExemple valide: 'agent_finance', 'expert-seo'` }],
            isError: true
        };
    }

    // Résolution des chemins
    const currentFileUrl = import.meta.url;
    const currentFilePath = fileURLToPath(currentFileUrl);
    // src/tools/create_agent.ts -> src/tools -> src -> Workflow
    const projectRoot = path.resolve(path.dirname(currentFilePath), '../../');
    const claudeDir = path.resolve(projectRoot, '.claude');
    const agentsDir = path.resolve(claudeDir, 'agents');

    // Assurer que les dossiers existent
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });

    // 1. Création du fichier Prompt (.md)
    const promptPath = path.join(agentsDir, `${name}.md`);
    await fs.writeFile(promptPath, prompt, 'utf-8');

    // 2. Création du fichier Settings (.json)
    let envVars = {};
    const availableServers = await getAvailableMcpServers();
    
    // Par défaut, on active tous les serveurs détectés (meilleure expérience pour l'agent)
    // Si aucun détecté (ou mcp.json manquant), on garde des defaults raisonnables
    let mcpServers = availableServers.length > 0 
        ? availableServers 
        : ["postgresql", "news", "discord", "workflow"];

    // Copie des env si demandé
    if (copyEnvFrom) {
        try {
            const sourceSettingsPath = path.resolve(projectRoot, copyEnvFrom);
            const sourceContent = await fs.readFile(sourceSettingsPath, 'utf-8');
            const sourceJson = JSON.parse(sourceContent);
            if (sourceJson.env) envVars = sourceJson.env;
            if (sourceJson.enabledMcpjsonServers) mcpServers = sourceJson.enabledMcpjsonServers;
        } catch (e: any) {
            console.warn(`⚠️ Impossible de copier la config depuis ${copyEnvFrom}: ${e.message}`);
        }
    } else {
        // Fallback env (si aucun fichier source fourni)
        envVars = {
            "ANTHROPIC_MODEL": model
        };
    }

    const settings = {
        env: {
            ...envVars,
            "ANTHROPIC_MODEL": model // Force le modèle demandé
        },
        enableAllProjectMcpServers: false,
        enabledMcpjsonServers: mcpServers,
        agent: name
    };

    const settingsFileName = `settings_${name}.json`;
    const settingsPath = path.join(claudeDir, settingsFileName);
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    return {
        content: [{ 
            type: 'text', 
            text: `✅ Agent '${name}' créé avec succès !\n\n📂 Fichiers :\n- Prompt : ${promptPath}\n- Config : ${settingsPath}\n\n🚀 Pour lancer cet agent :\nnode dist/index.js --settings .claude/${settingsFileName}` 
        }]
    };
}
