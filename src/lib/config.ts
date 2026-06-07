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
    DEFAULT_MODEL: 'MiniMax-M2.7',
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
 * Resolve the canonical HERMES_HOME directory for an agent.
 *
 * This is the SINGLE source of truth for where per-agent Hermes state lives.
 * Prior implementations computed this from `process.cwd()` which was non-
 * deterministic (any process spawned from a different cwd would create or
 * read a different HERMES_HOME). That caused the "two HERMES_HOME" problem
 * where one Overmind process wrote its agent's `.hermes/.env` to
 * `<workflow>/.overmind/...` while another process (e.g. a CLI launched
 * from `<backup root>/.overmind/...`) read a different `.hermes/.env`
 * — leading to credential drift, stale auth.json, and silent 401s.
 *
 * Resolution order (deterministic, multi-OS, multi-install):
 *   1. `OVERMIND_AGENT_HOME` env var (set by the install script or systemd
 *      EnvironmentFile) — wins if set, because the operator declared it
 *      explicitly. The runner just trusts it.
 *   2. `<workspace>/.overmind/hermes/agent_<name>/.hermes` — the legacy
 *      path. Kept as fallback for users who have existing state there.
 *   3. `~/.overmind/hermes/agent_<name>/.hermes` — the canonical home dir
 *      location for `npm -g sudo` installs (Linux/Mac prod) and
 *      `%LOCALAPPDATA%\overmind\hermes\agent_<name>\.hermes` on Windows.
 *      Created if missing.
 *
 * Both `.hermes/` directory AND its parent are returned via the two-call
 * pattern: `getAgentHermesHome(name)` returns the `.hermes/` path,
 * `getAgentOvermindHome(name)` returns the parent (where SOUL.md lives).
 *
 * Safe under all install modes:
 *   - Dev local  (`pnpm dev` from source repo): uses workspace fallback
 *   - Prod npm-g (Linux/Mac, `sudo npm i -g overmind-mcp`): uses HOME
 *   - Prod npm-g (Windows): uses %LOCALAPPDATA%
 *   - Docker / systemd: operator sets OVERMIND_AGENT_HOME explicitly
 */
export function getAgentHermesHome(agentName: string | null | undefined): string {
  const name = agentName ? `agent_${agentName}` : 'central';
  const hermesSub = '.hermes';

  // 1. Explicit override (operator-declared, e.g. via systemd EnvironmentFile
  //    or install script). The env var points to the PARENT directory
  //    (the .overmind/hermes/agent_<name> dir, not the .hermes subdir).
  if (process.env.OVERMIND_AGENT_HOME) {
    return path.join(process.env.OVERMIND_AGENT_HOME, hermesSub);
  }

  // 2. Legacy fallback: <workspace>/.overmind/hermes/<name>/.hermes
  //    Preserves backward compat with existing installs that have state
  //    in the workspace-relative .overmind directory.
  try {
    const ws = getWorkspaceDir();
    const legacy = path.join(ws, '.overmind', 'hermes', name, hermesSub);
    // If the legacy path already exists (i.e. previous runs created state
    // there), use it — this is the "be conservative, don't break existing
    // installs" rule. Only fall through to HOME-based if legacy is fresh.
    if (fs.existsSync(legacy)) return legacy;
  } catch {
    // getWorkspaceDir can throw if HOME is unset in some sandboxed envs.
    // That's OK — we still have the HOME-based fallback below.
  }

  // 3. HOME-based canonical location (works for sudo npm -g installs).
  //    Linux/Mac: $HOME/.overmind/hermes/<name>/.hermes
  //    Windows:   %LOCALAPPDATA%\overmind\hermes\<name>\.hermes
  //    (USERPROFILE is also accepted as a Windows fallback.)
  const homeBase = process.env.LOCALAPPDATA
    || process.env.USERPROFILE
    || os.homedir();
  const overmindRoot = process.platform === 'win32'
    ? path.join(homeBase, 'overmind', 'hermes', name)
    : path.join(homeBase, '.overmind', 'hermes', name);

  // Create parent if missing (write-enabled). This makes the function safe
  // to call before any agent has been initialized.
  try {
    fs.mkdirSync(overmindRoot, { recursive: true });
  } catch (e) {
    // Permission denied or readonly fs — fall back to legacy workspace path.
    // We don't throw here because callers (writeAuthJson, spawnHermes) need
    // to be able to continue even if HOME-based mkdir fails.
    const ws = (() => { try { return getWorkspaceDir(); } catch { return process.cwd(); } })();
    return path.join(ws, '.overmind', 'hermes', name, hermesSub);
  }
  return path.join(overmindRoot, hermesSub);
}

/** Parent of getAgentHermesHome — the .overmind/hermes/agent_<name> dir. */
export function getAgentOvermindHome(agentName: string | null | undefined): string {
  return path.dirname(getAgentHermesHome(agentName));
}
