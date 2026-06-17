/**
 * GeminiRunner — Exécute des agents IA via @google/gemini-cli npm
 *
 * NOTE: "gemini" dans run_agent = runner utilisant @google/gemini-cli npm.
 *
 * Le CLI @google/gemini-cli est installé via `npm install -g @google/gemini-cli`.
 * Flags utilisés (headless):
 *   gemini -p "prompt" --approval-mode yolo --session-id <uuid> --acp [--model <mode>]
 *
 * Les 11 modes Antigravity sont passés via --model pour donner du contexte.
 * Le flag --acp active le mode agent (ACP protocol).
 *
 * Sorties:
 *   --output-format text  → texte lisible
 *   --output-format json  → JSON structuré (utilisé pour extraire session_id)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { withSpan, type Span } from '../lib/telemetry.js';
import { loadEnvQuietly } from '../lib/loadEnv.js';
import { rootLogger } from '../lib/logger.js';
import {
  registerProcess,
  linkSessionToPid,
  appendOutput,
  updateProcessStatus,
  killProcessTree,
} from '../lib/processRegistry.js';

const logger = rootLogger.child({ module: 'GeminiRunner' });

// ============================================================================
// CHEMINS — @google/gemini-cli npm
// ============================================================================

/** CLI gemini (npm bin — @google/gemini-cli v0.43.0) */
const GEMINI_CLI = 'gemini';

// ============================================================================
// TYPES
// ============================================================================

export type GeminiMode =
  | 'GENERAL'
  | 'CONTEXT_CHECK'
  | 'PLAN'
  | 'COMMAND'
  | 'CASCADE'
  | 'EVAL'
  | 'ANTIGRAVITY_REVIEW'
  | 'MQUERY'
  | 'COMMIT_MESSAGE'
  | 'CHECKPOINT'
  | 'FAST_APPLY';

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
  model?: string;
  /** Mode Antigravity (défaut: GENERAL) */
  mode?: GeminiMode;
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
  model?: string;
  nickname?: string;
  fallbackUsed?: string;
}

// ============================================================================
// GEMINIRUNNER
// ============================================================================

export class GeminiRunner {
  private config: typeof CONFIG.CLAUDE;
  private timeoutMs: number;

  constructor() {
    this.config = CONFIG.CLAUDE;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 min default
  }

