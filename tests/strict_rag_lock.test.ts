import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresMemoryProvider } from '../src/memory/PostgresMemoryProvider.js';

vi.mock('overmind-postgres-mcp/services/embeddings', () => ({
  embedText: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3], model: 'test-model' }),
}));

describe('PostgresMemoryProvider Strict Mode (No Fallback)', () => {
  let provider: PostgresMemoryProvider;

  beforeEach(() => {
    // Setup provider with default env (connects to local postgres)
    provider = new PostgresMemoryProvider();
  });

  it('SHOULD throw a strict CORTEX error when vector search fails (missing pgvector)', async () => {
    const query = 'Test de recherche sémantique';

    // On mock le pool interne pour simuler une erreur SQL (ex: extension manquante)
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('relation "knowledge_chunks" does not exist')),
      connect: vi.fn(),
    };
    
    // Injecter le mock dans le provider (accès privé via any pour le test)
    (provider as any).getPoolFor = vi.fn().mockResolvedValue(mockPool);
    (provider as any).initializeDb = vi.fn().mockResolvedValue(undefined);

    try {
      await provider.searchMemory({
        query,
        limit: 5,
        includeRuns: false,
      });

      throw new Error(
        "Le test a échoué : la recherche n'a pas été verrouillée par la règle STRICT.",
      );
    } catch (err: unknown) {
      expect(err instanceof Error && err.message).toContain('CORTEX STRICT RULE');
      expect(err instanceof Error && err.message).toContain('pgvector est REQUISE');
      console.log('✅ Validation réussie : Le mécanisme est correctement verrouillé même en cas d\'erreur DB.');
    }
  });
});
