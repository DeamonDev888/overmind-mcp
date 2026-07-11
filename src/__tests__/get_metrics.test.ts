/**
 * Tests for get_metrics MCP tool (Fix #10).
 *
 * Tests:
 *   1. Returns formatted metrics with all sections
 *   2. Handles unavailable memory provider gracefully
 *   3. Handles unavailable gateway gracefully
 *   4. Reports process stats correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock agent_lifecycle
vi.mock('../lib/agent_lifecycle.js', () => ({
  getRunningAgents: vi.fn(() => []),
  getAgentCount: vi.fn(() => ({ running: 0, total: 0 })),
}));

// Mock memory factory
const mockGetStats = vi.fn();
vi.mock('../memory/MemoryFactory.js', () => ({
  getMemoryProvider: vi.fn(() => ({
    getStats: (...args: unknown[]) => mockGetStats(...args),
  })),
}));

// Mock HermesGatewayManager
const mockGetDetailedHealth = vi.fn();
vi.mock('../services/HermesGatewayManager.js', () => ({
  HermesGatewayManager: {
    getInstance: vi.fn(() => ({
      getDetailedHealth: (...args: unknown[]) => mockGetDetailedHealth(...args),
    })),
  },
}));

describe('get_metrics Tool (Fix #10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metrics with all 4 sections', async () => {
    mockGetStats.mockReturnValue({
      totalMemories: 42,
      totalRuns: 1337,
    });
    mockGetDetailedHealth.mockResolvedValue({
      status: 'online',
      url: 'http://127.0.0.1:8642',
      version: '0.18.2',
    });

    const { getMetricsTool } = await import('../tools/get_metrics.js');
    const result = await getMetricsTool({});

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('Live Agents');
    expect(text).toContain('Memory');
    expect(text).toContain('Hermes Gateway');
    expect(text).toContain('Server Process');
  });

  it('includes running agent count in live agents section', async () => {
    const { getRunningAgents, getAgentCount } = await import('../lib/agent_lifecycle.js');
    (getAgentCount as ReturnType<typeof vi.fn>).mockReturnValue({ running: 3, total: 5 });
    (getRunningAgents as ReturnType<typeof vi.fn>).mockReturnValue([
      { agentName: 'nexus_trader', runner: 'hermes', pid: 12345, sessionId: 'sess-abc' },
      { agentName: 'nexus_healer', runner: 'hermes', pid: 12346, sessionId: 'sess-def' },
      { agentName: 'nexus_master', runner: 'hermes', pid: 12347, sessionId: 'sess-ghi' },
    ]);
    mockGetStats.mockReturnValue({ totalMemories: 0, totalRuns: 0 });
    mockGetDetailedHealth.mockResolvedValue({ status: 'online' });

    const { getMetricsTool } = await import('../tools/get_metrics.js');
    const result = await getMetricsTool({});
    const text = result.content[0].text;

    expect(text).toContain('3');
    expect(text).toContain('nexus_trader');
    expect(text).toContain('nexus_healer');
    expect(text).toContain('nexus_master');
  });

  it('handles unavailable memory provider gracefully', async () => {
    const { getMemoryProvider } = await import('../memory/MemoryFactory.js');
    (getMemoryProvider as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('DB connection failed');
    });
    mockGetDetailedHealth.mockResolvedValue({ status: 'online' });

    const { getMetricsTool } = await import('../tools/get_metrics.js');
    const result = await getMetricsTool({});
    const text = result.content[0].text;

    expect(text).toContain('Memory');
    expect(text).toContain('unavailable');
    expect(result.isError).toBeFalsy();
  });

  it('handles unavailable gateway gracefully', async () => {
    mockGetStats.mockReturnValue({ totalMemories: 0, totalRuns: 0 });
    mockGetDetailedHealth.mockRejectedValue(new Error('Connection refused'));

    const { getMetricsTool } = await import('../tools/get_metrics.js');
    const result = await getMetricsTool({});
    const text = result.content[0].text;

    expect(text).toContain('Gateway');
    expect(text).toContain('Not configured');
    expect(result.isError).toBeFalsy();
  });

  it('includes Node PID and uptime in process section', async () => {
    mockGetStats.mockReturnValue({ totalMemories: 0, totalRuns: 0 });
    mockGetDetailedHealth.mockResolvedValue({ status: 'online' });

    const { getMetricsTool } = await import('../tools/get_metrics.js');
    const result = await getMetricsTool({});
    const text = result.content[0].text;

    expect(text).toContain('Node PID');
    expect(text).toContain(`${process.pid}`);
    expect(text).toContain('Uptime');
    expect(text).toContain('RSS Memory');
    expect(text).toContain('MB');
  });

  it('returns proper MCP response structure', async () => {
    mockGetStats.mockReturnValue({ totalMemories: 1, totalRuns: 1 });
    mockGetDetailedHealth.mockResolvedValue({ status: 'online' });

    const { getMetricsTool } = await import('../tools/get_metrics.js');
    const result = await getMetricsTool({});

    expect(result).toHaveProperty('content');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(typeof result.content[0].text).toBe('string');
  });
});
