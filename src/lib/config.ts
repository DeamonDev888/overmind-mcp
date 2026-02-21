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
  // 1. Environment Variable
  if (process.env.OVERMIND_WORKSPACE) {
    return path.resolve(process.env.OVERMIND_WORKSPACE);
  }

  // 2. Local Project mode if .mcp.json exists in cwd
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, '.mcp.json'))) {
    return cwd;
  }

  // 3. Fallback: global directory in user profile
  const homedir = os.homedir();
  const globalDir = path.join(homedir, '.overmind-mcp');

  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
    // Create an empty .mcp.json so claude CLI doesn't crash
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
  return path.resolve(workspaceDir, configPath);
}

export function updateConfig(newSettingsPath?: string, newMcpPath?: string) {
  if (newSettingsPath) CONFIG.CLAUDE.PATHS.SETTINGS = newSettingsPath;
  if (newMcpPath) CONFIG.CLAUDE.PATHS.MCP = newMcpPath;
}
