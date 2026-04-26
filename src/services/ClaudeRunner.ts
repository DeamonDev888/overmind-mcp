import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
}

export class ClaudeRunner {
  private config: typeof CONFIG.CLAUDE;
  private timeoutMs: number;

  constructor() {
    this.config = CONFIG.CLAUDE;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000;
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume } = options;
    let { sessionId } = options;
    const { CORE, PERMISSIONS, PATHS } = this.config;
    const agentCustomEnv: Record<string, string> = {};

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath);
      if (lastId) {
        sessionId = lastId;
      }
    }

    let settingsPath = resolveConfigPath(PATHS.SETTINGS, options.configPath);

    if (agentName) {
      const settingsDir = path.dirname(PATHS.SETTINGS);
      const specificSettingsPath = resolveConfigPath(
        path.join(settingsDir, `settings_${agentName}.json`),
        options.configPath,
      );

      if (!fs.existsSync(specificSettingsPath)) {
        return {
          result: '',
          error: `INVALID_AGENT: Agent "${agentName}" non trouvé.`,
        };
      }
      settingsPath = specificSettingsPath;
    }

    let mcpPath = resolveConfigPath(PATHS.MCP, options.configPath);
    let tmpMcpPathToDelete: string | null = null;
    let customTimeoutMs = this.timeoutMs;

    if (agentName) {
      try {
        const agentSettingsPath = resolveConfigPath(
          path.join(path.dirname(PATHS.SETTINGS), `settings_${agentName}.json`),
          options.configPath,
        );
        if (fs.existsSync(agentSettingsPath)) {
          const settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));

          if (settings.env) {
            Object.assign(agentCustomEnv, settings.env);
            if (settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS) {
              const timeoutValue = settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS;
              customTimeoutMs = parseInt(timeoutValue, 10) || customTimeoutMs;
            }
          }

          const agentMcpPath = resolveConfigPath(
            path.join(path.dirname(PATHS.SETTINGS), `.mcp.${agentName}.json`),
          );

          if (fs.existsSync(agentMcpPath)) {
            mcpPath = agentMcpPath;
          } else if (
            settings.enableAllProjectMcpServers === false &&
            Array.isArray(settings.enabledMcpjsonServers)
          ) {
            if (fs.existsSync(mcpPath)) {
              const fullMcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
              const filteredMcp: { mcpServers: Record<string, unknown> } = { mcpServers: {} };

              for (const serverName of settings.enabledMcpjsonServers) {
                if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
                  filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
                }
              }

              const tmpMcpPath = path.join(
                path.dirname(agentSettingsPath),
                `mcp_${agentName}_tmp.json`,
              );
              fs.writeFileSync(tmpMcpPath, JSON.stringify(filteredMcp, null, 2));
              mcpPath = tmpMcpPath;
              tmpMcpPathToDelete = tmpMcpPath;
            }
          }
        }
      } catch (e) {
        console.error(`[ClaudeRunner] ⚠️ Error processing agent settings: ${e}`);
      }
    }

    const argsSpawn: string[] = [];
    if (CORE) argsSpawn.push(...CORE.split(' ').filter(Boolean));
    if (PERMISSIONS) argsSpawn.push(...PERMISSIONS.split(' ').filter(Boolean));

    argsSpawn.push('--settings', settingsPath);
    argsSpawn.push('--mcp-config', mcpPath);
    argsSpawn.push('--output-format', 'json');

    if (sessionId) argsSpawn.push('--resume', sessionId);

    if (agentCustomEnv.ANTHROPIC_MODEL) {
      argsSpawn.push('--model', agentCustomEnv.ANTHROPIC_MODEL);
    }
    if (agentName) argsSpawn.push('--name', agentName);

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (value: RunAgentResult) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      const cleanupTmpFiles = () => {
        if (tmpMcpPathToDelete && fs.existsSync(tmpMcpPathToDelete)) {
          try { 
            fs.unlinkSync(tmpMcpPathToDelete); 
          } catch {
            // Ignored
          }
        }
      };

      let command = 'claude';
      let spawnArgs: string[] = [];

      if (process.platform === 'win32') {
        command = 'cmd.exe';
        spawnArgs = ['/c', 'claude', ...argsSpawn, '-p'];
      } else {
        spawnArgs = [...argsSpawn, '-p'];
      }

      const child: ChildProcess = spawn(command, spawnArgs, {
        cwd: options.cwd || process.cwd(),
        windowsHide: true,
        env: { ...process.env, ...agentCustomEnv },
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stdout += chunk;
          if (agentName && !options.silent) process.stderr.write(`[ClaudeRunner:${agentName}] ${chunk}`);
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stderr += chunk;
          if (agentName && !options.silent) process.stderr.write(`[ClaudeRunner:${agentName}:ERR] ${chunk}`);
        });
      }

      if (child.stdin) {
        child.stdin.write(prompt);
        child.stdin.end();
      }

      let killTimer: NodeJS.Timeout | null = null;
      const timeout = setTimeout(() => {
        child.kill();
        killTimer = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
        cleanupTmpFiles();
        safeResolve({ result: '', error: 'TIMEOUT', rawOutput: stdout + stderr });
      }, customTimeoutMs);

      child.on('error', (err: Error) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        cleanupTmpFiles();
        safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
      });

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        cleanupTmpFiles();

        const fullRaw = stdout + (stderr ? `\n\n--- STDERR ---\n${stderr}` : '');

        try {
          let jsonEnvelope: Record<string, unknown> | null = null;
          const trimmedStdout = stdout.trim();

          try {
            jsonEnvelope = JSON.parse(trimmedStdout);
          } catch {
            const lastBrace = trimmedStdout.lastIndexOf('}');
            const firstBrace = trimmedStdout.lastIndexOf('{', lastBrace);
            if (firstBrace !== -1 && lastBrace !== -1) {
              try {
                jsonEnvelope = JSON.parse(trimmedStdout.substring(firstBrace, lastBrace + 1));
              } catch {
                // Ignored
              }
            }
          }

          if (jsonEnvelope) {
            let foundSessionId = sessionId;
            if (jsonEnvelope.session_id && agentName) {
              foundSessionId = jsonEnvelope.session_id as string;
              await saveSessionId(agentName, jsonEnvelope.session_id as string, options.configPath);
            }

            return safeResolve({
              result: (jsonEnvelope.reply as string) || (jsonEnvelope.result as string) || stdout.trim(),
              sessionId: foundSessionId,
              rawOutput: stdout,
            });
          }

          if (code === 0) {
            return safeResolve({
              result: stdout.trim(),
              sessionId,
              rawOutput: stdout,
            });
          }

          safeResolve({
            result: '',
            error: code !== 0 ? `EXIT_CODE_${code}` : 'JSON_PARSE_ERROR',
            rawOutput: fullRaw,
          });
        } catch (error) {
          safeResolve({
            result: '',
            error: `INTERNAL_ERROR: ${error instanceof Error ? error.message : String(error)}`,
            rawOutput: fullRaw,
          });
        }
      });
    });
  }
}