  /**
   * Vérifie si @google/gemini-cli est installé
   */
  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(GEMINI_CLI, ['--version'], { shell: true, windowsHide: true });
      let output = '';
      child.stdout?.on('data', (d) => (output += d.toString()));
      child.on('close', (code) => resolve(code === 0 && output.includes('0.43')));
      child.on('error', () => resolve(false));
    });
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    if (options.agentName) {
      // Inline validation — prevents path traversal on settings_${agentName}.json
      if (!/^[a-zA-Z0-9_-]+$/.test(options.agentName)) {
        return { result: '', error: `INVALID_AGENT_NAME: '${options.agentName}' contains invalid characters. Only [a-zA-Z0-9_-] allowed.` };
      }
    }
    const cwd = options.cwd || process.cwd();
    loadEnvQuietly(path.join(cwd, '.env'));
    loadEnvQuietly(path.join(cwd, '../Workflow/.env'));

    const { prompt, agentName, autoResume, mode = 'GENERAL' } = options;
    let { sessionId } = options;
    const { PATHS } = this.config;

    // ========================================================================
    // VÉRIFICATION gemini CLI
    // ========================================================================

    const installed = await this.isInstalled();
    if (!installed) {
      return {
        result: '',
        error:
          'GEMINI_CLI_NOT_INSTALLED: @google/gemini-cli non trouvé.\n' +
          'Installez avec: npm install -g @google/gemini-cli\n' +
          'Vérifiez avec: gemini --version',
      };
    }

    // ========================================================================
    // ENV + SESSION
    // ========================================================================

    const agentCustomEnv: Record<string, string | undefined> = {
      ...process.env,
      ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
    };

    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath, 'gemini');
      if (lastId) sessionId = lastId;
    }

    // Session ID: génère si non fourni
    if (!sessionId) {
      sessionId = crypto.randomUUID();
    }

    // ========================================================================
    // SYSTEM PROMPT LOADING
    // ========================================================================

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

    // ========================================================================
    // MCP CONFIG
    // ========================================================================

    const agentConfigDir = path.join(
      options.configPath || cwd,
      '.antigravity',
      agentName ? `agent_${agentName}` : 'default',
    );

    if (!fs.existsSync(agentConfigDir)) {
      fs.mkdirSync(agentConfigDir, { recursive: true });
    }

    const mcpPath = path.join(agentConfigDir, 'mcp.json');

    if (agentName) {
      const settingsDir = path.dirname(PATHS.SETTINGS);
      const agentSettingsPath = resolveConfigPath(
        path.join(settingsDir, `settings_${agentName}.json`),
        options.configPath,
      );

      if (fs.existsSync(agentSettingsPath)) {
        let settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
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
          logger.info({ mcpPath }, 'MCP configuration synchronized for Gemini');
          if (!options.silent) {
            process.stderr.write(`[GeminiRunner] MCP synchronisé: ${mcpPath}\n`);
          }
        }
      }
    }

    // ========================================================================
    // CONSTRUCTION DES ARGS gemini CLI
    // ========================================================================
    //
    // Mode Antigravity → --model <mode> (pour donner du contexte au prompt)
    // ACP mode active le protocol agent (--acp)
    // --approval-mode yolo = auto-approve tous les outils
    // --output-format json = output structuré pour parser session_id
    // ========================================================================

    const argsSpawn: string[] = [];

    // Headless prompt (obligatoire pour non-interactive)
    argsSpawn.push('-p', finalPrompt);

    // Mode Antigravity → passe au model pour context
    argsSpawn.push('--model', `antigravity/${mode}`);

    // ACP mode (agent protocol)
    argsSpawn.push('--acp');

    // Auto-approve tous les outils
    argsSpawn.push('--approval-mode', 'yolo');

    // Session ID persistante
    argsSpawn.push('--session-id', sessionId);

    // Output JSON pour parser proprement
    argsSpawn.push('--output-format', 'json');

    // ========================================================================
    // SPAWN gemini CLI
    // ========================================================================

    const runImpl = async (span: Span): Promise<RunAgentResult> => {
      span.setAttribute('agentName', agentName || '');
      span.setAttribute('runner', 'gemini');
      span.setAttribute('mode', mode);

      return new Promise((resolve) => {
        let resolved = false;
        const safeResolve = (value: RunAgentResult) => {
          if (!resolved) {
            resolved = true;
            resolve(value);
          }
        };

        const child: ChildProcess = spawn(GEMINI_CLI, argsSpawn, {
          cwd,
          shell: false,
          windowsHide: true,
          env: agentCustomEnv as NodeJS.ProcessEnv,
        });

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

        child.stdout?.on('data', (data) => {
          const d = data.toString();
          if (child.pid && d) void appendOutput(child.pid, d, options.configPath);
          stdout += d;
          if (stdout.length > MAX_BUF) stdout = stdout.slice(-MAX_BUF);
        });

        child.stderr?.on('data', (data) => {
          const d = data.toString();
          if (child.pid && d) void appendOutput(child.pid, d, options.configPath);
          stderr += d;
          if (stderr.length > MAX_BUF) stderr = stderr.slice(-MAX_BUF);
        });

        const timeout = setTimeout(async () => {
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
          safeResolve({ result: '', error: 'TIMEOUT', rawOutput: stdout + stderr });
        }, this.timeoutMs);

        child.on('error', (err: Error) => {
          clearTimeout(timeout);
          safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
        });

        child.on('close', async (code: number | null) => {
          clearTimeout(timeout);

          if (code !== 0 && !stdout.trim()) {
            return safeResolve({
              result: '',
              error: `EXIT_CODE_${code}`,
              rawOutput: stderr,
            });
          }

          try {
            const trimmed = stdout.trim();
            let jsonOutput: Record<string, unknown> | null = null;

            // Parse JSON: d'abord ligne simple, puis extraire du milieu
            try {
              jsonOutput = JSON.parse(trimmed);
            } catch {
              // Strip les warnings ANSI avant de parser (ex: "Warning: True color...")
              const lines = trimmed.split('\n');
              const jsonLines: string[] = [];
              let inJson = false;
              for (const line of lines) {
                const trimmed2 = line.trim();
                // Détecte début JSON
                if (trimmed2 === '{' || trimmed2.startsWith('{')) {
                  inJson = true;
                }
                if (inJson || trimmed2 === '}' || trimmed2.endsWith('}')) {
                  inJson = true;
                  jsonLines.push(trimmed2);
                }
              }
              const cleaned = jsonLines.join('');
              if (cleaned.startsWith('{')) {
                try {
                  jsonOutput = JSON.parse(cleaned);
                } catch {
                  // pas de JSON → output brut
                }
              }
            }

            if (jsonOutput) {
              const resultText =
                (jsonOutput.reply as string) ||
                (jsonOutput.result as string) ||
                (jsonOutput.output as string) ||
                trimmed;
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

            // Fallback: texte brut (le mode --output-format text est utilisé si json échoue)
            return safeResolve({
              result: trimmed,
              sessionId: sessionId,
              rawOutput: stdout,
            });
          } catch {
            return safeResolve({
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

    // Cleanup fichier MCP temporaire
    if (fs.existsSync(mcpPath)) {
      try {
        fs.unlinkSync(mcpPath);
      } catch {
        // ignore cleanup errors
      }
    }

    return result;
  }
}