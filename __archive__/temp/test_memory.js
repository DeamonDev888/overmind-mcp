import { memorySearchTool } from './dist/tools/memory_search.js';

async function run() {
  const query = process.argv[2] || "architecture projet standard overmind";
  const result = await memorySearchTool({ query });
  console.log(JSON.stringify(result, null, 2));
}

run().catch(console.error);
