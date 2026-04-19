import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
  TIMEOUT_MS: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_CONFIG: ConfigType = {
  TIMEOUT_MS: 300000, // 5 minutes
  CLAUDE: {
    CORE: '--output-format json',
    PERMISSIONS: '--dangerously-skip-permissions',
    PATHS: {
      SETTINGS: './.claude/settings.json',
      MCP: '.mcp.json', // Will be resolved dynamically
    },
  },
  KILO: {
    CORE: '--auto --json-io',
    DEFAULT_MODEL: 'stepfun/step-3.5-flash:free',
    PATHS: {
      SETTINGS: './.kilocode/settings.json',
    },
  },
};

export const CONFIG = { ...DEFAULT_CONFIG };

// Helper to manually parse .env without any noisy console.logs
function loadEnvQuietly(envPath: string) {
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = (match[2] || '').replace(/\s*#.*$/, '').trim();
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          if (!process.env[key]) process.env[key] = value;
        }
      });
    }
  } catch (_e) {
    // Ignore .env parsing errors
  }
}

let cachedWorkspaceDir: string | null = null;

export function resetWorkspaceCache() {
  cachedWorkspaceDir = null;
}

export function getWorkspaceDir(): string {
  if (cachedWorkspaceDir && process.env.NODE_ENV !== 'test') return cachedWorkspaceDir;

  let workspaceDir = '';
  if (process.env.OVERMIND_WORKSPACE) {
    workspaceDir = path.resolve(process.env.OVERMIND_WORKSPACE);
  } else {
    // 2. Local Project mode if config exists in current working directory
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, '.mcp.json')) ||
      fs.existsSync(path.join(cwd, '.mcp.local.json'))
    ) {
      workspaceDir = cwd;
    } else {
      // 3. Search up the tree
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
        // 4. Auto-detect from code location
        const codeRoot = path.resolve(__dirname, '../..');
        if (
          fs.existsSync(path.join(codeRoot, '.mcp.json')) ||
          fs.existsSync(path.join(codeRoot, '.mcp.local.json'))
        ) {
          workspaceDir = codeRoot;
        } else {
          // 4. Global fallback
          const homedir = os.homedir();
          workspaceDir = path.join(homedir, '.overmind-mcp');
          if (!fs.existsSync(workspaceDir)) {
            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(
              path.join(workspaceDir, '.mcp.json'),
              JSON.stringify({ mcpServers: {} }, null, 2),
            );
          }
        }
      }
    }
  }

  // Load environment from workspace and related projects
  loadEnvQuietly(path.join(workspaceDir, '.env'));
  loadEnvQuietly(path.resolve(workspaceDir, '../serveur_PostGreSQL/.env'));

  cachedWorkspaceDir = workspaceDir;
  return workspaceDir;
}

// Trigger initial environment loading on module import
getWorkspaceDir();

export function resolveConfigPath(configPath: string): string {
  if (path.isAbsolute(configPath)) return configPath;

  const workspaceDir = getWorkspaceDir();
  const fullPath = path.resolve(workspaceDir, configPath);

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
