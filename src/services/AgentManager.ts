import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { CONFIG, resolveConfigPath, getWorkspaceDir } from '../lib/config.js';
import { getMemoryProvider } from '../memory/MemoryFactory.js';
import { interpolateEnvVars } from '../lib/envUtils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ⭐ LAYOUT DES FICHIERS — v3.1
// ═══════════════════════════════════════════════════════════════════════════════
//
//  HERMES agents  →  ~/.overmind/hermes/profiles/<name>/
//                      ├── profile.yaml      (kanban — OBLIGATOIRE)
//                      ├── config.yaml       (Hermes config)
//                      ├── SOUL.md           (system prompt)
//                      ├── .env              (credentials)
//                      ├── .mcp.json         (override MCP)
//                      ├── state.db          (local SQLite)
//                      ├── workspace.yaml    (kind: scratch|persistent|shared)
//                      └── README.md         (role + owner)
//
//  CLAUDE/KILO    →  <WORKSPACE>/.claude/agents/<name>.md  (legacy support)
//
//  getSharedHermesHome() = OVERMIND_HERMES_HOME || ~/.overmind/hermes/
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate agent name to prevent path traversal attacks.
 * Only allows alphanumeric, underscores, hyphens — no path separators or special chars.
 */
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;
export function validateAgentName(name: string): void {
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid agent name "${name}": only alphanumeric, underscores, and hyphens allowed (no path separators or special chars)`,
    );
  }
}

export interface AgentConfigUpdates {
  model?: string;
  mcpServers?: string[];
  env?: Record<string, string>;
  runner?: string;
  mode?: string;
  cliPath?: string;
  file?: 'prompt.md' | 'settings.json' | '.mcp.json' | 'skill.md';
  content?: string;
  /** SOUL.md / system prompt content (Hermes profiles only) */
  prompt?: string;
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
    const claudeAgentsDir = path.join(this.claudeDir, 'agents');
    await fs.mkdir(claudeAgentsDir, { recursive: true });

    // 1. Scan .claude/agents/*.md (agents Claude/Kilo/Gemini)
    const claudeFiles = await fs.readdir(claudeAgentsDir).catch(() => [] as string[]);
    const claudeAgentNames = claudeFiles.filter((f) => f.endsWith('.md')).map((f) => f.replace('.md', ''));

    // 2. Scan Hermes profiles via `hermes profile list` (v3.0 — native profiles)
    //    Pas de scan de dossier manuel — on utilise la CLI native Hermes.
    const { HermesProfileManager } = await import('./HermesProfileManager.js');
    const hermesProfiles = await HermesProfileManager.list();
    const hermesAgentNames = hermesProfiles
      .filter(p => p.name !== 'default') // 'default' n'est pas un agent Overmind
      .map(p => p.name);

    // Collect info
    interface AgentInfo {
      name: string;
      runner: string;
      model: string;
      provider: string;
      mcpServers: string[];
      origin: 'claude' | 'hermes';
      missingConfig: boolean;
      promptSize: number;
    }

    const agentsMap = new Map<string, AgentInfo>();
    const availableServers = await this.getAvailableMcpServers();

    // Process Claude agents
    for (const name of claudeAgentNames) {
      let runner = 'claude';
      let model = 'settings-default';
      let provider = 'auto';
      let mcpServers: string[] = [];
      let missingConfig = false;

      const settingsPath = path.join(this.claudeDir, `settings_${name}.json`);
      try {
        const settingsContent = await fs.readFile(settingsPath, 'utf-8');
        let settings = JSON.parse(settingsContent);
        settings = interpolateEnvVars(settings);
        model = settings.env?.ANTHROPIC_MODEL || settings.model || 'settings-default';
        runner = settings.runner || 'claude';
        mcpServers = settings.enabledMcpjsonServers || [];
        
        provider = settings.provider || settings.env?.PROVIDER || 'auto';
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
      } catch {
        missingConfig = true;
      }

      let promptSize = 0;
      try {
        const stat = await fs.stat(path.join(claudeAgentsDir, `${name}.md`));
        promptSize = stat.size;
      } catch {
        // Ignored
      }

      agentsMap.set(name, {
        name,
        runner,
        model,
        provider,
        mcpServers,
        origin: 'claude',
        missingConfig,
        promptSize,
      });
    }
    // Process Hermes agents — lit depuis les profils Hermes natifs (v3.0)
    for (const profile of hermesProfiles.filter(p => p.name !== 'default')) {
      const name = profile.name;
      const model = profile.model || 'unknown';
      const provider = model.includes('(') ? model.match(/\(([^)]+)\)/)?.[1] || 'auto' : 'auto';
      const promptSize = 0;

      if (!agentsMap.has(name)) {
        agentsMap.set(name, {
          name,
          runner: 'hermes',
          model: model.replace(/\s*\(.*\)$/, '').trim() || 'unknown',
          provider,
          mcpServers: [],
          origin: 'hermes',
          missingConfig: false,
          promptSize,
        });
      }
    }

    // Group by runner
    const runners = ['hermes', 'claude', 'kilo', 'gemini', 'qwencli', 'openclaw', 'cline', 'opencode'];
    const grouped = new Map<string, AgentInfo[]>();
    for (const r of runners) {
      grouped.set(r, []);
    }
    grouped.set('unknown/other', []);

    for (const agent of agentsMap.values()) {
      const r = agent.runner.toLowerCase();
      if (grouped.has(r)) {
        grouped.get(r)!.push(agent);
      } else {
        grouped.get('unknown/other')!.push(agent);
      }
    }

    const outputLines: string[] = [];

    for (const [runName, list] of grouped.entries()) {
      if (list.length === 0) continue;
      
      let sectionText = `### 🏃 Runner/Harnais : **${runName.toUpperCase()}** (${list.length} agent(s))\n`;
      const items: string[] = [];
      
      for (const agent of list) {
        if (!details) {
          const warnText = agent.missingConfig ? ' ⚠️ (Config settings manquante)' : '';
          items.push(`  - **${agent.name}**${warnText}`);
        } else {
          let agentDesc = `  - **${agent.name}**`;
          if (agent.missingConfig) {
            agentDesc += `\n    ⚠️ Config settings manquante (settings_${agent.name}.json)`;
          } else {
            agentDesc += `\n    - Modèle   : ${agent.model}`;
            agentDesc += `\n    - Provider : ${agent.provider}`;
            const serverStatus = agent.mcpServers.map((s) => {
              if (availableServers.includes(s)) return s;
              const sugg = availableServers.find(v => v.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(v.toLowerCase()));
              return sugg ? `${s} (⚠️ Suggestion: ${sugg})` : `${s} (⚠️ Absent)`;
            });
            agentDesc += `\n    - MCPs     : ${serverStatus.length > 0 ? serverStatus.join(', ') : 'Aucun'}`;
          }
          agentDesc += `\n    - Prompt   : ${agent.promptSize} bytes (${agent.origin === 'hermes' ? 'SOUL.md' : 'agents/' + agent.name + '.md'})`;
          items.push(agentDesc);
        }
      }
      
      sectionText += items.join('\n');
      outputLines.push(sectionText);
    }

    return outputLines;
  }

  /**
   * Lecture non-destructive du runner effectif d'un agent.
   *   - Hermes : `hermes profile list` contient <name> → 'hermes'
   *   - Claude/Kilo : .claude/settings_<name>.json → settings.runner || 'claude'
   *   - Sinon : undefined
   */
  async peekRunner(name: string): Promise<string | undefined> {
    // Hermes profile check via CLI (v3.0)
    try {
      const { HermesProfileManager } = await import('./HermesProfileManager.js');
      const profiles = await HermesProfileManager.list();
      if (profiles.some(p => p.name === name)) {
        return 'hermes';
      }
    } catch { /* fall through to Claude check */ }

    // Claude/Kilo check via filesystem
    const claudeSettingsPath = path.join(this.claudeDir, `settings_${name}.json`);
    try {
      if (fsSync.existsSync(claudeSettingsPath)) {
        const raw = fsSync.readFileSync(claudeSettingsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed.runner === 'string' && parsed.runner) || 'claude';
      }
    } catch { /* Ignored */ }
    return undefined;
  }

  async deleteAgent(name: string): Promise<{ deletedFiles: string[]; errors: string[] }> {
    validateAgentName(name);
    const deletedFiles: string[] = [];
    const errors: string[] = [];

    // ═══════════════════════════════════════════════════════════════════════
    // HERMES PROFILE (v3.0 — Délègue à `hermes profile delete`)
    // ═══════════════════════════════════════════════════════════════════════
    const { HermesProfileManager } = await import('./HermesProfileManager.js');
    const hermesProfiles = await HermesProfileManager.list();
    const isHermes = hermesProfiles.some(p => p.name === name);

    if (isHermes) {
      try {
        await HermesProfileManager.delete(name);
        deletedFiles.push(`hermes profile: ${name}`);
      } catch (e) {
        errors.push(`hermes_profile: ${e instanceof Error ? e.message : String(e)}`);
      }
      return { deletedFiles, errors };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CLAUDE/KILO/etc. — garde le code existant
    // ═══════════════════════════════════════════════════════════════════════
    const agentsDir = path.join(this.claudeDir, 'agents');
    const promptPath = path.join(agentsDir, `${name}.md`);
    const settingsPath = path.join(this.claudeDir, `settings_${name}.json`);
    const tmpMcpPath = path.join(this.claudeDir, `mcp_tmp.json`);

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
    validateAgentName(name);
    const changes: string[] = [];
    const claudeDir = this.claudeDir;

    // ═══════════════════════════════════════════════════════════════════════
    // HERMES PROFILE (v3.0 — Délègue à HermesProfileManager)
    // ═══════════════════════════════════════════════════════════════════════
    const { HermesProfileManager } = await import('./HermesProfileManager.js');
    const profiles = await HermesProfileManager.list();
    const isHermes = profiles.some(p => p.name === name);
    const hermesAgentDir = isHermes ? (await HermesProfileManager.getProfilePath(name)) || '' : '';

    // --- MODE RÉÉCRITURE DE FICHIER COMPLET ---
    if (updates.file && updates.content) {
      if (isHermes && hermesAgentDir) {
        // Profil Hermes natif : config.yaml, SOUL.md, mcp.json, .env
        let filePath: string;
        switch (updates.file) {
          case 'prompt.md':
            filePath = path.join(hermesAgentDir, 'SOUL.md');
            await fs.writeFile(filePath, updates.content, 'utf-8');
            changes.push(`✅ **SOUL.md** réécrit → ${filePath}`);
            break;
          case 'settings.json':
            // Pour Hermes, settings.json = config.yaml
            filePath = path.join(hermesAgentDir, 'config.yaml');
            await fs.writeFile(filePath, updates.content, 'utf-8');
            changes.push(`✅ **config.yaml** réécrit → ${filePath}`);
            break;
          case '.mcp.json':
            filePath = path.join(hermesAgentDir, 'mcp.json');
            await fs.writeFile(filePath, updates.content, 'utf-8');
            changes.push(`✅ **mcp.json** réécrit → ${filePath}`);
            break;
          case 'skill.md':
            filePath = path.join(hermesAgentDir, 'skills', 'skill.md');
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, updates.content, 'utf-8');
            changes.push(`✅ **skill.md** réécrit → ${filePath}`);
            break;
          default:
            throw new Error(`Fichier non supporté: ${updates.file}`);
        }
        return changes;
      } else {
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

        if (updates.file === 'settings.json') return changes;
      }
    }

    if (isHermes && hermesAgentDir) {
      // ═══════════════════════════════════════════════════════════════════════
      // HERMES PROFILE — update via HermesProfileManager (v3.0)
      // Délègue à `hermes config set` + écriture directe .env + SOUL.md
      // ═══════════════════════════════════════════════════════════════════════
      if (updates.model) {
        const oldModel = profiles.find(p => p.name === name)?.model || '(none)';
        await HermesProfileManager.update(name, { model: updates.model });
        changes.push(`- Modèle : ${oldModel} → ${updates.model}`);
      }
      if (updates.env) {
        const envMap: Record<string, string> = {};
        for (const [key, value] of Object.entries(updates.env)) {
          envMap[key] = value;
          changes.push(`- Env '${key}' → ${value ? '***' : '(vide)'}`);
        }
        await HermesProfileManager.update(name, { credentials: envMap });
      }
      if (updates.prompt) {
        await HermesProfileManager.update(name, { prompt: updates.prompt });
        changes.push(`- SOUL.md mis à jour`);
      }
      if (updates.mcpServers) {
        await HermesProfileManager.update(name, { mcpServers: updates.mcpServers });
        changes.push(`- MCPs : [${updates.mcpServers.join(', ')}]`);
      }
      if (updates.runner) {
        // Runner n'est plus stocké dans le profil — c'est Overmind qui route
        changes.push(`- Runner : ${updates.runner} (routing Overmind)`);
      }
      return changes;
    }

    // --- MODE MISE À JOUR UNITAIRE (settings.json) pour Claude/Kilo/etc. ---
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
          { cause: _e },
        );
      }
      return changes;
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
- **Transmission Éternelle** : Si tu termines une tâche, résume les points clés via \`memory_store\` pour que ton futur "soi" ne reparte pas de zéro.

### 🌐 Architecture Polyglotte & Multi-Runner
Tu es conçu pour être exécuté par différents runners (Claude, Kilo, Gemini, Hermes, etc.).
- **Compatibilité** : Ton prompt et tes compétences sont agnostiques au runner.
- **Orchestration** : Tu peux être sollicité dans des workflows parallèles (\`run_agents_parallel\`) ou séquentiels.
- **Auto-Évaluation** : Adapte tes réponses au format attendu par le runner actuel (JSON pour Claude Code, texte brut pour Kilo, etc.).`;

    const finalPrompt = prompt + memoryInstructions;

    // Resolve auth token: prefer ANTHROPIC_AUTH_TOKEN, fallback to any ANTHROPIC_AUTH_TOKEN_<N>
    let authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!authToken) {
      const suffixedKeys = Object.keys(process.env)
        .filter((k) => /^ANTHROPIC_AUTH_TOKEN_\d+$/.test(k))
        .sort();
      if (suffixedKeys.length > 0) {
        authToken = process.env[suffixedKeys[0]];
        console.warn(
          `[AgentManager] ⚠️  ANTHROPIC_AUTH_TOKEN absent — fallback sur ${suffixedKeys[0]}. ` +
            `Pour un comportement stable, définissez ANTHROPIC_AUTH_TOKEN dans le .env du service.`,
        );
      }
    }
    if (!authToken) {
      const err =
        'MISSING_AUTH_TOKEN: ANTHROPIC_AUTH_TOKEN (ou ANTHROPIC_AUTH_TOKEN_<N>) absent de l\'environnement. ' +
        'Impossible de créer l\'agent de manière sécurisée.';
      console.error(`[AgentManager] ❌ ${err}`);
      return {
        promptPath: '',
        settingsPath: '',
        error: err,
      };
    }

    let envVars: Record<string, string> = {
      ANTHROPIC_MODEL: model,
      ANTHROPIC_AUTH_TOKEN: authToken,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      ANTHROPIC_DEFAULT_HAIKU_MODEL:
        process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'claude-3-5-haiku-20241022',
      ANTHROPIC_DEFAULT_OPUS_MODEL:
        process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'claude-3-opus-20240229',
      ANTHROPIC_DEFAULT_SONNET_MODEL:
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-3-5-sonnet-20241022',
      AGENT_TIMEOUT_MS: process.env.AGENT_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '3000000',
      MISTRAL_API_KEY: process.env.MISTRAL_API_KEY || '',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      ALIBABA_API_KEY: process.env.ALIBABA_API_KEY || '',
      SILICONFLOW_API_KEY: process.env.SILICONFLOW_API_KEY || '',
      MINIMAXI_API_KEY: process.env.MINIMAXI_API_KEY || '',
      Z_AI_API_KEY: process.env.Z_AI_API_KEY || '',
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
        if (!sourceSettingsPath.startsWith(path.resolve(projectRoot))) {
          throw new Error(`copyEnvFrom path escapes project root: ${copyEnvFrom}`);
        }
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

    if (runner === 'hermes') {
      // ═══════════════════════════════════════════════════════════════════════
      // NATIVE HERMES PROFILE (v3.0 — Refactored)
      //
      // Au lieu de créer un layout custom (settings.json + SOUL.md manuels),
      // on délègue à `hermes profile create` qui crée un profil natif:
      //   ~/.hermes/profiles/<name>/
      //     ├── config.yaml   (provider + model + MCP — géré par Hermes)
      //     ├── .env          (credentials — géré par Hermes)
      //     ├── SOUL.md       (system prompt)
      //     ├── memories/     (state.db — isolation native)
      //     └── sessions/     (historique — géré par Hermes)
      //
      // Avantages:
      //   - Zero credential drift (1 .env par profil, point final)
      //   - Provider routing géré par Hermes (35+ providers natifs)
      //   - Pas de TOKEN_KEYS, pas de token resolution, pas de HERMES_HOME custom
      // ═══════════════════════════════════════════════════════════════════════
      const { HermesProfileManager } = await import('./HermesProfileManager.js');

      // Build credentials map from envVars (extract provider-specific keys)
      const credentials: Record<string, string> = {};
      const authToken = envVars.ANTHROPIC_AUTH_TOKEN || '';
      if (authToken) {
        // Auto-detect provider from token prefix to set the right env var
        if (authToken.startsWith('sk-cp-') || authToken.startsWith('sk-mm-')) {
          credentials['MINIMAX_CN_API_KEY'] = authToken;
        } else if (/^[0-9a-f]{32}/i.test(authToken)) {
          credentials['GLM_API_KEY'] = authToken;
        } else {
          credentials['ANTHROPIC_API_KEY'] = authToken;
        }
      }

      const { profilePath, soulPath } = await HermesProfileManager.create({
        name,
        prompt: finalPrompt,
        model,
        credentials,
        mcpServers,
        description: `Overmind agent: ${name}`,
      });

      // Mémoriser la création de l'agent
      try {
        const memory = getMemoryProvider();
        await memory.storeKnowledge({
          text: `Nouvel agent Hermes créé : '${name}'. Profile path : ${profilePath}.`,
          source: 'agent',
          agentName: name,
        });
      } catch { /* Ignored */ }

      return { promptPath: soulPath, settingsPath: path.join(profilePath, 'config.yaml') };
    }

    const agentsDir = path.join(this.claudeDir, 'agents');
    await fs.mkdir(this.claudeDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });

    const promptPath = path.join(agentsDir, `${name}.md`);
    await fs.writeFile(promptPath, finalPrompt, 'utf-8');

    const settings: Record<string, unknown> = {
      env: envVars,
      enableAllProjectMcpServers: false,
      enabledMcpjsonServers: mcpServers,
      agent: name,
      runner: runner || 'claude',
    };

    if (mode) settings.mode = mode;
    if (cliPath) settings.cliPath = cliPath;

    const settingsFileName = `settings_${name}.json`;
    const settingsPath = path.join(this.claudeDir, settingsFileName);
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

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
    } catch (e) {
      console.error(`[AgentManager] ⚠️ Failed to create .mcp.${name}.json:`, (e as Error).message);
    }

    try {
      const memory = getMemoryProvider();
      await memory.storeKnowledge({
        text: `Nouvel agent IA créé : '${name}'. Runner : ${runner || 'claude'}.`,
        source: 'agent',
        agentName: name,
      });
    } catch (_e) {
      // Ignored
    }

    return { promptPath, settingsPath };
  }

  async getDetailedConfigs(name: string): Promise<Record<string, string>> {
    validateAgentName(name);

    const result: Record<string, string> = {};
    const readFileSafe = async (filePath: string) => {
      try { return await fs.readFile(filePath, 'utf-8'); }
      catch { return 'MISSING'; }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // HERMES PROFILE (v3.0 — lit depuis ~/.hermes/profiles/<name>/)
    // ═══════════════════════════════════════════════════════════════════════
    const { HermesProfileManager } = await import('./HermesProfileManager.js');
    const profiles = await HermesProfileManager.list();
    const isHermes = profiles.some(p => p.name === name);

    if (isHermes) {
      const profilePath = await HermesProfileManager.getProfilePath(name);
      if (profilePath) {
        result['settings.json'] = await readFileSafe(path.join(profilePath, 'config.yaml'));
        result['prompt.md']     = await readFileSafe(path.join(profilePath, 'SOUL.md'));
        result['.mcp.json']     = await readFileSafe(path.join(profilePath, 'mcp.json'));
        result['.env']          = await readFileSafe(path.join(profilePath, '.env'));
      }
      return result;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CLAUDE/KILO/etc. — garde le code existant
    // ═══════════════════════════════════════════════════════════════════════
    const agentsDir = path.join(this.claudeDir, 'agents');
    const promptPath = path.join(agentsDir, `${name}.md`);
    const settingsPath = path.join(this.claudeDir, `settings_${name}.json`);
    const mcpPath = path.join(this.claudeDir, `.mcp.${name}.json`);
    const skillPath = path.join(this.claudeDir, `agents/${name}_skill.md`);
    const alternativeSkillPath = path.join(this.claudeDir, `skills/${name}.md`);

    // Fallback paths for Claude/Kilo agents
    const workspaceDir = getWorkspaceDir();
    const fallbackAgentsDir = path.join(workspaceDir, '.overmind', 'agents');
    const fallbackPromptPath = path.join(fallbackAgentsDir, `${name}.md`);
    const fallbackSettingsDir = path.join(workspaceDir, '.overmind', 'agents', name);
    const fallbackSettingsPath = path.join(fallbackSettingsDir, 'settings.json');
    const fallbackMcpPath = path.join(fallbackSettingsDir, '.mcp.json');

    result['prompt.md'] = await readFileSafe(promptPath);
    if (result['prompt.md'] === 'MISSING') {
      result['prompt.md'] = await readFileSafe(fallbackPromptPath);
    }

    result['settings.json'] = await readFileSafe(settingsPath);
    if (result['settings.json'] === 'MISSING') {
      result['settings.json'] = await readFileSafe(fallbackSettingsPath);
    }

    result['.mcp.json'] = await readFileSafe(mcpPath);
    if (result['.mcp.json'] === 'MISSING') {
      result['.mcp.json'] = await readFileSafe(fallbackMcpPath);
    }

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
