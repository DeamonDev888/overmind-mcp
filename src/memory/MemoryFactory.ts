import { MemoryProvider, StoreRunParams } from './types.js';
import { PostgresMemoryProvider } from './PostgresMemoryProvider.js';
import pino from 'pino';

const logger = pino({ name: 'MemoryFactory' });

let _provider: MemoryProvider | null = null;

/**
 * Gets the PostgreSQL Memory Provider.
 * SQLite support has been removed to streamline the codebase.
 */
export function getMemoryProvider(): MemoryProvider {
  if (_provider) return _provider;
  _provider = new PostgresMemoryProvider();
  return _provider;
}

/**
 * Convenience helper for runners to record activity without fetching the provider manually.
 * Includes error handling to prevent runner crashes if PostgreSQL is unavailable.
 */
export async function storeRun(params: StoreRunParams): Promise<string> {
  try {
    const provider = getMemoryProvider();
    return await provider.storeRun(params);
  } catch (error) {
    // Log error but don't crash the runner
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      runner: params.runner,
      agentName: params.agentName,
    }, 'Failed to store run in memory, continuing execution');
    // Return empty string to maintain compatibility
    return '';
  }
}
