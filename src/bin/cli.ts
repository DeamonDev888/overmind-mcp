#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PassThrough } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize OVERMIND_WORKSPACE to project directory to prevent global .env overrides
process.env.OVERMIND_WORKSPACE = process.env.OVERMIND_WORKSPACE || path.resolve(__dirname, '../..');

function loadEnvQuietly(envPath: string) {
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        // Skip empty lines and full comment lines
        if (!trimmed || trimmed.startsWith('#')) return;
        // Parse KEY=VALUE (value can contain '=')
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        const key = trimmed.slice(0, eqIdx).trim();
        if (!key) return;
        let value = trimmed.slice(eqIdx + 1).trim();
        // Strip trailing comments only when preceded by whitespace (not in quoted values)
        // e.g. FOO=hello # comment  → strips "# comment"
        //      BAR=http://foo.com#fragment → preserves "#fragment"
        if (!value.startsWith('"') && !value.startsWith("'")) {
          value = value.replace(/\s+#.*$/, '').trim();
        }
        // Strip quotes
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (!process.env[key]) process.env[key] = value;
      });
    }
  } catch (_e) {
    // Ignore silently
  }
}

// Atomic write: write to temp file first, then rename (atomic on POSIX, prevents corruption on crash)
function atomicWriteFile(filePath: string, content: string): void {
  const tmp = filePath + '.tmp.' + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

// Auto-formatteur de .env — Classifie tous les providers connus, préserve les valeurs
function autoFormatEnvFile(envPath: string) {
  try {
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');

    // Parser robuste : ignore commentaires, lit les lignes KEY=VALUE (valeur peut contenir '=')
    const envVars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key) envVars[key] = value;
    }

    if (Object.keys(envVars).length === 0) return;

    const usedKeys = new Set<string>();

    // Tri naturel pour les clés avec suffixes numériques (KEY, KEY_2, KEY_3…)
    function naturalSort(pairs: [string, string][]): [string, string][] {
      return pairs.sort((a, b) =>
        a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }),
      );
    }

    function extract(prefix: string | string[], exactMatch = false): [string, string][] {
      const res: [string, string][] = [];
      const prefixes = Array.isArray(prefix) ? prefix : [prefix];
      for (const key of Object.keys(envVars)) {
        if (usedKeys.has(key)) continue;
        const matches = exactMatch
          ? prefixes.includes(key)
          : prefixes.some((p) => key.startsWith(p));
        if (matches) {
          res.push([key, envVars[key]]);
          usedKeys.add(key);
        }
      }
      return naturalSort(res);
    }

    // ─── SECTIONS ──────────────────────────────────────────────────────────────
    const sections: { title: string; vars: [string, string][] }[] = [
      // ── Overmind Infrastructure ──
      {
        title: '🌐 OVERMIND CORE & INFRASTRUCTURE',
        vars: extract(['OVERMIND_WORKSPACE', 'OVERMIND_MEMORY_TYPE'], true),
      },
      { title: '⚙️  GLOBAL SETTINGS', vars: extract(['API_TIMEOUT_MS'], true) },
      { title: '🗄️  DATABASE (PostgreSQL / pgvector)', vars: extract('POSTGRES_') },
      { title: '🧠 EMBEDDINGS & VECTOR MEMORY', vars: extract('OVERMIND_EMBEDDING_') },

      // ── LLM Providers (Europe / USA) ──
      { title: '🤖 LLM PROVIDER - Mistral AI 🇫🇷', vars: extract('MISTRAL_') },
      { title: '🤖 LLM PROVIDER - OpenAI 🇺🇸', vars: extract('OPENAI_') },
      { title: '🤖 LLM PROVIDER - Anthropic 🇺🇸', vars: extract('ANTHROPIC_') },
      {
        title: '🤖 LLM PROVIDER - Google Gemini 🇺🇸',
        vars: extract(
          ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
          true,
        ),
      },
      {
        title: '🤖 LLM PROVIDER - NVIDIA NIM 🇺🇸',
        vars: [
          ...extract(['NVAPI_KEY', 'NVIDIA_API_KEY', 'NVIDIA_API_BASE'], true),
          ...extract('NVIDIA_'),
        ],
      },
      {
        title: '🤖 LLM PROVIDER - OpenRouter 🇺🇸',
        vars: extract(['OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'OPENROUTER_MODEL'], true),
      },
      {
        title: '🤖 LLM PROVIDER - xAI / Grok 🇺🇸',
        vars: extract(['XAI_API_KEY', 'XAI_BASE_URL', 'GROK_API_KEY', 'GROK_MODEL'], true),
      },
      { title: '🤖 LLM PROVIDER - Groq 🇺🇸', vars: extract('GROQ_') },
      { title: '🤖 LLM PROVIDER - Together AI 🇺🇸', vars: extract('TOGETHER_') },
      { title: '🤖 LLM PROVIDER - Cohere 🇺🇸', vars: extract('COHERE_') },
      { title: '🤖 LLM PROVIDER - Replicate 🇺🇸', vars: extract('REPLICATE_') },
      {
        title: '🤖 LLM PROVIDER - HuggingFace 🇺🇸',
        vars: extract(['HUGGINGFACE_API_KEY', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'], true),
      },
      { title: '🤖 LLM PROVIDER - Perplexity 🇺🇸', vars: extract('PERPLEXITY_') },
      { title: '🤖 LLM PROVIDER - SambaNova 🇺🇸', vars: extract('SAMBANOVA_') },
      {
        title: '🤖 LLM PROVIDER - Azure OpenAI ☁️',
        vars: extract(
          [
            'AZURE_API_KEY',
            'AZURE_API_BASE',
            'AZURE_OPENAI_API_KEY',
            'AZURE_OPENAI_ENDPOINT',
            'AZURE_OPENAI_API_VERSION',
          ],
          true,
        ),
      },
      {
        title: '🤖 LLM PROVIDER - ElevenLabs 🎙️',
        vars: extract(['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL_ID'], true),
      },
      {
        title: '🤖 LLM PROVIDER - AWS Bedrock ☁️',
        vars: extract(
          [
            'AWS_ACCESS_KEY_ID',
            'AWS_SECRET_ACCESS_KEY',
            'AWS_SESSION_TOKEN',
            'AWS_REGION',
            'AWS_DEFAULT_REGION',
            'AWS_ENDPOINT_URL',
          ],
          true,
        ),
      },

      // ── LLM Providers (Chine / Asie) ──
      { title: '🤖 LLM PROVIDER - DeepSeek 🇨🇳', vars: extract('DEEPSEEK_') },
      { title: '🤖 LLM PROVIDER - Alibaba DashScope 🇨🇳', vars: extract('ALIBABA_') },
      {
        title: '🤖 LLM PROVIDER - Qwen (DashScope) 🇨🇳',
        vars: extract(
          [
            'QWEN_API_KEY',
            'QWEN_BASE_URL',
            'QWEN_MODEL',
            'DASHSCOPE_API_KEY',
            'DASHSCOPE_BASE_URL',
          ],
          true,
        ),
      },
      { title: '🤖 LLM PROVIDER - SiliconFlow 🇨🇳', vars: extract('SILICONFLOW_') },
      {
        title: '🤖 LLM PROVIDER - Minimax 🇨🇳',
        vars: [...extract('MINIMAXI_'), ...extract('MINIMAX_')],
      },
      { title: '🤖 LLM PROVIDER - Ilmu AI / Z.AI 🇨🇳', vars: extract('Z_AI_') },
      {
        title: '🤖 LLM PROVIDER - Moonshot / Kimi 🇨🇳',
        vars: extract(
          ['MOONSHOT_API_KEY', 'MOONSHOT_BASE_URL', 'MOONSHOT_MODEL', 'KIMI_API_KEY'],
          true,
        ),
      },
      {
        title: '🤖 LLM PROVIDER - Baidu / ERNIE 🇨🇳',
        vars: extract(['BAIDU_API_KEY', 'ERNIE_API_KEY', 'WENXIN_API_KEY'], true),
      },
      {
        title: '🤖 LLM PROVIDER - ZhipuAI / GLM 🇨🇳',
        vars: [...extract(['ZHIPU_API_KEY', 'GLM_API_KEY'], true), ...extract('ZHIPUAI_')],
      },

      // ── Services & Intégrations ──
      {
        title: '💬 SERVICE - Discord',
        vars: extract(
          [
            'DISCORD_TOKEN',
            'DISCORD_BOT_TOKEN',
            'DISCORD_CHANNEL_ID',
            'DISCORD_GUILD_ID',
            'DISCORD_WEBHOOK_URL',
            'DISCORD_CLIENT_ID',
            'DISCORD_CLIENT_SECRET',
          ],
          true,
        ),
      },
      {
        title: '🐦 SERVICE - Twitter / X',
        vars: extract(
          [
            'TWITTER_API_KEY',
            'TWITTER_API_SECRET',
            'TWITTER_ACCESS_TOKEN',
            'TWITTER_ACCESS_SECRET',
            'TWITTER_BEARER_TOKEN',
            'X_API_KEY',
            'X_BEARER_TOKEN',
            'X_API_SECRET',
            'X_ACCESS_TOKEN',
            'X_ACCESS_SECRET',
          ],
          true,
        ),
      },
      {
        title: '📱 SERVICE - Telegram',
        vars: extract(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], true),
      },
      {
        title: '📱 SERVICE - Twilio / SMS',
        vars: extract(
          [
            'TWILIO_ACCOUNT_SID',
            'TWILIO_AUTH_TOKEN',
            'TWILIO_PHONE_NUMBER',
            'TWILIO_API_KEY',
            'TWILIO_API_SECRET',
          ],
          true,
        ),
      },
      {
        title: '🐙 SERVICE - GitHub',
        vars: extract(
          [
            'GITHUB_TOKEN',
            'GITHUB_API_KEY',
            'GH_TOKEN',
            'GITHUB_CLIENT_ID',
            'GITHUB_CLIENT_SECRET',
          ],
          true,
        ),
      },
      {
        title: '▲ SERVICE - Vercel',
        vars: extract(
          [
            'VERCEL_TOKEN',
            'VERCEL_API_TOKEN',
            'VERCEL_PROJECT_ID',
            'VERCEL_ORG_ID',
            'VERCEL_TEAM_ID',
          ],
          true,
        ),
      },
      {
        title: '🔺 SERVICE - Supabase',
        vars: extract(
          ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET'],
          true,
        ),
      },
      { title: '🎮 SERVICE - Riot Games', vars: extract(['RIOT_API_KEY', 'RIOT_REGION'], true) },
      {
        title: '🔍 SERVICE - Search (Serper/Tavily)',
        vars: extract(
          ['SERPER_API_KEY', 'TAVILY_API_KEY', 'SERPAPI_KEY', 'BRAVE_SEARCH_API_KEY'],
          true,
        ),
      },
      {
        title: '📰 SERVICE - Market Data & News',
        vars: extract(
          [
            'FINNHUB_API_KEY',
            'NEWSAPI_KEY',
            'ALPHAVANTAGE_API_KEY',
            'POLYGON_API_KEY',
            'TIINGO_API_KEY',
          ],
          true,
        ),
      },
    ];

    // Clés restantes non classifiées → section fourre-tout
    const uncategorized: [string, string][] = [];
    for (const key of Object.keys(envVars)) {
      if (!usedKeys.has(key)) uncategorized.push([key, envVars[key]]);
    }
    if (uncategorized.length > 0) {
      sections.push({ title: '📁 AUTRES / NON-CLASSIFIÉS', vars: naturalSort(uncategorized) });
    }

    // ─── RENDU ──────────────────────────────────────────────────────────────────
    let newContent = '';
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

    // N'écrire sur le disque que si quelque chose a changé (optimisation I/O)
    if (content.trim() !== newContent.trim()) {
      atomicWriteFile(envPath, newContent.trim() + '\n');
    }
  } catch (_e) {
    // Ignorer silencieusement pour ne pas crasher le boot
  }
}

const localEnvPath = path.resolve(__dirname, '../../.env');

// Auto-détection et injection de OVERMIND_WORKSPACE s'il est manquant — NE PAS écraser s'il existe déjà
try {
  if (!fs.existsSync(localEnvPath)) {
    const workspacePath = path.resolve(__dirname, '../../');
    atomicWriteFile(localEnvPath, `OVERMIND_WORKSPACE=${workspacePath}\n`);
  } else {
    const currentContent = fs.readFileSync(localEnvPath, 'utf8');
    const match = currentContent.match(/^OVERMIND_WORKSPACE=(.*)$/m);
    if (!match || !match[1]?.trim()) {
      const workspacePath = path.resolve(__dirname, '../../');
      if (!currentContent.includes('OVERMIND_WORKSPACE=')) {
        atomicWriteFile(
          localEnvPath,
          currentContent.trim() + `\nOVERMIND_WORKSPACE=${workspacePath}\n`,
        );
      } else {
        const newContent = currentContent.replace(
          /^OVERMIND_WORKSPACE=.*$/m,
          `OVERMIND_WORKSPACE=${workspacePath}`,
        );
        atomicWriteFile(localEnvPath, newContent);
      }
    }
  }
} catch (_e) {
  // Ignorer l'erreur silencieusement
}

// Classifie et réorganise automatiquement le .env à chaque démarrage d'Overmind
autoFormatEnvFile(localEnvPath);

// 🎯 Priorité de chargement (premier trouvé gagne, car loadEnvQuietly ne réécrit pas) :
//   1) $OVERMIND_ENV_FILE         → fichier explicite passé par le client MCP
//   2) <process.cwd()>/.env       → si lancé depuis un dossier projet
//   3) <bin>/../../.env           → fallback historique (utile en dev local)
const externalEnvCandidates: string[] = [];
if (process.env.OVERMIND_ENV_FILE) externalEnvCandidates.push(process.env.OVERMIND_ENV_FILE);
const cwdEnv = path.resolve(process.cwd(), '.env');
if (cwdEnv !== localEnvPath) externalEnvCandidates.push(cwdEnv);
for (const candidate of externalEnvCandidates) {
  loadEnvQuietly(candidate);
}

// Load OverMind's specific environment variables
loadEnvQuietly(localEnvPath);

// Inherit PostgreSQL Server environment variables (Database credentials, Embeddings)
loadEnvQuietly(path.resolve(__dirname, '../../../serveur_PostGreSQL/.env'));

// 🔍 Vérification des configurations critiques
function checkMissingConfigs() {
  const missingCore = [];
  const missingDb = [];

  // Vérification CORE
  if (!process.env.OVERMIND_WORKSPACE) missingCore.push('OVERMIND_WORKSPACE');
  if (!process.env.OVERMIND_MEMORY_TYPE) missingCore.push('OVERMIND_MEMORY_TYPE');

  // Vérification DB
  if (!process.env.POSTGRES_HOST) missingDb.push('POSTGRES_HOST');
  if (!process.env.POSTGRES_DATABASE) missingDb.push('POSTGRES_DATABASE');
  if (!process.env.POSTGRES_USER) missingDb.push('POSTGRES_USER');
  if (!process.env.POSTGRES_PASSWORD) missingDb.push('POSTGRES_PASSWORD');

  if (missingCore.length > 0) {
    console.error(`\n[Overmind] ⚠️ ATTENTION : Configuration 'CORE & INFRASTRUCTURE' incomplète !`);
    console.error(`[Overmind] ❌ Il manque : ${missingCore.join(', ')}\n`);
  }
  if (missingDb.length > 0) {
    console.error(
      `\n[Overmind] ⚠️ ATTENTION : Configuration 'DATABASE' incomplète (Imported from postgresql-server) !`,
    );
    console.error(`[Overmind] ❌ Il manque : ${missingDb.join(', ')}\n`);
  }
}
checkMissingConfigs();

import { rootLogger } from '../lib/logger.js';

// 💥 ERROR HANDLING: Catch everything to avoid silent EOFs
process.on('uncaughtException', (err) => {
  rootLogger.fatal({ err }, '💥 UNCAUGHT EXCEPTION');
  rootLogger.flush();
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  rootLogger.fatal({ reason, promise }, '💥 UNHANDLED REJECTION');
  rootLogger.flush();
});

// Ensure logs are flushed on exit
process.on('SIGINT', () => {
  rootLogger.info('🛑 Received SIGINT, flushing logs...');
  rootLogger.flush();
  process.exit(0);
});
process.on('SIGTERM', () => {
  rootLogger.info('🛑 Received SIGTERM, flushing logs...');
  rootLogger.flush();
  process.exit(0);
});

// 🛡️ SHIELD: Prevent any library from logging to stdout during initialization
// This is critical for MCP servers because any non-JSON output on stdout kills the handshake (EOF).
console.log = (...args) => rootLogger.info(args.length > 1 ? { args } : args[0]);
console.info = (...args) => rootLogger.info(args.length > 1 ? { args } : args[0]);

// 🛡️ E3: Warning filter — suppress repetitive FastMCP "could not infer client capabilities" spam.
// FastMCP retries client capability detection every ~180s in stateless HTTP mode, generating
// dozens of identical warnings. We log the FIRST occurrence, then suppress the rest.
const SUPPRESSED_WARN_PATTERNS = ['could not infer client capabilities'];
const loggedWarnings = new Set<string>();

console.warn = (...args) => {
  const msg = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '');
  const isSuppressed = SUPPRESSED_WARN_PATTERNS.some((p) => msg.includes(p));
  if (isSuppressed) {
    if (loggedWarnings.has(msg)) return; // Already logged once — suppress duplicate
    loggedWarnings.add(msg);
    rootLogger.debug({ suppressed: true }, `[WARN-DEDUP] ${msg}`);
    return;
  }
  rootLogger.warn(args.length > 1 ? { args } : args[0]);
};
console.error = (...args) => rootLogger.error(args.length > 1 ? { args } : args[0]);

