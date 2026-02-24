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
  TIMEOUT_MS: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_CONFIG: ConfigType = {
  TIMEOUT_MS: 300000, // 5 minutes
  CLAUDE: {
    CORE: '-p --output-format json',
    PERMISSIONS: '--dangerously-skip-permissions',
    PATHS: {
      SETTINGS: './.claude/settings.json',
      MCP: './.mcp.json',
    },
  },
};

export const CONFIG = { ...DEFAULT_CONFIG };

export function getWorkspaceDir(): string {
  // 1. Environment Variable (User Override)
  if (process.env.OVERMIND_WORKSPACE) {
    return path.resolve(process.env.OVERMIND_WORKSPACE);
  }

  // 2. Local Project mode if .mcp.json or .mcp.local.json exists in current working directory
  const cwd = process.cwd();
  if (
    fs.existsSync(path.join(cwd, '.mcp.json')) ||
    fs.existsSync(path.join(cwd, '.mcp.local.json'))
  ) {
    return cwd;
  }

  // 3. Auto-detect from code location (Noob-proof: finds the folder where Overmind is cloned)
  // We are in dist/lib or src/lib, so root is 2 levels up
  const codeRoot = path.resolve(__dirname, '../..');
  if (
    fs.existsSync(path.join(codeRoot, '.mcp.json')) ||
    fs.existsSync(path.join(codeRoot, '.mcp.local.json'))
  ) {
    return codeRoot;
  }

  // 4. Global fallback in user profile
  const homedir = os.homedir();
  const globalDir = path.join(homedir, '.overmind-mcp');

  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
    // Create an empty .mcp.json so the orchestrator has a base to work from
    fs.writeFileSync(
      path.join(globalDir, '.mcp.json'),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
  }

  return globalDir;
}

export function resolveConfigPath(configPath: string): string {
  if (path.isAbsolute(configPath)) return configPath;

  const workspaceDir = getWorkspaceDir();
  const absolutePath = path.resolve(workspaceDir, configPath);

  // Si c'est .mcp.json, vérifier d'abord si .mcp.local.json existe
  if (path.basename(absolutePath) === '.mcp.json') {
    const localPath = absolutePath.replace('.mcp.json', '.mcp.local.json');
    if (fs.existsSync(localPath)) {
      return localPath;
    }
  }

  return absolutePath;
}

export function updateConfig(newSettingsPath?: string, newMcpPath?: string) {
  if (newSettingsPath) CONFIG.CLAUDE.PATHS.SETTINGS = newSettingsPath;
  if (newMcpPath) CONFIG.CLAUDE.PATHS.MCP = newMcpPath;
}
