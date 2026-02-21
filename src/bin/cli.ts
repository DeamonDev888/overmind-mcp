#!/usr/bin/env node
import { createServer } from '../server.js';
import { updateConfig } from '../lib/config.js';

const cliArgs = process.argv.slice(2);
let settingsPath, mcpPath;

for (let i = 0; i < cliArgs.length; i++) {
  if (cliArgs[i] === '--settings' && cliArgs[i + 1]) {
    settingsPath = cliArgs[i + 1];
    i++;
  } else if (cliArgs[i] === '--mcp-config' && cliArgs[i + 1]) {
    mcpPath = cliArgs[i + 1];
    i++;
  }
}

if (settingsPath || mcpPath) {
  updateConfig(settingsPath, mcpPath);
  console.error(`🔧 Config surchargée : Settings=${settingsPath}, MCP=${mcpPath}`);
}

const server = createServer();
server.start({ transportType: 'stdio' });
