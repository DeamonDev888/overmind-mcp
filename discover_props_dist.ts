import { createServer } from './dist/server.js';

const server = createServer('Test', false);
console.log('Public properties:', Object.keys(server));
console.log('Server name in options:', (server as { options?: { name?: string } }).options?.name);

interface ServerWithTools {
  tools?: Record<string, unknown>;
}

if ((server as ServerWithTools).tools) {
  console.log('Tools found in root:', Object.keys((server as ServerWithTools).tools!));
} else {
  // Check common private property patterns if not using actual #
  for (const key in server) {
    if (key.includes('tools')) {
      console.log(`Found property: ${key}`);
    }
  }
}
