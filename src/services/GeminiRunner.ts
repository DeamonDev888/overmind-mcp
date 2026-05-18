import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { withSpan, type Span } from '../lib/telemetry.js';
import pino from 'pino';
import {
  registerProcess,
  linkSessionToPid,
  appendOutput,
  updateProcessStatus,
  killProcessTree,
} from '../lib/processRegistry.js';

const logger = pino({ name: 'GeminiRunner' });

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

export class GeminiRunner {
  private config: typeof CONFIG.CLAUDE;
  private timeoutMs: number;
  private tempFiles: string[] = []; // Track temp files for cleanup

  constructor() {
    this.config = CONFIG.CLAUDE;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 min default
  }

  private cleanupTempFiles(): void {
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
    const { prompt, agentName, autoResume } = options;
    let { sessionId } = options;
    const { PATHS } = this.config;

    // Initial custom env
    const agentCustomEnv: Record<string, string | undefined> = {
      ...process.env,
      ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
    };

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath, 'gemini');
      if (lastId) {
        sessionId = lastId;
      }
    }

    // --- System Prompt Loading ---
    let finalPrompt = prompt;
    if (agentName) {
      try {
        const settingsDir = path.dirname(PATHS.SETTINGS);
        let agentPromptPath = resolveConfigPath(
          path.join(settingsDir, 'agents', `${agentName}.md`),
          options.configPath,
        );

        if (!fs.existsSync(agentPromptPath)) {
          agentPromptPath = resolveConfigPath(
            path.join(path.dirname(settingsDir), 'agents', `${agentName}.md`),
            options.configPath,
          );
        }
        if (fs.existsSync(agentPromptPath)) {
          const systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
          finalPrompt = `${systemPrompt}\n\n[USER QUERY]:\n${prompt}`;
        }
      } catch (err) {
        logger.warn({ agentName, error: err }, 'Failed to load agent prompt, using raw prompt');
      }
    }

    // --- OAuth Sync & Centralization (Recopie) ---
    const userHome = process.env.USERPROFILE || process.env.HOME || '';
    const globalGeminiPath = path.join(userHome, '.gemini');

    // Dossier centralisé Overmind explicite
    const overmindGeminiPath = path.resolve(
      process.cwd(),
      '.overmind',
      'gemini',
      agentName ? `agent_${agentName}` : 'central',
    );
    const overmindGeminiSubPath = path.join(overmindGeminiPath, '.gemini');

    // S'assurer que les dossiers existent
    if (!fs.existsSync(overmindGeminiSubPath)) {
      fs.mkdirSync(overmindGeminiSubPath, { recursive: true });
    }

    const filesToSync = [
      'settings.json',
      'oauth_creds.json',
      'google_accounts.json',
      'projects.json',
      'state.json',
    ];

    for (const file of filesToSync) {
      const globalFile = path.join(globalGeminiPath, file);
      const localFile = path.join(overmindGeminiSubPath, file);

      if (fs.existsSync(globalFile)) {
        try {
          // Validate file integrity before copying
          const globalContent = fs.readFileSync(globalFile);
          const globalHash = createHash('sha256').update(globalContent).digest('hex');

          // Check if local file exists and has same content
          let needsCopy = true;
          if (fs.existsSync(localFile)) {
            const localContent = fs.readFileSync(localFile);
            const localHash = createHash('sha256').update(localContent).digest('hex');
            needsCopy = globalHash !== localHash;
          }

          if (needsCopy) {
            fs.writeFileSync(localFile, globalContent);
            this.tempFiles.push(localFile); // Track for cleanup
            logger.info({ file, from: globalFile, to: localFile }, 'OAuth file synchronized');
            if (!options.silent) {
              process.stderr.write(`[GeminiRunner] OAuth synchronisé: ${file}\n`);
            }
          } else {
            logger.debug({ file }, 'OAuth file already up to date');
          }
        } catch (err) {
          logger.error({ file, error: err }, 'Failed to synchronize OAuth file');
          if (!options.silent) {
            process.stderr.write(`[GeminiRunner] Échec synchronisation ${file}: ${err}\n`);
          }
        }
      }
    }

    agentCustomEnv.GEMINI_CLI_HOME = overmindGeminiPath;

    // --- MCP Configuration & Settings Env ---
    const mcpPath = path.join(overmindGeminiPath, 'mcp.json');

    if (agentName) {
      const settingsDir = path.dirname(PATHS.SETTINGS);
      const agentSettingsPath = resolveConfigPath(
        path.join(settingsDir, `settings_${agentName}.json`),
        options.configPath,
      );

      if (fs.existsSync(agentSettingsPath)) {
        let settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));

        // --- New interpolation logic ---
        settings = interpolateEnvVars(settings);

        if (settings.env) {
          Object.assign(agentCustomEnv, settings.env);
        }

        const originalMcpPath = resolveConfigPath(PATHS.MCP, options.configPath);
        if (fs.existsSync(originalMcpPath)) {
          const fullMcp = JSON.parse(fs.readFileSync(originalMcpPath, 'utf8'));
          let mcpToUse = fullMcp;

          if (
            settings.enableAllProjectMcpServers === false &&
            Array.isArray(settings.enabledMcpjsonServers)
          ) {
            const filteredMcp: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
            for (const serverName of settings.enabledMcpjsonServers) {
              if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
                filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
              }
            }
            mcpToUse = filteredMcp;
          }

          fs.writeFileSync(mcpPath, JSON.stringify(mcpToUse, null, 2));
          this.tempFiles.push(mcpPath); // Track for cleanup
          logger.info({ mcpPath }, 'MCP configuration synchronized');
          if (!options.silent) {
            process.stderr.write(`[GeminiRunner] MCP synchronisé: ${mcpPath}\n`);
          }
        }
      }
    }

    // --- SPAWN ---
    const isWin = process.platform === 'win32';
    let command = isWin ? 'gemini.cmd' : 'gemini';
    const argsSpawn: string[] = [];

    // On Windows, calling gemini.cmd via shell spawn can split multiline prompts.
    // We bypass gemini.cmd by calling the underlying gemini.js directly with node.
    const userHomeNpm = path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'npm');
    const geminiJsPath = path.join(
      userHomeNpm,
      'node_modules',
      '@google',
      'gemini-cli',
      'bundle',
      'gemini.js',
    );

    let useNodeDirectly = false;
    if (isWin && fs.existsSync(geminiJsPath)) {
      command = 'node';
      argsSpawn.push(geminiJsPath);
      useNodeDirectly = true;
    }

    argsSpawn.push('--approval-mode', 'yolo');
    argsSpawn.push('--output-format', 'json');
    argsSpawn.push('--prompt', finalPrompt);

    if (sessionId) {
      argsSpawn.push('--resume', sessionId);
    } else if (autoResume) {
      argsSpawn.push('--resume', 'latest');
    }

    const runImpl = async (span: Span): Promise<RunAgentResult> => {
      span.setAttribute('agentName', agentName || '');
      span.setAttribute('runner', 'gemini');

      return new Promise((resolve) => {
        let resolved = false;
        const safeResolve = (value: RunAgentResult) => {
          if (!resolved) {
            resolved = true;
            resolve(value);
          }
        };

        const child: ChildProcess = spawn(command, argsSpawn, {
          cwd: options.cwd || process.cwd(),
          shell: useNodeDirectly ? false : isWin,
          windowsHide: true,
          env: agentCustomEnv as NodeJS.ProcessEnv,
        });

        // Register process immediately after spawn
        if (child.pid) {
          void registerProcess(child.pid, {
            agentName: agentName || '',
            runner: 'gemini',
            configPath: options.configPath,
          });
        }

        let stdout = '';
        let stderr = '';
        const MAX_BUF = 10 * 1024 * 1024;
        const cleanup = () => {
          child.stdout?.removeAllListeners();
          child.stderr?.removeAllListeners();
          child.removeAllListeners();
        };

        child.stdout?.on('data', (data) => {
          const d = data.toString();
          if (child.pid && d) {
            void appendOutput(child.pid, d, options.configPath);
          }
          if (stdout.length + d.length > MAX_BUF) stdout = stdout.slice(-MAX_BUF);
          else stdout += d;
        });
        child.stderr?.on('data', (data) => {
          const d = data.toString();
          if (child.pid && d) {
            void appendOutput(child.pid, d, options.configPath);
          }
          if (stderr.length + d.length > MAX_BUF) stderr = stderr.slice(-MAX_BUF);
          else stderr += d;
        });

        const timeout = setTimeout(async () => {
          // Use killProcessTree to prevent zombie processes on Windows
          if (child.pid) await killProcessTree(child.pid);
          else child.kill();
          await new Promise<void>((res) => setTimeout(res, 5000));
          if (!child.killed) {
            if (child.pid) await killProcessTree(child.pid);
            else child.kill('SIGKILL');
          }
          if (child.pid) {
            void updateProcessStatus(child.pid, 'failed', null, options.configPath);
          }
          cleanup();
          safeResolve({ result: '', error: 'TIMEOUT', rawOutput: stdout + stderr });
        }, this.timeoutMs);

        child.on('error', (err: Error) => {
          clearTimeout(timeout);
          safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
        });

        child.on('close', async (code: number | null) => {
          clearTimeout(timeout);
          cleanup();

          if (code !== 0 && !stdout) {
            return safeResolve({
              result: '',
              error: code === 41 ? '🔑 Erreur Auth/API Key (OAuth/GCloud)' : `EXIT_CODE_${code}`,
              rawOutput: stderr,
            });
          }

          try {
            let jsonOutput: Record<string, unknown> | null = null;
            const trimmedStdout = stdout.trim();

            try {
              jsonOutput = JSON.parse(trimmedStdout);
            } catch (_) {
              const lastBrace = trimmedStdout.lastIndexOf('}');
              const firstBrace = trimmedStdout.lastIndexOf('{', lastBrace);
              if (firstBrace !== -1 && lastBrace !== -1) {
                try {
                  jsonOutput = JSON.parse(trimmedStdout.substring(firstBrace, lastBrace + 1));
                } catch {
                  // Ignore parsing errors for partial extraction
                }
              }
            }

            if (jsonOutput) {
              const resultText =
                (jsonOutput.reply as string) || (jsonOutput.result as string) || stdout.trim();
              const newSessionId = (jsonOutput.session_id as string) || sessionId;

              if (newSessionId && agentName) {
                await saveSessionId(agentName, newSessionId, options.configPath, 'gemini');
                if (child.pid) {
                  void linkSessionToPid(newSessionId, child.pid, options.configPath);
                }
              }

              return safeResolve({
                result: resultText,
                sessionId: newSessionId,
                rawOutput: stdout,
              });
            }

            safeResolve({
              result: stdout.trim(),
              sessionId: sessionId,
              rawOutput: stdout,
            });
          } catch {
            safeResolve({
              result: stdout.trim(),
              sessionId: sessionId,
              rawOutput: stdout,
            });
          }
        });

        if (child.stdin) {
          child.stdin.end();
        }
      });
    };

    const result = await withSpan('gemini.runAgent', runImpl, {
      agentName: agentName || '',
      runner: 'gemini',
    });

    // Cleanup temp files after execution
    this.cleanupTempFiles();

    return result;
  }
}
