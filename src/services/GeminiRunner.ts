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

  constructor() {
    this.config = CONFIG.CLAUDE;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 60000;
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
      const lastId = await getLastSessionId(agentName);
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
          options.configPath
        );
        
        if (!fs.existsSync(agentPromptPath)) {
          agentPromptPath = resolveConfigPath(
            path.join(path.dirname(settingsDir), 'agents', `${agentName}.md`),
            options.configPath
          );
        }

        if (fs.existsSync(agentPromptPath)) {
          const systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
          finalPrompt = `${systemPrompt}\n\n[USER QUERY]:\n${prompt}`;
        }
      } catch (_e) {
        // Silent failing
      }
    }

    // --- OAuth Sync & Centralization (Recopie) ---
    const userHome = process.env.USERPROFILE || process.env.HOME || '';
    const globalGeminiPath = path.join(userHome, '.gemini');
    
    // Dossier centralisé Overmind explicite
    const overmindGeminiPath = path.resolve(process.cwd(), '.overmind', 'gemini', agentName ? `agent_${agentName}` : 'central');
    const overmindGeminiSubPath = path.join(overmindGeminiPath, '.gemini');
    
    // S'assurer que les dossiers existent
    if (!fs.existsSync(overmindGeminiSubPath)) {
      fs.mkdirSync(overmindGeminiSubPath, { recursive: true });
    }

    const filesToSync = ['settings.json', 'oauth_creds.json', 'google_accounts.json', 'projects.json', 'state.json'];
    
    for (const file of filesToSync) {
      const globalFile = path.join(globalGeminiPath, file);
      const localFile = path.join(overmindGeminiSubPath, file);
      
      if (fs.existsSync(globalFile)) {
        try {
          fs.copyFileSync(globalFile, localFile);
          console.log(`[GeminiRunner] OAuth synchronisé: ${file} vers ${localFile}`);
        } catch (err) {
          console.error(`[GeminiRunner] Échec synchronisation ${file}: ${err}`);
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
        options.configPath
      );
      
      if (fs.existsSync(agentSettingsPath)) {
        const settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
        
        if (settings.env) {
          Object.assign(agentCustomEnv, settings.env);
        }

        const originalMcpPath = resolveConfigPath(PATHS.MCP, options.configPath);
        if (fs.existsSync(originalMcpPath)) {
          const fullMcp = JSON.parse(fs.readFileSync(originalMcpPath, 'utf8'));
          let mcpToUse = fullMcp;

          if (settings.enableAllProjectMcpServers === false && Array.isArray(settings.enabledMcpjsonServers)) {
            const filteredMcp: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
            for (const serverName of settings.enabledMcpjsonServers) {
              if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
                filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
              }
            }
            mcpToUse = filteredMcp;
          }
          
          fs.writeFileSync(mcpPath, JSON.stringify(mcpToUse, null, 2));
          console.log(`[GeminiRunner] MCP synchronisé: ${mcpPath}`);
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
    const geminiJsPath = path.join(userHomeNpm, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
    
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

    return new Promise((resolve) => {
      const child: ChildProcess = spawn(command, argsSpawn, {
        cwd: options.cwd || process.cwd(),
        shell: useNodeDirectly ? false : isWin,
        windowsHide: true,
        env: agentCustomEnv as NodeJS.ProcessEnv,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      child.on('close', async (code: number | null) => {
        if (code !== 0 && !stdout) {
          return resolve({ 
            result: '', 
            error: code === 41 ? '🔑 Erreur Auth/API Key (OAuth/GCloud)' : `EXIT_CODE_${code}\n${stderr}`, 
            rawOutput: stderr 
          });
        }

        try {
          const jsonOutput = JSON.parse(stdout.trim());
          const resultText = jsonOutput.reply || jsonOutput.result || stdout.trim();
          const newSessionId = jsonOutput.session_id || sessionId;

          if (newSessionId && agentName) {
            await saveSessionId(agentName, newSessionId);
          }

          resolve({
            result: resultText,
            sessionId: newSessionId,
            rawOutput: stdout,
          });
        } catch (_e) {
          resolve({
            result: stdout.trim(),
            sessionId: sessionId,
            rawOutput: stdout,
          });
        }
      });

      child.on('error', (err: Error) => {
        resolve({ result: '', error: err.message, rawOutput: '' });
      });

      if (child.stdin) {
        child.stdin.end();
      }
    });
  }
}
