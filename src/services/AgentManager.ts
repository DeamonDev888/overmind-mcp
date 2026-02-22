import fs from 'fs/promises';
import path from 'path';
import { CONFIG, resolveConfigPath, getWorkspaceDir } from '../lib/config.js';

export interface AgentConfigUpdates {
  model?: string;
  mcpServers?: string[];
  env?: Record<string, string>;
}

export class AgentManager {
  private claudeDir: string;

  constructor(customClaudeDir?: string) {
    if (customClaudeDir) {
      this.claudeDir = customClaudeDir;
    } else {
      this.claudeDir = path.join(getWorkspaceDir(), '.claude');
    }
  }

  private async getAvailableMcpServers(): Promise<string[]> {
    try {
      const mcpPath = resolveConfigPath(CONFIG.CLAUDE.PATHS.MCP);
      const content = await fs.readFile(mcpPath, 'utf-8');
      const json = JSON.parse(content);
      return Object.keys(json.mcpServers || {});
    } catch (_e) {
      return [];
    }
  }

  async listAgents(details: boolean = false): Promise<string[]> {
    const agentsDir = path.join(this.claudeDir, 'agents');
    await fs.mkdir(agentsDir, { recursive: true });

    const files = await fs.readdir(agentsDir);
    const agentFiles = files.filter((f) => f.endsWith('.md'));
    const agentsList: string[] = [];

    for (const file of agentFiles) {
      const agentName = file.replace('.md', '');
      if (!details) {
        agentsList.push(`- ${agentName}`);
        continue;
      }

      let info = `🤖 **${agentName}**`;
      const settingsPath = path.join(this.claudeDir, `settings_${agentName}.json`);
      try {
        const settingsContent = await fs.readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(settingsContent);
        const model = settings.env?.ANTHROPIC_MODEL || 'settings-default';
        const servers = settings.enabledMcpjsonServers || [];

        const availableServers = await this.getAvailableMcpServers();
        const serverStatus = servers.map((s: string) =>
          availableServers.includes(s) ? s : `${s} (⚠️ INCONNU)`,
        );

        info += `\n  - Modèle : ${model}`;
        info += `\n  - Serveurs MCP : ${servers.length > 0 ? serverStatus.join(', ') : 'Aucun'}`;
      } catch (_e) {
        info += `\n  - Config : ⚠️ Manquante ou invalide (${settingsPath})`;
      }

      try {
        const promptPath = path.join(agentsDir, file);
        const promptStat = await fs.stat(promptPath);
        info += `\n  - Prompt Size : ${promptStat.size} bytes`;
      } catch (_e) {
        // Ignore missing or inaccessible prompt file
      }

      agentsList.push(info);
    }
    return agentsList;
  }

