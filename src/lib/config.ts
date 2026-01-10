import path from 'path';
import { fileURLToPath } from 'url';

export interface ConfigType {
    CLAUDE: {
        CORE: string;
        PERMISSIONS: string;
        PATHS: {
            SETTINGS: string;
            MCP: string;
        }
    };
    TIMEOUT_MS: number;
}

export const DEFAULT_CONFIG: ConfigType = {
    TIMEOUT_MS: 300000, // 5 minutes
    CLAUDE: {
        CORE: '-p --output-format json',
        PERMISSIONS: '--dangerously-skip-permissions',
        PATHS: {
            SETTINGS: '.claude/settings.json',
            MCP: '.mcp.json'
        }
    }
};

export const CONFIG = { ...DEFAULT_CONFIG };

export function resolveConfigPath(configPath: string): string {
    if (path.isAbsolute(configPath)) return configPath;
    
    // Resolve relative to project root (Workflow/)
    const currentFileUrl = import.meta.url;
    const currentFilePath = fileURLToPath(currentFileUrl);
    // src/lib/config.ts -> src/lib -> src -> Workflow
    const projectRoot = path.resolve(path.dirname(currentFilePath), '../../'); 
    
    return path.resolve(projectRoot, configPath);
}

export function updateConfig(newSettingsPath?: string, newMcpPath?: string) {
    if (newSettingsPath) CONFIG.CLAUDE.PATHS.SETTINGS = newSettingsPath;
    if (newMcpPath) CONFIG.CLAUDE.PATHS.MCP = newMcpPath;
}
