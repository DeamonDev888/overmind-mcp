import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadEnvQuietly } from './loadEnv.js';

export interface ConfigType {
  CLAUDE: {
    CORE: string;
    PERMISSIONS: string;
    PATHS: {
      SETTINGS: string;
      MCP: string;
    };
  };
  KILO: {
    CORE: string;
    DEFAULT_MODEL: string;
    PATHS: {
      SETTINGS: string;
    };
  };
  HERMES: {
    CORE: string;
    DEFAULT_MODEL: string;
    PATHS: {
      SETTINGS: string;
    };
  };
  TIMEOUT_MS: number;
  HARD_TIMEOUT_MS: number;
  KEEPALIVE_INTERVAL_MS: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Version read from package.json at build time
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let PKG_VERSION = '2.7.0';
try {
  const pkg = require('../../package.json');
  PKG_VERSION = pkg.version || PKG_VERSION;
} catch { /* fallback */ }

export { PKG_VERSION };

export const DEFAULT_CONFIG: ConfigType = {
  TIMEOUT_MS: 900000, // 15 minutes
  KEEPALIVE_INTERVAL_MS: 300000, // 5 minutes (must be < TIMEOUT_MS to actually extend)
  HARD_TIMEOUT_MS: 60000, // 1 minute extra after keepalive
  CLAUDE: {
    CORE: '--output-format json',
    PERMISSIONS: process.env.OVERMIND_CLAUDE_PERMISSIONS || '--dangerously-skip-permissions',
    PATHS: {
      SETTINGS: './.claude/settings.json',
      MCP: '.mcp.json',
    },
  },
  KILO: {
    CORE: '--auto',
    DEFAULT_MODEL: 'step 3.5 flash',
    PATHS: {
      SETTINGS: './.claude/settings.json',
    },
  },
  HERMES: {
    CORE: 'chat -q',
    DEFAULT_MODEL: 'MiniMax-M3',
    PATHS: {
      SETTINGS: './.claude/settings.json',
    },
  },
};

// Deep clone to prevent shared references with DEFAULT_CONFIG
export const CONFIG: ConfigType = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

let cachedWorkspaceDir: string | null = null;

export function resetWorkspaceCache() {
  cachedWorkspaceDir = null;
}

/** Validate agent name to prevent path traversal */
export function isValidAgentName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name) && name.length > 0 && name.length <= 128;
}

export function getWorkspaceDir(): string {
  if (cachedWorkspaceDir && process.env.NODE_ENV !== 'test') return cachedWorkspaceDir;

  let workspaceDir = '';
  if (process.env.OVERMIND_WORKSPACE) {
    workspaceDir = path.resolve(process.env.OVERMIND_WORKSPACE);
  } else {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, '.mcp.json')) ||
      fs.existsSync(path.join(cwd, '.mcp.local.json'))
    ) {
      workspaceDir = cwd;
    } else {
      let current = cwd;
      while (path.dirname(current) !== current) {
        if (
          fs.existsSync(path.join(current, '.mcp.json')) ||
          fs.existsSync(path.join(current, '.mcp.local.json'))
        ) {
          workspaceDir = current;
          break;
        }
        current = path.dirname(current);
      }

      if (!workspaceDir) {
        const codeRoot = path.resolve(__dirname, '../..');
        if (
          fs.existsSync(path.join(codeRoot, '.mcp.json')) ||
          fs.existsSync(path.join(codeRoot, '.mcp.local.json'))
        ) {
          workspaceDir = codeRoot;
        } else {
          const homedir = os.homedir();
          workspaceDir = path.join(homedir, '.overmind-mcp');
          try {
            if (!fs.existsSync(workspaceDir)) {
              fs.mkdirSync(workspaceDir, { recursive: true });
              fs.writeFileSync(
                path.join(workspaceDir, '.mcp.json'),
                JSON.stringify({ mcpServers: {} }, null, 2),
              );
            }
          } catch {
            // Permission errors — fall back to cwd
            workspaceDir = cwd;
          }
        }
      }
    }
  }

  // Load environment from workspace and related projects
  loadEnvQuietly(path.join(workspaceDir, '.env'));
  // Allow an optional external .env to be loaded via env var (prevents hardcoded path assumptions)
  const externalEnvPath = process.env.OVERMIND_EXTERNAL_ENV_PATH;
  if (externalEnvPath) {
    loadEnvQuietly(path.resolve(externalEnvPath));
  }

  cachedWorkspaceDir = workspaceDir;
  return workspaceDir;
}

