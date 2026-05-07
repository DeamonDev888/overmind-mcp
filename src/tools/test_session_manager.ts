/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           🧪 SESSION MANAGER TESTER — MCP Mode               ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Teste le session_manager via MCP SDK                         ║
 * ║                                                              ║
 * ║  USAGE                                                       ║
 * ║  npx tsx src/tools/test_session_manager.ts <action>          ║
 * ║                                                              ║
 * ║  EXEMPLES                                                    ║
 * ║  npx tsx src/tools/test_session_manager.ts list claude       ║
 * ║  npx tsx src/tools/test_session_manager.ts stats             ║
 * ║  npx tsx src/tools/test_session_manager.ts purge             ║
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

// ─── Parsing des arguments ───────────────────────────────────────────────────
const argv = process.argv.slice(2);

if (argv.length < 1) {
  console.error('\n❌ Action manquante !');
  console.error('Usage: npx tsx src/tools/test_session_manager.ts <action> [runner]\n');
  console.error('Actions: list, stats, purge');
  console.error('Exemples:');
  console.error('  npx tsx src/tools/test_session_manager.ts list claude');
  console.error('  npx tsx src/tools/test_session_manager.ts stats');
  console.error('  npx tsx src/tools/test_session_manager.ts purge\n');
  process.exit(1);
}

const [action, runner] = argv;

// ─── MODE MCP ────────────────────────────────────────────────────────────────
async function runSessionManagerTest() {
  // Chemin vers le binaire compilé
  const serverBin = path.resolve(__dirname, '../../dist/bin/cli.js');

  if (!fs.existsSync(serverBin)) {
    console.error(`\n❌ Binaire serveur introuvable : ${serverBin}`);
    console.error("   Lancez d'abord : pnpm run build\n");
    process.exit(1);
  }

  console.error(`\n[CLI:mcp] 🚀 Démarrage du serveur MCP : node ${serverBin}`);
  console.error(`[CLI:mcp] 🗂️ action="${action}"${runner ? `  runner="${runner}"` : ''}\n`);

  // Le serveur hérite de process.env (donc du .env déjà chargé)
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--no-warnings', serverBin],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client(
    { name: 'session-manager-tester', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    // Listing des outils disponibles
    const { tools } = await client.listTools();
    console.error(
      `[CLI:mcp] ✅ Connecté — ${tools.length} outil(s) disponible(s) : ${tools.map((t) => t.name).join(', ')}\n`,
    );

    // Vérifier que session_manager est disponible
    const sessionManagerTool = tools.find((t) => t.name === 'session_manager');
    if (!sessionManagerTool) {
      console.error('[CLI:mcp] ❌ Outil session_manager non trouvé !');
      process.exit(1);
    }

    console.error(`[CLI:mcp] 📤 Appel session_manager…`);

    // Préparer les arguments selon l'action
    const args: Record<string, unknown> = { action };

    if (runner) {
      args.runner = runner;
    }

    // Ajouter des options spécifiques selon l'action
    if (action === 'list') {
      args.includeExpired = false;
    }

    const result = await client.callTool({
      name: 'session_manager',
      arguments: args,
    });

    console.log('\n── Résultat Session Manager ──────────────────────────────');
    console.log((result.content as { text: string }[])[0].text);
  } catch (error) {
    console.error('\n💥 Erreur :', error);
    process.exit(1);
  } finally {
    await transport.close();
    console.error('\n[CLI:mcp] 🔌 Connexion fermée.');
  }
}

// ─── Exécution ───────────────────────────────────────────────────────────────
try {
  await runSessionManagerTest();
} catch (err) {
  console.error('\n💥 Erreur fatale :', err);
  process.exit(1);
}