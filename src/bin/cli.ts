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
          value = value.replace(/\s*#.*$/, '').trim();
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

// 🪄 Auto-formatteur de .env (Classifie sans rien effacer)
function autoFormatEnvFile(envPath: string) {
  try {
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');
    
    const envVars: Record<string, string> = {};
    content.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) envVars[match[1]] = match[2];
    });

    if (Object.keys(envVars).length === 0) return;

    const usedKeys = new Set<string>();
    
    function extract(prefix: string | string[], exactMatch = false) {
      const res: [string, string][] = [];
      const prefixes = Array.isArray(prefix) ? prefix : [prefix];
      for (const key of Object.keys(envVars)) {
        if (usedKeys.has(key)) continue;
        const matches = exactMatch ? prefixes.includes(key) : prefixes.some(p => key.startsWith(p));
        if (matches) {
          res.push([key, envVars[key]]);
          usedKeys.add(key);
        }
      }
      return res.sort((a, b) => a[0].localeCompare(b[0]));
    }

    const sections = [
      { title: "🌐 OVERMIND CORE & INFRASTRUCTURE", vars: extract(["OVERMIND_WORKSPACE", "OVERMIND_MEMORY_TYPE"], true) },
      { title: "⚙️ GLOBAL SETTINGS", vars: extract(["API_TIMEOUT_MS"], true) },
      { title: "🗄️ DATABASE CONFIGURATION (PostgreSQL)", vars: extract("POSTGRES_") },
      { title: "🧠 EMBEDDINGS & VECTOR MEMORY", vars: extract("OVERMIND_EMBEDDING_") },
      { title: "🤖 LLM PROVIDER - Mistral AI", vars: extract("MISTRAL_") },
      { title: "🤖 LLM PROVIDER - OpenAI", vars: extract("OPENAI_") },
      { title: "🤖 LLM PROVIDER - NVIDIA NIM", vars: extract("NVAPI_") },
      { title: "🤖 LLM PROVIDER - Minimax", vars: extract("MINIMAXI_") },
      { title: "🤖 LLM PROVIDER - Ilmu AI", vars: extract("Z_AI_") },
      { title: "🤖 LLM PROVIDER - Anthropic", vars: extract("ANTHROPIC_") },
      { title: "🤖 LLM PROVIDER - DeepSeek", vars: extract("DEEPSEEK_") },
      { title: "🤖 LLM PROVIDER - SiliconFlow", vars: extract("SILICONFLOW_") },
      { title: "🤖 LLM PROVIDER - Alibaba (DashScope)", vars: extract("ALIBABA_") }
    ];

    const uncategorized: [string, string][] = [];
    for (const key of Object.keys(envVars)) {
      if (!usedKeys.has(key)) uncategorized.push([key, envVars[key]]);
    }
    if (uncategorized.length > 0) {
      sections.push({ title: "📁 AUTRES / NON-CLASSIFIÉS", vars: uncategorized.sort((a, b) => a[0].localeCompare(b[0])) });
    }

    let newContent = "";
    for (const section of sections) {
      if (section.vars.length > 0) {
        newContent += `# ==========================================\n`;
        newContent += `# ${section.title}\n`;
        newContent += `# ==========================================\n`;
        for (const [k, v] of section.vars) {
          newContent += `${k}=${v}\n`;
        }
        newContent += `\n`;
      }
    }

    // On évite d'écrire sur le disque si le fichier est déjà parfaitement formaté (optimisation)
    if (content.trim() !== newContent.trim()) {
        fs.writeFileSync(envPath, newContent.trim() + '\n', 'utf8');
    }
  } catch (e) {
    // Ignore error silently to not crash the boot
  }
}

const localEnvPath = path.resolve(__dirname, '../../.env');

// Auto-détection et injection de OVERMIND_WORKSPACE s'il est manquant
try {
  const workspacePath = path.resolve(__dirname, '../../');
  if (!fs.existsSync(localEnvPath)) {
    fs.writeFileSync(localEnvPath, `OVERMIND_WORKSPACE=${workspacePath}\n`, 'utf8');
  } else {
    const currentContent = fs.readFileSync(localEnvPath, 'utf8');
    if (!currentContent.includes('OVERMIND_WORKSPACE=')) {
      fs.appendFileSync(localEnvPath, `\nOVERMIND_WORKSPACE=${workspacePath}\n`, 'utf8');
    }
  }
} catch (e) {
  // Ignorer l'erreur silencieusement
}

// Classifie et réorganise automatiquement le .env à chaque démarrage d'Overmind
autoFormatEnvFile(localEnvPath);

// Load OverMind's specific environment variables
loadEnvQuietly(localEnvPath);

// Inherit PostgreSQL Server environment variables (Database credentials, Embeddings)
loadEnvQuietly(path.resolve(__dirname, '../../../serveur_PostGreSQL/.env'));

// 🔍 Vérification des configurations critiques
function checkMissingConfigs() {
  const missingCore = [];
  const missingDb = [];

  // Vérification CORE
  if (!process.env.OVERMIND_WORKSPACE) missingCore.push("OVERMIND_WORKSPACE");
  if (!process.env.OVERMIND_MEMORY_TYPE) missingCore.push("OVERMIND_MEMORY_TYPE");

  // Vérification DB
  if (!process.env.POSTGRES_HOST) missingDb.push("POSTGRES_HOST");
  if (!process.env.POSTGRES_DATABASE) missingDb.push("POSTGRES_DATABASE");
  if (!process.env.POSTGRES_USER) missingDb.push("POSTGRES_USER");
  if (!process.env.POSTGRES_PASSWORD) missingDb.push("POSTGRES_PASSWORD");

  if (missingCore.length > 0) {
    console.error(`\n[Overmind] ⚠️ ATTENTION : Configuration 'CORE & INFRASTRUCTURE' incomplète !`);
    console.error(`[Overmind] ❌ Il manque : ${missingCore.join(', ')}\n`);
  }
  if (missingDb.length > 0) {
    console.error(`\n[Overmind] ⚠️ ATTENTION : Configuration 'DATABASE' incomplète (Imported from postgresql-server) !`);
    console.error(`[Overmind] ❌ Il manque : ${missingDb.join(', ')}\n`);
  }
}
checkMissingConfigs();

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
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((err?: Error | null) => void),
  callback?: (err?: Error | null) => void,
): boolean {
  const str = typeof chunk === 'string' ? chunk : chunk.toString();
  const trimmed = str.trim();

  // Handle overload: if encoding is a function, it's actually the callback
  if (typeof encoding === 'function') {
    callback = encoding as (err?: Error | null) => void;
    encoding = undefined;
  }

  // Allow JSON-RPC (starts with {) and empty/newline chunks (often used by transport)
  if (trimmed.startsWith('{') || trimmed === '') {
    return originalStdoutWrite(chunk, encoding as BufferEncoding, callback);
  }

  // Redirect everything else to stderr
  return process.stderr.write(chunk, encoding as BufferEncoding, callback);
} as typeof process.stdout.write;

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
