import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresMemoryProvider } from '../src/memory/PostgresMemoryProvider.js';

describe('PostgresMemoryProvider Strict Mode (No Fallback)', () => {
  let provider: PostgresMemoryProvider;

  beforeEach(() => {
    // Setup provider with default env (connects to local postgres)
    provider = new PostgresMemoryProvider();
  });

  it('SHOULD validate semantic search or throw a strict CORTEX error', async () => {
    const query = 'Test de recherche sémantique';

    try {
      const results = await provider.searchMemory({
        query,
        limit: 5,
        includeRuns: false,
      });

      // Si pgvector est là, on doit avoir un tableau (même vide)
      expect(Array.isArray(results)).toBe(true);
      console.log('✅ Validation réussie : Recherche effectuée avec succès (pgvector présent).');
    } catch (err: unknown) {
      // Si ça échoue, ça DOIT être à cause de la règle stricte
      expect(err instanceof Error && err.message).toContain('CORTEX STRICT RULE');
      expect(err instanceof Error && err.message).toContain('pgvector est REQUISE');
      console.log(
        '✅ Validation réussie : Le mécanisme est correctement verrouillé (pgvector absent).',
      );
    }
  });
});