// NOTE: getWorkspaceDir() is NOT called automatically at import time.
// It is called lazily on first access (see getWorkspaceDir() body above).
// This prevents the cache from being polluted by premature cwd resolution
// when the module is imported by an MCP server before OVERMIND_WORKSPACE is set.
// Callers MUST call resetWorkspaceCache() if OVERMIND_WORKSPACE changes.

export function resolveConfigPath(configPath: string, workspaceDirOverride?: string): string {
  if (path.isAbsolute(configPath)) return configPath;

  const workspaceDir = workspaceDirOverride || getWorkspaceDir();
  const fullPath = path.resolve(workspaceDir, configPath);

  // Prevent path traversal beyond workspace
  if (!fullPath.startsWith(path.resolve(workspaceDir))) {
    throw new Error(`Path traversal detected: ${configPath} resolves outside workspace`);
  }

  // Special handling for MCP config to support .local variant
  if (configPath === '.mcp.json' && !fs.existsSync(fullPath)) {
    const localPath = path.resolve(workspaceDir, '.mcp.local.json');
    if (fs.existsSync(localPath)) return localPath;
  }

  return fullPath;
}

export function updateConfig(newSettingsPath?: string, newMcpPath?: string) {
  if (newSettingsPath) CONFIG.CLAUDE.PATHS.SETTINGS = newSettingsPath;
  if (newMcpPath) CONFIG.CLAUDE.PATHS.MCP = newMcpPath;
}

/**
 * Resolve the canonical Hermes *agent home* directory for an Overmind agent.
 *
 * Overmind+Hermes uses a **single shared HERMES_HOME** rooted at
 * `<workspace>/.overmind/hermes/` (or `OVERMIND_HERMES_HOME` if explicitly set).
 * Per-agent state lives in the standard Hermes layout under that root:
 *
 *   <hermesHome>/agents/<name>/settings.json   ← per-agent env + persona
 *   <hermesHome>/agents/<name>/SOUL.md         ← per-agent system prompt
 *   <hermesHome>/config.yaml                   ← global, managed by Hermes upstream
 *   <hermesHome>/auth.json                     ← global, managed by Hermes upstream
 *   <hermesHome>/sessions/, logs/, etc.        ← global, managed by Hermes upstream
 *
 * Why a SHARED HERMES_HOME (not a per-agent .hermes dir)?
 *   1. **Hermes upstream's own layout** is `~/.hermes/agents/<name>/` (see
 *      `appdirs`-style resolution in `hermes_agent.agents.AgentConfig`).
 *      Inventing `Workflow/.overmind/hermes/agent_<name>/.hermes/` doubled the
 *      files we had to keep in sync and caused credential drift.
 *   2. **Shared config.yaml / auth.json** means a single credential pool
 *      across all agents — no need to re-pick + re-prune per agent.
 *   3. **The launcher .bat** at `C:\Users\Deamon\Desktop\launcher\Hermes-MiniMax-2.bat`
 *      proves this works with a stock `HERMES_HOME=C:\Users\Deamon\AppData\Local\hermes`
 *      + `agents/<name>/settings.json` — no polyglot, no special wrapper.
 *
 * Resolution order (deterministic, multi-OS, multi-install):
 *   1. `OVERMIND_HERMES_HOME` env var (operator-declared, e.g. via systemd
 *      EnvironmentFile) — wins if set, because the operator declared it
 *      explicitly. The runner just trusts it.
 *   2. `<workspace>/.overmind/hermes/` — dev + local install fallback.
 *      Kept as fallback for users who have existing state there.
 *   3. `~/.overmind/hermes/` (Linux/Mac) or `%LOCALAPPDATA%\overmind\hermes\`
 *      (Windows) — canonical home dir for `npm -g sudo` installs.
 *      Created if missing.
 *
 * Returns the **per-agent home** under that root: `.../agents/<name>/`.
 * Use `getSharedHermesHome()` to get the shared root.
 *
 * Safe under all install modes:
 *   - Dev local  (`pnpm dev` from source repo): uses workspace fallback
 *   - Prod npm-g (Linux/Mac, `sudo npm i -g overmind-mcp`): uses HOME
 *   - Prod npm-g (Windows): uses %LOCALAPPDATA%
 *   - Docker / systemd: operator sets OVERMIND_HERMES_HOME explicitly
 */
