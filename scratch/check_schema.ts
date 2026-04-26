import { createServer } from '../src/server.js';

async function check() {
  const server = createServer();
  // @ts-expect-error - listTools() might not be public in the type definition but exists at runtime
  const tools = await server.listTools();
  const runAgent = tools.find((t: { name: string; parameters: unknown }) => t.name === 'run_agent');
  console.log(JSON.stringify(runAgent.parameters, null, 2));
}

check().catch(console.error);
