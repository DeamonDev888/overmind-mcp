import { runAgent } from './run_agent.js';


async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: npx tsx src/tools/run_agent_cli.ts <runner> <agentName> <prompt>');
    process.exit(1);
  }

  const [runner, agentName, prompt] = args;

  const result = await runAgent({
    runner: runner as "claude",
    agentName,
    prompt,
    autoResume: true
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
