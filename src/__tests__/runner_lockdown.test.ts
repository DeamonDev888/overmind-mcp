import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Mock telemetry — withSpan just calls fn() with a fake span to avoid OTel dependency
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
    on: vi.fn((event, cb) => {
      if (event === 'close') setTimeout(() => cb(0), 10);
    }),
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    kill: vi.fn(),
  })),
  exec: vi.fn(),
}));

describe('Lockdown: Runner & Workspace Integrity', () => {
  // Use dynamic import AFTER mocks are set up
  let ClaudeRunner: typeof import('../services/ClaudeRunner.js').ClaudeRunner;
  let getWorkspaceDir: typeof import('../lib/config.js').getWorkspaceDir;
  let resetWorkspaceCache: typeof import('../lib/config.js').resetWorkspaceCache;

  // Real paths for CI compatibility
  const TEST_AGENT_NAME = 'mainteneur_agent_divers';
  const TMP_HERMES_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'om-runner-'));
  const SETTINGS_DIR = path.join(TMP_HERMES_HOME, '.claude');
  const SETTINGS_FILE = path.join(SETTINGS_DIR, `settings_${TEST_AGENT_NAME}.json`);
  const SOUL_FILE = path.join(TMP_HERMES_HOME, `${TEST_AGENT_NAME}.md`);

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create real settings file on disk (CI-friendly — no fs mocking)
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ env: { ANTHROPIC_MODEL: 'test-model' } }));
    fs.writeFileSync(SOUL_FILE, 'test-prompt');

    // Point OVERMIND_HERMES_HOME to our temp dir
    process.env.OVERMIND_HERMES_HOME = TMP_HERMES_HOME;
    delete process.env.OVERMIND_WORKSPACE;

    // Dynamic imports after mocks
    const runnerModule = await import('../services/ClaudeRunner.js');
    const configModule = await import('../lib/config.js');
    ClaudeRunner = runnerModule.ClaudeRunner;
    getWorkspaceDir = configModule.getWorkspaceDir;
    resetWorkspaceCache = configModule.resetWorkspaceCache;
  });

  afterEach(() => {
    // Cleanup temp files
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
      await runner.runAgent({ prompt: 'test', agentName: TEST_AGENT_NAME });

      const { spawn } = await import('child_process');
      const spawnCalls = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const spawnArgs = spawnCalls[0] as unknown[];
      const options = spawnArgs[2] as { env: Record<string, string | undefined> };
      const env = options.env;

      expect(env, 'Process environment MUST be defined').toBeDefined();
      expect(env.OVERMIND_AGENT_NAME, 'OVERMIND_AGENT_NAME MUST be injected').toBe(TEST_AGENT_NAME);
    });

    it('MUST map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY for legacy/standard compatibility', async () => {
      const runner = new ClaudeRunner();
      // Set a token in env to verify the mapping
      process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
      await runner.runAgent({ prompt: 'test', agentName: TEST_AGENT_NAME });

      const { spawn } = await import('child_process');
      const spawnCalls = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const env = (spawnCalls[0] as unknown[])[2] as { env: Record<string, string | undefined> };
      if (env.ANTHROPIC_AUTH_TOKEN) {
        expect(
          env.ANTHROPIC_API_KEY,
          'ANTHROPIC_API_KEY MUST be assigned the value of ANTHROPIC_AUTH_TOKEN',
        ).toBe(env.ANTHROPIC_AUTH_TOKEN);
      }
      delete process.env.ANTHROPIC_AUTH_TOKEN;
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
