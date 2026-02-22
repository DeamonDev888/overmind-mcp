import fs from 'fs/promises';
import path from 'path';
import { CONFIG, resolveConfigPath, getWorkspaceDir } from '../lib/config.js';
import { getMemoryProvider } from '../memory/MemoryFactory.js';

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
## 🧠 Intelligence et Mémoire Long Terme (Overmind Protocol)
Tu es un agent de l'écosystème Overmind, équipé d'une mémoire sémantique persistante.

### 📜 Protocole d'Initialisation (OBLIGATOIRE)
Avant toute action ou modification de code :
1. **Vérifie les Standards** : Appelle \`memory_search(query: "architecture projet standard overmind")\`. Tu DOIS respecter l'usage de pnpm, TypeScript (dist/), ESModules et FastMCP.
2. **Auto-Évaluation** : Appelle \`memory_runs(agent_name: "${name}", limit: 5)\` pour analyser tes succès et échecs récents. Apprends de tes erreurs passées.
3. **Récupère le Contexte** : Appelle \`memory_search(query: "contexte projet ${name}")\` pour retrouver les dernières décisions ou l'état d'avancement.

### 💾 Protocole de Mémorisation
Ne laisse pas tes découvertes s'effacer :
- **Pattern & Décision** : Si tu identifies une règle métier ou si tu prends une décision architecturale, utilise \`memory_store\` avec \`source: "decision"\` ou \`source: "pattern"\`.
- **Auto-Correction** : Si tu corriges un bug complexe, stocke la solution avec \`source: "error"\` pour ne plus reproduire l'erreur.
- **Identité** : Utilise toujours \`agent_name: "${name}"\` pour tes souvenirs personnels, sauf si l'information est d'intérêt général (auquel cas, ne le spécifie pas).`;

    const finalPrompt = prompt + memoryInstructions;

    const promptPath = path.join(agentsDir, `${name}.md`);
    await fs.writeFile(promptPath, finalPrompt, 'utf-8');

    let envVars: Record<string, string> = { ANTHROPIC_MODEL: model };
    const availableServers = await this.getAvailableMcpServers();
    let mcpServers =
      availableServers.length > 0
        ? availableServers
        : ['postgresql', 'news', 'discord-server', 'workflow'];

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

    // Mémoriser la création de l'agent dans Overmind
    try {
      const memory = getMemoryProvider();
      await memory.storeKnowledge({
        text: `Nouvel agent IA créé : '${name}'.
Runner : ${runner || 'claude'}.
Modèle : ${model}.
Capacités définies : ${prompt.slice(0, 300)}...
Serveurs MCP activés : ${mcpServers.join(', ')}.`,
        source: 'agent',
      });
    } catch (_e) {
      // Ignorer si la mémoire échoue
    }

    return { promptPath, settingsPath };
  }
}
