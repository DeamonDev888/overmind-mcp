/**
 * HermesGatewayManager — Manages the Hermes API Server lifecycle.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  PURPOSE                                                              ║
 * ║                                                                      ║
 * ║  Singleton that detects, validates, and ensures the Hermes API        ║
 * ║  Server (gateway/platforms/api_server.py) is reachable.               ║
 * ║                                                                      ║
 * ║  The API Server is a platform adapter inside the Hermes gateway       ║
 * ║  process. It exposes an OpenAI-compatible HTTP+SSE API:               ║
 * ║                                                                      ║
 * ║    GET  /health                → {"status": "ok", ...}               ║
 * ║    GET  /v1/models             → OpenAI model list                    ║
 * ║    GET  /v1/capabilities       → Feature flags                       ║
 * ║    POST /v1/chat/completions   → Chat (streaming SSE or JSON)        ║
 * ║    POST /v1/responses          → Responses API (stateful)            ║
 * ║    POST /v1/runs               → Async run (returns run_id)          ║
 * ║    GET  /v1/runs/{id}/events   → SSE lifecycle events                ║
 * ║    POST /v1/runs/{id}/stop     → Interrupt a run                     ║
 * ║    POST /v1/runs/{id}/approval → Resolve pending approval            ║
 * ║                                                                      ║
 * ║  Configuration (read from Hermes .env):                               ║
 * ║    API_SERVER_ENABLED=1        → enables the adapter                 ║
 * ║    API_SERVER_KEY=<secret>     → Bearer token for auth               ║
 * ║    API_SERVER_PORT=8642        → listen port (default: 8642)         ║
 * ║    API_SERVER_HOST=127.0.0.1   → listen host (default: loopback)    ║
 * ║                                                                      ║
 * ║  This manager does NOT start the gateway — that's Hermes' job         ║
 * ║  (via `hermes gateway start`). It only detects and health-checks.     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { rootLogger } from '../lib/logger.js';

const logger = rootLogger.child({ module: 'HermesGatewayManager' });

export interface GatewayInfo {
  /** Base URL of the API server, e.g. http://127.0.0.1:8642 */
  url: string;
  /** Bearer token for Authorization header */
  apiKey: string;
  /** Port the server listens on */
  port: number;
  /** Host the server listens on */
  host: string;
  /** True if the last health check succeeded */
  healthy: boolean;
  /** PID of the gateway process (from health/detailed), if available */
  pid: number | null;
  /** Hermes version reported by the server */
  version: string | null;
}

/**
 * Resolve the Hermes home directory.
 * On Windows: AppData\Local\hermes (official install)
 * On Linux/macOS: ~/.hermes
 */
function getHermesHome(): string {
  // 1. Explicit env var
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;

  // 2. Windows official install
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || os.homedir();
    return path.join(localAppData, 'hermes');
  }

  // 3. POSIX
  return path.join(os.homedir(), '.hermes');
}

/**
 * Read API_SERVER_KEY from the Hermes .env file.
 * The key is required by the API server for Bearer auth.
 */
function readApiKeyFromEnv(): string | null {
  const hermesHome = getHermesHome();
  const envPath = path.join(hermesHome, '.env');

  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('API_SERVER_KEY=')) {
        const value = trimmed.slice('API_SERVER_KEY='.length).trim();
        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          return value.slice(1, -1);
        }
        return value;
      }
    }
  } catch {
    // .env not found or unreadable
  }

  // Fallback: environment variable
  return process.env.API_SERVER_KEY || null;
}

/** Read port from .env or use default */
function readPortFromEnv(): number {
  const hermesHome = getHermesHome();
  const envPath = path.join(hermesHome, '.env');

  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('API_SERVER_PORT=')) {
        const port = parseInt(trimmed.slice('API_SERVER_PORT='.length).trim(), 10);
        if (!isNaN(port) && port > 0 && port < 65536) return port;
      }
    }
  } catch {
    // ignore
  }

  // Fallback: env var or default
  const envPort = parseInt(process.env.API_SERVER_PORT || '', 10);
  return !isNaN(envPort) && envPort > 0 ? envPort : 8642;
}

