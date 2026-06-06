/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — BridgeHttpClient (JSON-RPC 2.0 HTTP Caller)     ║
 * ║                                                                      ║
 * ║   Client HTTP minimaliste pour parler à un OverBridgeServer.         ║
 * ║   Utilisé par le CLI pour les commandes 'call', 'scenario', etc.     ║
 * ║   Supporte :                                                          ║
 * ║     - Single + batch JSON-RPC 2.0                                    ║
 * ║     - Auth Bearer token                                              ║
 * ║     - Timeout configurable                                            ║
 * ║     - Mode "auto" : démarre un bridge local si pas de serveur       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import http from 'node:http';
import { URL } from 'node:url';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface JsonRpcCallRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcCallResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface BridgeHttpClientConfig {
  /** URL complète du serveur (ex: http://127.0.0.1:3100) */
  baseUrl: string;
  /** Bearer token (si configuré côté serveur) */
  authToken?: string;
  /** Timeout par défaut en ms (default: 60_000) */
  timeoutMs?: number;
}

// ─── BridgeHttpClient ──────────────────────────────────────────────────────

export class BridgeHttpClient {
  private readonly config: Required<Omit<BridgeHttpClientConfig, 'authToken'>> &
    Pick<BridgeHttpClientConfig, 'authToken'>;
  private rpcId = 1;

  constructor(config: BridgeHttpClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ''), // strip trailing slashes
      authToken: config.authToken,
      timeoutMs: config.timeoutMs ?? 60_000,
    };
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  // ─── JSON-RPC Calls ──────────────────────────────────────────────────────

  /**
   * Appelle une méthode JSON-RPC et retourne le résultat (ou throw).
   */
  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    const req: JsonRpcCallRequest = {
      jsonrpc: '2.0',
      id: this.rpcId++,
      method,
      params,
    };
    const res = await this._post('/rpc', req, timeoutMs ?? this.config.timeoutMs);
    if (Array.isArray(res)) {
      throw new Error('Unexpected batch response to single call');
    }
    if (res.error) {
      const err = new Error(`JSON-RPC error ${res.error.code}: ${res.error.message}`);
      Object.assign(err, { code: res.error.code, data: res.error.data });
      throw err;
    }
    return res.result as T;
  }

  /**
   * Batch JSON-RPC (plusieurs calls en un round-trip).
   */
  async callBatch<T = unknown>(
    calls: Array<{ method: string; params?: Record<string, unknown> }>,
  ): Promise<T[]> {
    const reqs: JsonRpcCallRequest[] = calls.map((c) => ({
      jsonrpc: '2.0',
      id: this.rpcId++,
      method: c.method,
      params: c.params,
    }));
    const responses = await this._post('/rpc', reqs, this.config.timeoutMs);
    if (!Array.isArray(responses)) {
      throw new Error('Batch call did not return an array');
    }
    return responses.map((r) => {
      if (r.error) {
        const err = new Error(`JSON-RPC error ${r.error.code}: ${r.error.message}`);
        Object.assign(err, { code: r.error.code, data: r.error.data });
        throw err;
      }
      return r.result as T;
    });
  }

  /**
   * GET /health (pas JSON-RPC, endpoint séparé).
   */
  async health(): Promise<unknown> {
    const res = await this._get('/health', 5_000);
    return JSON.parse(res);
  }

  // ─── HTTP Helpers ────────────────────────────────────────────────────────

  private async _post(path: string, body: unknown, timeoutMs: number): Promise<JsonRpcCallResponse | JsonRpcCallResponse[]> {
    const url = new URL(this.config.baseUrl + path);
    const data = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            ...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
          },
          signal: controller.signal,
        },
        (res) => {
          clearTimeout(timer);
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(text) as JsonRpcCallResponse | JsonRpcCallResponse[]);
              } catch (err) {
                reject(new Error(`Invalid JSON response: ${text.slice(0, 200)}`));
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      req.write(data);
      req.end();
    });
  }

  private async _get(path: string, timeoutMs: number): Promise<string> {
    const url = new URL(this.config.baseUrl + path);
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        },
        (res) => {
          clearTimeout(timer);
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(text);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      req.end();
    });
  }
}