// 🛡️ ULTIMATE SHIELD: Proxy process.stdout.write to redirect non-JSON data to stderr
// E3: Deduplicate SHIELD warnings — library pino loggers fire repeatedly on stdout
const shieldDedup = new Set<string>();
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

  // Skip empty chunks or pure whitespace (often used as delimiters/keep-alive)
  if (trimmed === '') {
    return originalStdoutWrite(chunk, encoding as BufferEncoding | undefined, callback);
  }

  // Allow JSON-RPC (starts with { or [)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);

      // BLOCK ARRAYS on stdout (Batch responses are not standard in MCP)
      if (Array.isArray(parsed)) {
        if (!shieldDedup.has('array-blocked')) {
          shieldDedup.add('array-blocked');
          rootLogger.warn(
            { raw: str },
            '🛡️ [SHIELD] Blocked array-as-JSON-RPC on stdout (future occurrences suppressed)',
          );
        }
        return process.stderr.write(chunk, encoding as BufferEncoding | undefined, callback);
      }

      // Check for JSON-RPC (Response or Notification)
      if (parsed.jsonrpc === '2.0') {
        return originalStdoutWrite(chunk, encoding as BufferEncoding | undefined, callback);
      }

      // Block non-RPC JSON (deduplicated — these fire repeatedly from library pino loggers)
      if (!shieldDedup.has('object-blocked')) {
        shieldDedup.add('object-blocked');
        rootLogger.warn(
          { raw: str },
          '🛡️ [SHIELD] Blocked non-JSON-RPC (Object) on stdout (future occurrences suppressed)',
        );
      }
      return process.stderr.write(chunk, encoding as BufferEncoding | undefined, callback);
    } catch (e) {
      // Malformed JSON-like content
      rootLogger.debug(
        { raw: str, err: (e as Error).message },
        '🛡️ [SHIELD] Blocked malformed JSON-like content on stdout',
      );
      return process.stderr.write(chunk, encoding as BufferEncoding | undefined, callback);
    }
  }

  // Redirect everything else to stderr (via Pino)
  rootLogger.debug({ raw: trimmed }, '🛡️ [SHIELD] Intercepted non-JSON stdout write');
  return process.stderr.write(chunk, encoding as BufferEncoding | undefined, callback);
} as typeof process.stdout.write;

