import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath, getWorkspaceDir, getAgentHermesHome, getAgentOvermindHome, getSharedHermesHome } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { linkSessionToPid } from '../lib/processRegistry.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { withSpan } from '../lib/telemetry.js';
import { loadEnvQuietly } from '../lib/loadEnv.js';
import pino from 'pino';
import {
  registerProcess,
  appendOutput,
  updateProcessStatus,
} from '../lib/processRegistry.js';
import {
  registerLiveAgent,
  appendLiveOutput,
  setLiveStatus,
  unregisterLiveAgent,
} from '../lib/agent_lifecycle.js';
import { killProcessTree } from './hermes/processUtils.js';
import { findHermesBinary } from './hermes/binaryFinder.js';
import { defaultBaseUrlFor, TOKEN_KEYS } from './hermes/providerConfig.js';
import { filterConfigYaml } from './hermes/configYamlFilter.js';

const logger = pino({ name: 'NousHermesRunner' });

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
  model?: string;
  provider?: string;
  hermesArgs?: string[];
  mcpConfigPath?: string;
  signal?: AbortSignal;
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
  model?: string; // resolved real model ID
  nickname?: string; // original value from config (if different)
  fallbackUsed?: string; // which fallback token was used (e.g. 'AUTH_FALLBACK_1')
}

/**
 * NousHermesRunner — Runner Hermes Agent pour Overmind (v2.8.45+).
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  ⭐ ARCHITECTURE CREDENTIALS HERMES — LIRE CECI EN PREMIER                 ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                              ║
 * ║  Les credentials Hermes sont dans LE DOSSIER NATIF HERMES UNIQUEMENT :      ║
 * ║                                                                              ║
 * ║    <HERMES_HOME>/agents/<name>/settings.json                                 ║
 * ║                                                                              ║
 * ║  Sur Linux (npm -g) :  /home/demon/.overmind/hermes/agents/<name>/           ║
 * ║  Sur Windows (dev)  :  Workflow/.overmind/hermes/agents/<name>/              ║
 * ║                                                                              ║
 * ║  ❌ .claude/settings_<name>.json → CLAUDE CODE / KILO SEULEMENT             ║
 * ║  ❌ NousHermesRunner NE LIT JAMAIS depuis .claude/                          ║
 * ║  ❌ Ne pas éditer hermes/agents/<name>/settings.json manuellement           ║
 * ║     entre les runs — le runner le met à jour automatiquement.               ║
 * ║                                                                              ║
 * ║  FORMAT du settings.json Hermes :                                            ║
 * ║  {                                                                           ║
 * ║    "env": {                                                                  ║
 * ║      "ANTHROPIC_AUTH_TOKEN":  "sk-cp-...",   ← token MiniMax / Z.AI        ║
 * ║      "ANTHROPIC_BASE_URL":    "https://api.minimaxi.com/anthropic",          ║
 * ║      "ANTHROPIC_MODEL":       "MiniMax-M3",                                  ║
 * ║      "ANTHROPIC_PROVIDER":    "minimax-cn",                                  ║
 * ║      "MINIMAX_CN_API_KEY":    "sk-cp-...",   ← injecté auto par le runner   ║
 * ║      "MINIMAX_CN_BASE_URL":   "https://api.minimaxi.com/anthropic"           ║
 * ║    },                                                                        ║
 * ║    "enableAllProjectMcpServers": false,                                      ║
 * ║    "enabledMcpjsonServers": ["memory", "discord", "postgres"],               ║
 * ║    "agent": "<name>",                                                        ║
 * ║    "runner": "hermes"                                                        ║
 * ║  }                                                                           ║
 * ║                                                                              ║
 * ║  Supporte l'interpolation $VAR (ex: "$ANTHROPIC_AUTH_TOKEN_1")              ║
 * ║  résolue depuis process.env au moment du spawn.                             ║
 * ║                                                                              ║
 * ║  HERMES_HOME résolu dans l'ordre :                                           ║
 * ║    1. OVERMIND_HERMES_HOME (env var explicite, ex: systemd EnvironmentFile) ║
 * ║    2. <OVERMIND_WORKSPACE>/.overmind/hermes/ (dev local)                    ║
 * ║    3. ~/.overmind/hermes/ (Linux) / %LOCALAPPDATA%/overmind/hermes/ (Win)   ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 *  • Providers supportés : MiniMax CN/GLOBAL, Z.AI/GLM, Mistral, OpenAI, NVIDIA NIM
 *  • OpenRouter = embeddings UNIQUEMENT (bloqué pour LLM inference)
 *  • auth.json purgé à chaque run (évite les credentials stale de l'ancien provider)
 *  • HOME/USERPROFILE propagé au process Hermes pour résolution ~/.hermes canonique
 *  • Voir hermesTokenResolver.ts pour le 3-pass token detection (sk-cp-/32hex/sk-ant-)
 */
export class NousHermesRunner {
  private timeoutMs: number;
  private tempFiles: string[] = [];
  private MAX_BUF = 10 * 1024 * 1024; // 10MB buffer limit

  constructor() {
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 min default
  }

