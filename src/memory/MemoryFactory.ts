import { MemoryProvider, StoreRunParams } from './types.js';
import {
  PostgresMemoryProvider,
  registerMemoryAlertCallback,
} from './PostgresMemoryProvider.js';
import { rootLogger } from '../lib/logger.js';

const logger = rootLogger.child({ module: 'MemoryFactory' });

let _provider: MemoryProvider | null = null;
let _isDbAvailable = true;
let _lastDbError: string | null = null;

// Re-export for external use
export { registerMemoryAlertCallback, unregisterMemoryAlertCallback } from './PostgresMemoryProvider.js';

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
 * Check if memory database is available.
 */
export function isMemoryAvailable(): boolean {
  return _isDbAvailable;
}

/**
 * Get last database error message.
 */
export function getLastMemoryError(): string | null {
  return _lastDbError;
}

/**
 * Initialize memory factory and register alert callbacks.
 */
export function initMemoryFactory(): void {
  registerMemoryAlertCallback((message, error) => {
    _isDbAvailable = false;
    _lastDbError = error?.message || message;
    logger.error({ message, error: error?.message }, 'MEMORY ALERT: Database unavailable!');

    // Could trigger additional alerts here (webhooks, notifications, etc.)
  });
  logger.info('MemoryFactory initialized with alert callbacks');
}

// Initialize on module load
initMemoryFactory();

/**
 * Convenience helper for runners to record activity without fetching the provider manually.
 * THROWS on DB failure to alert the caller - memory failures should not be silent!
 */
export async function storeRun(params: StoreRunParams): Promise<string> {
  const provider = getMemoryProvider();
  try {
    _isDbAvailable = true;
    _lastDbError = null;
    return await provider.storeRun(params);
  } catch (error) {
    _isDbAvailable = false;
    const err = error instanceof Error ? error : new Error(String(error));
    _lastDbError = err.message;
    logger.error({
      error: err.message,
      runner: params.runner,
      agentName: params.agentName,
    }, 'CRITICAL: Failed to store run in memory - database may be unavailable!');

    // Re-throw so the runner can report this to the user
    // Don't leak connection details — keep error generic, details in logs
    throw new Error('MEMORY_UNAVAILABLE: Database operation failed — check server logs', { cause: error });
  }
}