// 🛡️ STDIN INTERCEPTOR: Detect and unroll JSON-RPC Batches [req1, req2]
// FastMCP/Zod only support single objects. Intercepting before FastMCP starts.
const originalStdin = process.stdin;
const stdinProxy = new PassThrough();

originalStdin.on('data', (chunk: Buffer) => {
  const str = chunk.toString();
  const trimmed = str.trim();

  // 🔍 [DEBUG] Log every incoming chunk that looks like JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    rootLogger.debug(
      {
        length: trimmed.length,
        preview: trimmed.substring(0, 100),
        isBatch: trimmed.startsWith('['),
      },
      '[SHIELD] STDIN chunk received',
    );
  }

  // If it's a batch, unroll it into separate JSON chunks
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        rootLogger.warn({ count: parsed.length }, '[SHIELD] Unrolling JSON-RPC BATCH on STDIN');
        for (const item of parsed) {
          stdinProxy.write(JSON.stringify(item) + '\n');
        }
        return;
      }
    } catch (_e) {
      // Not a valid batch or partial JSON, pass through as-is
    }
  }
  stdinProxy.write(chunk);
});

// Hijack process.stdin for FastMCP and any other consumers
Object.defineProperty(process, 'stdin', {
  value: stdinProxy,
  writable: false,
  configurable: true,
});

