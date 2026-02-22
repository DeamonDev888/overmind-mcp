import { MemoryProvider } from './types.js';
import { PostgresMemoryProvider } from './PostgresMemoryProvider.js';

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
 */
export function storeRun(params: any): Promise<string> | string {
  return getMemoryProvider().storeRun(params);
}
