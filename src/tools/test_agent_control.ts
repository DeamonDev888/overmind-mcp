/**
 * Test script for agent_control (status, stream, kill, wait)
 * Tests the full pipeline: run_agent in background → agent_control operations
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverBin = path.resolve(__dirname, '../../dist/bin/cli.js');

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.error('\n🚀 Démarrage du serveur MCP...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--no-warnings', serverBin],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client(
    { name: 'agent-control-tester', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);

  const { tools } = await client.listTools();
  console.error(`✅ Connecté — ${tools.length} outil(s): ${tools.map(t => t.name).join(', ')}\n`);

  // Test 1: Run a kilo agent in background (non-blocking via --silent)
  console.error('── Test 1: Lancer un agent en arrière-plan ──────────────────────');
  const runArgs = {
    runner: 'kilo' as const,
    agentName: 'test_control_agent',
    prompt: 'Echo simply: "BACKGROUND_TEST_OK" then exit immediately',
    silent: true,
    autoResume: false,
  };

  console.error('📤 Appel run_agent (background mode)...');
  const runResult = await client.callTool({ name: 'run_agent', arguments: runArgs });
  console.error('run_agent result:', JSON.stringify(runResult, null, 2));

  // Small delay to let agent start
  await sleep(2000);

  // Test 2: Check agent status
  console.error('\n── Test 2: agent_control status ───────────────────────────────');
  const statusResult = await client.callTool({
    name: 'agent_control',
    arguments: {
      agentName: 'test_control_agent',
      runner: 'kilo',
      action: 'status',
    }
  });
  console.error('status result:', JSON.stringify(statusResult, null, 2));

  // Test 3: Stream agent output
  console.error('\n── Test 3: agent_control stream ──────────────────────────────');
  const streamResult = await client.callTool({
    name: 'agent_control',
    arguments: {
      agentName: 'test_control_agent',
      runner: 'kilo',
      action: 'stream',
    }
  });
  console.error('stream result:', JSON.stringify(streamResult, null, 2));

  // Test 4: Wait for agent completion (max 30s)
  console.error('\n── Test 4: agent_control wait (30s timeout) ──────────────────');
  const waitResult = await client.callTool({
    name: 'agent_control',
    arguments: {
      agentName: 'test_control_agent',
      runner: 'kilo',
      action: 'wait',
      timeoutMs: 30000,
    }
  });
  console.error('wait result:', JSON.stringify(waitResult, null, 2));

  // Test 5: Verify agent is done
  console.error('\n── Test 5: Final status check ─────────────────────────────────');
  const finalStatus = await client.callTool({
    name: 'agent_control',
    arguments: {
      agentName: 'test_control_agent',
      runner: 'kilo',
      action: 'status',
    }
  });
  console.error('final status:', JSON.stringify(finalStatus, null, 2));

  await transport.close();
  console.error('\n🔌 Connexion fermée. Tests terminés.\n');
}

main().catch(err => {
  console.error('\n💥 Erreur fatale :', err);
  process.exit(1);
});