// Setup completed - Dynamically import server components AFTER process.env is configured
const { initTelemetry } = await import('../lib/telemetry.js');
initTelemetry();

const { createServer } = await import('../server.js');
const { updateConfig } = await import('../lib/config.js');

const cliArgs = process.argv.slice(2);
let settingsPath, mcpPath;
let memoryOnly = false;
let memoryToolsOnly = false;
let sslCert: string | undefined;
let sslKey: string | undefined;
let sslCa: string | undefined;
let transportType: 'stdio' | 'httpStream' = 'stdio';
let httpPort = 3099;
let httpHost = 'localhost';
let httpEndpoint = '/mcp';

for (let i = 0; i < cliArgs.length; i++) {
  if (cliArgs[i] === '--settings' && cliArgs[i + 1]) {
    settingsPath = cliArgs[i + 1];
    i++;
  } else if (cliArgs[i] === '--mcp-config' && cliArgs[i + 1]) {
    mcpPath = cliArgs[i + 1];
    i++;
    // ─── Mode restreint mémoire (v3.2 — actif via --memory-only) ────────────
    // Le daemon écoute sur le même port que le serveur principal.
  } else if (cliArgs[i] === '--memory-only') {
    memoryOnly = true;
  } else if (cliArgs[i] === '--memory-tools-only') {
    memoryToolsOnly = true;
  } else if (cliArgs[i] === '--transport' && cliArgs[i + 1]) {
    const t = cliArgs[i + 1];
    if (t === 'http-stream' || t === 'httpStream') {
      transportType = 'httpStream';
    }
    i++;
  } else if (cliArgs[i] === '--port' && cliArgs[i + 1]) {
    httpPort = parseInt(cliArgs[i + 1], 10);
    i++;
  } else if (cliArgs[i] === '--host' && cliArgs[i + 1]) {
    httpHost = cliArgs[i + 1];
    i++;
  } else if (cliArgs[i] === '--endpoint' && cliArgs[i + 1]) {
    httpEndpoint = cliArgs[i + 1];
    i++;
  } else if (cliArgs[i] === '--ssl-cert' && cliArgs[i + 1]) {
    sslCert = cliArgs[i + 1];
    i++;
  } else if (cliArgs[i] === '--ssl-key' && cliArgs[i + 1]) {
    sslKey = cliArgs[i + 1];
    i++;
  } else if (cliArgs[i] === '--ssl-ca' && cliArgs[i + 1]) {
    sslCa = cliArgs[i + 1];
    i++;
  }
}

