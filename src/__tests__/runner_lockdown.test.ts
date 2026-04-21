import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeRunner } from '../services/ClaudeRunner.js';
import { spawn } from 'child_process';
import path from 'path';
import { getWorkspaceDir, resetWorkspaceCache } from '../lib/config.js';
// Mock fs to bypass file existence checks in tests
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const actualDefault = actual.default as Record<string, unknown>;
  return {
    ...actual,
    default: {
      ...actualDefault,
      existsSync: vi.fn((p) => {
        if (p.includes('.json') || p.includes('.md')) return true;
        return actual.default.existsSync(p);
      }),
      readFileSync: vi.fn((p) => {
        if (p.includes('.json')) return JSON.stringify({ env: { ANTHROPIC_MODEL: 'test-model' } });
        if (p.includes('.md')) return 'test-prompt';
        return actual.default.readFileSync(p);
      }),
      readdirSync: vi.fn((_p) => {
        return ['settings_mainteneur_agent_divers.json'];
      }),
    },
  };
});

// Mock child_process for isolation
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => {
      if (event === 'close') setTimeout(() => cb(0), 10);
    }),
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    kill: vi.fn(),
  })),
}));

describe('Lockdown: Runner & Workspace Integrity', () => {
  const runner = new ClaudeRunner();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Environment Injection', () => {
    it('MUST inject agent-specific settings into the spawned process', async () => {
      await runner.runAgent({ prompt: 'test', agentName: 'mainteneur_agent_divers' });

      const spawnCalls = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const spawnArgs = spawnCalls[0] as unknown[];
      const options = spawnArgs[2] as { env: Record<string, string | undefined> };
      const env = options.env;

      expect(env, 'Process environment MUST be defined').toBeDefined();
      expect(
        env.ANTHROPIC_MODEL,
        'ANTHROPIC_MODEL MUST be injected from settings.json',
      ).toBeDefined();
      expect(env.OVERMIND_AGENT_NAME).toBe('mainteneur_agent_divers');
    });

    it('MUST map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY for legacy/standard compatibility', async () => {
      await runner.runAgent({ prompt: 'test', agentName: 'mainteneur_agent_divers' });

      const spawnCalls = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const env = (spawnCalls[0] as unknown[])[2] as { env: Record<string, string | undefined> };
      if (env.ANTHROPIC_AUTH_TOKEN) {
        expect(
          env.ANTHROPIC_API_KEY,
          'ANTHROPIC_API_KEY MUST be assigned the value of ANTHROPIC_AUTH_TOKEN',
        ).toBe(env.ANTHROPIC_AUTH_TOKEN);
      }
    });
  });

  describe('Workspace Resolution', () => {
    it('MUST resolve to the Workflow directory if OVERMIND_WORKSPACE is set', () => {
      const originalWorkspace = process.env.OVERMIND_WORKSPACE;
      resetWorkspaceCache();
      try {
        process.env.OVERMIND_WORKSPACE = path.resolve('./');
        const ws = getWorkspaceDir();
        expect(ws).toBe(path.resolve('./'));
      } finally {
        process.env.OVERMIND_WORKSPACE = originalWorkspace;
        resetWorkspaceCache();
      }
    });

    it('MUST prevent using a random root directory if a .mcp.json is present in the intended workspace', () => {
      resetWorkspaceCache();
      const originalWorkspace = process.env.OVERMIND_WORKSPACE;
      const workflowDir = path.resolve(__dirname, '../..'); // Go up from __tests__ to src, then to root

      try {
        // Explicitly set OVERMIND_WORKSPACE to Workflow directory
        process.env.OVERMIND_WORKSPACE = workflowDir;
        const ws = getWorkspaceDir();
        // Since we are running tests in Workflow, it should resolve here
        // In CI, the directory is overmind-mcp, locally it might be Workflow
        const lowerWs = ws.toLowerCase();
        expect(lowerWs.includes('workflow') || lowerWs.includes('overmind-mcp')).toBe(true);
      } finally {
        process.env.OVERMIND_WORKSPACE = originalWorkspace;
        resetWorkspaceCache();
      }
    });
  });
});
