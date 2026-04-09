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
    const agentCustomEnv: Record<string, string> = {};

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

          if (settings.env) {
            // Mémoriser l'env configuré pour l'injection
            Object.assign(agentCustomEnv, settings.env);

            if (settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS) {
              const timeoutValue = settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS;
              customTimeoutMs = parseInt(timeoutValue, 10) || customTimeoutMs;
            }
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
    // DÉCISION IMPORTANTE: On n'ajoute pas de guillemets manuels ici, spawn s'en occupe
    argsSpawn.push('--settings', settingsPath);
    argsSpawn.push('--mcp-config', mcpPath);

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
      let spawnArgs: string[] = [];

      // Prepend persona if defined
      let finalPrompt = prompt;
      if (agentName) {
        let agentPromptPath = resolveConfigPath(
          path.join(path.dirname(PATHS.SETTINGS), 'agents', `${agentName}.md`),
        );
        if (!fs.existsSync(agentPromptPath)) {
          // Fallback: Check agents/ folder at the root level of settingsDir
          agentPromptPath = resolveConfigPath(
            path.join(path.dirname(path.dirname(PATHS.SETTINGS)), 'agents', `${agentName}.md`),
          );
        }

        if (fs.existsSync(agentPromptPath)) {
          const systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
          finalPrompt = `${systemPrompt}\n\n[USER QUERY]:\n${prompt}`;
        }
      }

      if (isWin) {
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
            '-p',
            finalPrompt,
          ];
        } else {
          command = 'cmd.exe';
          spawnArgs = ['/c', 'claude', ...argsSpawn, '-p', finalPrompt];
        }
      } else {
        spawnArgs = [...argsSpawn, '-p', finalPrompt];
      }

      if (agentName) {
        process.stderr.write(`[ClaudeRunner] 🚀 Démarrage de l'agent ${agentName}...\n`);
        // Debug: Log the prompt size
        process.stderr.write(`[ClaudeRunner] 📏 Prompt Size: ${finalPrompt.length} chars\n`);
      }

      const child: ChildProcess = spawn(command, spawnArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
        // shell: false explicitly (handled by command selection)
        windowsHide: true,
        env: {
          ...process.env,
          ...agentCustomEnv,
          // Compatibilité Anthropic/Z.ai pour Claude Code standard
          ...(agentCustomEnv.ANTHROPIC_AUTH_TOKEN && !agentCustomEnv.ANTHROPIC_API_KEY
            ? { ANTHROPIC_API_KEY: agentCustomEnv.ANTHROPIC_AUTH_TOKEN }
            : {}),
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

        const detectError = (text: string) => {
          const lower = text.toLowerCase();
          if (lower.includes('api key') || lower.includes('auth') || lower.includes('401')) {
            return '🔑 Erreur Auth/API Key (Clé invalide ou manquante)';
          }
          if (lower.includes('quota') || lower.includes('exceeded') || lower.includes('429')) {
            return '📊 Quota dépassé (API Key épuisée)';
          }
          if (lower.includes('rate limit')) {
            return '⏳ Rate limit atteint';
          }
          if (lower.includes('model') && lower.includes('404')) {
            return '🤖 Modèle introuvable';
          }
          return null;
        };

        if (code !== 0 && !stdout) {
          const specificError = detectError(stderr);
          return resolve({
            result: '',
            error: specificError || `EXIT_CODE_${code}`,
            rawOutput: stderr,
          });
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
          const specificError = detectError(stdout) || detectError(stderr);
          resolve({
            result: '',
            error: specificError || 'JSON_PARSE_ERROR',
            rawOutput: stdout,
          });
        }
      });

      child.on('error', (err: Error) => {
        cleanupTmpFiles();
        resolve({ result: '', error: err.message, rawOutput: '' });
      });
    });
  }
}
