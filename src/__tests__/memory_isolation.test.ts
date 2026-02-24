import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memoryStoreTool } from '../tools/memory_store.js';
import { memorySearchTool } from '../tools/memory_search.js';
import { memoryRunsTool } from '../tools/memory_runs.js';
import * as MemoryFactory from '../memory/MemoryFactory.js';

vi.mock('../memory/MemoryFactory.js', () => ({
  getMemoryProvider: vi.fn(),
  storeRun: vi.fn(),
}));

describe('Memory Isolation (Private Context)', () => {
  const mockProvider = {
    storeKnowledge: vi.fn(),
    searchMemory: vi.fn(),
    getRecentRuns: vi.fn(),
    getStats: vi.fn(),
    storeRun: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (MemoryFactory.getMemoryProvider as any).mockReturnValue(mockProvider);
    // Reset env
    delete process.env.OVERMIND_AGENT_NAME;
  });

  afterEach(() => {
    delete process.env.OVERMIND_AGENT_NAME;
  });

  describe('memory_store', () => {
    it('should use agent_name from arguments if provided and no env is set', async () => {
      mockProvider.storeKnowledge.mockResolvedValue('id-123');
      await memoryStoreTool({ text: 'test knowledge', source: 'user', agent_name: 'manual_agent' });
      expect(mockProvider.storeKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'manual_agent',
        }),
      );
    });

    it('should use OVERMIND_AGENT_NAME if agent_name is not provided', async () => {
      process.env.OVERMIND_AGENT_NAME = 'auto_agent';
      mockProvider.storeKnowledge.mockResolvedValue('id-123');
      await memoryStoreTool({ text: 'test automatic', source: 'user' });
      expect(mockProvider.storeKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'auto_agent',
        }),
      );
    });

    it('should prioritize OVERMIND_AGENT_NAME over arguments (Isolation Enforcement)', async () => {
      process.env.OVERMIND_AGENT_NAME = 'isolated_agent';
      mockProvider.storeKnowledge.mockResolvedValue('id-123');
      await memoryStoreTool({
        text: 'test bypass attempt',
        source: 'user',
        agent_name: 'tried_to_bypass',
      });
      expect(mockProvider.storeKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'isolated_agent',
        }),
      );
    });
  });

  describe('memory_search', () => {
    it('should use OVERMIND_AGENT_NAME for filtering if env is set', async () => {
      process.env.OVERMIND_AGENT_NAME = 'searching_agent';
      mockProvider.searchMemory.mockResolvedValue([]);
      await memorySearchTool({ query: 'lost keys', limit: 10, include_runs: false });
      expect(mockProvider.searchMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'searching_agent',
        }),
      );
    });

    it('should allow searching without agent filter if neither arg nor env is set', async () => {
      mockProvider.searchMemory.mockResolvedValue([]);
      await memorySearchTool({ query: 'global info', limit: 10, include_runs: false });
      expect(mockProvider.searchMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: undefined,
        }),
      );
    });
  });

  describe('memory_runs', () => {
    it('should use OVERMIND_AGENT_NAME for runs history if env is set', async () => {
      process.env.OVERMIND_AGENT_NAME = 'runner_agent';
      mockProvider.getRecentRuns.mockResolvedValue([]);
      await memoryRunsTool({ limit: 5, stats: false });
      expect(mockProvider.getRecentRuns).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'runner_agent',
        }),
      );
    });

    it('should use OVERMIND_AGENT_NAME for stats if env is set', async () => {
      process.env.OVERMIND_AGENT_NAME = 'stats_agent';
      mockProvider.getStats.mockResolvedValue({ totalRuns: 10, totalKnowledge: 5, byRunner: [] });
      await memoryRunsTool({ stats: true, limit: 10 });
      expect(mockProvider.getStats).toHaveBeenCalledWith('stats_agent');
    });

    it('should respect manual agent_name if OVERMIND_AGENT_NAME is NOT set', async () => {
      delete process.env.OVERMIND_AGENT_NAME;
      mockProvider.getStats.mockResolvedValue({ totalRuns: 1, totalKnowledge: 1, byRunner: [] });
      await memoryRunsTool({ stats: true, agent_name: 'other_agent', limit: 10 });
      expect(mockProvider.getStats).toHaveBeenCalledWith('other_agent');
    });
  });
});
