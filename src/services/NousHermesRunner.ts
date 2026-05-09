import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { resolveKiloModel } from '../lib/modelMapping.js';
import { withSpan } from '../lib/telemetry.js';
import pino from 'pino';

const execAsync = promisify(exec);

const logger = pino({ name: 'NousHermesRunner' });

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
  model?: string; // resolved real model ID
  nickname?: string; // original value from config (if different)
}

/**
 * Find hermes binary across platforms (Windows, Linux, macOS)
 * Priority: HERMES_BIN_PATH env > PATH > platform-specific paths > pip show
 */
async function findHermesBinary(): Promise<string> {
  const isWin = process.platform === 'win32';

  // 1. Check environment variable first (allows users to override)
  if (process.env.HERMES_BIN_PATH) {
    if (fs.existsSync(process.env.HERMES_BIN_PATH)) {
      logger.info({ path: process.env.HERMES_BIN_PATH }, 'Using HERMES_BIN_PATH');
      return process.env.HERMES_BIN_PATH;
    }
  }

  // 2. Try to find via PATH
  try {
    const command = isWin ? 'where hermes' : 'which hermes';
    const { stdout } = await execAsync(command);
    const hermesPath = stdout.trim().split('\n')[0];
    if (hermesPath && fs.existsSync(hermesPath)) {
      logger.info({ path: hermesPath }, 'Found hermes in PATH');
      return hermesPath;
    }
  } catch {
    // Not found in PATH
  }

  // 3. Platform-specific paths
  const platformPaths = isWin
    ? [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts', 'hermes.exe'),
        path.join(process.env.APPDATA || '', 'Python', 'Python312', 'Scripts', 'hermes.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'Scripts', 'hermes.exe'),
        path.join(process.env.APPDATA || '', 'Python', 'Python311', 'Scripts', 'hermes.exe'),
        'C:\\Python312\\Scripts\\hermes.exe',
        'C:\\Python311\\Scripts\\hermes.exe',
        'C:\\Program Files\\Hermes\\hermes.exe',
      ]
    : [
        path.join(process.env.HOME || '', '.local', 'bin', 'hermes'),
        path.join(process.env.HOME || '', 'miniconda3', 'bin', 'hermes'),
        path.join(process.env.HOME || '', 'anaconda3', 'bin', 'hermes'),
        '/usr/local/bin/hermes',
        '/usr/bin/hermes',
        '/opt/homebrew/bin/hermes',
      ];

  for (const p of platformPaths) {
    if (fs.existsSync(p)) {
      logger.info({ path: p }, 'Found hermes at platform path');
      return p;
    }
  }

  // 4. Try pip show to find installation
  try {
    const { stdout } = await execAsync('pip show hermes-agent 2>/dev/null || pip3 show hermes-agent');
    const match = stdout.match(/Location:\s*(.+)/);
    if (match) {
      const sitePackages = match[1].trim();
      const hermesPath = isWin
        ? path.join(sitePackages, 'Scripts', 'hermes.exe')
        : path.join(sitePackages, 'bin', 'hermes');
      if (fs.existsSync(hermesPath)) {
        logger.info({ path: hermesPath }, 'Found hermes via pip show');
        return hermesPath;
      }
    }
  } catch {
    // pip show failed
  }

  // 5. Fallback to 'hermes' and let spawn fail with proper error
  logger.warn('hermes binary not found, using "hermes" command');
  return 'hermes';
}

export class NousHermesRunner {
  private timeoutMs: number;
  private tempFiles: string[] = [];
  private MAX_BUF = 10 * 1024 * 1024; // 10MB buffer limit

  constructor() {
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 min default
  }

  cleanupTempFiles(): void {
    for (const tempFile of this.tempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          logger.debug({ tempFile }, 'Cleaned up temp file');
        }
      } catch (err) {
        logger.warn({ tempFile, error: err }, 'Failed to cleanup temp file');
      }
    }
    this.tempFiles = [];
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    return runAgentWrapper.call(this, options);
  }

  async runAgentInternal(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume, silent } = options;
    let { sessionId } = options;

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath, 'hermes');
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

    // --- Isolation / Settings / Prompt ---
    const overmindHermesPath = path.resolve(
      process.cwd(),
      '.overmind',
      'hermes',
      agentName ? `agent_${agentName}` : 'central',
    );
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
            logger.warn({ settingsDir, error: e }, 'Error reading settings directory');
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
            'MISTRAL_API_KEY_5',
            'MISTRAL_API_KEY_6',
            'MISTRAL_API_KEY_7',
          ];
          let envCopy = { ...settings.env };

          // --- ENV VARIABLE SUBSTITUTION ($VAR_NAME) ---
          envCopy = interpolateEnvVars(envCopy);

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

            if (!silent)
              console.error(
                `[NousHermesRunner] 🛠️  Hermes configs (mcp.json & config.yaml) generated in ${hermesConfigDir}`,
              );
          } catch (err) {
            logger.error({ error: err }, 'Error translating MCP config');
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message?.includes('INVALID_AGENT')) throw e;
        logger.warn({ agentName, error: e }, 'Error processing agent settings');
      }
    }

    // --- CLI Arguments & Prompt Handling ---
    const finalPrompt = systemPrompt ? `${systemPrompt}\n\n[USER QUERY]:\n${prompt}` : prompt;

    // Nettoyer les sauts de ligne pour l'argument CLI (-q ne supporte pas les \n)
    const cliPrompt = finalPrompt.replace(/\n+/g, ' ').trim();

    // Check command line length (Windows limit 8191)
    if (cliPrompt.length > 7000) {
      console.warn(
        `[NousHermesRunner] ⚠️  Prompt is very long (${cliPrompt.length} chars). This might fail on Windows.`,
      );
    }

    // En version 0.11.0, on simplifie pour éviter les erreurs d'arguments
    const cleanArgs = ['chat', '-q', cliPrompt, '--source', 'tool', '-Q'];
    if (!silent) cleanArgs.push('-v');

    // --- Model & Provider selection ---
    const DEFAULT_MODEL = 'tencent/hy3-preview:free'; // Modèle OpenRouter gratuit
    const originalModel = options.model || DEFAULT_MODEL;
    const model = resolveKiloModel(originalModel);

    const isNvidiaModel = model.includes('deepseek') || model.includes('nvidia');
    const hasNvidiaKey = !!(agentCustomEnv.NVIDIA_API_KEY || agentCustomEnv.NVAPI_KEY);

    const lowModel = model.toLowerCase();
    const isOpenAIModel =
      lowModel.includes('gpt') ||
      lowModel.includes('o1') ||
      lowModel.includes('o3') ||
      lowModel.includes('minimax') ||
      lowModel.includes('glm');
    const hasOpenAIKey = !!agentCustomEnv.OPENAI_API_KEY;

    const isMistralModel =
      model.includes('mistral') || model.includes('codestral') || model.includes('devstral');
    const hasMistralKey = !!agentCustomEnv.MISTRAL_API_KEY;

    cleanArgs.push('--model', model);

    if (isOpenAIModel && hasOpenAIKey) {
      logger.info({ model, provider: 'openai' }, 'Using OpenAI provider');
      cleanArgs.push('--provider', 'openai');
      // Nettoyage des clés conflictuelles
      delete agentCustomEnv.OPENROUTER_API_KEY;
      delete agentCustomEnv.NVIDIA_API_KEY;
      delete agentCustomEnv.NVAPI_KEY;
    } else if (isMistralModel && hasMistralKey) {
      logger.info({ model, provider: 'mistral' }, 'Using Mistral provider');
      cleanArgs.push('--provider', 'mistral');
      // Nettoyage des clés conflictuelles
      delete agentCustomEnv.OPENROUTER_API_KEY;
      delete agentCustomEnv.NVIDIA_API_KEY;
      delete agentCustomEnv.NVAPI_KEY;
      delete agentCustomEnv.OPENAI_API_KEY;
    } else if (isNvidiaModel && hasNvidiaKey) {
      logger.info({ model, provider: 'nvidia' }, 'Using NVIDIA NIM provider');
      cleanArgs.push('--provider', 'nvidia');
    } else {
      // Fallback OpenRouter pour tout le reste ou si clé NIM manquante
      logger.info({ model, provider: 'openrouter' }, 'Using OpenRouter provider');
      cleanArgs.push('--provider', 'openrouter');
    }

    // --- Find Hermes Binary (cross-platform) ---
    const spawnCommand = await findHermesBinary();

    if (!silent) {
      logger.info({ command: spawnCommand, args: cleanArgs }, 'Starting Hermes Agent');
    }

    // Track temp files for MCP config
    const mcpJsonPath = path.join(overmindHermesSubPath, 'mcp.json');
    const configYamlPath = path.join(overmindHermesSubPath, 'config.yaml');
    this.tempFiles.push(mcpJsonPath, configYamlPath);

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
        if (stdout.length + chunk.length > this.MAX_BUF) {
          stdout = stdout.slice(-this.MAX_BUF);
        }
        stdout += chunk;
        if (!silent) {
          process.stderr.write(`[Hermes] ${chunk}`);
        }
      });

      child.stderr?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        if (stderr.length + chunk.length > this.MAX_BUF) {
          stderr = stderr.slice(-this.MAX_BUF);
        }
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
          model,
          nickname: originalModel !== model ? originalModel : undefined,
        });
      }, this.timeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);

        if (code !== 0 && !stdout) {
          return safeResolve({
            result: '',
            error: `EXIT_CODE_${code}`,
            rawOutput: stderr || stdout,
            model,
            nickname: originalModel !== model ? originalModel : undefined,
          });
        }

        safeResolve({
          result: stdout.trim(),
          sessionId: sessionId,
          rawOutput: stdout,
          model,
          nickname: originalModel !== model ? originalModel : undefined,
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

/**
 * Run agent with proper cleanup and telemetry
 */
async function runAgentWrapper(
  this: NousHermesRunner,
  options: RunAgentOptions,
): Promise<RunAgentResult> {
  try {
    const result = await withSpan('hermes.runAgent', async (span) => {
      span.setAttribute('agentName', options.agentName || '');
      span.setAttribute('model', options.model || '');
      span.setAttribute('runner', 'hermes');
      return await this.runAgentInternal(options);
    }, {
      agentName: options.agentName || '',
      model: options.model || '',
      runner: 'hermes',
    });

    // Cleanup on success
    this.cleanupTempFiles();

    // Save session if needed
    if (options.agentName && result.sessionId) {
      await saveSessionId(
        options.agentName,
        result.sessionId,
        options.configPath,
        'hermes',
      );
    }

    return result;
  } catch (error) {
    // Cleanup on error
    this.cleanupTempFiles();

    logger.error({
      error: error instanceof Error ? error.message : String(error),
      agentName: options.agentName,
    }, 'Hermes runner failed');

    throw error;
  }
}
