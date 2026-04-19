import { memorySearchTool } from './memory_search.js';
import { memoryRunsTool } from './memory_runs.js';

async function init() {
  console.error("--- Architecture Search ---");
  const architecture = await memorySearchTool({ query: "architecture projet standard overmind", limit: 3, include_runs: false });
  console.error(JSON.stringify(architecture, null, 2));

  console.error("\n--- Context Search ---");
  const context = await memorySearchTool({ query: "contexte projet contremaitre", limit: 3, include_runs: false });
  console.error(JSON.stringify(context, null, 2));

  console.error("\n--- Recent Runs ---");
  const runs = await memoryRunsTool({ limit: 5, stats: false });
  console.error(JSON.stringify(runs, null, 2));
}

init().catch(console.error);
