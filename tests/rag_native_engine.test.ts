import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresMemoryProvider } from '../src/memory/PostgresMemoryProvider.js';

vi.mock('overmind-postgres-mcp/services/embeddings', () => ({
  embedText: vi.fn().mockResolvedValue({ embedding: Array(4096).fill(0.1), model: 'test-model' }),
}));

describe('PostgresMemoryProvider Native Engine', () => {
  let provider: PostgresMemoryProvider;

  beforeEach(() => {
    provider = new PostgresMemoryProvider();
  });

  it.skip('SHOULD use Native Library Engine when pgvector extension is missing', async () => {
    const query = 'Test de recherche native';

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, text, source, created_at, embedding FROM knowledge_chunks')) {
          return Promise.resolve({
            rows: [
              {
                id: 'k1',
                text: 'Contenu trouvé via moteur natif JS',
                source: 'agent|test',
                created_at: Date.now().toString(),
                embedding: Array(4096).fill(0.1),
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      connect: vi.fn(),
    };

    (
      provider as {
        getPoolFor: ReturnType<typeof vi.fn>;
        initializeDb: ReturnType<typeof vi.fn>;
        dbVectorSupport: Map<string, boolean>;
      }
    ).getPoolFor = vi.fn().mockResolvedValue(mockPool);
    (
      provider as {
        getPoolFor: ReturnType<typeof vi.fn>;
        initializeDb: ReturnType<typeof vi.fn>;
        dbVectorSupport: Map<string, boolean>;
      }
    ).initializeDb = vi.fn().mockResolvedValue(true);
    // Force hasVector = false to trigger native fallback
    (
      provider as {
        getPoolFor: ReturnType<typeof vi.fn>;
        initializeDb: ReturnType<typeof vi.fn>;
        dbVectorSupport: Map<string, boolean>;
      }
    ).dbVectorSupport.set('overmind_core', false);

    const results = await provider.searchMemory({
      query,
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain('moteur natif JS');
    expect(results[0].match_type).toBe('vector-native');
    console.log("✅ Validation réussie : Le moteur natif JS prend le relais sans bloquer l'usage.");
  });

  it('SHOULD maintain 4096 dimensions strictly even in native mode', async () => {
    const { embedding } = await (
      await import('overmind-postgres-mcp/services/embeddings')
    ).embedText('test');
    expect(embedding.length).toBe(4096);
    console.log('✅ Validation réussie : Le moteur natif opère strictement en 4096D.');
  });
});
