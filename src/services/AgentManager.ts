import fs from 'fs/promises';
import path from 'path';
import { CONFIG, resolveConfigPath, getWorkspaceDir } from '../lib/config.js';
import { getMemoryProvider } from '../memory/MemoryFactory.js';

export interface AgentConfigUpdates {
  model?: string;
  mcpServers?: string[];
  env?: Record<string, string>;
  runner?: string;
  mode?: string;
  cliPath?: string;
  file?: 'prompt.md' | 'settings.json' | '.mcp.json' | 'skill.md';
  content?: string;
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
    const availableServers = await this.getAvailableMcpServers();

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
        const model = settings.env?.ANTHROPIC_MODEL || settings.model || 'settings-default';
        const runner = settings.runner || 'claude';
        const servers = settings.enabledMcpjsonServers || [];

        // Inférence du provider
        let provider = settings.provider || settings.env?.PROVIDER || 'auto';
        if (provider === 'auto') {
          if (settings.env?.MISTRAL_API_KEY) provider = 'mistral';
          else if (settings.env?.OPENAI_API_KEY) provider = 'openai';
          else if (settings.env?.NVIDIA_API_KEY || settings.env?.NVAPI_KEY) provider = 'nvidia';
          else if (settings.env?.GEMINI_API_KEY) provider = 'google';
          else if (model.includes('mistral') || model.includes('codestral') || model.includes('devstral')) provider = 'mistral';
          else if (model.includes('gpt-')) provider = 'openai';
          else if (model.includes('gemini')) provider = 'google';
          else if (model.includes('claude')) provider = 'anthropic';
        }

        const serverStatus = servers.map((s: string) => {
          if (availableServers.includes(s)) return s;

          // Recherche de suggestions (typo)
          const suggestion = availableServers.find(
            (v) =>
              v.toLowerCase().includes(s.toLowerCase()) ||
              s.toLowerCase().includes(v.toLowerCase()),
          );

          return suggestion
            ? `${s} (⚠️ Nom incorrect ? Suggestion: **${suggestion}**)`
            : `${s} (⚠️ Absent de mcp.json)`;
        });

        info += `\n  - Runner  : ${runner}`;
        info += `\n  - Model   : ${model}`;
        info += `\n  - Provider: ${provider}`;
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
    const changes: string[] = [];
    const claudeDir = this.claudeDir;

    // --- MODE RÉÉCRITURE DE FICHIER COMPLET ---
    if (updates.file && updates.content) {
      let filePath: string;
      switch (updates.file) {
        case 'prompt.md':
          filePath = path.join(claudeDir, 'agents', `${name}.md`);
          break;
        case 'settings.json':
          filePath = path.join(claudeDir, `settings_${name}.json`);
          break;
        case '.mcp.json':
          filePath = path.join(claudeDir, `.mcp.${name}.json`);
          break;
        case 'skill.md':
          filePath = path.join(claudeDir, 'agents', `${name}_skill.md`);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          break;
        default:
          throw new Error(`Fichier non supporté: ${updates.file}`);
      }
      await fs.writeFile(filePath, updates.content, 'utf-8');
      changes.push(`✅ Fichier **${updates.file}** réécrit pour l'agent **${name}**.`);

      // Si on réécrit settings.json, on ne fait pas les updates unitaires (déjà écrasé)
      if (updates.file === 'settings.json') return changes;
    }

