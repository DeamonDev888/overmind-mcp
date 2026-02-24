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
    this.timeoutMs = CONFIG.TIMEOUT_MS || 30000;
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
    let customTimeoutMs = this.timeoutMs;

    // --- Isolation & MCP dédié par agent ---
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

          // Chercher d'abord le fichier MCP individuel pré-généré
          const agentMcpDir = path.dirname(agentSettingsPath);
          const agentMcpPath = path.join(agentMcpDir, `.mcp.${agentName}.json`);
          const agentMcpPathAlt = path.join(agentMcpDir, `mcp_${agentName}.json`);

          if (fs.existsSync(agentMcpPath)) {
            // Utiliser le fichier MCP individuel de l'agent
            mcpPath = agentMcpPath;
            console.log(`[ClaudeRunner] ✅ Using agent MCP file: ${agentMcpPath}`);
          } else if (fs.existsSync(agentMcpPathAlt)) {
            // Fallback: utiliser le nom sans point
            mcpPath = agentMcpPathAlt;
            console.log(`[ClaudeRunner] ✅ Using alt agent MCP file: ${agentMcpPathAlt}`);
          } else if (
            settings.enableAllProjectMcpServers === false &&
            Array.isArray(settings.enabledMcpjsonServers)
          ) {
            // Fallback: générer à la volée si le fichier n'existe pas
            if (fs.existsSync(mcpPath)) {
              const fullMcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
              const filteredMcp: { mcpServers: Record<string, unknown> } = { mcpServers: {} };

              for (const serverName of settings.enabledMcpjsonServers) {
                if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
                  filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
                }
              }

              const agentMcpPathAlt = path.join(agentMcpDir, `mcp_${agentName}.json`);
              fs.writeFileSync(agentMcpPathAlt, JSON.stringify(filteredMcp, null, 2));
              mcpPath = agentMcpPathAlt;
              console.log(`[ClaudeRunner] ⚠️ Generated MCP file on-the-fly: ${agentMcpPathAlt}`);
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
    argsSpawn.push('--mcp-config', `"${mcpPath.replace(/"/g, '\\"')}"`);

    // N'utiliser --resume QUE si sessionId est explicitement fourni par l'utilisateur
    // Ne PAS utiliser autoResume pour éviter les sessions expirées
    if (sessionId && !autoResume) {
      argsSpawn.push('--resume', sessionId);
    }

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const command = isWin ? `claude ${argsSpawn.join(' ')}` : 'claude';
      const spawnArgs = isWin ? [] : argsSpawn;

      const child: ChildProcess = spawn(command, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        shell: isWin,
      });

      let stdout = '';
      let stderr = '';
      const fullOutput: string[] = [];

      if (child.stdout) {
        child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      }
      if (child.stderr) {
        child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      }

      const timeout = setTimeout(() => {
        child.kill();
        resolve({ result: '', error: `TIMEOUT`, rawOutput: stdout });
      }, customTimeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);

        // DEBUG: Logger la sortie stderr pour voir l'erreur de Claude
        console.error('[ClaudeRunner] Claude EXIT CODE:', code);
        console.error('[ClaudeRunner] Claude stderr:', stderr);
        console.error('[ClaudeRunner] Claude stdout:', stdout);

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
        resolve({ result: '', error: err.message, rawOutput: '' });
      });

      if (child.stdin) {
        child.stdin.write(prompt);
        child.stdin.end();
      }
    });
  }
}
