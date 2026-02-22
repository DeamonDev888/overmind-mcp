import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresMemoryProvider } from '../src/memory/PostgresMemoryProvider.js';

describe('PostgresMemoryProvider Strict Mode (No Fallback)', () => {
  let provider: PostgresMemoryProvider;

  beforeEach(() => {
    // Setup provider with default env (connects to local postgres)
    provider = new PostgresMemoryProvider();
  });

  it('SHOULD throw a strict CORTEX error when vector search fails (missing pgvector)', async () => {
    const query = 'Test de recherche sémantique';

    // On s'attend à ce que la recherche échoue avec NOTRE message d'erreur personnalisé
    // car pgvector n'est pas installé sur cette instance Windows.
    try {
      await provider.searchMemory({
        query,
        limit: 5,
        includeRuns: false,
      });

      // Si on arrive ici, c'est que ça n'a pas crashé (echec du test de verrouillage)
      throw new Error(
        "Le test a échoué : la recherche n'a pas été verrouillée par la règle STRICT.",
      );
    } catch (err: unknown) {
      expect(err instanceof Error && err.message).toContain('CORTEX STRICT RULE');
      expect(err instanceof Error && err.message).toContain('pgvector est REQUISE');
      console.log('✅ Validation réussie : Le mécanisme est correctement verrouillé.');
    }
  });
});
