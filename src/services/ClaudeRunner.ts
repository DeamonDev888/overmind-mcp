import fs from 'fs';
import os from 'os';
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
  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, sessionId, autoResume } = options;
    const { CORE, PERMISSIONS, PATHS } = CONFIG.CLAUDE;
    const cwd = process.cwd();

    let mcpPath = resolveConfigPath(PATHS.MCP);
    let agentSettingsPath = resolveConfigPath(PATHS.SETTINGS);
    let finalSettingsPath = agentSettingsPath;
    let tmpMcpPathToDelete = '';

    const agentCustomEnv: Record<string, string> = {};
    let customTimeoutMs = CONFIG.TIMEOUT_MS;

    if (agentName) {
      const specificSettingsPath = resolveConfigPath(
        path.join(path.dirname(PATHS.SETTINGS), `settings_${agentName}.json`),
      );
      
      try {
        if (fs.existsSync(specificSettingsPath)) {
          const settings = JSON.parse(fs.readFileSync(specificSettingsPath, 'utf8'));
          agentSettingsPath = specificSettingsPath;
          
          if (settings.env) {
            Object.assign(agentCustomEnv, settings.env);
            if (!agentCustomEnv.ANTHROPIC_MODEL && (settings.env.ANTHROPIC_MODEL || settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL)) {
              agentCustomEnv.ANTHROPIC_MODEL = (settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL && settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL.includes('claude')) 
                ? settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL 
                : 'claude-3-5-sonnet-20241022';
            }

            if (settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS) {
              const timeoutValue = settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS;
              customTimeoutMs = parseInt(timeoutValue, 10) || customTimeoutMs;
            }
          }

          // Utiliser directement le fichier MCP spécifique de l'agent s'il existe
          const agentMcpPath = resolveConfigPath(
            path.join(path.dirname(PATHS.SETTINGS), `.mcp.${agentName}.json`),
          );

          if (fs.existsSync(agentMcpPath)) {
            // Utiliser le fichier MCP spécifique à l'agent directement
            mcpPath = agentMcpPath;
          } else if (
            settings.enableAllProjectMcpServers === false &&
            Array.isArray(settings.enabledMcpjsonServers)
          ) {
            // Fallback: utiliser le fichier MCP général avec filtrage
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

      // Utiliser directement le fichier settings original sans copie temporaire
      // Le modèle est passé via le flag --model qui est déjà configuré plus bas
      finalSettingsPath = agentSettingsPath;
    }

    const argsSpawn: string[] = [
      '--bare',
      '--no-session-persistence',
      '--tools', ''
    ];
    if (CORE) argsSpawn.push(...CORE.split(' ').filter(Boolean));
    if (PERMISSIONS) argsSpawn.push(...PERMISSIONS.split(' ').filter(Boolean));
    argsSpawn.push('--settings', finalSettingsPath);
    argsSpawn.push('--mcp-config', mcpPath);

    if (sessionId) {
      argsSpawn.push('--resume', sessionId);
    }

    // --- MODEL & NICKNAME FLAGS ---
    const modelToUse = agentCustomEnv.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
    argsSpawn.push('--model', modelToUse);
    
    if (agentCustomEnv.AGENT_NICKNAME) {
      argsSpawn.push('--name', agentCustomEnv.AGENT_NICKNAME);
    } else if (agentName) {
      argsSpawn.push('--name', agentName);
    }

    return new Promise((resolve) => {
      const cleanupTmpFiles = () => {
        if (tmpMcpPathToDelete && fs.existsSync(tmpMcpPathToDelete)) {
          try { fs.unlinkSync(tmpMcpPathToDelete); } catch (_e) { /* silent */ }
        }
      };

      const isWin = process.platform === 'win32';
      let command = 'claude';
      let spawnArgs: string[] = [];

      // Resolve Agent Prompt
      let agentPromptPath = '';
      if (agentName) {
        agentPromptPath = resolveConfigPath(
          path.join(path.dirname(PATHS.SETTINGS), 'agents', `${agentName}.md`),
        );
        if (!fs.existsSync(agentPromptPath)) {
          agentPromptPath = resolveConfigPath(
            path.join(path.dirname(path.dirname(PATHS.SETTINGS)), 'agents', `${agentName}.md`),
          );
        }
      }

      const isNarrator = agentName === 'sentinel_cortex' || (agentPromptPath && fs.existsSync(agentPromptPath));
      const spawnCwd = isNarrator ? os.tmpdir() : cwd;
      let finalPrompt = prompt;
      let systemArgs: string[] = [];

      if (agentPromptPath && fs.existsSync(agentPromptPath)) {
        const systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
        if (isNarrator) {
          systemArgs = ['--system-prompt', systemPrompt];
        } else {
          finalPrompt = `${systemPrompt}\n\n[USER QUERY]:\n${prompt}`;
        }
      }

      if (isWin) {
        command = 'C:\\Users\\Deamon\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
        spawnArgs = [...argsSpawn, ...systemArgs, '-p', finalPrompt];
      } else {
        command = 'claude';
        spawnArgs = [...argsSpawn, ...systemArgs, '-p', finalPrompt];
      }

      if (agentName) {
        const id = agentCustomEnv.AGENT_NICKNAME || agentName;
        process.stderr.write(`[ClaudeRunner] 🚀 Démarrage de l'agent ${id} on [${command}] (CWD: ${spawnCwd})...\n`);
      }

      const child: ChildProcess = spawn(command, spawnArgs, {
        cwd: spawnCwd,
        windowsHide: true,
        env: { ...process.env, ...agentCustomEnv },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stdout += chunk;
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stderr += chunk;
        });
      }

      const timeout = setTimeout(() => {
        child.kill();
        cleanupTmpFiles();
        resolve({ result: '', error: `TIMEOUT`, rawOutput: stdout + '\n\n' + stderr });
      }, customTimeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);
        cleanupTmpFiles();

        const fullRaw = stdout + (stderr ? `\n\n--- STDERR ---\n${stderr}` : '');
        let specificError: string | undefined;
        
        const lowRaw = fullRaw.toLowerCase();
        if (lowRaw.includes('api key') || lowRaw.includes('auth')) specificError = 'AUTH_ERROR';
        else if (lowRaw.includes('quota') || lowRaw.includes('exceeded')) specificError = 'QUOTA_ERROR';
        else if (lowRaw.includes('rate limit')) specificError = 'RATE_LIMIT';

        try {
          const jsonStartIndex = stdout.indexOf('{');
          const jsonLastIndex = stdout.lastIndexOf('}');
          
          if (jsonStartIndex < 0 || jsonLastIndex <= jsonStartIndex) {
            return resolve({
              result: stdout.trim() || '',
              error: specificError || (!stdout.trim() ? 'NO_OUTPUT' : undefined),
              rawOutput: fullRaw,
            });
          }

          const jsonStr = stdout.substring(jsonStartIndex, jsonLastIndex + 1);
          const response = JSON.parse(jsonStr);

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
            error: specificError || 'JSON_PARSE_ERROR',
            rawOutput: fullRaw,
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
