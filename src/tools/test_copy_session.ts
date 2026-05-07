/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           🧪 SESSION COPY TEST — MCP Mode                    ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Teste la copie de session via MCP                            ║
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
async function testCopySession() {
  const serverBin = path.resolve(__dirname, '../../dist/bin/cli.js');

  if (!fs.existsSync(serverBin)) {
    console.error(`\n❌ Binaire serveur introuvable : ${serverBin}`);
    console.error("   Lancez d'abord : pnpm run build\n");
    process.exit(1);
  }

  console.error(`\n[CLI:mcp] 🧪 Test de copie de session`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--no-warnings', serverBin],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client(
    { name: 'session-copy-tester', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    console.error(
      `[CLI:mcp] ✅ Connecté — ${tools.length} outil(s) disponible(s)\n`,
    );

    // Tester la copie d'une session
    console.error(`[CLI:mcp] 📤 Test 1: Copie d'une session Claude…`);

    const copyResult = await client.callTool({
      name: 'session_manager',
      arguments: {
        action: 'copy',
        sourceAgentName: 'contremaitre',
        targetAgentName: 'contremaitre_copy_test',
        sourceRunner: 'claude',
        targetRunner: 'claude',
      },
    });

    console.log('\n── Résultat Copie ────────────────────────────────────────');
    console.log((copyResult.content as { text: string }[])[0].text);

    // Vérifier que la copie existe
    console.error(`\n[CLI:mcp] 📤 Test 2: Vérification de la copie…`);

    const listResult = await client.callTool({
      name: 'session_manager',
      arguments: {
        action: 'list',
        runner: 'claude',
        agentName: 'contremaitre_copy_test',
      },
    });

    console.log('\n── Vérification ───────────────────────────────────────────');
    console.log((listResult.content as { text: string }[])[0].text);

    // Supprimer la copie de test
    console.error(`\n[CLI:mcp] 🗑️ Test 3: Suppression de la copie de test…`);

    const deleteResult = await client.callTool({
      name: 'session_manager',
      arguments: {
        action: 'delete',
        agentName: 'contremaitre_copy_test',
        runner: 'claude',
      },
    });

    console.log('\n── Suppression ─────────────────────────────────────────────');
    console.log((deleteResult.content as { text: string }[])[0].text);

    console.error('\n✅ Tests de copie/suppression réussis !');
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
  await testCopySession();
} catch (err) {
  console.error('\n💥 Erreur fatale :', err);
  process.exit(1);
}