  cleanupTempFiles(): void {
    logger.debug({ count: this.tempFiles.length }, '[CLEANUP] Cleaning up temporary run files.');
    for (const tempFile of this.tempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          logger.debug({ tempFile }, '[CLEANUP] Cleaned up temp file');
        }
      } catch (err) {
        logger.warn({ tempFile, error: err }, '[CLEANUP] Failed to cleanup temp file');
      }
    }
    this.tempFiles = [];
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    if (options.agentName) {
      // Inline validation — prevents path traversal on settings_${agentName}.json
      if (!/^[a-zA-Z0-9_-]+$/.test(options.agentName)) {
        return { result: '', error: `INVALID_AGENT_NAME: '${options.agentName}' contains invalid characters. Only [a-zA-Z0-9_-] allowed.` };
      }
    }
    logger.info({ agentName: options.agentName, model: options.model, sessionId: options.sessionId }, '[RUN_AGENT] Initiating runAgent entrypoint.');
    try {
      const result = await withSpan(
        'hermes.runAgent',
        async (span) => {
          span.setAttribute('agentName', options.agentName || '');
          span.setAttribute('model', options.model || '');
          span.setAttribute('runner', 'hermes');
          return await this.runAgentInternal(options);
        },
        {
          agentName: options.agentName || '',
          model: options.model || '',
          runner: 'hermes',
        },
      );

      this.cleanupTempFiles();

      if (options.agentName && result.sessionId) {
        logger.info({ agentName: options.agentName, sessionId: result.sessionId }, '[RUN_AGENT] Saving completed session ID.');
        await saveSessionId(options.agentName, result.sessionId, options.configPath, 'hermes');
      }

      return result;
    } catch (error) {
      this.cleanupTempFiles();
      logger.error(
        { error: error instanceof Error ? error.message : String(error), agentName: options.agentName },
        '[RUN_AGENT] Hermes runner execution flow threw an error.',
      );
      throw error;
    }
  }

  async runAgentInternal(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume, silent } = options;
    let { sessionId } = options;
    const cwd = options.cwd || process.cwd();
    const configPath = options.configPath || getWorkspaceDir();

    logger.info({ agentName, autoResume, cwd, configPath, silent }, '[RUN_AGENT_INTERNAL] Starting internal agent runner workflow.');

    // Load .env files FIRST
    const envPaths = [path.join(cwd, '.env'), path.join(cwd, '../Workflow/.env')];
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        logger.debug({ envPath }, '[RUN_AGENT_INTERNAL] Loading quiet environment file.');
        loadEnvQuietly(envPath);
      } else {
        logger.debug({ envPath }, '[RUN_AGENT_INTERNAL] Environment file not found, skipping.');
      }
    }

    // Auto Resume
    if (autoResume && agentName && !sessionId) {
      logger.info({ agentName }, '[RUN_AGENT_INTERNAL] Auto-resume enabled. Querying last session ID.');
      const lastId = await getLastSessionId(agentName, configPath, 'hermes');
      if (lastId) {
        sessionId = lastId;
        if (!silent) logger.info({ sessionId }, '[NousHermesRunner] Auto-resume session.');
        logger.info({ sessionId }, '[RUN_AGENT_INTERNAL] Resolved last session ID for resume.');
      } else {
        logger.info('[RUN_AGENT_INTERNAL] No previous session ID found for auto-resume.');
      }
    }

    const MAX_BUF = 10 * 1024 * 1024;
    const timeoutMs = this.timeoutMs;
    const HARD_TIMEOUT_MS = 60000;

    // ═══════════════════════════════════════════════════════════════════════════
    // HERMES_HOME — résolu via getAgentHermesHome() (multi-OS, multi-install).
    //   Priorité : OVERMIND_HERMES_HOME > <workspace>/.overmind/hermes/ > ~/.overmind/hermes/
    // ═══════════════════════════════════════════════════════════════════════════
    const overmindHermesPath = getAgentOvermindHome(agentName);
    const overmindHermesSubPath = getAgentHermesHome(agentName);

    // ═══════════════════════════════════════════════════════════════════════════
    // ⭐ CHEMIN CREDENTIALS HERMES — SOURCE DE VÉRITÉ UNIQUE
    //
    //   <HERMES_HOME>/agents/<name>/settings.json
    //
    // ❌ NE PAS utiliser .claude/settings_<name>.json — c'est pour Claude/Kilo.
    // ❌ Ce fichier EST le fichier natif Hermes. Le runner le lit ET le met à jour.
    // ═══════════════════════════════════════════════════════════════════════════
    const agentSettingsPath = agentName ? path.join(overmindHermesSubPath, 'settings.json') : '';

    if (agentName && !fs.existsSync(overmindHermesSubPath)) {
      return {
        result: '',
        error:
          `INVALID_AGENT: Dossier Hermes manquant pour l'agent "${agentName}". ` +
          `Créez le dossier et le fichier : ${agentSettingsPath} ` +
          `avec { "env": { "ANTHROPIC_AUTH_TOKEN": "sk-cp-...", ` +
          `"ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic", ` +
          `"ANTHROPIC_MODEL": "MiniMax-M3", "ANTHROPIC_PROVIDER": "minimax-cn" }, ` +
          `"agent": "${agentName}", "runner": "hermes" }`,
      };
    }

    // Load agent settings + MCP config (same pattern as ClaudeRunner)
    let systemPrompt = '';
    let resolvedModel: string | undefined;
    let resolvedProvider: string | undefined;
    const agentCustomEnv: Record<string, string | undefined> = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1',
      PYTHONLEGACYWINDOWSSTDIO: '1', TERM: 'emacs',
      PROMPT_TOOLKIT_NO_INTERACTIVE: '1', ANSICON: '1',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
      NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || process.env.NVAPI_KEY,
      NVIDIA_API_BASE: process.env.NVIDIA_API_BASE || 'https://integrate.api.nvidia.com/v1',
      ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
      // OVERMIND_AGENT_HOME tells Hermes (v0.13.0+) to read agent-specific .env FIRST
      // get_env_value() in Hermes checks OVERMIND_AGENT_HOME/.hermes/.env before HERMES_HOME/.env
      // This allows $VAR expansion done by Overmind to take precedence over gateway .env
      ...(agentName ? { OVERMIND_AGENT_HOME: getAgentOvermindHome(agentName) } : {}),
      // NOTE: do NOT pre-seed GLM_API_KEY with '' here. The real value comes from
      // settings_<agent>.json (merged below) or from the agent's .hermes/.env file.
      // Seeding '' here used to win against Object.assign() whenever interpolateEnvVars()
      // returned an empty value for $GLM_API_KEY (e.g. shell parent didn't export it),
      // which silently nulled out getTokenForIndex() and caused EXIT_CODE_1 / 401 errors.
    };

    let tmpSettingsPath: string | null = null;
    let tmpMcpPath: string | null = null;
    let loadedSettings: any = null;
    // Capture the RAW (pre-interpolation) settings tokens so getTokenForIndex can
    // fail-loud on unresolved $VAR references and report which one is missing.
    // (Once interpolateEnvVars() runs, $VAR has been replaced with its value, and
    //  we lose the information that the user explicitly asked for THAT var.)
    const rawExplicitSettingsTokens: Array<{ key: string; value: string }> = [];

    // TOKEN_KEYS is now imported from ./hermes/providerConfig.ts (extracted module).

    if (agentName) {
      // Locate the per-agent SOUL.md (system prompt). We support the canonical
      // Hermes layout (HERMES_HOME/agents/<name>/SOUL.md) and a one-shot legacy
      // path (HERMES_HOME/agent_<name>/.hermes/SOUL.md) for existing installs.
      // The canonical path wins; the legacy is fallback so we don't break
      // agents that haven't been migrated yet.
      const canonicalSoul = path.join(overmindHermesSubPath, 'SOUL.md');
      const legacySoul = path.join(
        getSharedHermesHome(),
        `agent_${agentName}`,
        '.hermes',
        'SOUL.md',
      );
      const claudeSoul = path.join(
        configPath,
        '.claude',
        'agents',
        `${agentName}.md`,
      );
      
      const agentPromptPath = fs.existsSync(claudeSoul)
        ? claudeSoul
        : fs.existsSync(canonicalSoul)
        ? canonicalSoul
        : fs.existsSync(legacySoul)
        ? legacySoul
        : null;

      if (agentPromptPath && fs.existsSync(agentPromptPath)) {
        systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
        
        // Sync system prompt to canonical layout if loaded from legacy or Claude paths
        if (agentPromptPath !== canonicalSoul) {
          try {
            if (!fs.existsSync(overmindHermesSubPath)) {
              fs.mkdirSync(overmindHermesSubPath, { recursive: true });
            }
            fs.writeFileSync(canonicalSoul, systemPrompt, 'utf8');
            logger.info({ agentName, source: agentPromptPath, target: canonicalSoul }, 'Synced SOUL.md to canonical Hermes path.');
          } catch (e) {
            logger.warn({ error: e }, 'Failed to sync SOUL.md to canonical Hermes path');
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // LECTURE CREDENTIALS HERMES — <HERMES_HOME>/agents/<name>/settings.json
      //
      // Ce chemin est résolu UNE SEULE FOIS en haut de la fonction (agentSettingsPath).
      // Il pointe vers le dossier natif Hermes, PAS vers .claude/.
      // Si le fichier est absent, l'agent tourne sans LLM (erreur claire dans les logs).
      // ─────────────────────────────────────────────────────────────────────────
      try {
        // agentSettingsPath = <HERMES_HOME>/agents/<name>/settings.json (défini ligne ~405)
        // ❌ NE PAS changer ceci pour pointer vers .claude/ — c'est intentionnel.
        if (!fs.existsSync(agentSettingsPath)) {
          logger.error(
            {
              agentName,
              expected: agentSettingsPath,
              hermesHome: overmindHermesSubPath,
              action:
                `Créer ${agentSettingsPath} avec les credentials. ` +
                `Format minimal : { "env": { "ANTHROPIC_AUTH_TOKEN": "sk-cp-...", ` +
                `"ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic", ` +
                `"ANTHROPIC_MODEL": "MiniMax-M3", "ANTHROPIC_PROVIDER": "minimax-cn" }, ` +
                `"agent": "${agentName}", "runner": "hermes" }`,
            },
            '[HERMES] ❌ settings.json introuvable dans le dossier Hermes natif. ' +
            'Hermes NE cherche PAS dans .claude/ — uniquement dans .overmind/hermes/agents/<name>/settings.json. ' +
            'Voir la documentation dans le commentaire du constructeur NousHermesRunner.',
          );
        }
        if (fs.existsSync(agentSettingsPath)) {
          // Read the RAW settings (pre-interpolation) to capture $VAR references
          // before they get resolved. We iterate the FULL TOKEN_KEYS list (100%
          // exhaustive) so any env-var name the runner knows about gets captured
          // for fail-loud validation later.
          const rawSettings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
          if (rawSettings.env) {
            for (const tk of TOKEN_KEYS) {
              const v = rawSettings.env[tk];
              if (v && typeof v === 'string' && v.length > 0) {
                rawExplicitSettingsTokens.push({ key: tk, value: v });
              }
            }
          }
          let settings = rawSettings;
          settings = interpolateEnvVars(settings);
          loadedSettings = settings;

          // Fichier temporaire interpolé (valeurs $VAR résolues) — nettoyé après le spawn.
          // Situé dans le même dossier que settings.json : <HERMES_HOME>/agents/<name>/
          const tempSettings = path.join(
            path.dirname(agentSettingsPath),
            `settings_tmp.json`,
          );
          fs.writeFileSync(tempSettings, JSON.stringify(settings, null, 2));
          tmpSettingsPath = tempSettings;
          this.tempFiles.push(tempSettings);

          if (settings.env) {
            Object.assign(agentCustomEnv, settings.env);
            if (!options.model && settings.env.MODEL) {
              agentCustomEnv.ANTHROPIC_MODEL = settings.env.MODEL;
            }
          }

          // ─────────────────────────────────────────────────────────────────────
          // CONFIG MCP — Résolution dans l'ordre suivant :
          //   1. <HERMES_HOME>/agents/<name>/.mcp.json  (override par agent)
          //   2. <OVERMIND_WORKSPACE>/.mcp.json filtré par enabledMcpjsonServers
          // ─────────────────────────────────────────────────────────────────────
          const agentMcpPath = path.join(overmindHermesSubPath, '.mcp.json');

          if (fs.existsSync(agentMcpPath)) {
            // Override MCP par agent : <HERMES_HOME>/agents/<name>/.mcp.json
            const tempMcp = path.join(
              path.dirname(agentSettingsPath),
              `mcp_tmp.json`,
            );
            fs.writeFileSync(tempMcp, fs.readFileSync(agentMcpPath, 'utf8'));
            tmpMcpPath = tempMcp;
            this.tempFiles.push(tempMcp);
          } else if (
            settings.enableAllProjectMcpServers === false &&
            Array.isArray(settings.enabledMcpjsonServers)
          ) {
            // Filtre le .mcp.json du workspace selon enabledMcpjsonServers
            const projectMcpPath = resolveConfigPath(CONFIG.CLAUDE.PATHS.MCP, configPath);
            if (fs.existsSync(projectMcpPath)) {
              const fullMcp = JSON.parse(fs.readFileSync(projectMcpPath, 'utf8'));
              const filteredMcp: { mcpServers: Record<string, unknown> } = { mcpServers: {} };

              for (const serverName of settings.enabledMcpjsonServers) {
                if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
                  filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
                }
              }

              const tempMcp = path.join(
                path.dirname(agentSettingsPath),
                `mcp_tmp.json`,
              );
              fs.writeFileSync(tempMcp, JSON.stringify(filteredMcp, null, 2));
              tmpMcpPath = tempMcp;
              this.tempFiles.push(tempMcp);
            }
          }
        }
      } catch (e) {
        logger.warn({ error: e }, `Failed to process settings/mcp configurations for Hermes agent ${agentName}`);
      }

      // Charge le .env de l'agent (dans <HERMES_HOME>/agents/<name>/.env) en FALLBACK UNIQUEMENT.
      // Les clés déjà définies dans settings.json ne sont PAS écrasées.
      //
      // CRITICAL (2.8.29): The .hermes/.env file is a STALE WRITE of the previous
      // spawn — it gets re-written by the runner itself at line ~1013, but if a
      // user's first run was for Z.AI and they later switch the agent to MiniMax
      // CN, the stale .hermes/.env from the previous run gets re-loaded into
      // agentCustomEnv HERE, OVERWRITING the MiniMax settings that were just merged
      // from settings_<agent>.json in the block above (line ~412). Symptom: the
      // agent silently reverts to the old provider (e.g. Z.AI glm-5.1) on every
      // spawn, causing persistent 401s.
      //
      // Fix: only load keys from .hermes/.env that are NOT already in agentCustomEnv
      // (i.e. settings_<agent>.json wins; .hermes/.env is a fallback for unrelated
      // custom vars the user might have set manually).
      const envPath = path.join(overmindHermesSubPath, '.env');
      if (fs.existsSync(envPath)) {
        try {
          const content = fs.readFileSync(envPath, 'utf8');
          content.split('\n').forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) return;
            const key = trimmed.slice(0, eqIdx).trim();
            let value = trimmed.slice(eqIdx + 1).trim();
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
            if (key && agentCustomEnv[key] === undefined) {
              // Only fill in keys that settings_<agent>.json did NOT set.
              // settings_<agent>.json is the user's source of truth; .hermes/.env
              // is a stale write from a previous spawn and must not override it.
              agentCustomEnv[key] = value;
            }
          });
        } catch (e) {
          logger.warn({ envPath, error: e }, 'Failed to read agent env file');
        }
      }

      resolvedModel = agentCustomEnv.MODEL || agentCustomEnv.ANTHROPIC_MODEL;
      resolvedProvider = agentCustomEnv.PROVIDER || agentCustomEnv.ANTHROPIC_PROVIDER;
      if (resolvedProvider && (resolvedProvider.startsWith('http://') || resolvedProvider.startsWith('https://'))) {
        if (resolvedProvider.includes('minimax')) {
          resolvedProvider = 'minimax-cn';
        } else if (resolvedProvider.includes('z.ai') || resolvedProvider.includes('bigmodel')) {
          resolvedProvider = 'zai';
        } else {
          resolvedProvider = undefined;
        }
      }
    }

    const finalModel = options.model || resolvedModel || CONFIG.HERMES.DEFAULT_MODEL;
    const finalPrompt = systemPrompt ? `${systemPrompt}\n\n[USER QUERY]:\n${prompt}` : prompt;
    const cliPrompt = finalPrompt;

    // Build CLI args: chat -q (persistent session, NOT -z oneshot)
    // -z + --resume doesn't work — resume is ignored in oneshot mode
    //
    // 2.8.33: RE-ADD --provider for MiniMax/Z.AI cases. The empirical 2.8.28
    // observation ("`hermes chat -q --provider minimax-cn` 401s while `--yolo`
    // alone works") was based on a specific `Hermes-MiniMax-2.bat` test
    // where the env was set perfectly. In our sniperbot_analyst scenario
    // (a real production setup with stale state, multiple providers in the
    // auth.json pool, and Hermes upstream's auto-router that picks
    // openrouter for `MiniMax-M3` as an OpenRouter alias), NOT passing
    // --provider makes Hermes upstream fall back to openrouter, which
    // then 401s because the OPENROUTER_API_KEY is purged.
    //
    // So: pass --provider when we have a resolved provider that matches
    // a registered plugin. This forces Hermes upstream to use the right
    // plugin profile (and the right credential pool bucket).
    const cleanArgs = ['chat', '-q', cliPrompt, '-Q'];
    cleanArgs.push('--model', finalModel);
    if (options.provider || resolvedProvider) {
      const provider: string = (options.provider || resolvedProvider) as string;
      cleanArgs.push('--provider', provider);
      logger.info(
        { agentName, provider, model: finalModel },
        '[HERMES_ARGS] Passing --provider (2.8.33: needed to bypass upstream auto-router that picked openrouter for MiniMax-M3).',
      );
    }

    // ============================================================
    // 2.8.36 — TOOLSET DISCOVERY (LOG ONLY — NOT PASSED TO CLI)
    // ============================================================
    // Previously we passed MCP server names via `--toolsets` to Hermes.
    // This caused `Warning: Unknown toolsets: mcp-memory, mcp-discord, ...`
    // because Hermes's toolset registry does NOT use the `mcp-<name>` format.
    //
    // The MCP servers load correctly WITHOUT `--toolsets` because:
    //   1. `HERMES_HOME` is overridden to the per-agent isolated run home.
    //   2. `filterConfigYaml` writes a filtered `config.yaml` that lists only
    //      the allowed MCP servers under `mcp_servers:`.
    //   3. Hermes reads `config.yaml` at startup and connects to every server
    //      listed there — no `--toolsets` flag needed.
    //
    // We still build `toolsetList` for diagnostic logging so that the log
    // shows which MCP servers are expected for this agent run.
    //
    // Source of truth for the list:
    //   - If settings has `enabledMcpjsonServers: [...non-empty...]`, use that.
    //   - Else, if `enableAllProjectMcpServers: true`, use ALL server names
    //     from the Hermes config.yaml.
    //   - Else, skip — no toolset hint.
    const toolsetList: string[] = [];
    // Read the canonical settings.json we just wrote to find the MCP server hints.
    // (settingsJson lives inside the `if (agentName)` block above, so we re-read
    // it from disk here to keep the args-building code path-independent.)
    const effectiveSettings: { enabledMcpjsonServers?: string[]; enableAllProjectMcpServers?: boolean } = {};
    if (agentName) {
      try {
        if (loadedSettings) {
          if (Array.isArray(loadedSettings.enabledMcpjsonServers)) {
            effectiveSettings.enabledMcpjsonServers = loadedSettings.enabledMcpjsonServers.filter(Boolean);
          }
          if (loadedSettings.enableAllProjectMcpServers !== undefined) {
            effectiveSettings.enableAllProjectMcpServers = loadedSettings.enableAllProjectMcpServers === true;
          }
        } else {
          const canonicalPath = path.join(overmindHermesSubPath, 'settings.json');
          if (fs.existsSync(canonicalPath)) {
            const raw = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
            if (Array.isArray(raw.enabledMcpjsonServers)) {
              effectiveSettings.enabledMcpjsonServers = raw.enabledMcpjsonServers.filter(Boolean);
            }
            if (raw.enableAllProjectMcpServers !== undefined) {
              effectiveSettings.enableAllProjectMcpServers = raw.enableAllProjectMcpServers === true;
            }
          }
        }
      } catch (e) {
        logger.warn({ error: e }, '[HERMES_ARGS] Failed to read settings for toolset hints.');
      }
    }
    const enabledInSettings = effectiveSettings.enabledMcpjsonServers || [];
    if (enabledInSettings.length > 0) {
      toolsetList.push(...enabledInSettings);
    } else if (effectiveSettings.enableAllProjectMcpServers === true) {
      // ============================================================
      // 2.8.39 — READ MCP SERVERS FROM HERMES CONFIG.YAML (NOT .mcp.json)
      // ============================================================
      // Earlier (2.8.36) we read `Workflow/.mcp.json` for the toolset names,
      // but that's the Overmind-CLI/Claude-Code format. Hermes upstream's
      // `--toolsets` flag expects names that match the `mcp_servers:` block
      // of the **Hermes config.yaml** (i.e. <HERMES_HOME>/config.yaml).
      // The two registries use DIFFERENT names — `serveur_discord` vs
      // `discord-server`, `X` vs `x_server`, etc. — and the Hermes one is
      // the one Hermes actually recognises. Passing `serveur_discord` to
      // `--toolsets` produces the `Warning: Unknown toolsets` we saw at
      // 17:50, which silently dropped those tools and the agent reported
      // "j'ai pas de MCP".
      //
      // Read the Hermes config.yaml `mcp_servers:` block and pass its keys.
      // Fall back to `.mcp.json` only if the Hermes config has no mcp_servers.
      try {
        const hermesConfigPath = path.join(getSharedHermesHome(), 'config.yaml');
        if (fs.existsSync(hermesConfigPath)) {
          const yamlText = fs.readFileSync(hermesConfigPath, 'utf8');
          
          // Line-by-line YAML parser for the `mcp_servers` section (handles comments, varying indentation, and exits correctly)
          const lines = yamlText.split(/\r?\n/);
          let inMcpServers = false;
          const serverNames: string[] = [];
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            if (line.match(/^mcp_servers:\s*$/) || line.match(/^mcp_servers:\s*#.*$/)) {
              inMcpServers = true;
              continue;
            }
            
            if (inMcpServers) {
              const indentMatch = line.match(/^(\s+)/);
              if (!indentMatch) {
                inMcpServers = false;
                continue;
              }
              const keyMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/);
              if (keyMatch) {
                serverNames.push(keyMatch[1]);
              }
            }
          }
          if (serverNames.length > 0) {
            toolsetList.push(...serverNames);
          }
        }
        if (toolsetList.length === 0) {
          // Fallback: read .mcp.json (Overmind format) for any servers not in
          // Hermes config. This won't help if names don't match, but at least
          // surfaces the names to the user via the warning.
          const projectMcpPath = path.join(getWorkspaceDir(), '.mcp.json');
          if (fs.existsSync(projectMcpPath)) {
            const projectMcp = JSON.parse(fs.readFileSync(projectMcpPath, 'utf8'));
            const allServers = Object.keys(projectMcp?.mcpServers || {});
            toolsetList.push(...allServers);
          }
        }
      } catch (e) {
        logger.warn({ error: e }, '[HERMES_ARGS] Failed to read Hermes config.yaml for toolsets, continuing without --toolsets.');
      }
    }
    if (toolsetList.length > 0) {
      // Log which MCP servers are expected for this run — do NOT pass to CLI.
      // Hermes loads them via the isolated config.yaml; passing --toolsets
      // would produce `Warning: Unknown toolsets: mcp-<name>` noise with no benefit.
      logger.info(
        { agentName, expectedMcpServers: toolsetList },
        '[HERMES_ARGS] Expected MCP servers for this run (loaded via config.yaml, NOT via --toolsets).',
      );
    }
    if (sessionId) cleanArgs.push('--resume', sessionId);

    // Token fallback setup (same as ClaudeRunner)
    const FALLBACK_KEYS = ['AUTH_FALLBACK_1', 'AUTH_FALLBACK_2', 'AUTH_FALLBACK_3'];

    // ============================================================
    // TOKEN PREFIX → PROVIDER MAPPING (Hermes v0.16.0)
    // ============================================================
    // The token PREFIX is the most reliable signal for the provider.
    // We detect it from the literal value, NOT from a hardcoded env-var name,
    // because the same env-var name (e.g. ANTHROPIC_AUTH_TOKEN) can be reused
    // across providers when the user copy-pastes keys from one service to another.
    //
    // Convention (observed in real .env files and provider dashboards):
    //   MiniMax     → "sk-cp-..."  → env MINIMAX_API_KEY  (or MINIMAX_CN_API_KEY)
    //   Z.AI / GLM  → "32hex.32hex"  → env ZAI_ANTHROPIC_FALLBACK_KEY  (or GLM_API_KEY)
    //                 e.g. "c78a134949fc4c369911c24e9fa4b84c.OZhHX5Obs6qF1ISt"
    //   Z.AI alt    → 32-char hex (single block, no dot)  → env ZAI_ANTHROPIC_FALLBACK_KEY
    //                 e.g. "5f650035e5a845549e4765184d8179b1"
    //   Anthropic   → "sk-ant-..." → env ANTHROPIC_AUTH_TOKEN
    //   OpenAI      → "sk-..."     → env OPENAI_API_KEY  (no -ant, no -cp)
    //   OpenRouter  → "sk-or-..."  → env OPENROUTER_API_KEY (BLOCKED for LLM)
    //   Mistral     → (variable)   → env MISTRAL_API_KEY_*
    //   Other       → unknown      → env ANTHROPIC_AUTH_TOKEN (default Anthropic)
    //
    // NOTE: This function-local copy mirrors the canonical implementation in
    // src/services/hermesTokenResolver.ts. The runner uses these local closures
    // so it doesn't have to thread env/logger through every call site; the
    // canonical exported versions exist for testing and for any future caller
    // that wants the same behavior without instantiating NousHermesRunner.
    const TOKEN_PREFIX_PROVIDERS: Array<{ test: (t: string) => boolean; provider: string; envKey: string }> = [
      // Z.AI: c78a134949fc4c369911c24e9fa4b84c.OZhHX5Obs6qF1ISt (32hex.32hex — 2 blocks)
      { test: (t) => /^[0-9a-f]{32}\.[0-9a-zA-Z]+$/i.test(t), provider: 'zai', envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY' },
      // Z.AI: 5f6500...q3m3 (32-char hex single block, no dot, no dashes)
      { test: (t) => /^[0-9a-f]{32}$/i.test(t), provider: 'zai', envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY' },
      // MiniMax: sk-cp-...qNmo (with cp prefix)
      { test: (t) => t.startsWith('sk-cp-'), provider: 'minimax', envKey: 'MINIMAX_API_KEY' },
      // MiniMax: sk-mm-... (alternative prefix)
      { test: (t) => t.startsWith('sk-mm-'), provider: 'minimax', envKey: 'MINIMAX_API_KEY' },
      // Anthropic
      { test: (t) => t.startsWith('sk-ant-'), provider: 'anthropic', envKey: 'ANTHROPIC_AUTH_TOKEN' },
      // OpenRouter (BLOCKED for LLM, but we still detect it for diagnostic)
      { test: (t) => t.startsWith('sk-or-'), provider: 'openrouter', envKey: 'OPENROUTER_API_KEY' },
      // OpenAI (no -ant, no -cp, no -or)
      { test: (t) => t.startsWith('sk-'), provider: 'openai', envKey: 'OPENAI_API_KEY' },
      // Generic 16+ hex without dot — probably a Z.AI token variant
      { test: (t) => /^[0-9a-f]{16,}$/i.test(t), provider: 'zai', envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY' },
    ];

    function detectTokenProvider(token: string): { provider: string; envKey: string } {
      for (const rule of TOKEN_PREFIX_PROVIDERS) {
        if (rule.test(token)) return { provider: rule.provider, envKey: rule.envKey };
      }
      return { provider: 'unknown', envKey: 'ANTHROPIC_AUTH_TOKEN' };
    }

    // ============================================================
    // TOKEN RESOLUTION ORDER (settings.env first, then process.env, then detection)
    // ============================================================
    // See src/services/hermesTokenResolver.ts for the canonical exported version
    // and the rationale for the 3-pass strategy. The local closure below
    // captures agentCustomEnv, TOKEN_KEYS, agentName, logger, and tmpSettingsPath
    // from the enclosing scope so call sites stay terse.

    function resolveTokenWithDetection(
      explicitSettingsTokens: Array<{ key: string; value: string }>,
    ): { tokenEnvKey: string; tokenValue: string; detectedProvider: string; source: 'settings-explicit' | 'env-fallback' | 'detected' } | null {
      // Step 1: settings_<agent>.json env block takes ABSOLUTE priority
      // (whatever the user explicitly set in their agent config wins)
      if (explicitSettingsTokens.length > 0) {
        const t = explicitSettingsTokens[0];
        // If the value is a $VAR reference, RESOLVE it against process.env
        let resolvedValue = t.value;
        if (typeof t.value === 'string' && t.value.startsWith('$')) {
          const varName = t.value.slice(1);
          const fromEnv = process.env[varName];
          if (!fromEnv || fromEnv.length === 0) {
            // FAIL LOUD — do not silently fall back. The user explicitly asked
            // for THIS var, and it doesn't exist. Surface the misconfiguration.
            logger.error(
              {
                agentName,
                requestedVar: varName,
                requestedKey: t.key,
                settingsPath: tmpSettingsPath,
              },
              '[FAIL-LOUD] settings_<agent>.json references $' + varName + ' but it is not set in process.env. ' +
              'Either export it in the parent .env, or fix the reference in settings_<agent>.json. ' +
              'Refusing to fall back to a different credential.',
            );
            throw new Error(
              `MISSING_ENV_VAR: settings_<agent>.json env.${t.key}="$` + varName + '" ' +
              `but process.env.${varName} is empty. Add it to /home/demon/.overmind/.env or fix the settings reference.`,
            );
          }
          resolvedValue = fromEnv;
          logger.info(
            { agentName, sourceKey: t.key, referencedVar: varName, resolvedLen: resolvedValue.length },
            '[TOKEN_RESOLVER] Resolved $VAR reference from settings_<agent>.json against process.env.',
          );
        }
        const detected = detectTokenProvider(resolvedValue);
        logger.info(
          { agentName, tokenKey: t.key, detectedProvider: detected.provider, mappedTo: detected.envKey },
          '[TOKEN_RESOLVER] Using explicit settings_<agent>.json token, re-mapping to detected provider env var.',
        );
        return { tokenEnvKey: t.key, tokenValue: resolvedValue, detectedProvider: detected.provider, source: 'settings-explicit' };
      }

      // Step 2: iterate TOKEN_KEYS in priority order.
      //
      // Two passes are needed to avoid a re-map bug where a generic key
      // (e.g. ANTHROPIC_AUTH_TOKEN=sk-cp-...) would hijack a provider-specific
      // key the user explicitly set (e.g. MINIMAX_API_KEY=sk-cp-...-DIFFERENT).
      //
      // Pass A: prefer keys whose NAME matches the detected provider
      //         (e.g. tk='MINIMAX_API_KEY' with value sk-cp-* → use as-is).
      // Pass B: fall back to the first non-empty key, re-mapping its env-var
      //         name to match the detected provider prefix.
      //
      // We must scan ALL candidate values across BOTH passes to know which
      // provider each one is. So do a single scan that pairs (key, detected).

      type Candidate = { key: string; value: string; detected: ReturnType<typeof detectTokenProvider> };
      const candidates: Candidate[] = [];
      for (const tk of TOKEN_KEYS) {
        const v = agentCustomEnv[tk];
        if (v && typeof v === 'string' && v.length > 0) {
          candidates.push({ key: tk, value: v, detected: detectTokenProvider(v) });
        }
      }
      if (candidates.length === 0) return null;

      // Pass A: any candidate whose env-var name already matches its detected provider
      // (e.g. MINIMAX_API_KEY=sk-cp-...  →  detected.envKey='MINIMAX_API_KEY' → match).
      // TOKEN_KEYS ordering means provider-specific keys come first, so this preserves
      // the user's explicit choice over a generic-key re-map.
      for (const c of candidates) {
        if (c.detected.provider !== 'unknown' && c.detected.envKey === c.key) {
          return {
            tokenEnvKey: c.key,
            tokenValue: c.value,
            detectedProvider: c.detected.provider,
            source: 'env-fallback',
          };
        }
      }

      // Pass B: re-map the first candidate to the right provider env-var name.
      const first = candidates[0];
      if (first.detected.provider !== 'unknown' && first.detected.envKey !== first.key) {
        logger.info(
          { agentName, sourceKey: first.key, detectedProvider: first.detected.provider, remappedTo: first.detected.envKey },
          '[TOKEN_RESOLVER] Token prefix detected provider mismatch — re-mapping env var.',
        );
        return {
          tokenEnvKey: first.detected.envKey,
          tokenValue: first.value,
          detectedProvider: first.detected.provider,
          source: 'detected',
        };
      }

      // Pass C (rare): all candidates have provider='unknown' or envKey already matches.
      return {
        tokenEnvKey: first.key,
        tokenValue: first.value,
        detectedProvider: first.detected.provider,
        source: 'env-fallback',
      };
    }

    const getAvailableFallbacks = (): Array<{ key: string; value: string }> => {
      const fb: Array<{ key: string; value: string }> = [];
      for (const k of FALLBACK_KEYS) {
        const v = agentCustomEnv[k];
        if (v && typeof v === 'string' && v.length > 0) fb.push({ key: k, value: v });
      }
      return fb;
    };

    const getTokenForIndex = (idx: number): { tokenEnvKey: string; tokenValue: string } | null => {
      if (idx === 0) {
        // Use the RAW (pre-interpolation) settings tokens captured at load time.
        // This way, if the user set "$GLM_API_KEY_Y" in settings, we can detect
        // that it was a $VAR reference and fail-loud if it's not in process.env.
        // Reading tmpSettingsPath here would be too late (it's deleted by
        // cleanupTmpFiles() before this runs in some code paths).
        const explicitSettingsTokens = rawExplicitSettingsTokens;

        // The resolver may throw MISSING_ENV_VAR if a $VAR in settings is unresolved.
        // We catch and surface it as a clear NO_LLM_TOKEN error (the caller wraps it).
        const resolved = resolveTokenWithDetection(explicitSettingsTokens);
        if (resolved) return { tokenEnvKey: resolved.tokenEnvKey, tokenValue: resolved.tokenValue };

        // Diagnostic: dump which keys were checked and their (masked) state so a future
        // EXIT_CODE_1 + 401 has a clear breadcrumb back to the empty/missing credential.
        const probe = TOKEN_KEYS.map((tk) => {
          const v = agentCustomEnv[tk];
          if (typeof v !== 'string' || v.length === 0) return `${tk}=<empty>`;
          return `${tk}=<set len=${v.length}>`;
        });
        logger.error(
          { agentName, checked: probe, settingsPath: tmpSettingsPath, envFile: path.join(overmindHermesSubPath, '.env') },
          'No usable LLM token found. Check settings_<agent>.json env block and the agent .hermes/.env file.',
        );
        return null;
      }
      const fb = getAvailableFallbacks();
      return fb[idx - 1] ? { tokenEnvKey: fb[idx - 1].key, tokenValue: fb[idx - 1].value } : null;
    };

    const isRetryableError = (stderr: string): boolean => {
      const lower = stderr.toLowerCase();
      return lower.includes('401') || lower.includes('unauthorized') ||
        lower.includes('invalid api key') || lower.includes('authentication failed') ||
        lower.includes('invalid authentication') || lower.includes('429') ||
        lower.includes('rate limit') || lower.includes('quota exhausted') ||
        lower.includes('limit exhausted') || lower.includes('503') ||
        lower.includes('service unavailable') || lower.includes('500') ||
        lower.includes('internal server error');
    };

    // HERMES_HOME setup — the SHARED root, not the per-agent home.
    // Hermes upstream resolves `agents/<name>/`, `config.yaml`, `auth.json`, etc.
    // relative to this single root. We do NOT seed `agentCustomEnv.HERMES_HOME`
    // here anymore because spawnHermes() sets it explicitly from getSharedHermesHome().
    const sharedHome = getSharedHermesHome();
    if (!fs.existsSync(overmindHermesSubPath)) fs.mkdirSync(overmindHermesSubPath, { recursive: true });

    // ============================================================
    // 2.8.37 — BOOTSTRAP MINIMAL config.yaml IN OVERRIDDEN HERMES_HOME
    // ============================================================
    // When we redirect HERMES_HOME to <workspace>/.overmind/hermes/ (the
    // Overmind-shared root), Hermes upstream has NO config.yaml in that
    // path yet. It only writes one after the FIRST successful startup. But
    // for the FIRST startup, the agent would have ZERO MCP servers
    // registered (because mcp_servers: lives in config.yaml). That was the
    // root cause of "le sniperbot n'a pas de MCP" — the sniperbot_analyst
    // was being spawned with HERMES_HOME pointing at an empty dir.
    //
    // Fix: at spawn time, if <sharedHome>/config.yaml doesn't exist, write
    // a minimal one copied from the default ~/.hermes/config.yaml. The user
    // can also point OVERMIND_HERMES_CONFIG_TEMPLATE at a custom file. We
    // preserve anything Hermes has already written in <sharedHome>/config.yaml
    // (e.g. if the user already has a real config there, we don't overwrite it).
    const sharedConfigPath = path.join(sharedHome, 'config.yaml');
    if (!fs.existsSync(sharedConfigPath)) {
      // Look for a source config to copy: default Hermes home, then env override
      const defaultHermesHome = process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'hermes')
        : path.join(process.env.HOME || '~', '.hermes');
      const defaultConfigPath = process.env.OVERMIND_HERMES_CONFIG_TEMPLATE
        || path.join(defaultHermesHome, 'config.yaml');
      if (fs.existsSync(defaultConfigPath)) {
        try {
          fs.copyFileSync(defaultConfigPath, sharedConfigPath);
          logger.info(
            { sharedHome, sourceConfig: defaultConfigPath },
            '[HERMES_HOME] Bootstrapped minimal config.yaml from default Hermes home (2.8.37).',
          );
        } catch (e) {
          logger.warn({ error: e, defaultConfigPath }, '[HERMES_HOME] Failed to bootstrap config.yaml; will create empty one.');
          fs.writeFileSync(sharedConfigPath, 'mcp_servers: {}\n', 'utf8');
        }
      } else {
        // No default config to copy — write a stub that the user can fill in.
        fs.writeFileSync(sharedConfigPath, 'mcp_servers: {}\n', 'utf8');
        logger.warn(
          { defaultConfigPath, sharedConfigPath },
          '[HERMES_HOME] No default Hermes config.yaml found. Wrote empty stub. MCP servers will not be available until you populate this file.',
        );
      }
    }
    // HOME / USERPROFILE override: point Hermes at the parent .overmind dir,
    // NOT the cwd. This makes relative .hermes lookups inside Hermes
    // (e.g. `~/.hermes/.env` resolution) resolve to the same canonical
    // location regardless of where the spawn came from.
    if (process.platform === 'win32') agentCustomEnv.USERPROFILE = overmindHermesPath;
    else agentCustomEnv.HOME = overmindHermesPath;

    // AbortSignal
    if (options.signal?.aborted) return Promise.reject(new Error('ABORTED'));

    // ═══════════════════════════════════════════════════════════════════════════
    // MISE À JOUR settings.json Hermes natif (2.8.45)
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // Le runner LIT et ÉCRIT dans le MÊME fichier :
    //   <HERMES_HOME>/agents/<name>/settings.json
    //
    // Cycle complet :
    //   1. LECTURE  : settings.json → interpolation $VAR → agentCustomEnv
    //   2. DÉTECTION: token prefix (sk-cp-* → MiniMax, 32hex → Z.AI, etc.)
    //   3. INJECTION: MINIMAX_CN_API_KEY, MINIMAX_CN_BASE_URL, etc. auto-injectés
    //   4. ÉCRITURE : settings.json mis à jour avec les clés injectées
    //   5. SPAWN    : hermes chat -q avec HERMES_HOME = runs/<name>/
    //
    // ❌ Overmind NE convertit PAS depuis .claude/ — c'est le chemin Claude/Kilo.
    // ✅ settings.json est géré par l'utilisateur ET mis à jour par Overmind.
    //    Les $VAR restent en tant que littéraux après la première résolution.
    //    Pour changer un credential, éditer directement settings.json.
    //
    // Autres fichiers gérés par Hermes upstream (ne pas toucher) :
    //   config.yaml, auth.json, sessions/, logs/
    if (agentName) {
      const agentHome = overmindHermesSubPath; // = <HERMES_HOME>/agents/<name>/
      if (!fs.existsSync(agentHome)) fs.mkdirSync(agentHome, { recursive: true });

      // Build the canonical Hermes settings.json from the agent's settings_<name>.json.
      // We preserve: env, enableAllProjectMcpServers, enabledMcpjsonServers, agent, runner.
      // We do NOT touch: config.yaml, auth.json, .env — Hermes upstream owns those.
      const tmpAgentSettings = path.join(agentHome, 'settings.json');
      const settingsJson: Record<string, unknown> = {};
      // Read the interpolated settings the runner just merged (line ~412 above)
      // and copy the Hermes-relevant fields. We don't re-interpolate here because
      // the caller already did it on the raw `settings` object.
      if (tmpSettingsPath && fs.existsSync(tmpSettingsPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(tmpSettingsPath, 'utf8'));
          if (raw.env) settingsJson.env = { ...raw.env };
          if (raw.enableAllProjectMcpServers !== undefined) {
            settingsJson.enableAllProjectMcpServers = raw.enableAllProjectMcpServers;
          }
          if (Array.isArray(raw.enabledMcpjsonServers)) {
            settingsJson.enabledMcpjsonServers = raw.enabledMcpjsonServers;
          }
        } catch (e) {
          logger.warn({ tmpSettingsPath, error: e }, 'Failed to read tmp settings for canonical write');
        }
      }

      // ============================================================
      // 2.8.31 — INJECT PROVIDER-SPECIFIC ENV VARS INTO settings.json
      // ============================================================
      // The Hermes plugins (e.g. `minimax`, `zai`, `openai`) read PROVIDER-
      // SPECIFIC env vars from the per-agent settings.json — NOT the generic
      // `ANTHROPIC_AUTH_TOKEN`. For example the `minimax-cn` plugin reads
      // `MINIMAX_CN_API_KEY`, and the `minimax` (GLOBAL) plugin reads
      // `MINIMAX_API_KEY`. If those vars aren't in the agent's settings.json,
      // the plugin can't find the credential and the upstream falls back to
      // the wrong provider (we saw it pick `openrouter` or `nvidia` instead
      // of `minimax-cn`).
      //
      // We inject by:
      //   1. Detecting the provider from the user's ANTHROPIC_BASE_URL hint
      //      (api.minimaxi.com → CN, api.minimax.io → GLOBAL, etc.).
      //   2. For MiniMax: ONLY seed the matching env var (CN vs GLOBAL) so
      //      the upstream plugin's first-match resolver picks the right one.
      //      Do NOT seed both — that was the bug in 2.8.30 (caused it to pick
      //      GLOBAL even when the URL was CN).
      //   3. For Z.AI: seed ZAI_ANTHROPIC_FALLBACK_KEY + GLM_API_KEY.
      //   4. Leave ANTHROPIC_AUTH_TOKEN in place as a fallback (some Hermes
      //      code paths still read it generically).
      const envObj = settingsJson.env as Record<string, string> | undefined;
      if (envObj) {
        const baseUrl = (envObj['ANTHROPIC_BASE_URL'] || '').toLowerCase();
        const anthropicToken = envObj['ANTHROPIC_AUTH_TOKEN'] || envObj['ANTHROPIC_API_KEY'] || '';
        if (anthropicToken && (anthropicToken.startsWith('sk-cp-') || anthropicToken.startsWith('sk-mm-'))) {
          // MiniMax token — pick CN vs GLOBAL based on URL
          if (baseUrl.includes('minimaxi')) {
            // CN: api.minimaxi.com
            envObj['MINIMAX_CN_API_KEY'] = anthropicToken;
            // The Hermes `providers.py` resolver reads `MINIMAX_CN_BASE_URL`
            // (NOT just `ANTHROPIC_BASE_URL`) to dispatch to the CN plugin
            // profile. Seed it explicitly so the provider resolver picks
            // `minimax-cn` (not `minimax` GLOBAL on first-match).
            envObj['MINIMAX_CN_BASE_URL'] = 'https://api.minimaxi.com/anthropic';
            logger.info(
              { agentName, cnApiKeySet: true, cnBaseUrlSet: true, globalApiKeySet: false, detectedFrom: 'api.minimaxi.com (CN)' },
              '[SETTINGS_JSON] Seeded MINIMAX_CN_API_KEY + MINIMAX_CN_BASE_URL (CN plugin resolver).',
            );
          } else if (baseUrl.includes('minimax') || baseUrl === '') {
            // GLOBAL: api.minimax.io, OR no URL hint (default to CN per OVERMIND_MINIMAX_DEFAULT=cn)
            const defaultCn = (process.env.OVERMIND_MINIMAX_DEFAULT || 'cn').toLowerCase() === 'cn';
            if (defaultCn) {
              envObj['MINIMAX_CN_API_KEY'] = anthropicToken;
              envObj['MINIMAX_CN_BASE_URL'] = 'https://api.minimaxi.com/anthropic';
              logger.info(
                { agentName, detectedFrom: 'no URL + OVERMIND_MINIMAX_DEFAULT=cn' },
                '[SETTINGS_JSON] Seeded MINIMAX_CN_API_KEY + MINIMAX_CN_BASE_URL (default CN per OVERMIND_MINIMAX_DEFAULT).',
              );
            } else {
              envObj['MINIMAX_API_KEY'] = anthropicToken;
              envObj['MINIMAX_BASE_URL'] = 'https://api.minimax.io/anthropic';
              logger.info(
                { agentName, detectedFrom: 'api.minimax.io (GLOBAL)' },
                '[SETTINGS_JSON] Seeded MINIMAX_API_KEY + MINIMAX_BASE_URL (GLOBAL plugin resolver).',
              );
            }
          }
        } else if (anthropicToken && /^[0-9a-f]{32}(\.[0-9a-zA-Z]+)?$/i.test(anthropicToken)) {
          // Z.AI token (32hex or 32hex.32hex)
          envObj['ZAI_ANTHROPIC_FALLBACK_KEY'] = anthropicToken;
          envObj['GLM_API_KEY'] = anthropicToken;
          logger.info(
            { agentName },
            '[SETTINGS_JSON] Seeded ZAI_ANTHROPIC_FALLBACK_KEY + GLM_API_KEY (Z.AI token).',
          );
        }
      }

      // Always declare the agent name + runner so Hermes can route to the right MCP servers.
      settingsJson.agent = agentName;
      settingsJson.runner = 'hermes';
      fs.writeFileSync(tmpAgentSettings, JSON.stringify(settingsJson, null, 2) + '\n', 'utf8');
      // 2.8.32: DO NOT push tmpAgentSettings to this.tempFiles — the
      // canonical settings.json is the AGENT'S PERMANENT Hermes config,
      // not a temp file. cleanupTempFiles() (called in finally + after
      // spawn) would otherwise unlink it on every spawn, forcing the
      // Hermes upstream plugin resolver to re-derive provider routing
      // from the (now-empty) .env block on the next run. This was the
      // root cause of the 13:51 "Erreur inconnue" — manual settings.json
      // edits were being silently deleted after each spawn.
      logger.info(
        { agentName, settingsPath: tmpAgentSettings, envKeys: Object.keys((settingsJson.env as object) || {}).length },
        '[HERMES] Wrote canonical agents/<name>/settings.json (env block from settings_<name>.json + provider-specific seeds).',
      );
    }

    let effectiveHermesHome = sharedHome;
    if (agentName && enabledInSettings.length > 0) {
      try {
        const runsDir = path.join(sharedHome, 'runs');
        if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
        
        const runHome = path.join(runsDir, agentName);
        if (!fs.existsSync(runHome)) fs.mkdirSync(runHome, { recursive: true });
        
        // Copy auth.json if exists
        const sharedAuth = path.join(sharedHome, 'auth.json');
        const runAuth = path.join(runHome, 'auth.json');
        if (fs.existsSync(sharedAuth)) {
          fs.copyFileSync(sharedAuth, runAuth);
        }
        
        // Robust directory junction/symlink helper
        const linkDirRobust = (target: string, source: string) => {
          if (!fs.existsSync(source)) {
            try {
              fs.mkdirSync(source, { recursive: true });
            } catch (e) {
              logger.warn({ source, error: e }, '[HERMES_HOME] Failed to create link source directory');
            }
          }
          let exists = false;
          let stats: fs.Stats | null = null;
          try {
            stats = fs.lstatSync(target);
            exists = true;
          } catch {
            // target does not exist
          }
          if (exists) {
            logger.debug(
              { target, isJunction: stats ? (stats.isSymbolicLink() || stats.isDirectory()) : false },
              '[HERMES_HOME] Target directory/link already exists. Skipping link creation.'
            );
          } else {
            logger.info({ target, source }, '[HERMES_HOME] Creating junction/symbolic link.');
            if (process.platform === 'win32') {
              try {
                fs.symlinkSync(source, target, 'junction');
              } catch {
                // Junction may already exist — ignore
              }
            } else {
              fs.symlinkSync(source, target);
            }
          }
        };

        // Link agents directory
        const sharedAgents = path.join(sharedHome, 'agents');
        const runAgents = path.join(runHome, 'agents');
        linkDirRobust(runAgents, sharedAgents);
        
        // Link sessions directory
        const sharedSessions = path.join(sharedHome, 'sessions');
        const runSessions = path.join(runHome, 'sessions');
        linkDirRobust(runSessions, sharedSessions);
        
        // Generate filtered config.yaml
        const sharedConfig = path.join(sharedHome, 'config.yaml');
        const runConfig = path.join(runHome, 'config.yaml');
        const filteredConfig = filterConfigYaml(sharedConfig, enabledInSettings);
        fs.writeFileSync(runConfig, filteredConfig, 'utf8');
        
        effectiveHermesHome = runHome;
        logger.info(
          { agentName, runHome, enabledMcp: enabledInSettings },
          '[HERMES_HOME] Isolated agent Hermes Home and filtered config.yaml successfully.',
        );
      } catch (e) {
        logger.warn({ error: e }, 'Failed to setup isolated run home; falling back to sharedHome');
      }
    }

    // AbortSignal
    if (options.signal?.aborted) return Promise.reject(new Error('ABORTED'));
    let currentChildRef: ChildProcess | null = null;

    return new Promise((resolve) => {
      let resolved = false;
      let retryCount = 0;
      const maxRetries = getAvailableFallbacks().length + 1;
      let currentSessionId: string | undefined = sessionId;

      const abortListener = () => {
        if (currentChildRef) {
          killProcessTree(currentChildRef).then(() => {
            cleanupTmpFiles();
            safeResolve({ result: '', error: 'ABORTED', rawOutput: '' });
          });
        } else {
          cleanupTmpFiles();
          safeResolve({ result: '', error: 'ABORTED', rawOutput: '' });
        }
      };

      const safeResolve = (v: RunAgentResult) => {
        if (!resolved) {
          resolved = true;
          if (options.signal) {
            options.signal.removeEventListener('abort', abortListener);
          }
          resolve(v);
        }
      };

      const cleanupTmpFiles = () => {
        for (const f of [tmpSettingsPath, tmpMcpPath]) {
          if (f && fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* ignored */ } }
        }
      };

      const spawnHermes = async (tokenInfo: { tokenEnvKey: string; tokenValue: string } | null) => {
        const spawnEnv: Record<string, string> = { ...process.env as Record<string, string>, ...agentCustomEnv as Record<string, string> };
        if (tokenInfo) {
          // Purge ALL known LLM provider env vars from the spawn env. We
          // re-seed ONLY the ones this agent actually uses, derived from the
          // token prefix. Without this purge, a stale `MINIMAX_CN_API_KEY` or
          // `ZAI_ANTHROPIC_FALLBACK_KEY` left over from a previous provider
          // (e.g. in `Workflow/.env`) can shadow the correct credential.
          for (const tk of TOKEN_KEYS) delete spawnEnv[tk];
          // Also purge provider-specific env vars that the user might have
          // left in the workflow .env (e.g. Z.AI legacy keys) but that don't
          // match the agent's current provider.
          for (const stale of [
            'MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY',
            'ZAI_ANTHROPIC_FALLBACK_KEY', 'GLM_API_KEY',
            'Z_AI_API_KEY', 'Z_AI_BASE_URL', 'GLM_BASE_URL',
            'NVIDIA_API_KEY', 'NVIDIA_API_BASE',
          ]) {
            delete spawnEnv[stale];
          }
          let resolvedToken = tokenInfo.tokenValue;
          if (resolvedToken.startsWith('$')) resolvedToken = process.env[resolvedToken.slice(1)] || resolvedToken;
          spawnEnv[tokenInfo.tokenEnvKey] = resolvedToken;

          // ============================================================
          // 2.8.30 — Seed provider-specific env vars for Hermes plugins.
          // ============================================================
          // The Hermes plugins read provider-specific env vars, not the
          // generic `ANTHROPIC_AUTH_TOKEN`. For example the `minimax` plugin
          // reads `MINIMAX_CN_API_KEY` (CN) or `MINIMAX_API_KEY` (GLOBAL),
          // and the `zai` plugin reads `ZAI_ANTHROPIC_FALLBACK_KEY`.
          //
          // Without this seed, Hermes falls back to the WRONG plugin (we saw
          // it pick `nvidia` because `ANTHROPIC_BASE_URL` wasn't set yet and
          // it could match an NVIDIA-style model name pattern). The fix is
          // tiny: when we know the token prefix (e.g. `sk-cp-` for MiniMax),
          // ALSO seed the provider-specific env var that the upstream plugin
          // actually reads. Reference: the .bat launchers do the same.
          //
          // We do NOT write to the agent's `.hermes/.env` file anymore —
          // this is a process-env-only seed, scoped to this single spawn.
          if (resolvedToken.startsWith('sk-cp-') || resolvedToken.startsWith('sk-mm-')) {
            // MiniMax token — seed BOTH env vars so either CN or GLOBAL plugin
            // can pick it up. The plugin's own URL/host detection will pick
            // the right one.
            spawnEnv['MINIMAX_CN_API_KEY'] = resolvedToken;
            spawnEnv['MINIMAX_API_KEY'] = resolvedToken;
            logger.info(
              { agentName, envKey: tokenInfo.tokenEnvKey, alsoSeeded: ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'] },
              '[SPAWN_ENV] Seeded MiniMax provider-specific env vars from sk-cp-* token (plugin compat).',
            );
          } else if (/^[0-9a-f]{32}(\.[0-9a-zA-Z]+)?$/i.test(resolvedToken)) {
            // Z.AI token (32hex or 32hex.32hex) — seed Z.AI env vars.
            spawnEnv['ZAI_ANTHROPIC_FALLBACK_KEY'] = resolvedToken;
            spawnEnv['GLM_API_KEY'] = resolvedToken;
            logger.info(
              { agentName, envKey: tokenInfo.tokenEnvKey, alsoSeeded: ['ZAI_ANTHROPIC_FALLBACK_KEY', 'GLM_API_KEY'] },
              '[SPAWN_ENV] Seeded Z.AI provider-specific env vars from 32hex token (plugin compat).',
            );
          }
        }

        // BLOCK: OpenRouter is for embeddings only — never pass to Hermes for LLM inference
        delete spawnEnv['OPENROUTER_API_KEY'];
        delete spawnEnv['OPENROUTER_BASE_URL'];
        delete spawnEnv['OVERMIND_EMBEDDING_KEY'];

        const hermesBin = await findHermesBinary();
        const isWin = process.platform === 'win32';
        const venvRoot = process.env.HERMES_AGENT_ROOT
          || (isWin
            ? path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv')
            : path.join(process.env.HOME || '', '.local', 'share', 'hermes-agent', 'venv'));
        // Only override VIRTUAL_ENV/PATH when hermes actually lives inside a venv
        // (i.e. <venv>/bin/hermes or <venv>/Scripts/hermes.exe). If the binary is a
        // system install (e.g. /usr/local/bin/hermes), leave the parent PATH alone.
        const venvBin = isWin ? path.join(venvRoot, 'Scripts') : path.join(venvRoot, 'bin');
        const isVenvInstall = hermesBin.startsWith(venvBin + path.sep) || hermesBin === venvBin;
        const pathSep = isWin ? ';' : ':';
        // 2.8.30: HERMES_HOME is the SHARED root, not the per-agent home.
        // Hermes upstream resolves `agents/<name>/`, `config.yaml`, `auth.json`,
        // etc. relative to HERMES_HOME. Setting it to the per-agent home would
        // tell Hermes "this IS the Hermes root" and make it look for config.yaml
        // IN the agent dir — wrong layout.
        const child: ChildProcess = spawn(hermesBin, cleanArgs, {
          cwd, shell: false, windowsHide: true,
          env: {
            ...spawnEnv,
            HERMES_HOME: effectiveHermesHome,
            ...(isVenvInstall
              ? {
                  VIRTUAL_ENV: venvRoot,
                  PATH: `${venvRoot}${isWin ? ';' : ':'}${venvBin}${pathSep}${process.env.PATH || ''}`,
                }
              : {}),
          },
        });
        currentChildRef = child;

        if (child.pid) {
          void registerProcess(child.pid, { agentName: agentName || '', runner: 'hermes', configPath });
          void registerLiveAgent({
            pid: child.pid, runner: 'hermes', agentName: agentName || '',
            sessionId: currentSessionId || '',
            cleanupFn: async () => { await killProcessTree(child); },
            childRef: child,
          });
          child.once('exit', (code) => {
            setLiveStatus(child.pid!, code === 0 ? 'done' : 'failed', code ?? null);
            void unregisterLiveAgent(child.pid!);
          });
        }

        let stdout = ''; let stderr = '';
        child.stdout?.on('data', (d: Buffer) => {
          const chunk = d.toString();
          if (child.pid) { void appendOutput(child.pid, chunk, configPath); void appendLiveOutput(child.pid, chunk); }
          if (stdout.length + chunk.length > this.MAX_BUF) stdout = stdout.slice(-this.MAX_BUF); else stdout += chunk;
          if (!silent && agentName) process.stderr.write(`[Hermes:${agentName}] ${chunk}`);
        });
        child.stderr?.on('data', (d: Buffer) => {
          const chunk = d.toString();
          if (stderr.length + chunk.length > this.MAX_BUF) stderr = stderr.slice(-this.MAX_BUF); else stderr += chunk;
          if (!silent && agentName) process.stderr.write(`[Hermes:${agentName}:ERR] ${chunk}`);
        });

        const timer = setTimeout(() => {
          if (child.stdin && !child.stdin.destroyed) { try { child.stdin.write('\n'); } catch { /* ignore */ } }
          setTimeout(async () => {
            await killProcessTree(child);
            cleanupTmpFiles();
            safeResolve({ result: '', error: 'HARD_TIMEOUT', rawOutput: stdout + stderr });
          }, HARD_TIMEOUT_MS);
        }, timeoutMs);

        child.on('close', async (code: number | null) => {
          clearTimeout(timer);
          if (child.pid) void updateProcessStatus(child.pid, code === 0 ? 'done' : 'failed', code, configPath);

          const sessionMatch = stdout.match(/session_id:\s*(\S+)/i) || 
                               stderr.match(/session_id:\s*(\S+)/i) || 
                               stdout.match(/Session:\s*(\S+)/) || 
                               stderr.match(/Session:\s*(\S+)/);
          if (sessionMatch) currentSessionId = sessionMatch[1];


          const retryable = isRetryableError(stderr) || isRetryableError(stdout);
          if (code !== 0 && retryable && retryCount < maxRetries) {
            retryCount++;
            const ti = getTokenForIndex(retryCount);
            if (!silent) {
              process.stderr.write(`\n\x1b[41m\x1b[37m[NousHermesRunner] Retry ${retryCount}/${maxRetries} avec ${ti?.tokenEnvKey || 'UNKNOWN'}...\x1b[0m\n`);
            }
            await killProcessTree(child);
            setImmediate(() => spawnHermes(ti));
            return;
          }

          cleanupTmpFiles();
          if (currentSessionId && agentName) {
            await saveSessionId(agentName, currentSessionId, configPath, 'hermes');
            if (child.pid) void linkSessionToPid(currentSessionId, child.pid, configPath);
          }

          if (code !== 0 && !stdout.trim()) {
            safeResolve({ result: '', error: `EXIT_CODE_${code}`, rawOutput: stderr || stdout, sessionId: currentSessionId });
            return;
          }
          safeResolve({ result: stdout.trim(), sessionId: currentSessionId, rawOutput: stdout });
        });

        child.on('error', (err: Error) => {
          clearTimeout(timer);
          killProcessTree(child).then(() => {
            cleanupTmpFiles();
            safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
          });
        });
      };

      if (options.signal) {
        options.signal.addEventListener('abort', abortListener);
      }

      let firstToken: { tokenEnvKey: string; tokenValue: string } | null;
      try {
        firstToken = getTokenForIndex(0);
      } catch (e) {
        // getTokenForIndex throws MISSING_ENV_VAR when settings_<agent>.json references
        // a $VAR that doesn't exist in process.env. Surface it as a clear error.
        const msg = e instanceof Error ? e.message : String(e);
        logger.error({ agentName, error: msg }, '[NO_LLM_TOKEN] Token resolution failed.');
        safeResolve({
          result: '',
          error: `NO_LLM_TOKEN: ${msg}`,
          rawOutput: '',
        });
        return;
      }
      if (!firstToken && agentName) {
        // No credential was resolved at all — refuse to spawn hermes with an empty
        // API key (which would silently 401 and report the misleading EXIT_CODE_1).
        // The diagnostic log inside getTokenForIndex(0) already lists the checked keys.
        const settingsHint = tmpSettingsPath
          ? `Look at ${tmpSettingsPath} (env block) and ${path.join(overmindHermesSubPath, '.env')}.`
          : `No settings_${agentName}.json was loaded. Check the .claude/ folder.`;
        safeResolve({
          result: '',
          error: `NO_LLM_TOKEN: settings_<agent>.json env block is empty or missing required keys (${TOKEN_KEYS.join(', ')}). ${settingsHint}`,
          rawOutput: '',
        });
        return;
      }
      spawnHermes(firstToken);
    });
  }
}
