import { createServer } from './src/server.js';

const server = createServer('Test', false);
console.log('Public properties:', Object.keys(server));

// Try to find nested tools
function findTools(obj: unknown, path = ''): void {
  if (!obj || typeof obj !== 'object' || path.length > 50) return;
  for (const key in obj) {
    if (key === 'tools') {
      console.log(`Found tools at: ${path}.${key} ->`, Object.keys(obj[key]));
    }
    // findTools(obj[key], `${path}.${key}`); // Recursive can be dangerous
  }
}

findTools(server, 'server');
// Check options.name
console.log('Server name in options:', (server as { options?: { name?: string } }).options?.name);
