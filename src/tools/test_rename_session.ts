/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           🧪 SESSION RENAME TEST — MCP Mode                   ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Teste le renommage de session via MCP                        ║
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

// ─── MODE MCP ────────────────────────────────────────────────────────────────
async function testRenameSession() {
  const serverBin = path.resolve(__dirname, '../../dist/bin/cli.js');

  if (!fs.existsSync(serverBin)) {
    console.error(`\n❌ Binaire serveur introuvable : ${serverBin}`);
    console.error("   Lancez d'abord : pnpm run build\n");
    process.exit(1);
  }

  console.error(`\n[CLI:mcp] 🧪 Test de renommage de session`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--no-warnings', serverBin],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client(
    { name: 'session-rename-tester', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    console.error(
      `[CLI:mcp] ✅ Connecté — ${tools.length} outil(s) disponible(s)\n`,
    );

    // Créer une session de test
    console.error(`[CLI:mcp] 📤 Préparation: Création d'une session de test…`);

    await client.callTool({
      name: 'session_manager',
      arguments: {
        action: 'copy',
        sourceAgentName: 'contremaitre',
        targetAgentName: 'test_rename_original',
        sourceRunner: 'claude',
        targetRunner: 'claude',
      },
    });

    console.error(`[CLI:mcp] ✅ Session de test créée`);

    // Tester le renommage
    console.error(`[CLI:mcp] 📤 Test 1: Renommage de la session…`);

    const renameResult = await client.callTool({
      name: 'session_manager',
      arguments: {
        action: 'rename',
        oldAgentName: 'test_rename_original',
        newAgentName: 'test_rename_renamed',
        runner: 'claude',
      },
    });

    console.log('\n── Résultat Renommage ────────────────────────────────────────');
    console.log((renameResult.content as { text: string }[])[0].text);

    // Vérifier que le renommage a fonctionné
    console.error(`[CLI:mcp] 📤 Test 2: Vérification du renommage…`);

    const listResult = await client.callTool({
      name: 'session_manager',
      arguments: {
        action: 'list',
        runner: 'claude',
        agentName: 'test_rename_renamed',
      },
    });

    console.log('\n── Vérification ───────────────────────────────────────────────');
    console.log((listResult.content as { text: string }[])[0].text);

    // Nettoyer
    console.error(`[CLI:mcp] 🗑️ Test 3: Nettoyage de la session de test…`);

    const deleteResult = await client.callTool({
      name: 'session_manager',
      arguments: {
        action: 'delete',
        agentName: 'test_rename_renamed',
        runner: 'claude',
      },
    });

    console.log('\n── Nettoyage ────────────────────────────────────────────────');
    console.log((deleteResult.content as { text: string }[])[0].text);

    console.error('\n✅ Tests de renommage réussis !');
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
  await testRenameSession();
} catch (err) {
  console.error('\n💥 Erreur fatale :', err);
  process.exit(1);
}