// Auth token (env var OR CLI flag). Si présent, toutes les requêtes HTTP
// doivent inclure "Authorization: Bearer <token>". Protège les 14 tools MCP.
const mcpAuthToken = process.env.OVERMIND_AUTH_TOKEN || undefined;

// ─── SECURITÉ: refuser bind réseau non-localhost sans SSL ───────────────────
// Un serveur HTTP sans chiffrement sur 0.0.0.0 expose les 14 tools MCP
// (run_agent = exécution de code arbitraire) à n'importe qui sur le LAN.
if (transportType === 'httpStream' && !(sslCert && sslKey)) {
  const isLoopback = httpHost === 'localhost' || httpHost === '127.0.0.1' || httpHost === '::1';
  if (!isLoopback) {
    rootLogger.error(
      `[SECURITÉ] Refus de démarrer en HTTP (sans SSL) sur ${httpHost}.` +
        ` Utilisez --ssl-cert / --ssl-key ou bind sur localhost.`,
    );
    process.exit(1);
  }
  rootLogger.warn(
    `[SECURITÉ] Serveur HTTP sans SSL sur ${httpHost}.` +
      ` Acceptable en local, MAIS ne pas exposer sur le réseau sans --ssl-cert/--ssl-key.`,
  );
}

if (settingsPath || mcpPath) {
  updateConfig(settingsPath, mcpPath);
  // Do NOT log to stderr during MCP initialization as it can cause EOF errors in some clients
}

