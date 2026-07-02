/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — BridgeProxy (Base Client SDK Proxy)              ║
 * ║                                                                      ║
 * ║   [SCRIPT DE BASE - CLIENT SDK LOW-LEVEL TRANSPORT]                  ║
 * ║   Couche basse : transport JSON-RPC 2.0 vers Overmind MCP Server.   ║
 * ║   Gère : reconnexion, health checks, circuit breaker, SSE streaming.║
 * ║                                                                      ║
 * ║   ARCHITECTURE                                                       ║
 * ║   ─────────────                                                      ║
 * ║   OverBridgeService → BridgeProxy → HTTP localhost:3099/mcp          ║
 * ║                                              → Overmind MCP Server  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import type {
  BridgeConfig,
  CircuitBreakerConfig,
  CircuitState,
  HealthStatus,
  McpResponse,
  JsonRpcRequest,
} from './types.js';
import { DEFAULT_BRIDGE_CONFIG, DEFAULT_CIRCUIT_CONFIG } from './types.js';
import {
  createBridgeLogger,
  parseMcpResponseBody,
  withRetry,
  type BridgeLogger,
} from './utils.js';

// ─── Circuit Breaker ───────────────────────────────────────────────────────

class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureAt = 0;

  constructor(private config: CircuitBreakerConfig) {}

  get currentState(): CircuitState {
    // Auto-transition open → half-open après resetTimeout
    if (this.state === 'open' && Date.now() - this.lastFailureAt > this.config.resetTimeoutMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();
    this.successCount = 0;

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  canExecute(): boolean {
    return this.currentState !== 'open';
  }
}

// ─── BridgeProxy ───────────────────────────────────────────────────────────

export class BridgeProxy {
  private rpcId = 1;
  private readonly config: BridgeConfig;
  private readonly circuit: CircuitBreaker;
  readonly log: BridgeLogger;

  constructor(
    config?: Partial<BridgeConfig>,
    circuitConfig?: Partial<CircuitBreakerConfig>,
    logger?: BridgeLogger,
  ) {
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
    this.circuit = new CircuitBreaker({ ...DEFAULT_CIRCUIT_CONFIG, ...circuitConfig });
    this.log = logger ?? createBridgeLogger('bridge-proxy');
  }

  get mcpUrl(): string {
    return this.config.mcpUrl;
  }

  get agentTimeout(): number {
    return this.config.agentTimeoutMs;
  }

  get defaultMcpServers(): import('./types.js').McpServerSpec[] {
    return this.config.defaultMcpServers;
  }

  get circuitState(): CircuitState {
    return this.circuit.currentState;
  }

  // ─── Core RPC Call ───────────────────────────────────────────────────────

  /**
   * Appelle un tool MCP via JSON-RPC 2.0 sur HTTP.
   *
   * TIMEOUT STRATEGY (3 couches) :
   *   1. AbortController sur le fetch initial
   *   2. Body reader avec deadline absolue
   *   3. Promise.race per-chunk (sécurité si le serveur ne produit plus)
   *
   * @param toolName  Nom de l'outil MCP (ex: 'run_agent', 'memory_search')
   * @param args      Arguments de l'outil
   * @param timeoutMs Timeout en ms (default: config.defaultTimeoutMs)
   */
  async call(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<McpResponse> {
    const timeout = timeoutMs ?? this.config.defaultTimeoutMs;

    // Circuit breaker gate
    if (!this.circuit.canExecute()) {
      throw Object.assign(
        new Error(`Circuit breaker OPEN — too many failures. Retry after ${this.config.retryDelayMs}ms`),
        { code: 'ECIRCUITOPEN' },
      );
    }

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.rpcId++,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    };

    this.log.info(`→ MCP ${toolName} (timeout: ${timeout / 1000}s)`);

    const startTime = Date.now();
    try {
      const response = await this._fetch(request, timeout);
      const elapsed = Date.now() - startTime;
      this.circuit.recordSuccess();
      this.log.info(`← MCP ${toolName} OK (${elapsed}ms)`);
      return response;
    } catch (err) {
      const error = err as Error & { code?: string };
      this.circuit.recordFailure();

      // Erreurs transitoires → retry automatique
      const retryable = ['ETIMEDOUT', 'EBODYREAD', 'ECONNRESET', 'ECONNREFUSED'];
      if (retryable.includes(error?.code ?? '')) {
        this.log.warn(`🔁 ${error.code} on ${toolName}, retrying...`);
        return withRetry(
          () => this._fetch(request, timeout),
          {
            maxAttempts: this.config.maxRetries,
            delayMs: this.config.retryDelayMs,
          },
          this.log,
        );
      }

      throw err;
    }
  }

  // ─── JSON-RPC Protocol Ping ──────────────────────────────────────────────

  /**
   * Envoie une requête de ping JSON-RPC standard légère au serveur.
   */
  async ping(timeoutMs?: number): Promise<boolean> {
    const timeout = timeoutMs ?? 5_000;
    const request = {
      jsonrpc: '2.0' as const,
      id: this.rpcId++,
      method: 'ping',
      params: {},
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(this.config.mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return false;
      const bodyText = await response.text();
      const parsed = JSON.parse(bodyText.trim());
      return parsed && parsed.jsonrpc === '2.0' && !parsed.error;
    } catch {
      return false;
    }
  }

  // ─── Health Check ────────────────────────────────────────────────────────

  async healthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();
    const isOnline = await this.ping(5_000);
    if (isOnline) {
      return {
        status: 'online',
        mcpUrl: this.config.mcpUrl,
        circuitState: this.circuit.currentState,
        latencyMs: Date.now() - startTime,
        checkedAt: Date.now(),
      };
    } else {
      return {
        status: this.circuit.currentState === 'open' ? 'offline' : 'degraded',
        mcpUrl: this.config.mcpUrl,
        circuitState: this.circuit.currentState,
        checkedAt: Date.now(),
      };
    }
  }

  // ─── Internal Fetch ──────────────────────────────────────────────────────

  private async _fetch(request: JsonRpcRequest, timeoutMs: number): Promise<McpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: globalThis.Response;
    try {
      response = await fetch(this.config.mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const error = err as Error & { type?: string };
      if (error.name === 'TimeoutError' || error.type === 'TimeoutError' || error.name === 'AbortError') {
        throw Object.assign(
          new Error(`TIMEOUT: ${request.params.name} no response after ${timeoutMs / 1000}s`),
          { code: 'ETIMEDOUT', toolName: request.params.name, timeoutMs },
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw Object.assign(
        new Error(`MCP HTTP ${response.status}: ${response.statusText}`),
        { code: 'EHTTPSTATUS', status: response.status },
      );
    }

    // Lecture du body avec timeout effectif (3 couches)
    const text = await this._readBody(response, timeoutMs);
    return parseMcpResponseBody(text);
  }

  /**
   * Lecture du body response avec 3 couches de timeout :
   *   1. Deadline absolue (startRead + timeoutMs)
   *   2. Promise.race per-chunk
   *   3. reader.cancel() sur timeout
   */
  private async _readBody(response: globalThis.Response, timeoutMs: number): Promise<string> {
    if (!response.body) {
      throw Object.assign(new Error('Response body is null'), { code: 'EBODYREAD' });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    const startRead = Date.now();

    try {
      while (true) {
        // Couche 1 — deadline absolue
        if (Date.now() - startRead > timeoutMs) {
          reader.cancel();
          throw Object.assign(
            new Error(`Body read timeout after ${timeoutMs / 1000}s`),
            { code: 'EBODYREAD' },
          );
        }

        // Couche 2+3 — Promise.race per-chunk (avec cleanup du timeout)
        let raceTimer: ReturnType<typeof setTimeout> | undefined;
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value?: undefined }>((_, reject) => {
            raceTimer = setTimeout(
              () => reject(Object.assign(
                new Error(`Chunk read timeout after ${timeoutMs / 1000}s`),
                { code: 'EBODYREAD' },
              )),
              timeoutMs,
            );
          }),
        ]);
        if (raceTimer) {
          clearTimeout(raceTimer);
        }

        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join('');
    } catch (err) {
      const error = err as Error & { code?: string };
      if (error?.code === 'EBODYREAD') throw err;
      throw Object.assign(
        new Error(`Body read failed: ${error.message}`),
        { code: 'EBODYREAD' },
      );
    }
  }
}
