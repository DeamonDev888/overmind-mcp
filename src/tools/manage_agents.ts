import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Helpers ---
function getClaudeDir() {
    const currentFileUrl = import.meta.url;
    const currentFilePath = fileURLToPath(currentFileUrl);
    const projectRoot = path.resolve(path.dirname(currentFilePath), '../../');
    return path.resolve(projectRoot, '.claude');
}

// --- Schemas ---

export const listAgentsSchema = z.object({
    details: z.boolean().optional().default(false).describe("Si true, affiche les détails complets (modèle, config) de chaque agent.")
});

export const deleteAgentSchema = z.object({
    name: z.string().describe("Nom de l'agent à supprimer (ex: agent_finance)")
});

// --- Tools ---

export async function listAgents(args: z.infer<typeof listAgentsSchema>): Promise<any> {
    const { details } = args;
    const claudeDir = getClaudeDir();
    const agentsDir = path.join(claudeDir, 'agents');

    try {
        // Ensure dir exists
        await fs.mkdir(agentsDir, { recursive: true });

        const files = await fs.readdir(agentsDir);
        const agentFiles = files.filter(f => f.endsWith('.md'));

        if (agentFiles.length === 0) {
            return {
                content: [{ type: 'text', text: "📂 Aucun agent trouvé." }]
            };
        }

        const agentsList = [];

        for (const file of agentFiles) {
            const agentName = file.replace('.md', '');
            
            if (!details) {
                agentsList.push(`- ${agentName}`);
                continue;
            }

            // Fetch details if requested
            let info = `🤖 **${agentName}**`;
            
            // Read settings
            const settingsPath = path.join(claudeDir, `settings_${agentName}.json`);
            try {
                const settingsContent = await fs.readFile(settingsPath, 'utf-8');
                const settings = JSON.parse(settingsContent);
                const model = settings.env?.ANTHROPIC_MODEL || "settings-default";
                const servers = settings.enabledMcpjsonServers || [];
                
                info += `\n  - Modèle : ${model}`;
                info += `\n  - Serveurs MCP : ${servers.length > 0 ? servers.join(', ') : 'Aucun'}`;
            } catch (e) {
                info += `\n  - Config : ⚠️ Manquante ou invalide (${settingsPath})`;
            }

            // Read Prompt stats
            try {
                const promptPath = path.join(agentsDir, file);
                const promptStat = await fs.stat(promptPath);
                info += `\n  - Prompt Size : ${promptStat.size} bytes`;
            } catch (e) {}

            agentsList.push(info);
        }

        return {
            content: [{ 
                type: 'text', 
                text: `📋 **Liste des Agents Disponibles (${agentFiles.length})** :\n\n${agentsList.join('\n\n')}` 
            }]
        };

    } catch (e: any) {
        return {
            isError: true,
            content: [{ type: 'text', text: `❌ Erreur lors du listing des agents : ${e.message}` }]
        };
    }
}

export async function deleteAgent(args: z.infer<typeof deleteAgentSchema>): Promise<any> {
    const { name } = args;
    const claudeDir = getClaudeDir();
    const agentsDir = path.join(claudeDir, 'agents');
    
    const promptPath = path.join(agentsDir, `${name}.md`);
    const settingsPath = path.join(claudeDir, `settings_${name}.json`);

    const deletedFiles = [];
    const errors = [];

    // Delete Prompt
    try {
        await fs.unlink(promptPath);
        deletedFiles.push(promptPath);
    } catch (e: any) {
        if (e.code !== 'ENOENT') errors.push(`Prompt: ${e.message}`);
    }

    // Delete Settings
    try {
        await fs.unlink(settingsPath);
        deletedFiles.push(settingsPath);
    } catch (e: any) {
        if (e.code !== 'ENOENT') errors.push(`Settings: ${e.message}`);
    }

    if (deletedFiles.length === 0 && errors.length === 0) {
         return {
            isError: true,
            content: [{ type: 'text', text: `⚠️ Agent '${name}' introuvable (ni prompt, ni settings).` }]
        };
    }

    let response = `🗑️ **Suppression de l'agent '${name}'**\n`;
    if (deletedFiles.length > 0) {
        response += `\n✅ Fichiers supprimés :\n${deletedFiles.map(f => `- ${path.basename(f)}`).join('\n')}`;
    }
    if (errors.length > 0) {
        response += `\n\n❌ Erreurs :\n${errors.join('\n')}`;
    }

    return {
        content: [{ type: 'text', text: response }]
    };
}
