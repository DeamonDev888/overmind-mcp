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
} catch {
  /* fallback */
}

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
          workspaceDir = path.join(homedir, '.overmind');
          try {
            if (!fs.existsSync(workspaceDir)) {
              fs.mkdirSync(workspaceDir, { recursive: true });
            }
          } catch {
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
 * Resolve the canonical Hermes *profile home* directory for an Overmind agent.
 *
 * v3.1 architecture:
 *   ~/.overmind/hermes/profiles/<name>/
 *     ├── profile.yaml      (kanban description — OBLIGATOIRE)
 *     ├── config.yaml       (Hermes config)
 *     ├── SOUL.md           (system prompt)
 *     ├── .env              (credentials)
 *     ├── .mcp.json         (MCP override)
 *     ├── state.db          (local SQLite state)
 *     ├── skills/
 *     ├── memories/
 *     ├── cron/
 *     ├── hooks/
 *     ├── logs/
 *     ├── README.md
 *     └── workspace.yaml    (kind: scratch|persistent|shared)
 *
 * Resolution order:
 *   1. ~/.overmind/hermes/profiles/<name>/  (canonical v3.1)
 *   2. ~/.hermes/profiles/<name>/            (native Hermes — fallback)
 */
export function getAgentHermesHome(agentName: string | null | undefined): string {
  const base = getSharedHermesHome();
  const name = agentName || 'central';
  // v3.1 canonical: <shared>/profiles/<name>/
  return path.join(base, 'profiles', name);
}

/**
 * The SHARED Hermes home for this Overmind install.
 * v3.1: ~/.overmind/hermes/
 */
export function getSharedHermesHome(): string {
  // 1. Explicit operator override
  if (process.env.OVERMIND_HERMES_HOME) {
    return process.env.OVERMIND_HERMES_HOME;
  }

  // 2. Canonical: ~/.overmind/hermes/
  const homeBase = process.env.LOCALAPPDATA || process.env.USERPROFILE || os.homedir();
  const overmindRoot =
    process.platform === 'win32'
      ? path.join(homeBase, 'overmind', 'hermes')
      : path.join(homeBase, '.overmind', 'hermes');

  try {
    fs.mkdirSync(overmindRoot, { recursive: true });
  } catch {
    return process.env.HOME || process.env.USERPROFILE || process.cwd();
  }
  return overmindRoot;
}
