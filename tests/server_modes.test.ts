import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from '../src/server.ts';

// Mock FastMCP to track addTool calls
vi.mock('fastmcp', () => {
  return {
    FastMCP: vi.fn().mockImplementation(function (options) {
      return {
        options,
        addTool: vi.fn(),
      };
    }),
  };
});

describe('OverMind Server Modes (Mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register all tools in full mode', () => {
    const server = createServer('Full', false);
    const mockAddTool = server.addTool as ReturnType<typeof vi.fn>;

    const registeredTools = mockAddTool.mock.calls.map(
      (call: { 0: { name: string } }) => call[0].name,
    );

    expect(registeredTools).toContain('run_agent');
    expect(registeredTools).toContain('create_agent');
    expect(registeredTools).toContain('list_agents');
    expect(registeredTools).toContain('memory_search');

    expect(registeredTools.length).toBeGreaterThan(7);
  });

  it('should register only memory tools in memory-only mode', () => {
    const server = createServer('MemoryOnly', true);
    const mockAddTool = server.addTool as ReturnType<typeof vi.fn>;

    const registeredTools = mockAddTool.mock.calls.map(
      (call: { 0: { name: string } }) => call[0].name,
    );

    // Memory tools should be present
    expect(registeredTools).toContain('memory_search');
    expect(registeredTools).toContain('memory_store');
    expect(registeredTools).toContain('memory_runs');

    // Management tools should be ABSENT
    expect(registeredTools).not.toContain('run_agent');
    expect(registeredTools).not.toContain('create_agent');

    expect(registeredTools.length).toBe(3);
  });
});
