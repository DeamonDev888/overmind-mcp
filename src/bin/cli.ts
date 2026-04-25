#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to manually parse .env without any noisy console.logs from external packages (dotenvx corrupts MCP JSON streams)
function loadEnvQuietly(envPath: string) {
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          // Remove inline comments and trailing spaces
          value = value.replace(/\s*#.*$/, '').trim();
          // Remove surrounding quotes if present
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          if (!process.env[key]) process.env[key] = value;
        }
      });
    }
  } catch (_e) {
    // Ignore silently
  }
}

// Load OverMind's specific environment variables
loadEnvQuietly(path.resolve(__dirname, '../../.env'));

// Inherit PostgreSQL Server environment variables (Database credentials, Embeddings)
loadEnvQuietly(path.resolve(__dirname, '../../../serveur_PostGreSQL/.env'));

// Suppress experimental warnings (like node:sqlite) to avoid breaking MCP handshake
process.removeAllListeners('warning');

// 💥 ERROR HANDLING: Catch everything to avoid silent EOFs
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// 🛡️ SHIELD: Prevent any library from logging to stdout during initialization
// This is critical for MCP servers because any non-JSON output on stdout kills the handshake (EOF).
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

// 🛡️ ULTIMATE SHIELD: Proxy process.stdout.write to redirect non-JSON data to stderr
const originalStdoutWrite = process.stdout.write;
process.stdout.write = function (chunk: string | Uint8Array, encoding?: any, callback?: any): boolean {
  const str = typeof chunk === 'string' ? chunk : chunk.toString();
  const trimmed = str.trim();
  
  // Allow JSON-RPC (starts with {) and empty/newline chunks (often used by transport)
  if (trimmed.startsWith('{') || trimmed === '') {
    return originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
  }
  
  // Redirect everything else to stderr
  return process.stderr.write(chunk, encoding, callback);
} as any;

// Setup completed - Dynamically import server components AFTER process.env is configured
const { createServer } = await import('../server.js');
const { updateConfig } = await import('../lib/config.js');

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
  // Do NOT log to stderr during MCP initialization as it can cause EOF errors in some clients
}

const server = createServer();
console.error(`[Overmind] 🚀 Démarrage du serveur...`);
server.start({ transportType: 'stdio' });
console.error(`[Overmind] ✅ Serveur prêt sur STDIO.`);
