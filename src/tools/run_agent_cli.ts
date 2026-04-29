/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           🚀 OVERMIND CLI TESTER — Mode Dual               ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  --lib  : appelle runAgent() directement (rapide, in-proc)  ║
 * ║  --mcp  : spawn le serveur MCP + appel via SDK officiel     ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  USAGE                                                       ║
 * ║  npx tsx src/tools/run_agent_cli.ts [--lib|--mcp]           ║
 * ║            <runner> <agentName> <prompt> [model]             ║
 * ║                                                              ║
 * ║  EXEMPLES                                                    ║
 * ║  npx tsx src/tools/run_agent_cli.ts --lib                   ║
 * ║            kilo sniper_analyst "Analyse le marché"           ║
 * ║                                                              ║
 * ║  npx tsx src/tools/run_agent_cli.ts --mcp                   ║
 * ║            kilo mistral_test_kilo_1 "Hello" mistral-large-latest ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ─── ENV: chargée en tout premier (avant tout import qui lirait process.env) ────
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Résolution du .env relatif au projet (src/tools → ../../.env)
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const { config } = await import('dotenv');
  config({ path: envPath });
}

// ─── Imports métier ─────────────────────────────────────────────────────────
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runAgent } from './run_agent.js';

// ─── Parsing des arguments ───────────────────────────────────────────────────
const argv = process.argv.slice(2);

// Premier arg optionnel : mode
let mode: 'lib' | 'mcp' = 'lib'; // défaut : lib
let rest = argv;

if (argv[0] === '--lib') { mode = 'lib'; rest = argv.slice(1); }
else if (argv[0] === '--mcp') { mode = 'mcp'; rest = argv.slice(1); }

if (rest.length < 3) {
  console.error('\n❌ Paramètres manquants !');
  console.error('Usage: npx tsx src/tools/run_agent_cli.ts [--lib|--mcp] <runner> <agentName> <prompt> [model]\n');
  console.error('Modes:');
  console.error('  --lib  (défaut) : appel direct à runAgent() — rapide, sans serveur');
  console.error('  --mcp           : spawn du serveur MCP + appel via SDK officiel\n');
  console.error('Runners: claude, gemini, kilo, qwencli, openclaw, cline, opencode, hermes\n');
  process.exit(1);
}

const [runner, agentName, prompt, model] = rest;

// ─── MODE LIB ────────────────────────────────────────────────────────────────
async function runViaLib() {
  console.error(`\n[CLI:lib] 🤖 runner="${runner}"  agent="${agentName}"${model ? `  modèle="${model}"` : ''}`);

  const result = await runAgent({
    runner: runner as Parameters<typeof runAgent>[0]['runner'],
    agentName,
    prompt,
    model,
    autoResume: true,
    silent: false,
  });

  console.log('\n── Résultat ──────────────────────────────────────────────');
  console.log(JSON.stringify(result, null, 2));
}

// ─── MODE MCP ────────────────────────────────────────────────────────────────
async function runViaMcp() {
  // Chemin vers le binaire compilé, résolu relativement à ce fichier
  // src/tools/run_agent_cli.ts → dist/bin/cli.js
  const serverBin = path.resolve(__dirname, '../../dist/bin/cli.js');

  if (!fs.existsSync(serverBin)) {
    console.error(`\n❌ Binaire serveur introuvable : ${serverBin}`);
    console.error('   Lancez d\'abord : pnpm run build\n');
    process.exit(1);
  }

  console.error(`\n[CLI:mcp] 🚀 Démarrage du serveur MCP : node ${serverBin}`);
  console.error(`[CLI:mcp] 🤖 runner="${runner}"  agent="${agentName}"${model ? `  modèle="${model}"` : ''}\n`);

  // Le serveur hérite de process.env (donc du .env déjà chargé)
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--no-warnings', serverBin],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client(
    { name: 'overmind-cli-tester', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    // Listing des outils disponibles (optionnel, utile pour le debug)
    const { tools } = await client.listTools();
    console.error(`[CLI:mcp] ✅ Connecté — ${tools.length} outil(s) disponible(s) : ${tools.map(t => t.name).join(', ')}\n`);

    const args: Record<string, unknown> = { runner, agentName, prompt, autoResume: true, silent: false };
    if (model) args.model = model;

    console.error(`[CLI:mcp] 📤 Appel run_agent…`);
    const result = await client.callTool({ name: 'run_agent', arguments: args });

    console.log('\n── Résultat MCP ──────────────────────────────────────────');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await transport.close();
    console.error('\n[CLI:mcp] 🔌 Connexion fermée.');
  }
}

// ─── Dispatch ────────────────────────────────────────────────────────────────
try {
  if (mode === 'mcp') {
    await runViaMcp();
  } else {
    await runViaLib();
  }
} catch (err) {
  console.error('\n💥 Erreur fatale :', err);
  process.exit(1);
}
