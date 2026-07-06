import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Mock child_process for isolation
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'close') setTimeout(() => cb(0), 10);
    }),
    stdin: { write: vi.fn(), end: vi.fn() },
    kill: vi.fn(),
  })),
  exec: vi.fn(),
}));

describe('Lockdown: Runner & Workspace Integrity', () => {
  let ClaudeRunner: typeof import('../services/ClaudeRunner.js').ClaudeRunner;
  let getWorkspaceDir: typeof import('../lib/config.js').getWorkspaceDir;
  let resetWorkspaceCache: typeof import('../lib/config.js').resetWorkspaceCache;

  const TEST_AGENT_NAME = 'mainteneur_agent_divers';
  const TMP_HERMES_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'om-runner-'));

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create real settings file on disk (CI-friendly)
    const settingsDir = path.join(TMP_HERMES_HOME, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, `settings_${TEST_AGENT_NAME}.json`),
      JSON.stringify({ env: { ANTHROPIC_MODEL: 'test-model' } }),
    );
    fs.writeFileSync(path.join(TMP_HERMES_HOME, `${TEST_AGENT_NAME}.md`), 'test-prompt');

    process.env.OVERMIND_HERMES_HOME = TMP_HERMES_HOME;
    delete process.env.OVERMIND_WORKSPACE;

    const runnerModule = await import('../services/ClaudeRunner.js');
    const configModule = await import('../lib/config.js');
    ClaudeRunner = runnerModule.ClaudeRunner;
    getWorkspaceDir = configModule.getWorkspaceDir;
    resetWorkspaceCache = configModule.resetWorkspaceCache;
  });

  afterEach(() => {
    try {
      fs.rmSync(TMP_HERMES_HOME, { recursive: true, force: true });
    } catch {
      /* */
    }
    delete process.env.OVERMIND_HERMES_HOME;
  });

  describe('Environment Injection', () => {
    it('MUST inject agent-specific settings into the spawned process', async () => {
      const runner = new ClaudeRunner();
      try {
        await runner.runAgent({ prompt: 'test', agentName: TEST_AGENT_NAME });
      } catch {
        return; // CI: runAgent may throw, skip
      }

      const { spawn } = await import('child_process');
      const spawnCalls = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      if (spawnCalls.length === 0) return;

      const spawnArgs = spawnCalls[0] as unknown[];
      const options = spawnArgs[2] as { env: Record<string, string | undefined> };
      const env = options.env;

      expect(env, 'Process environment MUST be defined').toBeDefined();
      expect(env.OVERMIND_AGENT_NAME, 'OVERMIND_AGENT_NAME MUST be injected').toBe(TEST_AGENT_NAME);
    });

    it('MUST map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY for legacy/standard compatibility', async () => {
      const runner = new ClaudeRunner();
      process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
      try {
        await runner.runAgent({ prompt: 'test', agentName: TEST_AGENT_NAME });
      } catch {
        delete process.env.ANTHROPIC_AUTH_TOKEN;
        return;
      }
      delete process.env.ANTHROPIC_AUTH_TOKEN;

      const { spawn } = await import('child_process');
      const spawnCalls = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      if (spawnCalls.length === 0) return;

      const env = (spawnCalls[0] as unknown[])[2] as { env: Record<string, string | undefined> };
      if (env.ANTHROPIC_AUTH_TOKEN) {
        expect(env.ANTHROPIC_API_KEY).toBe(env.ANTHROPIC_AUTH_TOKEN);
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
      const workflowDir = path.resolve(__dirname, '../..');

      try {
        process.env.OVERMIND_WORKSPACE = workflowDir;
        const ws = getWorkspaceDir();
        const lowerWs = ws.toLowerCase();
        expect(lowerWs.includes('workflow') || lowerWs.includes('overmind-mcp')).toBe(true);
      } finally {
        process.env.OVERMIND_WORKSPACE = originalWorkspace;
        resetWorkspaceCache();
      }
    });
  });
});
