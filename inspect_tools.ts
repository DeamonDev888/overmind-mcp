import { createServer } from './src/server.js';

const fullServer = createServer('full', false);
const memoryServer = createServer('memory', true);

// FastMCP usually stores tools in a property like 'tools'
console.log(
  'Full mode tools:',
  Object.keys((fullServer as { tools: Record<string, unknown> }).tools),
);
console.log(
  'Memory mode tools:',
  Object.keys((memoryServer as { tools: Record<string, unknown> }).tools),
);
