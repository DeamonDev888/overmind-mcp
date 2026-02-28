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
    this.timeoutMs = CONFIG.TIMEOUT_MS || 120000;
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume } = options;
    let { sessionId } = options;
    const { CORE, PERMISSIONS, PATHS } = this.config;

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName);
      if (lastId) {
        sessionId = lastId;
      }
    }

    let settingsPath = resolveConfigPath(PATHS.SETTINGS);

    if (agentName) {
      const settingsDir = path.dirname(PATHS.SETTINGS);
      const specificSettingsPath = resolveConfigPath(
        path.join(settingsDir, `settings_${agentName}.json`),
      );

      if (!fs.existsSync(specificSettingsPath)) {
        return {
          result: '',
          error: `INVALID_AGENT`,
        };
      }
      settingsPath = specificSettingsPath;
    }

    const cwd = process.cwd();
    const relativeSettings = path.relative(cwd, settingsPath);
    if (!relativeSettings.startsWith('..') && !path.isAbsolute(relativeSettings)) {
      settingsPath = relativeSettings.startsWith('./') ? relativeSettings : `./${relativeSettings}`;
    }

    let mcpPath = resolveConfigPath(PATHS.MCP);
    let tmpMcpPathToDelete: string | null = null;
    let customTimeoutMs = this.timeoutMs;

    // --- Isolation ---
    if (agentName) {
      try {
        const agentSettingsPath = resolveConfigPath(
          path.join(path.dirname(PATHS.SETTINGS), `settings_${agentName}.json`),
        );
        if (fs.existsSync(agentSettingsPath)) {
          const settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));

          if (settings.env && settings.env.AGENT_TIMEOUT_MS) {
            customTimeoutMs = parseInt(settings.env.AGENT_TIMEOUT_MS, 10) || customTimeoutMs;
          }

          if (
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
      } catch (_e) {
        // Warning
      }
    }

    const relativeMcp = path.relative(cwd, mcpPath);
    if (!relativeMcp.startsWith('..') && !path.isAbsolute(relativeMcp)) {
      mcpPath = relativeMcp.startsWith('./') ? relativeMcp : `./${relativeMcp}`;
    }

    const argsSpawn: string[] = [];
    if (CORE) argsSpawn.push(...CORE.split(' ').filter(Boolean));
    if (PERMISSIONS) argsSpawn.push(...PERMISSIONS.split(' ').filter(Boolean));
    argsSpawn.push('--settings', `"${settingsPath}"`);
    argsSpawn.push('--mcp-config', `"${mcpPath}"`);

    if (sessionId) {
      argsSpawn.push('--resume', sessionId);
    }

    return new Promise((resolve) => {
      const cleanupTmpFiles = () => {
        if (tmpMcpPathToDelete && fs.existsSync(tmpMcpPathToDelete)) {
          try {
            fs.unlinkSync(tmpMcpPathToDelete);
          } catch (_e) {
            // Ignore unlink errors
          }
        }
      };

      const isWin = process.platform === 'win32';
      let command = 'claude';
      let spawnArgs = argsSpawn;

      if (isWin) {
        // Try to find the absolute path to avoid shell warnings/concatenation issues
        const claudePath = 'C:\\Users\\Deamon\\AppData\\Roaming\\npm\\claude.ps1';
        if (fs.existsSync(claudePath)) {
          command = 'powershell.exe';
          spawnArgs = [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            claudePath,
            ...argsSpawn,
          ];
        } else {
          // Fallback to shell string (still triggers warning but works)
          command = `claude ${argsSpawn.join(' ')}`;
          spawnArgs = [];
        }
      }

      if (agentName) {
        process.stderr.write(`[ClaudeRunner] 🚀 Démarrage de l'agent ${agentName}...\n`);
      }

      const child: ChildProcess = spawn(command, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        shell: isWin && command !== 'powershell.exe', // disable shell if we use absolute powershell.exe
        windowsHide: true,
        env: {
          ...process.env,
          ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
        },
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stdout += chunk;
          if (agentName) {
            process.stderr.write(`[ClaudeRunner:${agentName}] ${chunk}`);
          }
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stderr += chunk;
          if (agentName) {
            process.stderr.write(`[ClaudeRunner:${agentName}:ERR] ${chunk}`);
          }
        });
      }

      const timeout = setTimeout(() => {
        child.kill();
        cleanupTmpFiles();
        resolve({ result: '', error: `TIMEOUT`, rawOutput: stdout });
      }, customTimeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);
        cleanupTmpFiles();

        if (code !== 0 && !stdout) {
          return resolve({ result: '', error: `EXIT_CODE_${code}`, rawOutput: stderr });
        }

        try {
          let jsonStr = stdout.trim();
          const jsonStartIndex = jsonStr.indexOf('{');
          const jsonLastIndex = jsonStr.lastIndexOf('}');
          if (jsonStartIndex >= 0 && jsonLastIndex > jsonStartIndex) {
            jsonStr = jsonStr.substring(jsonStartIndex, jsonLastIndex + 1);
          }

          const response = JSON.parse(jsonStr || '{}');

          if (agentName && response.session_id) {
            await saveSessionId(agentName, response.session_id);
          }

          resolve({
            result: response.result || JSON.stringify(response),
            sessionId: response.session_id,
            rawOutput: stdout,
          });
        } catch (_error) {
          resolve({
            result: '',
            error: 'JSON_PARSE_ERROR',
            rawOutput: stdout,
          });
        }
      });

      child.on('error', (err: Error) => {
        cleanupTmpFiles();
        resolve({ result: '', error: err.message, rawOutput: '' });
      });

      if (child.stdin) {
        child.stdin.write(prompt);
        child.stdin.end();
      }
    });
  }
}