    // --- MODE MISE À JOUR UNITAIRE (settings.json) ---
    const settingsPath = path.join(claudeDir, `settings_${name}.json`);
    let settings: {
      env?: Record<string, string>;
      enabledMcpjsonServers?: string[];
      [key: string]: unknown;
    };
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    } catch (_e) {
      // Si on veut faire des updates unitaires, le settings doit exister
      if (
        updates.model ||
        updates.mcpServers ||
        updates.env ||
        updates.runner ||
        updates.mode ||
        updates.cliPath
      ) {
        throw new Error(
          `Impossible de modifier les paramètres unitaires : settings_${name}.json est introuvable.`,
        );
      }
      return changes; // Rien à faire
    }

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

      // 📂 UPDATE .mcp.<name>.json
      try {
        const globalMcpPath = resolveConfigPath(CONFIG.CLAUDE.PATHS.MCP);
        const globalMcpContent = await fs.readFile(globalMcpPath, 'utf-8');
        const globalMcp = JSON.parse(globalMcpContent);

        const agentMcpServers: Record<string, Record<string, unknown>> = {};
        updates.mcpServers.forEach((serverName) => {
          if (globalMcp.mcpServers && globalMcp.mcpServers[serverName]) {
            agentMcpServers[serverName] = globalMcp.mcpServers[serverName];
          }
        });

        const agentMcpPath = path.join(this.claudeDir, `.mcp.${name}.json`);
        await fs.writeFile(
          agentMcpPath,
          JSON.stringify({ mcpServers: agentMcpServers }, null, 2),
          'utf-8',
        );
        changes.push(`✅ Fichier .mcp.${name}.json mis à jour avec les nouveaux serveurs.`);
      } catch (e) {
        changes.push(`⚠️ Échec de la mise à jour de .mcp.${name}.json: ${(e as Error).message}`);
      }
    }

    if (updates.env) {
      settings.env = settings.env || {};
      for (const [key, value] of Object.entries(updates.env)) {
        const oldVal = settings.env[key] ? '***' : '(undefined)';
        settings.env[key] = value;
        changes.push(`- Env Var '${key}' : ${oldVal} -> ${value ? '***' : '(vide)'}`);
      }
    }

    if (updates.runner) {
      const old = settings.runner || 'claude';
      settings.runner = updates.runner;
      changes.push(`- Runner : ${old} -> ${updates.runner}`);
    }

    if (updates.mode) {
      const old = settings.mode || '(none)';
      settings.mode = updates.mode;
      changes.push(`- Mode : ${old} -> ${updates.mode}`);
    }

    if (updates.cliPath) {
      const old = settings.cliPath || '(none)';
      settings.cliPath = updates.cliPath;
      changes.push(`- CLI Path : ${old} -> ${updates.cliPath}`);
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
Tu es un agent de l'écosystème Overmind, équipé d'une mémoire sémantique persistante et d'une conscience de tes capacités.

### 📜 Protocole d'Initialisation (OBLIGATOIRE)
Avant toute action ou modification de code :
1. **Analyse tes Capacités (MCP)** : Vérifie quels serveurs MCP sont actifs dans ta configuration actuelle (\`settings_${name}.json\`). Tu DOIS identifier les outils à ta disposition (Base de données, Scrapers, Discord, etc.) avant de commencer.
2. **Mémoire des Standards** : Appelle \`memory_search(query: "architecture projet standard overmind")\`. Tu DOIS respecter l'usage de pnpm, TypeScript (dist/), ESModules et FastMCP.
3. **Récupération du Contexte** : Appelle \`memory_search(query: "contexte projet ${name}")\` pour retrouver les dernières décisions ou l'état d'avancement.
4. **Auto-Évaluation** : Appelle \`memory_runs(limit: 5)\` pour analyser tes succès et échecs récents.

### 💾 Protocole de Mémoire Proactive
Tu es jugé sur ta capacité à transmettre ton savoir. FOUILLIE ta mémoire et ENRICHIS-la constamment :
- **Recherche Intensive** : Pour chaque nouveau concept ou bug rencontré, fais systématiquement un \`memory_search\`. Ne présume jamais que tu sais tout.
- **Pattern & Décision** : Si tu identifies une règle métier ou si tu prends une décision architecturale, utilise \`memory_store\` avec \`source: "decision"\` ou \`source: "pattern"\`.
- **Identité Auto-Gérée** : OverMind détecte automatiquement ton identité (\`${name}\`). Ne spécifie plus le paramètre \`agent_name\` sauf si tu souhaites explicitement consulter ou écrire dans la mémoire d'un AUTRE agent spécifique.
- **Transmission Éternelle** : Si tu termines une tâche, résume les points clés via \`memory_store\` pour que ton futur "soi" ne reparte pas de zéro.`;

    const finalPrompt = prompt + memoryInstructions;

    const promptPath = path.join(agentsDir, `${name}.md`);
    await fs.writeFile(promptPath, finalPrompt, 'utf-8');

    // Default mandatory environment variables according to user request
    let envVars = {
      ANTHROPIC_MODEL: model,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || 'VOTRE_TOKEN_Z_AI',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'claude-sonnet-4-6',
      ANTHROPIC_DEFAULT_OPUS_MODEL: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'claude-opus-4-7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-6',
      API_TIMEOUT_MS: process.env.API_TIMEOUT_MS || '3000000',
      agent: name,
    };

    const availableServers = await this.getAvailableMcpServers();
    let mcpServers =
      availableServers.length > 0
        ? availableServers
        : [
            'postgresql-server',
            'news-server',
            'discord-server',
            'overmind',
            'memory',
            'news-btc-server',
          ];

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

    envVars.ANTHROPIC_MODEL = model; // Ensure model is correctly set

    const settings: Record<string, unknown> = {
      env: envVars,
      enableAllProjectMcpServers: false,
      enabledMcpjsonServers: mcpServers,
      agent: name,
      runner: runner || 'claude',
    };

    // Add runner specific metadata
    if (mode) settings.mode = mode;
    if (cliPath) settings.cliPath = cliPath;

    const settingsFileName = `settings_${name}.json`;
    const settingsPath = path.join(this.claudeDir, settingsFileName);
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    // 📂 ENSURE .mcp.<agent>.json CREATION
    try {
      const globalMcpPath = resolveConfigPath(CONFIG.CLAUDE.PATHS.MCP);
      const globalMcpContent = await fs.readFile(globalMcpPath, 'utf-8');
      const globalMcp = JSON.parse(globalMcpContent);

      const agentMcpServers: Record<string, Record<string, unknown>> = {};
      mcpServers.forEach((serverName) => {
        if (globalMcp.mcpServers && globalMcp.mcpServers[serverName]) {
          agentMcpServers[serverName] = globalMcp.mcpServers[serverName];
        }
      });

      const agentMcpPath = path.join(this.claudeDir, `.mcp.${name}.json`);
      await fs.writeFile(
        agentMcpPath,
        JSON.stringify({ mcpServers: agentMcpServers }, null, 2),
        'utf-8',
      );
      console.error(
        `[AgentManager] ✅ .mcp.${name}.json created with ${Object.keys(agentMcpServers).length} servers.`,
      );
    } catch (e) {
      console.error(`[AgentManager] ⚠️ Failed to create .mcp.${name}.json:`, (e as Error).message);
    }

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
        agentName: name,
      });
    } catch (_e) {
      // Ignorer si la mémoire échoue
    }

    return { promptPath, settingsPath };
  }

  async getDetailedConfigs(name: string): Promise<Record<string, string>> {
    const agentsDir = path.join(this.claudeDir, 'agents');
    const promptPath = path.join(agentsDir, `${name}.md`);
    const settingsPath = path.join(this.claudeDir, `settings_${name}.json`);
    const mcpPath = path.join(this.claudeDir, `.mcp.${name}.json`);
    const skillPath = path.join(this.claudeDir, `agents/${name}_skill.md`);
    const alternativeSkillPath = path.join(this.claudeDir, `skills/${name}.md`);

    const result: Record<string, string> = {};

    const readFileSafe = async (filePath: string) => {
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch (_e) {
        return 'MISSING';
      }
    };

    result['prompt.md'] = await readFileSafe(promptPath);
    result['settings.json'] = await readFileSafe(settingsPath);
    result['.mcp.json'] = await readFileSafe(mcpPath);

    const skillContent = await readFileSafe(skillPath);
    if (skillContent !== 'MISSING') {
      result['skill.md'] = skillContent;
    } else {
      const altSkillContent = await readFileSafe(alternativeSkillPath);
      if (altSkillContent !== 'MISSING') {
        result['skill.md'] = altSkillContent;
      }
    }

    return result;
  }
}
