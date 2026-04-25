import { runNexusSentinelTool } from './dist/tools/run_nexus_sentinel.js';

const result = await runNexusSentinelTool({});
console.log(JSON.stringify(result, null, 2));