// HTTP Singleton mode (OVERMIND_HTTP_MODE=true in .env)
// Les serveurs memory et postgresql tournent deja en singleton sur leurs ports,
// Overmind se configure en client HTTP pour aggreguer les outils
if (process.env.OVERMIND_HTTP_MODE === 'true') {
  rootLogger.info(
    '[Overmind] [HTTP] Mode singleton actif — memory sur port ' +
      (process.env.MEMORY_HTTP_PORT || '3099') +
      ', postgresql sur port ' +
      (process.env.POSTGRES_HTTP_PORT || '5433'),
  );
  rootLogger.info(
    '[Overmind] [HTTP] Les outils sont exposés via la couche HTTP des serveurs distants',
  );
  // En mode HTTP singleton, Overmind CLI ne démarre pas son propre serveur MCP
  // Il agit comme client pour les serveurs distants (memory + postgresql)
  // Les agents se connectent directement aux endpoints HTTP des serveurs distants
  process.exit(0);
}

const server = createServer('OverMind-MCP', memoryOnly, memoryToolsOnly);
rootLogger.info(
  memoryOnly
    ? '[Overmind] [START] Démarrage du serveur mémoire...'
    : memoryToolsOnly
      ? '[Overmind] [START] Démarrage serveur (memory tools only)...'
      : '[Overmind] [START] Démarrage du serveur...',
);

