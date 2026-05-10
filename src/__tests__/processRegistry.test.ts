/**
 * processRegistry.test.ts
 *
 * Unit tests for the Process Registry module.
 * Tests cover: register, link, append, status, kill, unregister, cleanup.
 *
 * Note: Tests that depend on isPidAlive/killProcessTree (which call execAsync)
 * are skipped on Windows since mocking exec at the module level doesn't work
 * with how promisify is called at load time.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('../lib/config.js', () => ({
  getWorkspaceDir: () => '/tmp/test-overmind',
}));

import {
  registerProcess,
  linkSessionToPid,
  appendOutput,
  updateProcessStatus,
  getProcessStatus,
  killAgent,
  unregisterProcess,
  cleanupRegistry,
  getRunningProcesses,
} from '../lib/processRegistry.js';

const TEST_DIR = path.join(os.tmpdir(), `overmind-test-${Date.now()}`);
const SESSIONS_FILE = path.join(TEST_DIR, '.claude', 'sessions.json');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readSessions(): Promise<Record<string, unknown>> {
  try {
    const content = await fs.readFile(SESSIONS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeSessions(data: Record<string, unknown>): Promise<void> {
  await ensureDir(path.dirname(SESSIONS_FILE));
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function cleanupTestDir() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

describe('processRegistry', () => {
  beforeEach(async () => {
    await cleanupTestDir();
    await ensureDir(path.dirname(SESSIONS_FILE));
    await writeSessions({});
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  // ─── registerProcess ────────────────────────────────────────────────────────

  describe('registerProcess', () => {
    it('should register a new process with correct fields', async () => {
      await registerProcess(12345, {
        agentName: 'test_agent',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      const sessions = await readSessions();
      const entry = sessions['kilo:test_agent'] as Record<string, unknown>;

      expect(entry).toBeDefined();
      expect(entry.pid).toBe(12345);
      expect(entry.runner).toBe('kilo');
      expect(entry.agentName).toBe('test_agent');
      expect(entry.status).toBe('running');
      expect(entry.outputBuffer).toBe('');
      expect(entry.id).toBe('');
    });

    it('should register without runner (key = agentName only)', async () => {
      await registerProcess(99999, {
        agentName: 'standalone',
        configPath: TEST_DIR,
      });

      const sessions = await readSessions();
      const entry = sessions['standalone'] as Record<string, unknown>;

      expect(entry).toBeDefined();
      expect(entry.pid).toBe(99999);
      expect(entry.agentName).toBe('standalone');
    });

    it('should overwrite existing entry but preserve id/ts', async () => {
      await writeSessions({
        'claude:existing': {
          id: 'sess_previous',
          ts: 1000000,
          pid: 11111,
          runner: 'claude',
          agentName: 'existing',
          status: 'running',
          outputBuffer: 'old output',
        },
      });

      await registerProcess(22222, {
        agentName: 'existing',
        runner: 'claude',
        configPath: TEST_DIR,
      });

      const sessions = await readSessions();
      const entry = sessions['claude:existing'] as Record<string, unknown>;

      expect(entry.pid).toBe(22222);
      expect(entry.id).toBe('sess_previous');
      expect(entry.status).toBe('running');
    });
  });

  // ─── linkSessionToPid ─────────────────────────────────────────────────────────

  describe('linkSessionToPid', () => {
    it('should link sessionId to existing PID', async () => {
      await registerProcess(12345, {
        agentName: 'test_agent',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await linkSessionToPid('sess_abc123', 12345, TEST_DIR);

      const sessions = await readSessions();
      const entry = sessions['kilo:test_agent'] as Record<string, unknown>;

      expect(entry.id).toBe('sess_abc123');
      expect(entry.ts).toBeGreaterThan(0);
      expect(entry.lastOutputAt).toBeDefined();
    });

    it('should not link if PID does not match any entry', async () => {
      await registerProcess(12345, {
        agentName: 'test_agent',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await linkSessionToPid('sess_abc123', 99999, TEST_DIR);

      const sessions = await readSessions();
      const entry = sessions['kilo:test_agent'] as Record<string, unknown>;

      expect(entry.id).toBe('');
    });

    it('should not overwrite existing sessionId', async () => {
      await writeSessions({
        'kilo:agent': {
          id: 'sess_first',
          ts: Date.now(),
          pid: 12345,
          runner: 'kilo',
          agentName: 'agent',
          status: 'running',
          outputBuffer: '',
        },
      });

      await linkSessionToPid('sess_second', 12345, TEST_DIR);

      const sessions = await readSessions();
      const entry = sessions['kilo:agent'] as Record<string, unknown>;

      expect(entry.id).toBe('sess_first');
    });
  });

  // ─── appendOutput ────────────────────────────────────────────────────────────

  describe('appendOutput', () => {
    it('should append chunk to outputBuffer', async () => {
      await registerProcess(12345, {
        agentName: 'test_agent',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await appendOutput(12345, 'First chunk\n', TEST_DIR);
      await appendOutput(12345, 'Second chunk\n', TEST_DIR);

      const sessions = await readSessions();
      const entry = sessions['kilo:test_agent'] as Record<string, unknown>;

      expect(entry.outputBuffer).toBe('First chunk\nSecond chunk\n');
      expect(entry.lastOutputAt).toBeGreaterThan(0);
    });

    it('should update lastOutputAt on each append', async () => {
      await registerProcess(12345, {
        agentName: 'test_agent',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await appendOutput(12345, 'A', TEST_DIR);

      const sessions1 = await readSessions();
      const ts1 = sessions1['kilo:test_agent'] as Record<string, unknown>;
      const firstLastOutputAt = ts1.lastOutputAt as number;

      await new Promise((r) => setTimeout(r, 10));
      await appendOutput(12345, 'B', TEST_DIR);

      const sessions2 = await readSessions();
      const ts2 = sessions2['kilo:test_agent'] as Record<string, unknown>;
      const secondLastOutputAt = ts2.lastOutputAt as number;

      expect(secondLastOutputAt).toBeGreaterThan(firstLastOutputAt);
    });
  });

  // ─── updateProcessStatus ─────────────────────────────────────────────────────

  describe('updateProcessStatus', () => {
    it('should update status to done with exit code 0', async () => {
      await registerProcess(12345, {
        agentName: 'test_agent',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await updateProcessStatus(12345, 'done', 0, TEST_DIR);

      const sessions = await readSessions();
      const entry = sessions['kilo:test_agent'] as Record<string, unknown>;

      expect(entry.status).toBe('done');
      expect(entry.exitCode).toBe(0);
    });

    it('should update status to failed with non-zero exit code', async () => {
      await registerProcess(12345, {
        agentName: 'test_agent',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await updateProcessStatus(12345, 'failed', 1, TEST_DIR);

      const sessions = await readSessions();
      const entry = sessions['kilo:test_agent'] as Record<string, unknown>;

      expect(entry.status).toBe('failed');
      expect(entry.exitCode).toBe(1);
    });

    it('should handle null exit code', async () => {
      await registerProcess(12345, {
        agentName: 'test_agent',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await updateProcessStatus(12345, 'failed', null, TEST_DIR);

      const sessions = await readSessions();
      const entry = sessions['kilo:test_agent'] as Record<string, unknown>;

      expect(entry.status).toBe('failed');
      expect(entry.exitCode).toBe(null);
    });
  });

  // ─── getProcessStatus ────────────────────────────────────────────────────────

  describe('getProcessStatus', () => {
    it('should return null if agent not found', async () => {
      const result = await getProcessStatus('nonexistent', 'kilo', TEST_DIR);
      expect(result).toBeNull();
    });

    it('should return entry with status done for legacy string entry', async () => {
      await writeSessions({
        'claude:legacy': 'sess_old_string',
      });

      const result = await getProcessStatus('legacy', 'claude', TEST_DIR);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('done');
      expect(result!.id).toBe('sess_old_string');
    });

    // Note: isPidAlive tests (orphaned detection) require platform-specific mocking
    // which is difficult with promisify(exec) called at module load time.
    // These are covered by manual testing on each platform.
  });

  // ─── killAgent ───────────────────────────────────────────────────────────────

  describe('killAgent', () => {
    it('should return killed: false if agent not found', async () => {
      const result = await killAgent('nonexistent', 'kilo', TEST_DIR);
      expect(result.killed).toBe(false);
    });

    it('should return killed: false if agent not running', async () => {
      await writeSessions({
        'kilo:done_agent': {
          id: 'sess_done',
          ts: Date.now(),
          pid: 12345,
          runner: 'kilo',
          agentName: 'done_agent',
          status: 'done',
          outputBuffer: 'result',
        },
      });

      const result = await killAgent('done_agent', 'kilo', TEST_DIR);
      expect(result.killed).toBe(false);
    });

    // Note: killAgent tests with actual kill require platform-specific mocking.
    // These are covered by manual testing.
  });

  // ─── unregisterProcess ───────────────────────────────────────────────────────

  describe('unregisterProcess', () => {
    it('should remove entry by PID', async () => {
      await registerProcess(12345, {
        agentName: 'test_agent',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await unregisterProcess(12345, TEST_DIR);

      const sessions = await readSessions();
      expect(sessions['kilo:test_agent']).toBeUndefined();
    });

    it('should only remove the matching PID entry', async () => {
      await registerProcess(12345, {
        agentName: 'agent_a',
        runner: 'kilo',
        configPath: TEST_DIR,
      });
      await registerProcess(67890, {
        agentName: 'agent_b',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await unregisterProcess(12345, TEST_DIR);

      const sessions = await readSessions();
      expect(sessions['kilo:agent_a']).toBeUndefined();
      expect(sessions['kilo:agent_b']).toBeDefined();
    });
  });

  // ─── cleanupRegistry ─────────────────────────────────────────────────────────

  describe('cleanupRegistry', () => {
    it('should remove expired done/failed entries (older than TTL)', async () => {
      const oldTs = Date.now() - (65 * 60 * 1000);
      await writeSessions({
        'kilo:old_done': {
          id: 'sess_old',
          ts: oldTs,
          pid: 11111,
          runner: 'kilo',
          agentName: 'old_done',
          status: 'done',
          outputBuffer: 'old result',
          lastOutputAt: oldTs,
        },
      });

      const result = await cleanupRegistry(TEST_DIR);

      expect(result.expired).toBe(1);
      const sessions = await readSessions();
      expect(sessions['kilo:old_done']).toBeUndefined();
    });

    it('should keep recent done entries', async () => {
      const recentTs = Date.now() - (30 * 60 * 1000);
      await writeSessions({
        'kilo:recent_done': {
          id: 'sess_recent',
          ts: recentTs,
          pid: 11111,
          runner: 'kilo',
          agentName: 'recent_done',
          status: 'done',
          outputBuffer: 'recent result',
          lastOutputAt: recentTs,
        },
      });

      const result = await cleanupRegistry(TEST_DIR);

      expect(result.expired).toBe(0);
      const sessions = await readSessions();
      expect(sessions['kilo:recent_done']).toBeDefined();
    });
  });

  // ─── getRunningProcesses ─────────────────────────────────────────────────────

  describe('getRunningProcesses', () => {
    it('should return only running processes', async () => {
      await writeSessions({
        'kilo:running': {
          id: 'sess_1',
          ts: Date.now(),
          pid: 11111,
          runner: 'kilo',
          agentName: 'running',
          status: 'running',
          outputBuffer: '',
        },
        'kilo:done': {
          id: 'sess_2',
          ts: Date.now(),
          pid: 22222,
          runner: 'kilo',
          agentName: 'done',
          status: 'done',
          outputBuffer: 'result',
        },
        'claude:running': {
          id: 'sess_3',
          ts: Date.now(),
          pid: 33333,
          runner: 'claude',
          agentName: 'running',
          status: 'running',
          outputBuffer: '',
        },
      });

      const result = await getRunningProcesses(TEST_DIR);

      expect(result).toHaveLength(2);
      const agentNames = result.map((e) => e.agentName).sort();
      expect(agentNames).toEqual(['running', 'running']);
    });
  });

  // ─── buildKey ────────────────────────────────────────────────────────────────

  describe('key building', () => {
    it('should use runner:agentName format when runner is provided', async () => {
      await registerProcess(12345, {
        agentName: 'test',
        runner: 'claude',
        configPath: TEST_DIR,
      });

      const sessions = await readSessions();
      expect(sessions['claude:test']).toBeDefined();
      expect(sessions['test']).toBeUndefined();
    });

    it('should use agentName only when runner is undefined', async () => {
      await registerProcess(12345, {
        agentName: 'standalone',
        configPath: TEST_DIR,
      });

      const sessions = await readSessions();
      expect(sessions['standalone']).toBeDefined();
    });
  });

  // ─── Concurrency / Mutex ─────────────────────────────────────────────────────

  describe('mutex protection', () => {
    it('should handle concurrent registerProcess calls', async () => {
      await Promise.all([
        registerProcess(10001, { agentName: 'p1', runner: 'kilo', configPath: TEST_DIR }),
        registerProcess(10002, { agentName: 'p2', runner: 'kilo', configPath: TEST_DIR }),
        registerProcess(10003, { agentName: 'p3', runner: 'kilo', configPath: TEST_DIR }),
      ]);

      const sessions = await readSessions();

      expect(sessions['kilo:p1']).toBeDefined();
      expect(sessions['kilo:p2']).toBeDefined();
      expect(sessions['kilo:p3']).toBeDefined();
    });

    it('should handle concurrent appendOutput calls', async () => {
      await registerProcess(12345, {
        agentName: 'test',
        runner: 'kilo',
        configPath: TEST_DIR,
      });

      await Promise.all([
        appendOutput(12345, 'chunk1 ', TEST_DIR),
        appendOutput(12345, 'chunk2 ', TEST_DIR),
        appendOutput(12345, 'chunk3 ', TEST_DIR),
      ]);

      const sessions = await readSessions();
      const entry = sessions['kilo:test'] as Record<string, unknown>;
      expect(entry.outputBuffer).toContain('chunk1');
      expect(entry.outputBuffer).toContain('chunk2');
      expect(entry.outputBuffer).toContain('chunk3');
    });
  });
});