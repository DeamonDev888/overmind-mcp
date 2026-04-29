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

// 🪄 Auto-formatteur de .env — Classifie tous les providers connus, préserve les valeurs
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
          : prefixes.some(p => key.startsWith(p));
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
      { title: "🌐 OVERMIND CORE & INFRASTRUCTURE",      vars: extract(["OVERMIND_WORKSPACE", "OVERMIND_MEMORY_TYPE"], true) },
      { title: "⚙️  GLOBAL SETTINGS",                    vars: extract(["API_TIMEOUT_MS"], true) },
      { title: "🗄️  DATABASE (PostgreSQL / pgvector)",    vars: extract("POSTGRES_") },
      { title: "🧠 EMBEDDINGS & VECTOR MEMORY",           vars: extract("OVERMIND_EMBEDDING_") },

      // ── LLM Providers (Europe / USA) ──
      { title: "🤖 LLM PROVIDER - Mistral AI 🇫🇷",       vars: extract("MISTRAL_") },
      { title: "🤖 LLM PROVIDER - OpenAI 🇺🇸",            vars: extract("OPENAI_") },
      { title: "🤖 LLM PROVIDER - Anthropic 🇺🇸",         vars: extract("ANTHROPIC_") },
      { title: "🤖 LLM PROVIDER - Google Gemini 🇺🇸",     vars: extract(["GEMINI_API_KEY", "GEMINI_MODEL", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"], true) },
      { title: "🤖 LLM PROVIDER - NVIDIA NIM 🇺🇸",        vars: [...extract(["NVAPI_KEY", "NVIDIA_API_KEY", "NVIDIA_API_BASE"], true), ...extract("NVIDIA_")] },
      { title: "🤖 LLM PROVIDER - OpenRouter 🇺🇸",        vars: extract(["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "OPENROUTER_MODEL"], true) },
      { title: "🤖 LLM PROVIDER - xAI / Grok 🇺🇸",       vars: extract(["XAI_API_KEY", "XAI_BASE_URL", "GROK_API_KEY", "GROK_MODEL"], true) },
      { title: "🤖 LLM PROVIDER - Groq 🇺🇸",              vars: extract("GROQ_") },
      { title: "🤖 LLM PROVIDER - Together AI 🇺🇸",       vars: extract("TOGETHER_") },
      { title: "🤖 LLM PROVIDER - Cohere 🇺🇸",            vars: extract("COHERE_") },
      { title: "🤖 LLM PROVIDER - Replicate 🇺🇸",         vars: extract("REPLICATE_") },
      { title: "🤖 LLM PROVIDER - HuggingFace 🇺🇸",       vars: extract(["HUGGINGFACE_API_KEY", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"], true) },
      { title: "🤖 LLM PROVIDER - Perplexity 🇺🇸",        vars: extract("PERPLEXITY_") },
      { title: "🤖 LLM PROVIDER - SambaNova 🇺🇸",         vars: extract("SAMBANOVA_") },
      { title: "🤖 LLM PROVIDER - Azure OpenAI ☁️",       vars: extract(["AZURE_API_KEY", "AZURE_API_BASE", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_VERSION"], true) },
      { title: "🤖 LLM PROVIDER - ElevenLabs 🎙️",        vars: extract(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID"], true) },
      { title: "🤖 LLM PROVIDER - AWS Bedrock ☁️",        vars: extract(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_ENDPOINT_URL"], true) },

      // ── LLM Providers (Chine / Asie) ──
      { title: "🤖 LLM PROVIDER - DeepSeek 🇨🇳",          vars: extract("DEEPSEEK_") },
      { title: "🤖 LLM PROVIDER - Alibaba DashScope 🇨🇳",  vars: extract("ALIBABA_") },
      { title: "🤖 LLM PROVIDER - Qwen (DashScope) 🇨🇳",   vars: extract(["QWEN_API_KEY", "QWEN_BASE_URL", "QWEN_MODEL", "DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL"], true) },
      { title: "🤖 LLM PROVIDER - SiliconFlow 🇨🇳",        vars: extract("SILICONFLOW_") },
      { title: "🤖 LLM PROVIDER - Minimax 🇨🇳",            vars: [...extract("MINIMAXI_"), ...extract("MINIMAX_")] },
      { title: "🤖 LLM PROVIDER - Ilmu AI / Z.AI 🇨🇳",    vars: extract("Z_AI_") },
      { title: "🤖 LLM PROVIDER - Moonshot / Kimi 🇨🇳",    vars: extract(["MOONSHOT_API_KEY", "MOONSHOT_BASE_URL", "MOONSHOT_MODEL", "KIMI_API_KEY"], true) },
      { title: "🤖 LLM PROVIDER - Baidu / ERNIE 🇨🇳",      vars: extract(["BAIDU_API_KEY", "ERNIE_API_KEY", "WENXIN_API_KEY"], true) },
      { title: "🤖 LLM PROVIDER - ZhipuAI / GLM 🇨🇳",      vars: [...extract(["ZHIPU_API_KEY", "GLM_API_KEY"], true), ...extract("ZHIPUAI_")] },

      // ── Services & Intégrations ──
      { title: "💬 SERVICE - Discord",                    vars: extract(["DISCORD_TOKEN", "DISCORD_BOT_TOKEN", "DISCORD_CHANNEL_ID", "DISCORD_GUILD_ID", "DISCORD_WEBHOOK_URL", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"], true) },
      { title: "🐦 SERVICE - Twitter / X",                vars: extract(["TWITTER_API_KEY", "TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_SECRET", "TWITTER_BEARER_TOKEN", "X_API_KEY", "X_BEARER_TOKEN", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"], true) },
      { title: "📱 SERVICE - Telegram",                   vars: extract(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"], true) },
      { title: "📱 SERVICE - Twilio / SMS",               vars: extract(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "TWILIO_API_KEY", "TWILIO_API_SECRET"], true) },
      { title: "🐙 SERVICE - GitHub",                     vars: extract(["GITHUB_TOKEN", "GITHUB_API_KEY", "GH_TOKEN", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"], true) },
      { title: "▲ SERVICE - Vercel",                      vars: extract(["VERCEL_TOKEN", "VERCEL_API_TOKEN", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID", "VERCEL_TEAM_ID"], true) },
      { title: "🔺 SERVICE - Supabase",                   vars: extract(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET"], true) },
      { title: "🎮 SERVICE - Riot Games",                 vars: extract(["RIOT_API_KEY", "RIOT_REGION"], true) },
      { title: "🔍 SERVICE - Search (Serper/Tavily)",     vars: extract(["SERPER_API_KEY", "TAVILY_API_KEY", "SERPAPI_KEY", "BRAVE_SEARCH_API_KEY"], true) },
      { title: "📰 SERVICE - Market Data & News",         vars: extract(["FINNHUB_API_KEY", "NEWSAPI_KEY", "ALPHAVANTAGE_API_KEY", "POLYGON_API_KEY", "TIINGO_API_KEY"], true) },
    ];

    // Clés restantes non classifiées → section fourre-tout
    const uncategorized: [string, string][] = [];
    for (const key of Object.keys(envVars)) {
      if (!usedKeys.has(key)) uncategorized.push([key, envVars[key]]);
    }
    if (uncategorized.length > 0) {
      sections.push({ title: "📁 AUTRES / NON-CLASSIFIÉS", vars: naturalSort(uncategorized) });
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
      fs.writeFileSync(envPath, newContent.trim() + '\n', 'utf8');
    }
  } catch (_e) {
    // Ignorer silencieusement pour ne pas crasher le boot
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
} catch (_e) {
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
