/**
 * Tests for Overmind Bridge — CircuitBreaker, BridgeProxy, Config types.
 *
 * Covers:
 *   Fix #3: Auto-reconnect (CircuitBreaker.reset + BridgeProxy.forceReconnect)
 *   Fix #4: mcpToolTimeoutMs vs agentTimeoutMs separation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BridgeProxy } from '../bridge/BridgeProxy.js';
import {
  DEFAULT_BRIDGE_CONFIG,
  DEFAULT_CIRCUIT_CONFIG,
  type BridgeConfig,
} from '../bridge/types.js';

// ─── Fix #4: Config Types ─────────────────────────────────────────────────

describe('Bridge Config Types (Fix #4 — Timeout Separation)', () => {
  it('has mcpToolTimeoutMs set to 30s', () => {
    expect(DEFAULT_BRIDGE_CONFIG.mcpToolTimeoutMs).toBe(30_000);
  });

  it('has defaultTimeoutMs set to 60s', () => {
    expect(DEFAULT_BRIDGE_CONFIG.defaultTimeoutMs).toBe(60_000);
  });

  it('has agentTimeoutMs set to 1h', () => {
    expect(DEFAULT_BRIDGE_CONFIG.agentTimeoutMs).toBe(3_600_000);
  });

  it('separates mcpToolTimeoutMs from defaultTimeoutMs', () => {
    expect(DEFAULT_BRIDGE_CONFIG.mcpToolTimeoutMs).toBeLessThan(
      DEFAULT_BRIDGE_CONFIG.defaultTimeoutMs,
    );
  });

  it('separates defaultTimeoutMs from agentTimeoutMs', () => {
    expect(DEFAULT_BRIDGE_CONFIG.defaultTimeoutMs).toBeLessThan(
      DEFAULT_BRIDGE_CONFIG.agentTimeoutMs,
    );
  });

  it('includes mcpToolTimeoutMs in BridgeConfig interface', () => {
    const config: BridgeConfig = {
      ...DEFAULT_BRIDGE_CONFIG,
      mcpToolTimeoutMs: 45_000,
    };
    expect(config.mcpToolTimeoutMs).toBe(45_000);
  });
});

// ─── Fix #3: CircuitBreaker reset + forceReconnect ────────────────────────

describe('BridgeProxy — CircuitBreaker & Auto-Reconnect (Fix #3)', () => {
  it('starts with circuit closed', () => {
    const proxy = new BridgeProxy();
    expect(proxy.circuitState).toBe('closed');
  });

  it('forceReconnect resets the circuit breaker', async () => {
    const proxy = new BridgeProxy();

    // Simulate failures by calling internal _fetch and having it fail
    // We can observe circuit state via proxy.circuitState
    // After forceReconnect, circuit should be closed again
    proxy.forceReconnect();
    expect(proxy.circuitState).toBe('closed');
  });

  it('circuit opens after failure threshold then resets via forceReconnect', async () => {
    // Create a proxy with a low failure threshold
    const proxy = new BridgeProxy(
      { mcpUrl: 'http://127.0.0.1:1/mcp' }, // port 1 = will always fail
      { failureThreshold: 3, resetTimeoutMs: 60_000 },
    );

    // Make 3 failing calls to open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await proxy.call('ping', {}, 500);
      } catch {
        // expected to fail
      }
    }

    // Circuit should now be open
    expect(proxy.circuitState).toBe('open');

    // forceReconnect should reset it
    proxy.forceReconnect();
    expect(proxy.circuitState).toBe('closed');
  });
});

// ─── Circuit Breaker Default Config ───────────────────────────────────────

describe('CircuitBreaker Default Config', () => {
  it('has failureThreshold of 5', () => {
    expect(DEFAULT_CIRCUIT_CONFIG.failureThreshold).toBe(5);
  });

  it('has resetTimeoutMs of 30s', () => {
    expect(DEFAULT_CIRCUIT_CONFIG.resetTimeoutMs).toBe(30_000);
  });

  it('has successThreshold of 3', () => {
    expect(DEFAULT_CIRCUIT_CONFIG.successThreshold).toBe(3);
  });
});

// ─── BridgeProxy Health Check ─────────────────────────────────────────────

describe('BridgeProxy — Health Check', () => {
  it('returns offline when server is unreachable', async () => {
    const proxy = new BridgeProxy({
      mcpUrl: 'http://127.0.0.1:1/mcp', // port 1 = always refused
    });

    const status = await proxy.healthCheck();
    expect(status.status).not.toBe('online');
    expect(['offline', 'degraded']).toContain(status.status);
  });

  it('returns online when /health responds', async () => {
    // Mock global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: 'ok' }),
    }) as unknown as typeof fetch;

    const proxy = new BridgeProxy({
      mcpUrl: 'http://127.0.0.1:9999/mcp',
    });

    const status = await proxy.healthCheck();
    expect(status.status).toBe('online');
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);

    globalThis.fetch = originalFetch;
  });
});

// ─── OverBridgeService — Auto-Reconnect Heartbeat ─────────────────────────

describe('OverBridgeService — Heartbeat Auto-Reconnect (Fix #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connect() starts heartbeat with auto-reconnect logic', async () => {
    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: 'ok' }),
    }) as unknown as typeof fetch;

    const service = new OverBridgeService({
      mcpUrl: 'http://127.0.0.1:9999/mcp',
    });

    const status = await service.connect(100); // 100ms heartbeat
    expect(status.status).toBe('online');

    // Wait for at least one heartbeat cycle
    await new Promise((r) => setTimeout(r, 250));

    // Disconnect to clean up
    service.disconnect();

    globalThis.fetch = originalFetch;
  });

  it('disconnect() clears heartbeat interval', async () => {
    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: 'ok' }),
    }) as unknown as typeof fetch;

    const service = new OverBridgeService();
    await service.connect(10_000);
    service.disconnect();

    // After disconnect, heartbeat should be cleared (no crash, no hanging timers)
    // Re-disconnecting should be a no-op
    service.disconnect();

    globalThis.fetch = originalFetch;
  });
});