if (transportType === 'httpStream') {
  const httpStreamConfig: {
    port: number;
    host: string;
    endpoint: `/${string}`;
    stateless: boolean;
    sslCert?: string;
    sslKey?: string;
    sslCa?: string;
  } = {
    port: httpPort,
    host: httpHost,
    endpoint: httpEndpoint as `/${string}`,
    stateless: true,
  };
  if (sslCert) httpStreamConfig.sslCert = sslCert;
  if (sslKey) httpStreamConfig.sslKey = sslKey;
  if (sslCa) httpStreamConfig.sslCa = sslCa;
  const protocol = sslCert && sslKey ? 'https' : 'http';

  // PATCH: Monkey-patch http.createServer pour désactiver le requestTimeout de 5 min.
  // Sans ça, Node tue les SSE streams des agents long-running après 300s.
  // SCOPE: on restore l'original après la PREMIÈRE création de serveur,
  // pour ne pas affecter les autres serveurs HTTP du process (bridge, etc.).
  //
  // AUTH: si mcpAuthToken est défini, on wrap le requestListener pour
  // exiger "Authorization: Bearer *** sur chaque requête. Timing-safe
  // compare pour éviter les timing attacks.
  const origCreateServer = http.createServer.bind(http);

  (http as Record<string, unknown>).createServer = function (requestListener?: unknown) {
    // Wrap avec auth middleware si token configuré
    const wrappedListener = mcpAuthToken
      ? (req: http.IncomingMessage, res: http.ServerResponse) => {
          // Permettre les requêtes SSE (GET) et POST sans auth pour l'initialization
          // FastMCP fait l'initialize handshake avant les tool calls. On exige le
          // token sur TOUTES les requêtes — le client doit l'envoyer dès le début.
          const auth = req.headers['authorization'] || '';
          const expected = `Bearer ${mcpAuthToken}`;
          // Timing-safe comparison
          const a = Buffer.from(auth);
          const b = Buffer.from(expected);
          if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized', code: -32000 }));
            return;
          }
          if (typeof requestListener === 'function') {
            (requestListener as (req: http.IncomingMessage, res: http.ServerResponse) => void)(
              req,
              res,
            );
          }
        }
      : (requestListener as http.RequestListener | undefined);

    const hServer = origCreateServer(wrappedListener);
    hServer.requestTimeout = 0;
    hServer.headersTimeout = 0;
    hServer.keepAliveTimeout = 0;
    // Restaurer immédiatement — seul le serveur FastMCP doit être patché.
    (http as { createServer: typeof http.createServer }).createServer = origCreateServer;
    return hServer;
  };

  try {
    await server.start({ transportType: 'httpStream', httpStream: httpStreamConfig });
    rootLogger.info(
      `[Overmind] [READY] Serveur HTTP${sslCert ? 'S' : ''} sur ${protocol}://${httpHost}:${httpPort}${httpEndpoint}`,
    );
  } catch (err) {
    rootLogger.error(
      { error: err instanceof Error ? err.message : String(err), port: httpPort, host: httpHost },
      `[Overmind] [ERREUR] Échec du démarrage HTTP sur ${httpHost}:${httpPort}.` +
        ` Port déjà pris ? (EADDRINUSE)`,
    );
    process.exit(1);
  }
} else {
  try {
    await server.start({ transportType: 'stdio' });
    rootLogger.info(
      memoryOnly
        ? '[Overmind] [READY] Serveur mémoire prêt sur STDIO.'
        : '[Overmind] [READY] Serveur prêt sur STDIO.',
    );
  } catch (err) {
    rootLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      '[Overmind] [ERREUR] Échec du démarrage STDIO.',
    );
    process.exit(1);
  }
}
