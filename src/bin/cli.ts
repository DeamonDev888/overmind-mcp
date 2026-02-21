#!/usr/bin/env node
import { createServer } from '../server.js';
import { updateConfig } from '../lib/config.js';

const args = process.argv.slice(2);
let settingsPath, mcpPath;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--settings' && args[i + 1]) {
    settingsPath = args[i + 1];
    i++;
  } else if (args[i] === '--mcp-config' && args[i + 1]) {
    mcpPath = args[i + 1];
    i++;
  }
}

if (settingsPath || mcpPath) {
  updateConfig(settingsPath, mcpPath);
  console.error(`🔧 Config surchargée : Settings=${settingsPath}, MCP=${mcpPath}`);
}

const server = createServer();
server.start({ transportType: 'stdio' });
