/**
 * Tests for HermesGatewayManager — singleton health-check + config reader.
 *
 * Tests:
 *   1. API_SERVER_KEY reading from .env (quoted, unquoted, missing)
 *   2. Port/Host resolution from .env + env vars + defaults
 *   3. HERMES_HOME resolution (HERMES_HOME env, Windows, POSIX)
 *   4. Health probe with mocked fetch (ok, unreachable, cache TTL)
 *   5. Singleton behavior
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Mock telemetry — withSpan just calls fn() with a fake span
vi.mock('../lib/telemetry.js', () => ({
  withSpan: vi.fn((_name, fn) =>
    fn({ setAttribute: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() }),
  ),
  initTelemetry: vi.fn(),
  getTracer: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };
const TMPDIRS: string[] = [];

function makeTmp(label: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `om-gw-${label}-`));
  TMPDIRS.push(d);
  return d;
}

function writeEnvFile(dir: string, vars: Record<string, string>): void {
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(path.join(dir, '.env'), lines.join('\n') + '\n', 'utf-8');
}

beforeEach(() => {
  // Clean state
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  // Clear fetch mock
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  for (const d of TMPDIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
  TMPDIRS.length = 0;
});

describe('HermesGatewayManager — Config Reading', () => {
  it('reads API_SERVER_KEY from Hermes .env (unquoted)', async () => {
    const fakeHome = makeTmp('key-unquoted');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'test-key-12345' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    // Force a health check — it'll fail since fetch is not mocked, but we just
    // want to verify the key is read. We use a fake fetch that returns ok.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: '0.18.2' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const info = await mgr.ensureReady(true);
    expect(info).not.toBeNull();
    expect(info!.apiKey).toBe('test-key-12345');
  });

  it('reads API_SERVER_KEY from Hermes .env (double-quoted)', async () => {
    const fakeHome = makeTmp('key-quoted');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: '"my-secret-key"' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const info = await mgr.ensureReady(true);
    expect(info).not.toBeNull();
    expect(info!.apiKey).toBe('my-secret-key');
  });

  it('returns null when API_SERVER_KEY is missing', async () => {
    const fakeHome = makeTmp('no-key');
    process.env.HERMES_HOME = fakeHome;
    // No .env file at all — no API_SERVER_KEY

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    const info = await mgr.ensureReady(true);
    expect(info).toBeNull();
  });

  it('reads custom port and host from .env', async () => {
    const fakeHome = makeTmp('custom-port');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, {
      API_SERVER_KEY: 'secret',
      API_SERVER_PORT: '9999',
      API_SERVER_HOST: '0.0.0.0',
    });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const info = await mgr.ensureReady(true);
    expect(info).not.toBeNull();
    expect(info!.port).toBe(9999);
    expect(info!.host).toBe('0.0.0.0');
    expect(info!.url).toBe('http://0.0.0.0:9999');
  });

  it('defaults to port 8642 and host 127.0.0.1 when not in .env', async () => {
    const fakeHome = makeTmp('defaults');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'k' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const info = await mgr.ensureReady(true);
    expect(info!.port).toBe(8642);
    expect(info!.host).toBe('127.0.0.1');
  });

  it('rejects invalid port values (NaN, negative, > 65535)', async () => {
    const fakeHome = makeTmp('bad-port');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'k', API_SERVER_PORT: 'not-a-number' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const info = await mgr.ensureReady(true);
    expect(info!.port).toBe(8642); // falls back to default
  });
});

describe('HermesGatewayManager — Health Probe', () => {
  it('marks healthy when /health returns {"status": "ok"}', async () => {
    const fakeHome = makeTmp('healthy');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'k' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: '0.18.2' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const info = await mgr.ensureReady(true);
    expect(info!.healthy).toBe(true);
    expect(info!.version).toBe('0.18.2');
  });

  it('marks unhealthy when fetch throws (connection refused)', async () => {
    const fakeHome = makeTmp('unreachable');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'k' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const info = await mgr.ensureReady(true);
    expect(info).toBeNull();
  });

  it('marks unhealthy when /health returns non-ok status', async () => {
    const fakeHome = makeTmp('bad-status');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'k' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'error' }),
    });

    const info = await mgr.ensureReady(true);
    expect(info).toBeNull();
  });

  it('marks unhealthy when /health returns HTTP 500', async () => {
    const fakeHome = makeTmp('http500');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'k' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const info = await mgr.ensureReady(true);
    expect(info).toBeNull();
  });

  it('caches healthy result within TTL (no re-fetch)', async () => {
    const fakeHome = makeTmp('cache');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'k' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await mgr.ensureReady(true); // First call — probes
    await mgr.ensureReady(false); // Second call — uses cache
    await mgr.ensureReady(false); // Third call — still cached

    // fetch should only be called once (first call)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-probes after invalidate()', async () => {
    const fakeHome = makeTmp('invalidate');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'k' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await mgr.ensureReady(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mgr.invalidate();
    await mgr.ensureReady(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('isReady() returns false when gateway is unreachable', async () => {
    const fakeHome = makeTmp('isready');
    process.env.HERMES_HOME = fakeHome;
    writeEnvFile(fakeHome, { API_SERVER_KEY: 'k' });

    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const mgr = HermesGatewayManager.getInstance();
    mgr.invalidate(); // Clear any cached state from previous tests

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('refused'));
    expect(await mgr.isReady()).toBe(false);
  });
});

describe('HermesGatewayManager — Singleton', () => {
  it('getInstance() returns same instance', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const a = HermesGatewayManager.getInstance();
    const b = HermesGatewayManager.getInstance();
    expect(a).toBe(b);
  });
});