export function getAgentHermesHome(agentName: string | null | undefined): string {
  const shared = getSharedHermesHome();

  // Canonical layout (Hermes upstream appdirs style): <shared>/agents/<name>/
  const canonical = path.join(shared, 'agents', agentName || 'central');
  if (fs.existsSync(canonical)) return canonical;

  // Legacy layout (Overmind pre-2.8.30 polyglot): <shared>/agent_<name>/.hermes/
  // Preserved so existing installs (with state.db, logs, sessions, etc.) keep
  // working without a one-shot migration. New writes go to canonical; reads
  // fall through here if canonical doesn't exist yet.
  const legacy = path.join(shared, agentName ? `agent_${agentName}` : 'central', '.hermes');
  if (fs.existsSync(legacy)) return legacy;

  // Neither exists — return canonical (the runner will create it as needed).
  return canonical;
}

/**
 * The SHARED Hermes home for this Overmind install. This is what we set as
 * the `HERMES_HOME` env var on every Hermes spawn — Hermes upstream then
 * resolves `agents/<name>/`, `config.yaml`, `auth.json`, etc. relative to it.
 */
export function getSharedHermesHome(): string {
  // 1. Explicit operator override.
  if (process.env.OVERMIND_HERMES_HOME) {
    return process.env.OVERMIND_HERMES_HOME;
  }

  // 2. Workspace fallback: <workspace>/.overmind/hermes/
  //    Created lazily if missing.
  try {
    const ws = getWorkspaceDir();
    const wsHome = path.join(ws, '.overmind', 'hermes');
    // If the workspace path already exists (state from previous runs), prefer
    // it. Otherwise fall through to HOME-based canonical.
    if (fs.existsSync(wsHome)) return wsHome;
    // Doesn't exist yet — create it and use it (workspace is the dev default).
    try {
      fs.mkdirSync(wsHome, { recursive: true });
      return wsHome;
    } catch {
      // mkdir failed (readonly fs) — fall through to HOME-based.
    }
  } catch {
    // getWorkspaceDir can throw if HOME is unset in some sandboxed envs.
  }

  // 3. HOME-based canonical location (works for sudo npm -g installs).
  //    Linux/Mac: $HOME/.overmind/hermes
  //    Windows:   %LOCALAPPDATA%\overmind\hermes
  const homeBase = process.env.LOCALAPPDATA
    || process.env.USERPROFILE
    || os.homedir();
  const homePath = process.platform === 'win32'
    ? path.join(homeBase, 'overmind', 'hermes')
    : path.join(homeBase, '.overmind', 'hermes');
  try {
    fs.mkdirSync(homePath, { recursive: true });
  } catch {
    // Last-ditch fallback: HOME/USERPROFILE itself.
    return process.env.HOME || process.env.USERPROFILE || process.cwd();
  }
  return homePath;
}

/**
 * Backward-compat alias for older code that imported `getAgentOvermindHome`.
 * Returns the per-agent parent dir (= `getAgentHermesHome(name)` itself,
 * because the agent home IS the per-agent dir in the new layout).
 * @deprecated Use `getAgentHermesHome` directly.
 */
export function getAgentOvermindHome(agentName: string | null | undefined): string {
  return getAgentHermesHome(agentName);
}
