/**
 * Embedding provider for OverMind Memory.
 *
 * Priority:
 *  1. OpenAI-compatible API  → real semantic embeddings
 *     Set OVERMIND_EMBEDDING_URL (e.g. http://localhost:11434/v1/embeddings via Ollama)
 *     Set OVERMIND_EMBEDDING_MODEL (e.g. nomic-embed-text)
 *  2. JS fallback             → sparse TF-IDF-like vector (1024 dims)
 *     Works offline, less precise but functional for FTS-hybrid search.
 */

const FALLBACK_DIMS = 1024;

// ── Utility ─────────────────────────────────────────────────────────────────

/** djb2 hash → bucket index within FALLBACK_DIMS */
function hash(token: string): number {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = (h * 33) ^ token.charCodeAt(i);
  return Math.abs(h) % FALLBACK_DIMS;
}

/** Tokenise and compute sparse TF-IDF-like vector */
function fallbackEmbed(text: string): number[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const tf = new Map<number, number>();
  for (const t of tokens) {
    const idx = hash(t);
    tf.set(idx, (tf.get(idx) ?? 0) + 1);
  }

  const vec = new Array<number>(FALLBACK_DIMS).fill(0);
  tf.forEach((count, idx) => {
    vec[idx] = Math.sqrt(count);
  });

  // L2-normalise
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getEmbeddingConfig(): { url: string; model: string } | null {
  const url = process.env.OVERMIND_EMBEDDING_URL;
  const model = process.env.OVERMIND_EMBEDDING_MODEL ?? 'nomic-embed-text';
  return url ? { url, model } : null;
}

/**
 * Generate an embedding for `text`.
 * Returns { embedding, model } — model='fallback' when using JS fallback.
 */
export async function embedText(text: string): Promise<{ embedding: number[]; model: string }> {
  const config = getEmbeddingConfig();

  if (config) {
    try {
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      }
    } catch {
      // fall through to fallback
    }
  }

  return { embedding: fallbackEmbed(text), model: 'fallback' };
}

/** Cosine similarity between two vectors of equal length */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
