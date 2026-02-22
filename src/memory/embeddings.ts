/**
 * Embedding provider for OverMind Memory.
 *
 * Exclusively uses OpenAI-compatible API (OpenRouter/OpenAI) for HD embeddings.
 * FALLBACK LITE MODE HAS BEEN REMOVED.
 */

// ── Public API ────────────────────────────────────────────────────────────────

export function getEmbeddingConfig(): { url: string; model: string; key?: string } | null {
  const url = process.env.OVERMIND_EMBEDDING_URL || (process.env.OVERMIND_EMBEDDING_KEY ? 'https://openrouter.ai/api/v1/embeddings' : null);
  const model = process.env.OVERMIND_EMBEDDING_MODEL ?? 'qwen/qwen3-embedding-8b';
  const key = process.env.OVERMIND_EMBEDDING_KEY;
  return url ? { url, model, key } : null;
}

/**
 * Generate an embedding for `text`.
 * Returns { embedding, model }.
 * Returns empty embedding and model='none' if no API is configured or if API fails.
 */
export async function embedText(text: string): Promise<{ embedding: number[]; model: string }> {
  const config = getEmbeddingConfig();

  if (!config) {
    console.warn('[Embedding] No API configuration found. Semantic search will be disabled.');
    return { embedding: [], model: 'none' };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.key) {
      headers['Authorization'] = `Bearer ${config.key}`;
      // OpenRouter specific headers
      if (config.url.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://overmind-mcp.local';
        headers['X-Title'] = 'OverMind MCP Orchestrator';
      }
    }

    const res = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.model, input: text }),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{ embedding: number[] }>;
        embedding?: number[];
      };
      const embedding = json.data?.[0]?.embedding ?? json.embedding;
      if (Array.isArray(embedding) && embedding.length > 0) {
        return { embedding, model: config.model };
      }
    } else {
      const errBody = await res.text();
      console.error(`[Embedding API Error] ${res.status}: ${errBody}`);
    }
  } catch (e) {
    console.error(`[Embedding API Catch] ${e instanceof Error ? e.message : String(e)}`);
  }

  return { embedding: [], model: 'none' };
}

/** Cosine similarity between two vectors of equal length */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
