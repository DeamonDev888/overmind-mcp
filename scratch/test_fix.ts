// 🛡️ ULTIMATE SHIELD: Proxy process.stdout.write to redirect non-JSON data to stderr
const originalStdoutWrite = process.stdout.write;
process.stdout.write = function (chunk: string | Uint8Array, encoding?: any, callback?: any): boolean {
  const str = typeof chunk === 'string' ? chunk : chunk.toString();
  const trimmed = str.trim();
  
  if (trimmed.startsWith('{') || trimmed === '') {
    return originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
  }
  
  return process.stderr.write(`[REDIRECTED TO STDERR] ${str}`, encoding, callback);
} as any;

import { KiloRunner } from '../src/services/KiloRunner.js';

import { createServer } from '../src/server.js';

async function test() {
  console.log("This should be redirected to stderr by the shield");
  
  const runner = new KiloRunner();
  // Mock child process output
  const result = await runner.runAgent({
    prompt: "Say hello",
    silent: false
  });
  
  console.log("Result:", result.result);
}

test().catch(console.error);
