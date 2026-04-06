import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresMemoryProvider } from '../src/memory/PostgresMemoryProvider.js';

vi.mock('overmind-postgres-mcp/services/embeddings', () => ({
  embedText: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3], model: 'test-model' }),
}));

describe('Overmind Vector Isolation Check', () => {
  let provider: PostgresMemoryProvider;

  beforeEach(() => {
    provider = new PostgresMemoryProvider();
  });

  it('SHOULD NOT have any trigram or text fallback indexes in knowledge_chunks', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('pg_trgm') || sql.includes('gin_trgm_ops')) {
          return Promise.reject(new Error('VECTOR_ONLY_VIOLATION: pg_trgm is banned'));
        }
        return Promise.resolve({ rows: [] });
      }),
      connect: vi.fn().mockReturnThis(),
      release: vi.fn(),
    };

    // Simulate database initialization
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('pg_trgm') || sql.includes('gin_trgm_ops')) {
          throw new Error('VECTOR_ONLY_VIOLATION: pg_trgm is banned');
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect = vi.fn().mockResolvedValue(client);

    try {
      await (provider as { initializeDb: (dbName: string, pool: unknown) => Promise<void> }).initializeDb('test_db', mockPool);
      console.log('✅ Unit Test: No trigram violation detected.');
    } catch (err: Error) {
      if (err.message.includes('VECTOR_ONLY_VIOLATION')) {
        throw new Error('FATAL: Trigram index detected in a vector-only system!');
      }
    }
  });

  it('SHOULD strictly use <=> (cosine distance) for searching', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockReturnThis(),
      release: vi.fn(),
    };
    (provider as { getPoolFor: ReturnType<typeof vi.fn>; initializeDb: ReturnType<typeof vi.fn>; dbVectorSupport: Map<string, boolean> }).getPoolFor = vi.fn().mockResolvedValue(mockPool);
    (provider as { getPoolFor: ReturnType<typeof vi.fn>; initializeDb: ReturnType<typeof vi.fn>; dbVectorSupport: Map<string, boolean> }).initializeDb = vi.fn().mockResolvedValue(true);
    // Simuler le support vecteur pour que le test cible la requête SQL
    (provider as { getPoolFor: ReturnType<typeof vi.fn>; initializeDb: ReturnType<typeof vi.fn>; dbVectorSupport: Map<string, boolean> }).dbVectorSupport.set('overmind_core', true);

    await provider.searchMemory({ query: 'test', limit: 5 });

    const lastQuery = mockPool.query.mock.calls[0][0];
    expect(lastQuery).toContain('<=>'); // Must use vector distance
    expect(lastQuery).not.toContain('ILIKE'); // Must NOT use text search
    expect(lastQuery).not.toContain('ts_query'); // Must NOT use full-text search
    console.log('✅ Unit Test: Search methodology is strictly vector-only.');
  });
});
