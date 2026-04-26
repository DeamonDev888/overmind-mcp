import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId } from '../lib/sessions.js';

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
  model?: string;
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
}

export class NousHermesRunner {
  private timeoutMs: number;

  constructor() {
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 min default
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume, silent } = options;
    let { sessionId } = options;

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath);
      if (lastId) {
        sessionId = lastId;
      }
    }

    const agentCustomEnv: Record<string, string | undefined> = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1',
      PYTHONLEGACYWINDOWSSTDIO: '1',
      TERM: 'emacs',
      PROMPT_TOOLKIT_NO_INTERACTIVE: '1',
      // Force non-interactive for prompt_toolkit
      ANSICON: '1',
      // Map OpenRouter key if needed
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || process.env.OVERMIND_EMBEDDING_KEY,
      // Map NVIDIA NIM key
      NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || process.env.NVAPI_KEY,
      NVIDIA_API_BASE: process.env.NVIDIA_API_BASE || 'https://integrate.api.nvidia.com/v1',
      ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
    };
    const debugLogs: string[] = [];

    // --- Isolation / Settings / Prompt ---
    const overmindHermesPath = path.resolve(process.cwd(), '.overmind', 'hermes', agentName ? `agent_${agentName}` : 'central');
    const overmindHermesSubPath = path.join(overmindHermesPath, '.hermes');
    
    if (!fs.existsSync(overmindHermesSubPath)) {
      fs.mkdirSync(overmindHermesSubPath, { recursive: true });
    }

    // On définit l'environnement pour Hermes
    // IMPORTANT: HERMES_HOME doit pointer vers le dossier contenant config.yaml
    agentCustomEnv.HERMES_HOME = overmindHermesSubPath;
    
    if (process.platform === 'win32') {
      agentCustomEnv.USERPROFILE = overmindHermesPath;
    } else {
      agentCustomEnv.HOME = overmindHermesPath;
    }

    let systemPrompt = '';
    if (agentName) {
      try {
        const settingsDir = path.dirname(CONFIG.CLAUDE.PATHS.SETTINGS);
        const agentSettingsPath = resolveConfigPath(
          path.join(settingsDir, `settings_${agentName}.json`),
          options.configPath,
        );

        if (!fs.existsSync(agentSettingsPath)) {
          // Lister les agents disponibles pour aider au debugging
          let availableAgents: string[] = [];
          try {
            const files = fs.readdirSync(settingsDir);
            availableAgents = files
              .filter((f) => f.startsWith('settings_') && f.endsWith('.json'))
              .map((f) => f.replace('settings_', '').replace('.json', ''));
          } catch (e) {
            console.error(`[NousHermesRunner] ⚠️ Error reading settings directory: ${e}`);
          }

          return {
            result: '',
            error: `INVALID_AGENT: Agent Hermes "${agentName}" non trouvé.
              Veuillez utiliser 'create_agent' au préalable.
              Fichier attendu: ${agentSettingsPath}
              ${availableAgents.length > 0 ? `Agents disponibles: ${availableAgents.join(', ')}` : 'Aucun agent disponible'}
            `
              .replace(/\s+/g, ' ')
              .trim(),
          };
        }

        const settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
        if (!options.model && settings.model) {
          options.model = settings.model;
        }
        if (!options.model && settings.env?.ANTHROPIC_MODEL) {
          options.model = settings.env.ANTHROPIC_MODEL;
        }
        if (settings.env) {
          // Fusion intelligente : préserver les clés critiques (API keys)
          const criticalKeys = [
            'OPENROUTER_API_KEY',
            'NVIDIA_API_KEY',
            'NVIDIA_API_BASE',
            'OVERMIND_EMBEDDING_KEY',
            'OPENAI_API_KEY',
            'OPENAI_API_BASE',
            'OPENAI_BASE_URL',
            'MISTRAL_API_KEY',
            'MISTRAL_API_KEY_2',
            'MISTRAL_API_KEY_3',
            'MISTRAL_API_KEY_4',
          ];
          const envCopy = { ...settings.env };

          // --- ENV VARIABLE SUBSTITUTION ($VAR_NAME) ---
          for (const key in envCopy) {
            const val = envCopy[key];
            if (typeof val === 'string' && val.startsWith('$')) {
              const envVarName = val.substring(1);
              const resolvedVal = agentCustomEnv[envVarName] || process.env[envVarName];
              if (resolvedVal) {
                if (!silent) console.error(`[NousHermesRunner] 🔄 Substituted ${key} with ${resolvedVal.substring(0, 4)}...`);
                debugLogs.push(`🔄 Substituted ${key} with ${resolvedVal.substring(0, 4)}...`);
                envCopy[key] = resolvedVal;
              }
            }
          }

          for (const key of criticalKeys) {
            if (agentCustomEnv[key] && !envCopy[key]) {
              envCopy[key] = agentCustomEnv[key];
            }
          }
          Object.assign(agentCustomEnv, envCopy);
        }

        // --- Load System Prompt (agents/agentName.md) ---
        const agentPromptPath = resolveConfigPath(
          path.join(path.dirname(settingsDir), 'agents', `${agentName}.md`),
          options.configPath,
        );

        if (fs.existsSync(agentPromptPath)) {
          systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
        }

        // --- MCP Config Translation (JSON -> YAML for Hermes) ---
        const agentMcpPath = resolveConfigPath(
          path.join(path.dirname(settingsDir), `.mcp.${agentName}.json`),
          options.configPath,
        );

        if (fs.existsSync(agentMcpPath)) {
          try {
            const mcpConfig = JSON.parse(fs.readFileSync(agentMcpPath, 'utf8'));
            const hermesConfigDir = overmindHermesSubPath;
            if (!fs.existsSync(hermesConfigDir)) fs.mkdirSync(hermesConfigDir, { recursive: true });

            const mcpJsonPath = path.join(hermesConfigDir, 'mcp.json');
            const configYamlPath = path.join(hermesConfigDir, 'config.yaml');
            
            // Helper pour convertir le format MCP JSON vers le format mcp.json Hermes (identique à Claude Desktop)
            fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf8');
            
            // Generer aussi config.yaml (format snake_case attendu par Hermes)
            let yamlContent = 'mcp_servers:\n';
            for (const [name, server] of Object.entries(mcpConfig.mcpServers || {})) {
              const s = server as Record<string, unknown>;
              yamlContent += `  ${name}:\n`;
              if (s.command) yamlContent += `    command: "${s.command}"\n`;
              if (s.args && Array.isArray(s.args)) {
                yamlContent += `    args:\n`;
                for (const arg of s.args) {
                  yamlContent += `      - "${String(arg).replace(/"/g, '\\"')}"\n`;
                }
              }
              if (s.env && typeof s.env === 'object') {
                yamlContent += `    env:\n`;
                for (const [k, v] of Object.entries(s.env)) {
                  yamlContent += `      ${k}: "${String(v).replace(/"/g, '\\"')}"\n`;
                }
              }
              if (s.url) yamlContent += `    url: "${s.url}"\n`;
            }
            fs.writeFileSync(configYamlPath, yamlContent, 'utf8');

            if (!silent) console.error(`[NousHermesRunner] 🛠️  Hermes configs (mcp.json & config.yaml) generated in ${hermesConfigDir}`);
          } catch (err) {
            console.error(`[NousHermesRunner] ❌ Error translating MCP config: ${err}`);
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message?.includes('INVALID_AGENT')) throw e;
        console.error(`[NousHermesRunner] ⚠️ Error processing agent settings: ${e}`);
      }
    }

    // --- CLI Arguments & Prompt Handling ---
    const finalPrompt = systemPrompt ? `${systemPrompt}\n\n[USER QUERY]:\n${prompt}` : prompt;

    // Nettoyer les sauts de ligne pour l'argument CLI (-q ne supporte pas les \n)
    const cliPrompt = finalPrompt.replace(/\n+/g, ' ').trim();

    // Check command line length (Windows limit 8191)
    if (cliPrompt.length > 7000) {
      console.warn(`[NousHermesRunner] ⚠️  Prompt is very long (${cliPrompt.length} chars). This might fail on Windows.`);
    }

    const cleanArgs = ['chat', '-q', cliPrompt, '--source', 'tool', '-Q', '-t', 'all,mcp-overmind'];
    if (!silent) cleanArgs.push('-v');

    // --- Model & Provider selection ---
    const DEFAULT_MODEL = 'tencent/hy3-preview:free'; // Modèle OpenRouter gratuit
    const model = options.model || DEFAULT_MODEL;

    const isNvidiaModel = model.includes('deepseek') || model.includes('nvidia');
    const hasNvidiaKey = !!(agentCustomEnv.NVIDIA_API_KEY || agentCustomEnv.NVAPI_KEY);

    const isOpenAIModel = model.includes('gpt') || model.includes('o1') || model.includes('o3');
    const hasOpenAIKey = !!agentCustomEnv.OPENAI_API_KEY;

    const isMistralModel = model.includes('mistral') || model.includes('codestral') || model.includes('devstral');
    const hasMistralKey = !!agentCustomEnv.MISTRAL_API_KEY;

    cleanArgs.push('--model', model);

    if (isOpenAIModel && hasOpenAIKey) {
      if (!silent) console.error(`[NousHermesRunner] 🤖 Using OpenAI for ${model}`);
      cleanArgs.push('--provider', 'openai');
      // Nettoyage des clés conflictuelles
      delete agentCustomEnv.OPENROUTER_API_KEY;
      delete agentCustomEnv.NVIDIA_API_KEY;
      delete agentCustomEnv.NVAPI_KEY;

      // Map OPENAI_BASE_URL if present to OPENAI_API_BASE if needed by some tools
      if (agentCustomEnv.OPENAI_BASE_URL && !agentCustomEnv.OPENAI_API_BASE) {
        agentCustomEnv.OPENAI_API_BASE = agentCustomEnv.OPENAI_BASE_URL;
      }
    } else if (isMistralModel && hasMistralKey) {
      if (!silent) console.error(`[NousHermesRunner] 🌪️ Using Mistral for ${model}`);
      debugLogs.push(`🌪️ Using Mistral provider for ${model}`);
      cleanArgs.push('--provider', 'mistral');
      // Nettoyage des clés conflictuelles
      delete agentCustomEnv.OPENROUTER_API_KEY;
      delete agentCustomEnv.NVIDIA_API_KEY;
      delete agentCustomEnv.NVAPI_KEY;
      delete agentCustomEnv.OPENAI_API_KEY;
    } else if (isNvidiaModel && hasNvidiaKey) {
      if (!silent) console.error(`[NousHermesRunner] 🎯 Using NVIDIA NIM for ${model}`);
      debugLogs.push(`🎯 Using NVIDIA NIM for ${model}`);
      cleanArgs.push('--provider', 'nvidia');
    } else {
      // Fallback OpenRouter pour tout le reste ou si clé NIM manquante
      if (!silent) console.error(`[NousHermesRunner] 🌐 Using OpenRouter for ${model}`);
      debugLogs.push(`🌐 Using OpenRouter for ${model} (isMistral: ${isMistralModel}, hasKey: ${hasMistralKey})`);
      cleanArgs.push('--provider', 'openrouter');
    }

    // --- OS Specific Spawn ---
    const spawnCommand = 'hermes';

    if (!silent) {
      console.error(
        `[NousHermesRunner] 🚀 Starting Hermes Agent: ${spawnCommand} ${cleanArgs.join(' ')}`,
      );
    }

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (value: RunAgentResult) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      const child: ChildProcess = spawn(spawnCommand, cleanArgs, {
        cwd: options.cwd || process.cwd(),
        shell: true, // TRUE: permet de résoudre via PATH et gère les wrappers Python/Scripts sur Windows
        windowsHide: true,
        env: agentCustomEnv as NodeJS.ProcessEnv,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        stdout += chunk;
        if (!silent) {
          process.stderr.write(`[Hermes] ${chunk}`);
        }
      });

      child.stderr?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        stderr += chunk;
        if (!silent) {
          process.stderr.write(`[Hermes:ERR] ${chunk}`);
        }
      });

      const timeout = setTimeout(() => {
        child.kill();
        // Fallback to SIGKILL after 5 seconds if process still running
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
        safeResolve({
          result: stdout.trim(),
          error: 'TIMEOUT',
          rawOutput: stdout + '\n\n' + stderr,
        });
      }, this.timeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);

        if (code !== 0 && !stdout) {
          return safeResolve({
            result: '',
            error: `EXIT_CODE_${code}`,
            rawOutput: stderr || stdout,
          });
        }

        safeResolve({
          result: stdout.trim(),
          sessionId: sessionId,
          rawOutput: stdout,
        });
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeout);
        safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
      });

      if (child.stdin) {
        child.stdin.end();
      }
    });
  }
}