  async deleteAgent(name: string): Promise<{ deletedFiles: string[]; errors: string[] }> {
    const agentsDir = path.join(this.claudeDir, 'agents');
    const promptPath = path.join(agentsDir, `${name}.md`);
    const settingsPath = path.join(this.claudeDir, `settings_${name}.json`);
    const tmpMcpPath = path.join(this.claudeDir, `mcp_${name}_tmp.json`);

    const deletedFiles: string[] = [];
    const errors: string[] = [];

    for (const file of [promptPath, settingsPath, tmpMcpPath]) {
      try {
        await fs.unlink(file);
        deletedFiles.push(file);
      } catch (e) {
        if (e && typeof e === 'object' && 'code' in e && e.code !== 'ENOENT') {
          errors.push(`${path.basename(file)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return { deletedFiles, errors };
  }

  async updateAgentConfig(name: string, updates: AgentConfigUpdates): Promise<string[]> {
    const settingsPath = path.join(this.claudeDir, `settings_${name}.json`);
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const changes: string[] = [];

    if (updates.model) {
      settings.env = settings.env || {};
      const oldModel = settings.env.ANTHROPIC_MODEL;
      settings.env.ANTHROPIC_MODEL = updates.model;
      changes.push(`- Modèle : ${oldModel} -> ${updates.model}`);
    }

    if (updates.mcpServers) {
      const oldServers = settings.enabledMcpjsonServers || [];
      const availableServers = await this.getAvailableMcpServers();
      const unknownServers = updates.mcpServers.filter((s) => !availableServers.includes(s));

      if (unknownServers.length > 0 && availableServers.length > 0) {
        changes.push(
          `⚠️ **ATTENTION:** Serveurs inconnus détectés: ${unknownServers.join(', ')}. Ils ne sont PAS dans mcp.json.\n   Serveurs valides: ${availableServers.join(', ')}`,
        );
      }

      settings.enabledMcpjsonServers = updates.mcpServers;
      changes.push(
        `- Serveurs MCP : [${oldServers.join(', ')}] -> [${updates.mcpServers.join(', ')}]`,
      );
    }

    if (updates.env) {
      settings.env = settings.env || {};
      for (const [key, value] of Object.entries(updates.env)) {
        const oldVal = settings.env[key] ? '***' : '(undefined)';
        settings.env[key] = value;
        changes.push(`- Env Var '${key}' : ${oldVal} -> ${value ? '***' : '(vide)'}`);
      }
    }

    if (changes.length > 0) {
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    }

    return changes;
  }

  async createAgent(
    name: string,
    prompt: string,
    model: string,
    copyEnvFrom?: string,
    projectRoot?: string,
    runner?: string,
    mode?: string,
    cliPath?: string,
  ): Promise<{ promptPath: string; settingsPath: string; error?: string }> {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return { promptPath: '', settingsPath: '', error: 'INVALID_NAME' };
    }

    const agentsDir = path.join(this.claudeDir, 'agents');
    await fs.mkdir(this.claudeDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });

    const memoryInstructions = `

---
## 🧠 Système de Mémoire Long Terme (Overmind)
Tu es doté d'une mémoire persistante grâce aux outils MCP fournis (\`memory_store\` et \`memory_search\`).
- **Utilise l'outil \`memory_search\`** systématiquement au début de tes tâches. Passe le paramètre \`agent_name: "${name}"\` pour rechercher dans TES souvenirs personnels, ou ne le passe pas pour chercher dans la mémoire globale de l'Overmind.
- **Utilise l'outil \`memory_store\`** pour sauvegarder activement toute nouvelle information importante. Passe TOUJOURS le paramètre \`agent_name: "${name}"\` pour que cette connaissance te soit propre.`;

    const finalPrompt = prompt + memoryInstructions;

    const promptPath = path.join(agentsDir, `${name}.md`);
    await fs.writeFile(promptPath, finalPrompt, 'utf-8');

    let envVars: Record<string, string> = { ANTHROPIC_MODEL: model };
    const availableServers = await this.getAvailableMcpServers();
    let mcpServers =
      availableServers.length > 0
        ? availableServers
        : ['postgresql', 'news', 'discord', 'workflow'];

    if (copyEnvFrom && projectRoot) {
      try {
        const sourceSettingsPath = path.resolve(projectRoot, copyEnvFrom);
        const sourceContent = await fs.readFile(sourceSettingsPath, 'utf-8');
        const sourceJson = JSON.parse(sourceContent);
        if (sourceJson.env) envVars = { ...envVars, ...sourceJson.env };
        if (sourceJson.enabledMcpjsonServers) mcpServers = sourceJson.enabledMcpjsonServers;
      } catch (e) {
        console.warn(
          `⚠️ Impossible de copier la config depuis ${copyEnvFrom}: ${(e as Error).message}`,
        );
      }
    }

    envVars.ANTHROPIC_MODEL = model; // Force model

    const settings: Record<string, unknown> = {
      env: envVars,
      enableAllProjectMcpServers: false,
      enabledMcpjsonServers: mcpServers,
      agent: name,
    };

    // Ajouter les métadonnées du runner si spécifié
    if (runner) {
      settings.runner = runner;
    }
    if (mode) {
      settings.mode = mode;
    }
    if (cliPath) {
      settings.cliPath = cliPath;
    }

    const settingsFileName = `settings_${name}.json`;
    const settingsPath = path.join(this.claudeDir, settingsFileName);
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    return { promptPath, settingsPath };
  }
}
