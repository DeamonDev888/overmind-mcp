/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — Helpers & Utilities                             ║
 * ║   retry, logging, SSE parsing, validation                          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import type { McpResponse } from './types.js';

// ─── Logger ────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BridgeLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Crée un logger simple prefixé — peut être remplacé par pino/winston */
export function createBridgeLogger(prefix: string): BridgeLogger {
  const fmt = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    const ts = new Date().toISOString().slice(11, 19);
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${ts}] [${prefix}] ${msg}${metaStr}`);
  };

  return {
    debug: (msg, meta) => fmt('debug', msg, meta),
    info:  (msg, meta) => fmt('info', msg, meta),
    warn:  (msg, meta) => fmt('warn', msg, meta),
    error: (msg, meta) => fmt('error', msg, meta),
  };
}

// ─── SSE Parsing ───────────────────────────────────────────────────────────

/**
 * Parse une réponse SSE (text/event-stream) ligne par ligne.
 * Retourne le premier objet JSON-RPC valide trouvé dans les lignes "data:".
 */
export function parseSseText(text: string): McpResponse | null {
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      const dataStr = line.slice(6).trim();
      if (dataStr) {
        try {
          return JSON.parse(dataStr) as McpResponse;
        } catch {
          // ligne data: invalide — on continue
        }
      }
    }
  }
  return null;
}

/**
 * Parse le body d'une réponse MCP : SSE d'abord, fallback JSON brut.
 */
export function parseMcpResponseBody(text: string): McpResponse {
  // 1) Essai SSE
  const sse = parseSseText(text);
  if (sse) return sse;

  // 2) Fallback JSON direct
  const trimmed = text.trim();
  if (trimmed) {
    try {
      return JSON.parse(trimmed) as McpResponse;
    } catch {
      throw new Error(`SSE response: no valid data: line. Body preview: ${trimmed.substring(0, 200)}`);
    }
  }

  throw new Error('SSE response: empty body');
}

// ─── Retry ─────────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  /** Codes d'erreur qui méritent un retry (default: ETIMEDOUT, EBODYREAD, ECONNRESET) */
  retryableCodes?: string[];
}

const DEFAULT_RETRY_CODES = ['ETIMEDOUT', 'EBODYREAD', 'ECONNRESET', 'ECONNREFUSED'];

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
  logger?: BridgeLogger,
): Promise<T> {
  const codes = opts.retryableCodes ?? DEFAULT_RETRY_CODES;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err as Error & { code?: string };
      lastError = error;

      const isRetryable = codes.includes(error?.code ?? '');
      if (!isRetryable || attempt >= opts.maxAttempts) {
        throw err;
      }

      logger?.warn(`🔁 Retry ${attempt}/${opts.maxAttempts} (${error.code}) — delay ${opts.delayMs}ms`);
      await sleep(opts.delayMs);
    }
  }

  throw lastError;
}

// ─── Validation ────────────────────────────────────────────────────────────

export function validatePrompt(prompt: unknown): string {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Prompt is required and must be a non-empty string');
  }
  return prompt.trim();
}

export function validateAgentName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Agent name is required and must be a non-empty string');
  }
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error('Agent name must only contain alphanumeric, underscores, and hyphens');
  }
  return trimmed;
}

// ─── Misc ──────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extrait un sessionId depuis un marqueur textuel "SESSION_ID: xxx" */
export function extractSessionIdFromContent(
  content: Array<{ type: string; text: string }>,
): string | undefined {
  for (const c of content) {
    const m = c.text?.match(/SESSION_ID:\s*([a-zA-Z0-9_-]+)/i);
    if (m) return m[1];
  }
  return undefined;
}

/** Formate un contexte Discord pour l'injection dans le prompt agent */
export function formatDiscordContext(params: {
  channelId?: string;
  userId?: string;
  username?: string;
  message: string;
}): string {
  const { channelId, userId, username, message } = params;
  if (!channelId && !username) return message;

  return [
    '[DISCORD CONTEXT]',
    `CHANNEL_ID: ${channelId ?? 'unknown'}`,
    `USER_NAME: ${username ?? 'unknown'}`,
    `USER_ID: ${userId ?? 'unknown'}`,
    '=======================',
    `MESSAGE: ${message}`,
  ].join('\n');
}

/**
 * Interpolation de variables ${var} dans un template.
 * Utilisé par ScenarioLoader, PromptSource, et le CLI.
 *
 * Supporte :
 *   - ${var}        → remplacé par vars[var] si défini, sinon laissé tel quel
 *   - ${var:-def}   → valeur par défaut si vars[var] est undefined
 */
export function interpolate(template: string, vars?: Record<string, string | undefined>): string {
  if (!vars || Object.keys(vars).length === 0) return template;
  return template.replace(/\$\{([a-zA-Z0-9_]+)(?::-([^}]*))?\}/g, (_, key, def) => {
    if (vars[key] !== undefined) return vars[key]!;
    return def !== undefined ? def : `\${${key}}`;
  });
}