/** Read host from .env or use default */
function readHostFromEnv(): string {
  const hermesHome = getHermesHome();
  const envPath = path.join(hermesHome, '.env');

  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('API_SERVER_HOST=')) {
        return trimmed.slice('API_SERVER_HOST='.length).trim().replace(/['"]/g, '');
      }
    }
  } catch {
    // ignore
  }

  return process.env.API_SERVER_HOST || '127.0.0.1';
}

/**
 * Singleton manager for the Hermes API Server connection.
 *
 * Call `await HermesGatewayManager.getInstance()` to get a healthy gateway
 * info object. The first call probes the server; subsequent calls return
 * the cached state with periodic re-validation.
 */
export class HermesGatewayManager {
  private static instance: HermesGatewayManager | null = null;
  private cachedInfo: GatewayInfo | null = null;
  private lastHealthCheck: number = 0;
  private readonly HEALTH_CHECK_TTL_MS = 10_000; // re-check at most every 10s

  private constructor() {}

  static getInstance(): HermesGatewayManager {
    if (!HermesGatewayManager.instance) {
      HermesGatewayManager.instance = new HermesGatewayManager();
    }
    return HermesGatewayManager.instance;
  }

  /**
   * Probe the API server health endpoint.
   * Returns the raw JSON response or null on failure.
   */
  private async probeHealth(baseUrl: string, apiKey: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Get detailed health info (includes PID, gateway state, platform status).
   */
  async getDetailedHealth(): Promise<Record<string, unknown> | null> {
    const info = await this.ensureReady();
    if (!info) return null;
    try {
      const response = await fetch(`${info.url}/health/detailed`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${info.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Ensure the API server is reachable. Probes health, caches result.
   *
   * @param forceRefresh Skip the cache TTL and re-probe.
   * @returns GatewayInfo if healthy, null if unreachable.
   */
  async ensureReady(forceRefresh = false): Promise<GatewayInfo | null> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedInfo &&
      this.cachedInfo.healthy &&
      now - this.lastHealthCheck < this.HEALTH_CHECK_TTL_MS
    ) {
      return this.cachedInfo;
    }

    // Read config from Hermes .env
    const apiKey = readApiKeyFromEnv();
    const port = readPortFromEnv();
    const host = readHostFromEnv();
    const baseUrl = `http://${host}:${port}`;

    if (!apiKey) {
      logger.warn(
        '[HermesGatewayManager] API_SERVER_KEY not found in Hermes .env — API server not configured.',
      );
      this.cachedInfo = {
        url: baseUrl,
        apiKey: '',
        port,
        host,
        healthy: false,
        pid: null,
        version: null,
      };
      return null;
    }

    // Probe health
    const health = await this.probeHealth(baseUrl, apiKey);
    const healthy = health?.status === 'ok';

    this.cachedInfo = {
      url: baseUrl,
      apiKey,
      port,
      host,
      healthy,
      pid: null,
      version: (health?.version as string) || null,
    };
    this.lastHealthCheck = now;

    if (healthy) {
      logger.info(
        { url: baseUrl, version: this.cachedInfo.version },
        '[HermesGatewayManager] ✅ API server healthy.',
      );
    } else {
      logger.warn(
        { url: baseUrl },
        '[HermesGatewayManager] ⚠️ API server not reachable. Run `hermes gateway restart` after setting API_SERVER_ENABLED=1.',
      );
    }

    return healthy ? this.cachedInfo : null;
  }

  /**
   * Check if the gateway is ready (quick boolean check).
   */
  async isReady(): Promise<boolean> {
    const info = await this.ensureReady();
    return info !== null;
  }

  /**
   * Get cached info without probing. Returns last known state.
   */
  getCachedInfo(): GatewayInfo | null {
    return this.cachedInfo;
  }

  /**
   * Force a fresh health check on next ensureReady() call.
   */
  invalidate(): void {
    this.lastHealthCheck = 0;
  }
}
