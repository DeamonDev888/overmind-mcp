import 'dotenv/config';
import { runAgent } from './run_agent.js';

/**
 * 🚀 OVERMIND CLI TESTER
 * 
 * Ce script permet de tester directement l'orchestrateur runAgent depuis le terminal.
 * 
 * USAGE:
 * npx tsx src/tools/run_agent_cli.ts <runner> <agentName> <prompt>
 * 
 * EXEMPLES:
 * npx tsx src/tools/run_agent_cli.ts claude sniper_analyst "Donne moi l'état du marché"
 * npx tsx src/tools/run_agent_cli.ts kilo architect "Conçois une API pour Overmind"
 * npx tsx src/tools/run_agent_cli.ts hermes test_agent "Hello, qui es-tu ?"
 */

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('\n❌ Paramètres manquants !');
    console.error('Usage: npx tsx src/tools/run_agent_cli.ts <runner> <agentName> <prompt>\n');
    console.error('Runners disponibles: claude, gemini, kilo, qwencli, openclaw, cline, opencode, hermes\n');
    process.exit(1);
  }

  const [runner, agentName, prompt, model] = args;

  console.error(`\n[CLI] 🤖 Lancement de l'agent '${agentName}' via '${runner}'${model ? ` (Modèle: ${model})` : ''}...`);
  
  const result = await runAgent({
    runner: runner as any,
    agentName,
    prompt,
    model,
    autoResume: true,
    silent: false // On garde les logs pour le test CLI
  });

  // Affiche le résultat JSON final
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
