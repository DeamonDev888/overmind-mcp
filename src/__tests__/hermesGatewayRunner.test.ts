/**
 * Tests for HermesGatewayRunner — SSE streaming, session management, fallback.
 *
 * Tests:
 *   1. Successful HTTP+SSE chat completion
 *   2. SSE parsing (delta assembly)
 *   3. Session management (X-Hermes-Session-Id header)
 *   4. Abort via AbortSignal
 *   5. HTTP error handling (non-ok response)
 *   6. GATEWAY_NOT_READY fallback
 *   7. Profile routing (X-Hermes-Profile header)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock telemetry
vi.mock('../lib/telemetry.js', () => ({
  withSpan: vi.fn((_name, fn) =>
    fn({ setAttribute: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() }),
  ),
  initTelemetry: vi.fn(),
  getTracer: vi.fn(),
}));

// Mock agent_lifecycle (no real process tracking in tests)
vi.mock('../lib/agent_lifecycle.js', () => ({
  registerLiveAgent: vi.fn(),
  appendLiveOutput: vi.fn(),
  setLiveStatus: vi.fn(),
  unregisterLiveAgent: vi.fn(),
}));

// Mock processRegistry
vi.mock('../lib/processRegistry.js', () => ({
  registerProcess: vi.fn(),
  updateProcessStatus: vi.fn(),
  unregisterProcess: vi.fn(),
  isPidAlive: vi.fn().mockResolvedValue(true),
}));

// Mock sessions
vi.mock('../lib/sessions.js', () => ({
  saveSessionId: vi.fn(),
  getLastSessionId: vi.fn().mockResolvedValue(null),
  deleteSessionId: vi.fn(),
}));

// Mock config
vi.mock('../lib/config.js', () => ({
  getWorkspaceDir: vi.fn(() => '/fake/workspace'),
}));

// ─── Fix #1: SOUL.md injection — mock HermesProfileManager + fs ──────────
const mockGetProfilePath = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('../services/HermesProfileManager.js', () => ({
  HermesProfileManager: {
    getProfilePath: (...args: unknown[]) => mockGetProfilePath(...args),
  },
}));
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Helper: build a ReadableStream from SSE data lines
function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

// Helper: build SSE lines for OpenAI chat completion streaming
function buildSSEChunks(tokens: string[]): string[] {
  const chunks: string[] = [];
  for (const token of tokens) {
    chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`);
  }
  chunks.push('data: [DONE]\n\n');
  return chunks;
}

describe('HermesGatewayRunner — SSE Streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles full text from SSE delta chunks', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    // Mock gateway manager
    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'test-key',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    // Mock fetch with SSE stream
    const tokens = ['Hello', ' ', 'World', '!'];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['x-hermes-session-id', 'test-session-123']]),
      body: makeSSEStream(buildSSEChunks(tokens)),
    }) as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    const result = await runner.runAgent({
      prompt: 'Say hello world',
      silent: true,
    });

    expect(result.transport).toBe('gateway-http');
    expect(result.result).toBe('Hello World!');
    expect(result.sessionId).toBe('test-session-123');
    expect(result.error).toBeUndefined();
  });

  it('handles empty SSE stream gracefully', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'k',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(['data: [DONE]\n\n']),
    }) as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    const result = await runner.runAgent({ prompt: 'test', silent: true });

    expect(result.result).toBe('');
    expect(result.transport).toBe('gateway-http');
  });

  it('skips non-data SSE lines (comments, empty lines)', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'k',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    const sseChunks = [
      ': comment line\n\n',
      '\n',
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'OK' } }] })}\n\n`,
      'not-a-data-line\n\n',
      'data: [DONE]\n\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(sseChunks),
    }) as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    const result = await runner.runAgent({ prompt: 'test', silent: true });

    expect(result.result).toBe('OK');
  });
});

describe('HermesGatewayRunner — Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns GATEWAY_NOT_READY when server is unreachable', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue(null), // Gateway not ready
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    const runner = new HermesGatewayRunner();
    const result = await runner.runAgent({ prompt: 'test', silent: true });

    expect(result.transport).toBe('fallback-spawn');
    expect(result.error).toBe('GATEWAY_NOT_READY');
  });

  it('returns HTTP error when API responds non-ok', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'k',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    const result = await runner.runAgent({ prompt: 'test', silent: true });

    expect(result.error).toContain('HTTP_401');
  });

  it('returns GATEWAY_ERROR on fetch network failure', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'k',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    const runner = new HermesGatewayRunner();
    const result = await runner.runAgent({ prompt: 'test', silent: true });

    expect(result.error).toContain('GATEWAY_ERROR');
    expect(result.error).toContain('ECONNRESET');
  });
});

describe('HermesGatewayRunner — Session & Profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends X-Hermes-Session-Id header when sessionId is provided', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'k',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(buildSSEChunks(['ok'])),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    await runner.runAgent({
      prompt: 'test',
      sessionId: 'my-session-456',
      silent: true,
    });

    const callArgs = fetchMock.mock.calls[0];
    const fetchOptions = callArgs[1] as RequestInit;
    const headers = fetchOptions.headers as Record<string, string>;
    expect(headers['X-Hermes-Session-Id']).toBe('my-session-456');
  });

  it('sends X-Hermes-Profile header when agentName is set', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'k',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(buildSSEChunks(['ok'])),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    await runner.runAgent({
      prompt: 'test',
      agentName: 'sniperbot_analyst',
      silent: true,
    });

    const callArgs = fetchMock.mock.calls[0];
    const fetchOptions = callArgs[1] as RequestInit;
    const headers = fetchOptions.headers as Record<string, string>;
    expect(headers['X-Hermes-Profile']).toBe('sniperbot_analyst');
  });

  it('includes Authorization Bearer header with API key', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'my-secret-key',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(buildSSEChunks(['ok'])),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    await runner.runAgent({ prompt: 'test', silent: true });

    const callArgs = fetchMock.mock.calls[0];
    const fetchOptions = callArgs[1] as RequestInit;
    const headers = fetchOptions.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-key');
  });

  it('sends stream:true in request body', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'my-secret-key',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(buildSSEChunks(['ok'])),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    await runner.runAgent({ prompt: 'test prompt', silent: true });

    const callArgs = fetchMock.mock.calls[0];
    const fetchOptions = callArgs[1] as RequestInit;
    const body = JSON.parse(fetchOptions.body as string);
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toBe('test prompt');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix #1: SOUL.md injection
// ═══════════════════════════════════════════════════════════════════════════
describe('HermesGatewayRunner — SOUL.md Injection (Fix #1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProfilePath.mockReset();
    mockReadFileSync.mockReset();
  });

  it('injects SOUL.md as system message when profile is set', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    mockGetProfilePath.mockResolvedValue('/fake/profiles/test-agent');
    mockReadFileSync.mockReturnValue('You are a Nexus trader agent.');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'my-secret-key',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(buildSSEChunks(['ok'])),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    await runner.runAgent({
      prompt: 'Analyze BTC',
      agentName: 'test-agent',
      silent: true,
    });

    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    // First message should be system (SOUL.md), second is user
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toBe('You are a Nexus trader agent.');
    expect(body.messages[1].role).toBe('user');
  });

  it('skips SOUL.md injection for default profile', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'my-secret-key',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(buildSSEChunks(['ok'])),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    await runner.runAgent({ prompt: 'test', silent: true }); // no agentName → default

    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    // Only user message, no system message
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    // getProfilePath should not have been called
    expect(mockGetProfilePath).not.toHaveBeenCalled();
  });

  it('continues without SOUL.md when profile path cannot be resolved', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    mockGetProfilePath.mockResolvedValue(null);

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'my-secret-key',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(buildSSEChunks(['ok'])),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    await runner.runAgent({
      prompt: 'test',
      agentName: 'missing-soul-agent',
      silent: true,
    });

    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    // Only user message — SOUL.md was not found
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix #2: Concurrency guard (rate limit)
// ═══════════════════════════════════════════════════════════════════════════
describe('HermesGatewayRunner — Concurrency Guard (Fix #2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProfilePath.mockReset();
    mockReadFileSync.mockReset();
  });

  it('tracks active gateway runs correctly', async () => {
    const { HermesGatewayManager } = await import('../services/HermesGatewayManager.js');
    const { HermesGatewayRunner } = await import('../services/HermesGatewayRunner.js');

    const mockMgr = {
      ensureReady: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:8642',
        apiKey: 'my-secret-key',
        port: 8642,
        host: '127.0.0.1',
        healthy: true,
        pid: null,
        version: '0.18.2',
      }),
    };
    HermesGatewayManager.getInstance = vi.fn().mockReturnValue(mockMgr);

    // Use a deferred response to simulate an in-flight request
    let resolveFetch: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    globalThis.fetch = vi.fn().mockReturnValue(fetchPromise) as unknown as typeof fetch;

    const runner = new HermesGatewayRunner();
    const runPromise = runner.runAgent({ prompt: 'long-running', silent: true });

    // Give the promise a tick to start
    await new Promise((r) => setTimeout(r, 50));

    // Resolve the fetch
    resolveFetch!({
      ok: true,
      headers: new Map(),
      body: makeSSEStream(buildSSEChunks(['done'])),
    });

    const result = await runPromise;
    expect(result.transport).toBe('gateway-http');
    expect(result.result).toBe('done');
  });
});
