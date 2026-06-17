import fs from 'fs';
import { rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ module: 'Hermes-configYamlFilter' });

/**
 * Filter a Hermes config.yaml to only include the allowed MCP servers.
 *
 * Reads the `mcp_servers:` block from the source YAML, extracts each server
 * sub-block (by indentation), and keeps only those whose name is in
 * `allowedServers`. Non-mcp_servers content (header, comments) is preserved.
 *
 * Returns a valid YAML string. If the source file doesn't exist, returns
 * an empty `mcp_servers: {}` block.
 */
export function filterConfigYaml(sourceYamlPath: string, allowedServers: string[]): string {
  try {
    if (!fs.existsSync(sourceYamlPath)) return 'mcp_servers: {}\n';
    const yamlText = fs.readFileSync(sourceYamlPath, 'utf8');
    const lines = yamlText.split(/\r?\n/);

    let inMcpServers = false;
    let currentServerName = '';
    const serverBlocks: Record<string, string[]> = {};
    const headerLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (line.match(/^mcp_servers:\s*$/) || line.match(/^mcp_servers:\s*#.*$/)) {
        inMcpServers = true;
        headerLines.push(line);
        continue;
      }

      if (inMcpServers) {
        const indentMatch = line.match(/^(\s+)/);
        if (!indentMatch) {
          inMcpServers = false;
          headerLines.push(line);
          continue;
        }

        const indent = indentMatch[1].length;
        const keyMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:/);
        if (keyMatch && indent === 2) {
          currentServerName = keyMatch[1];
          serverBlocks[currentServerName] = [line];
        } else if (currentServerName) {
          serverBlocks[currentServerName].push(line);
        }
      } else {
        headerLines.push(line);
      }
    }

    let result = '';
    for (const line of headerLines) {
      result += line + '\n';
      if (line.match(/^mcp_servers:\s*$/) || line.match(/^mcp_servers:\s*#.*$/)) {
        for (const srv of allowedServers) {
          if (serverBlocks[srv]) {
            result += serverBlocks[srv].join('\n') + '\n';
          }
        }
      }
    }
    return result;
  } catch (err) {
    logger.error({ sourceYamlPath, error: err }, '[YAML_FILTER] Unexpected failure while filtering config.yaml.');
    return 'mcp_servers: {}\n';
  }
}
