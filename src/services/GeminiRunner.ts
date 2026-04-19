import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId } from '../lib/sessions.js';

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

export class GeminiRunner {
  private config: typeof CONFIG.CLAUDE; // Reusing config structure for isolation
  private timeoutMs: number;

  constructor() {
    this.config = CONFIG.CLAUDE;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 300000; // 5 min default for tools
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume } = options;
    let { sessionId } = options;
    const { PATHS } = this.config;
    const agentCustomEnv: Record<string, string> = {};

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName);
      if (lastId) {
        sessionId = lastId;
      }
    }

    let customTimeoutMs = this.timeoutMs;
    let allowedMcpServers: string[] | null = null;

    // --- Isolation & Env ---
    if (agentName) {
      try {
        const agentSettingsPath = resolveConfigPath(
          path.join(path.dirname(PATHS.SETTINGS), `settings_${agentName}.json`),
        );
        if (fs.existsSync(agentSettingsPath)) {
          const settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));

          if (settings.env) {
            Object.assign(agentCustomEnv, settings.env);
            if (settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS) {
              const t = settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS;
              customTimeoutMs = parseInt(t, 10) || customTimeoutMs;
            }
          }

          // Capture enabled servers for --allowed-mcp-server-names
          if (
            settings.enableAllProjectMcpServers === false &&
            Array.isArray(settings.enabledMcpjsonServers)
          ) {
            allowedMcpServers = settings.enabledMcpjsonServers;
          }
        }
      } catch (_e) {
        // Skip filtering on error
      }
    }

    const isWin = process.platform === 'win32';
    // Utilisation directe du bundle JS avec node pour éviter les bugs de quoting CMD.exe sur Windows
    const command = isWin ? 'node' : 'gemini';
    const bundlePath = 'C:\\Users\\Deamon\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js';
    const argsSpawn: string[] = isWin ? [bundlePath] : [];

    // --- SELECTION ET TRADUCTION DU MODELE ---
    let modelToUse = agentCustomEnv.GEMINI_MODEL || agentCustomEnv.ANTHROPIC_MODEL || 'gemini-3-flash-preview';

    const modelLower = modelToUse.toLowerCase();

    // Traduction automatique : si le modèle configuré est un modèle Claude ou GLM (spécifique à Z.ai),
    // ou s'il contient des mots clés de modèles externes, on bascule sur un modèle Gemini standard.
    const isExternalModel = 
      modelLower.includes('claude') || 
      modelLower.includes('glm') ||
      modelLower.includes('deepseek') ||
      modelLower.includes('gpt') ||
      modelLower.includes('sonnet') ||
      modelLower.includes('opus') ||
      modelLower.includes('haiku');

    // Gestion des surnoms personnalisés OverMind (ex: "The Chaos Prophet", "Satoshi's Ear")
    // On force l'utilisation des modèles Gemini 3 pour ces surnoms quand on utilise le runner gemini.
    const isCustomNickname = !modelLower.startsWith('gemini-') && !modelLower.startsWith('models/');

    if (isExternalModel || isCustomNickname) {
      if (modelLower.includes('pro')) {
        modelToUse = 'gemini-3.1-pro-preview';
      } else {
        // Par défaut, ou si 'flash' est mentionné dans le surnom
        modelToUse = 'gemini-3-flash-preview';
      }
    }

    // Sécurité supplémentaire : si l'utilisateur a juste mis 'flash' ou 'pro'
    if (modelToUse === 'flash') modelToUse = 'gemini-3-flash-preview';
    if (modelToUse === 'pro') modelToUse = 'gemini-3.1-pro-preview';

    if (modelToUse) {
      argsSpawn.push('-m', modelToUse);
    }

    // Config MCP (restrict to enabled servers if specified)
    if (allowedMcpServers && allowedMcpServers.length > 0) {
      argsSpawn.push('--allowed-mcp-server-names', allowedMcpServers.join(','));
    }

    // Always use YOLO mode for headless/non-interactive tool execution
    argsSpawn.push('--yolo');

    // Pass the prompt in headless mode
    argsSpawn.push('-p', prompt);

    return new Promise((resolve) => {
      const child: ChildProcess = spawn(command, argsSpawn, {
        cwd: process.cwd(),
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          ...agentCustomEnv,
          ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
        },
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (d: Buffer) => {
          const str = d.toString();
          stdout += str;
          process.stderr.write(str); // Redirect to stderr for safety in MCP context
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (d: Buffer) => {
          const str = d.toString();
          stderr += str;
          process.stderr.write(str); // Redirect to stderr for safety in MCP context
        });
      }

      const cleanup = () => {
        // No temporary files to cleanup for now as we don't use --mcp-config-path
      };

      const timeout = setTimeout(() => {
        child.kill();
        cleanup();
        resolve({ result: '', error: `TIMEOUT`, rawOutput: stdout });
      }, customTimeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);
        cleanup();

        if (code !== 0 && !stdout) {
          return resolve({ result: '', error: `EXIT_CODE_${code}`, rawOutput: stderr });
        }

        resolve({
          result: stdout.trim(),
          sessionId: sessionId,
          rawOutput: stdout,
        });
      });

      child.on('error', (err: Error) => {
        cleanup();
        resolve({ result: '', error: err.message, rawOutput: '' });
      });

      if (child.stdin) {
        child.stdin.end();
      }
    });
  }
}
