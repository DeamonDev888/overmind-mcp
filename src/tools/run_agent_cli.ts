/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           🚀 OVERMIND CLI TESTER — In-process              ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  USAGE                                                       ║
 * ║  npx tsx src/tools/run_agent_cli.ts                          ║
 * ║            <runner> <agentName> <prompt> [model]             ║
 * ║                                                              ║
 * ║  EXEMPLE                                                     ║
 * ║  npx tsx src/tools/run_agent_cli.ts                          ║
 * ║            kilo sniper_analyst "Analyse le marché"           ║
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
import { runAgent } from './run_agent.js';

// ─── Parsing des arguments ───────────────────────────────────────────────────
const argv = process.argv.slice(2);

if (argv.length < 3) {
  console.error('\n❌ Paramètres manquants !');
  console.error(
    'Usage: npx tsx src/tools/run_agent_cli.ts <runner> <agentName> <prompt> [model]\n',
  );
  console.error('Runners: claude, gemini, kilo, qwencli, openclaw, cline, opencode, hermes\n');
  process.exit(1);
}

const [runner, agentName, prompt, model] = argv;

async function run() {
  console.error(
    `\n[CLI] 🤖 runner="${runner}"  agent="${agentName}"${model ? `  modèle="${model}"` : ''}`,
  );

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

try {
  await run();
} catch (err) {
  console.error('\n💥 Erreur fatale :', err);
  process.exit(1);
}
