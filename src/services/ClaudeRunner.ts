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
        // Lister les agents disponibles pour aider au debugging
        let availableAgents: string[] = [];
        try {
          const files = fs.readdirSync(settingsDir);
          availableAgents = files
            .filter(f => f.startsWith('settings_') && f.endsWith('.json'))
            .map(f => f.replace('settings_', '').replace('.json', ''));
        } catch (_e) {
          // Ignore error reading directory
        }

        return {
          result: '',
          error: `INVALID_AGENT: Agent "${agentName}" non trouvé.
            Fichier attendu: ${specificSettingsPath}
            Répertoire config: ${path.dirname(PATHS.SETTINGS)}
            ${availableAgents.length > 0 ? `Agents disponibles: ${availableAgents.join(', ')}` : 'Aucun agent disponible'}
          `.replace(/\s+/g, ' ').trim(),
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

    // Vérifier si le fichier MCP existe
    if (!fs.existsSync(mcpPath)) {
      return {
        result: '',
        error: `MISSING_MCP: Fichier de configuration MCP introuvable.
          Fichier attendu: ${mcpPath}
          Veuillez vérifier que le fichier .mcp.json existe dans le répertoire de configuration.
        `.replace(/\s+/g, ' ').trim(),
      };
    }

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

            // --- SMART NICKNAME FALLBACK ---
            const currentModel = settings.env.ANTHROPIC_MODEL;
            const isTechnicalModelId = currentModel && (
              currentModel.includes('claude') || 
              currentModel.includes('gpt') || 
              currentModel.includes('glm') || 
              currentModel.includes('minimax') ||
              currentModel.includes('deepseek') ||
              currentModel.includes('moonshot')
            );

            if (currentModel && !isTechnicalModelId) {
              // Si le modèle est un surnom, on l'utilise pour l'affichage mais on remet un vrai ID de modèle pour l'API
              agentCustomEnv.AGENT_NICKNAME = currentModel;
              // On utilise le modèle Sonnet par défaut ou la valeur configurée si elle semble valide
              agentCustomEnv.ANTHROPIC_MODEL = (settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL && settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL.includes('claude')) 
                ? settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL 
                : 'claude-3-5-sonnet-20241022';
            }

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

    let tmpSettingsPathToDelete: string | null = null;
    let finalSettingsPath = settingsPath;

    // Validation des chemins pour Windows
    if (process.platform === 'win32') {
      // S'assurer que les chemins sont valides et accessibles
      if (settingsPath && !fs.existsSync(settingsPath)) {
        return {
          result: '',
          error: `SETTINGS_NOT_FOUND: ${settingsPath}`,
        };
      }
      if (mcpPath && !fs.existsSync(mcpPath)) {
        return {
          result: '',
          error: `MCP_CONFIG_NOT_FOUND: ${mcpPath}`,
        };
      }
    }

    if (agentCustomEnv.AGENT_NICKNAME) {
      try {
        // On crée un fichier settings temporaire pour substituer le surnom par un vrai modèle
        // car le CLI Claude ne valide pas les surnoms dynamiques en interne
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const tempSettings = JSON.parse(JSON.stringify(settings));
        tempSettings.env.ANTHROPIC_MODEL = agentCustomEnv.ANTHROPIC_MODEL;

        const tmpSettingsPath = path.join(os.tmpdir(), `settings-${agentName || 'agent'}-${Date.now()}.json`);
        fs.writeFileSync(tmpSettingsPath, JSON.stringify(tempSettings, null, 2));
        finalSettingsPath = tmpSettingsPath;
        tmpSettingsPathToDelete = tmpSettingsPath;
      } catch (e) {
        console.error(`[ClaudeRunner] ⚠️ Erreur lors de la création du settings temporaire: ${e}`);
      }
    }

    const argsSpawn: string[] = [];
    if (CORE) argsSpawn.push(...CORE.split(' ').filter(Boolean));
    if (PERMISSIONS) argsSpawn.push(...PERMISSIONS.split(' ').filter(Boolean));
    // DÉCISION IMPORTANTE: On n'ajoute pas de guillemets manuels ici, spawn s'en occupe
    argsSpawn.push('--settings', finalSettingsPath);
    argsSpawn.push('--mcp-config', mcpPath);

    if (sessionId) {
      argsSpawn.push('--resume', sessionId);
    }

    // --- MODEL & NICKNAME FLAGS ---
    const modelToUse = agentCustomEnv.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
    console.error(`[ClaudeRunner] 🛠️  Model override: ${modelToUse}`);
    argsSpawn.push('--model', modelToUse);
    
    if (agentCustomEnv.AGENT_NICKNAME) {
      console.error(`[ClaudeRunner] 👤 Nickname: ${agentCustomEnv.AGENT_NICKNAME}`);
      argsSpawn.push('--name', agentCustomEnv.AGENT_NICKNAME);
    } else if (agentName) {
      argsSpawn.push('--name', agentName);
    }

    // --- AGENTIC OPTIMIZATIONS ---
    // Disable tools for strict JSON output agents (prevents hallucinated tool calls)
    if (prompt.toLowerCase().includes('[strict json mode]')) {
      argsSpawn.push('--tools', 'none');
    }

    return new Promise((resolve) => {
      const cleanupTmpFiles = () => {
        if (tmpMcpPathToDelete && fs.existsSync(tmpMcpPathToDelete)) {
          try { fs.unlinkSync(tmpMcpPathToDelete); } catch (_e) {
            // Ignore deletion errors
          }
        }
        if (tmpSettingsPathToDelete && fs.existsSync(tmpSettingsPathToDelete)) {
          try { fs.unlinkSync(tmpSettingsPathToDelete); } catch (_e) {
            // Ignore deletion errors
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

      // Pass prompt via stdin to avoid shell escaping issues with JSON special chars
      // Use -p without argument, then write to stdin
      if (isWin) {
        // Sous Windows, TOUJOURS utiliser cmd.exe pour garantir la compatibilité
        // Le spawn direct de claude.cmd peut échouer avec EINVAL dans certains contextes
        command = 'cmd.exe';
        spawnArgs = ['/c', 'claude', ...argsSpawn, '-p'];
      } else {
        spawnArgs = [...argsSpawn, '-p'];
      }

      if (agentName) {
        const id = agentCustomEnv.AGENT_NICKNAME || agentName;
        console.error(`[ClaudeRunner] 🚀 Démarrage de l'agent ${id}...`);
        console.error(`[ClaudeRunner] 📏 Prompt Size: ${finalPrompt.length} chars`);
        // Debug: Log la commande pour faciliter le troubleshooting
        if (process.env.DEBUG_CLAUDE_RUNNER) {
          console.error(`[ClaudeRunner] 🔧 Command: ${command}`);
          console.error(`[ClaudeRunner] 🔧 Args: ${spawnArgs.slice(0, 3).join(' ')}... (${spawnArgs.length} args total)`);
        }
      }

      const child: ChildProcess = spawn(command, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
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

      // Écrire le prompt via stdin (important: le faire avant d'écouter les événements)
      if (child.stdin) {
        try {
          child.stdin.write(finalPrompt);
          child.stdin.end();
        } catch (stdinError) {
          console.error(`[ClaudeRunner] ⚠️ Stdin write error: ${stdinError}`);
          // On continue quand même,某些cas le process peut démarrer sans stdin
        }
      }

      // Gestion robuste des erreurs de spawn immédiates
      child.on('error', (spawnError: Error) => {
        console.error(`[ClaudeRunner] ❌ Spawn Error: ${spawnError.message}`);
        if (spawnError.message.includes('EINVAL')) {
          console.error(`[ClaudeRunner] 🔧 Debug Info:`);
          console.error(`[ClaudeRunner]    - Platform: ${process.platform}`);
          console.error(`[ClaudeRunner]    - Command: ${command}`);
          console.error(`[ClaudeRunner]    - Args count: ${spawnArgs.length}`);
          console.error(`[ClaudeRunner]    - CWD: ${process.cwd()}`);
        }
        clearTimeout(timeout);
        cleanupTmpFiles();
        resolve({
          result: '',
          error: `SPAWN_ERROR: ${spawnError.message}`,
          rawOutput: spawnError.message,
        });
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stdout += chunk;
          if (agentName) {
            const id = agentCustomEnv.AGENT_NICKNAME || agentName;
            process.stderr.write(`[ClaudeRunner:${id}] ${chunk}`);
          }
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stderr += chunk;
          if (agentName) {
            const id = agentCustomEnv.AGENT_NICKNAME || agentName;
            process.stderr.write(`[ClaudeRunner:${id}:ERR] ${chunk}`);
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
          if (lower.includes('connection') || lower.includes('econnrefused')) {
            return '🌐 Erreur de connexion (réseau ou API indisponible)';
          }
          if (lower.includes('timeout')) {
            return '⏱️ Timeout de la requête';
          }
          return null;
        };

        // Gestion améliorée des codes de sortie
        if (code !== 0) {
          const specificError = detectError(stderr || stdout);
          if (specificError) {
            return resolve({
              result: '',
              error: specificError,
              rawOutput: stderr || stdout,
            });
          }
          // Si code != 0 mais qu'il y a du stdout, on tente de parser
          if (!stdout) {
            return resolve({
              result: '',
              error: `EXIT_CODE_${code}${stderr ? `: ${stderr.substring(0, 100)}` : ''}`,
              rawOutput: stderr,
            });
          }
        }

        try {
          // Extract raw text output from claude CLI
          const rawText = stdout.trim();
          
          // Try to detect if the output is itself a JSON envelope (from --output-format json)
          let resultText = rawText;
          try {
            const envelope = JSON.parse(rawText);
            if (envelope.session_id && agentName) {
              await saveSessionId(agentName, envelope.session_id);
            }
            // If it's an envelope with a reply field, extract it
            resultText = envelope.reply || envelope.result || rawText;
          } catch (_) {
            // Not a JSON envelope - it's a plain text response (expected for non --output-format json mode)
            resultText = rawText;
          }

          resolve({
            result: resultText,
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
