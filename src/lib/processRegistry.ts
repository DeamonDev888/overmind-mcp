import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Mutex } from 'async-mutex';
import { getWorkspaceDir } from './config.js';

const execAsync = promisify(exec);
const registryMutex = new Mutex();

const SESSIONS_FILE = '.claude/sessions.json';
const PROCESS_TTL_MS = 60 * 60 * 1000; // 1h after done/failed → cleanup

export type ProcessStatus = 'running' | 'done' | 'failed' | 'orphaned';

export interface ProcessEntry {
  id: string; // sessionId
  ts: number; // timestamp
  pid?: number;
  runner?: string;
  agentName: string;
  status: ProcessStatus;
  outputBuffer: string;
  exitCode?: number | null;
  lastOutputAt?: number;
}

interface SessionsStore {
  [key: string]: ProcessEntry | string; // string = legacy sessionId-only
}

function getSessionsPath(workspaceDir?: string): string {
  return path.resolve(workspaceDir || getWorkspaceDir(), SESSIONS_FILE);
}

function buildKey(runner: string | undefined, agentName: string): string {
  return runner ? `${runner}:${agentName}` : agentName;
}

async function readStore(
  workspaceDir?: string,
): Promise<{ store: SessionsStore; path: string }> {
  const filePath = getSessionsPath(workspaceDir);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { store: JSON.parse(content) as SessionsStore, path: filePath };
  } catch {
    return { store: {}, path: filePath };
  }
}

async function writeStore(
  store: SessionsStore,
  filePath: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Check if a PID is still alive on the system.
 */
export async function isPidAlive(pid: number): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
      return true;
    } else {
      await execAsync(`kill -0 ${pid}`);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Kill a process tree (PID + all children) — Windows or Unix.
 */
export async function killProcessTree(pid: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execAsync(`taskkill /F /T /PID ${pid}`);
    } else {
      await execAsync(`kill -9 ${pid}`);
    }
  } catch {
    // Process may have already exited — that's fine
  }
}

/**
 * Register a new running process. Called immediately after spawn(),
 * before sessionId is known.
 */
export async function registerProcess(
  pid: number,
  meta: {
    agentName: string;
    runner?: string;
    configPath?: string;
  },
): Promise<void> {
  return registryMutex.runExclusive(async () => {
    const { store, path: filePath } = await readStore(meta.configPath);
    const key = buildKey(meta.runner, meta.agentName);

    // Preserve existing id/ts if any (legacy entry), just update pid/status
    const existing = store[key];
    const entry: ProcessEntry =
      typeof existing === 'object' && existing !== null
        ? { ...existing, pid, status: 'running', outputBuffer: existing.outputBuffer || '' }
        : {
            id: '',
            ts: Date.now(),
            pid,
            runner: meta.runner,
            agentName: meta.agentName,
            status: 'running',
            outputBuffer: '',
          };

    store[key] = entry;
    await writeStore(store, filePath);
  });
}

/**
 * Link a sessionId to an already-registered PID.
 * Called when the runner emits a sessionId for the first time.
 */
export async function linkSessionToPid(
  sessionId: string,
  pid: number,
  configPath?: string,
): Promise<void> {
  return registryMutex.runExclusive(async () => {
    const { store, path: filePath } = await readStore(configPath);

    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (typeof entry === 'object' && entry !== null && entry.pid === pid && !entry.id) {
        entry.id = sessionId;
        entry.ts = Date.now();
        entry.lastOutputAt = Date.now();
        store[key] = entry;
        await writeStore(store, filePath);
        return;
      }
    }
  });
}

/**
 * Update output buffer for a running process.
 * Called in stdout 'data' handler to enable live streaming.
 */
export async function appendOutput(
  pid: number,
  chunk: string,
  configPath?: string,
): Promise<void> {
  return registryMutex.runExclusive(async () => {
    const { store, path: filePath } = await readStore(configPath);

    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (typeof entry === 'object' && entry !== null && entry.pid === pid) {
        entry.outputBuffer += chunk;
        entry.lastOutputAt = Date.now();
        store[key] = entry;
        await writeStore(store, filePath);
        return;
      }
    }
  });
}

/**
 * Mark a process as done/failed/orphaned.
 */
export async function updateProcessStatus(
  pid: number,
  status: ProcessStatus,
  exitCode?: number | null,
  configPath?: string,
): Promise<void> {
  return registryMutex.runExclusive(async () => {
    const { store, path: filePath } = await readStore(configPath);

    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (typeof entry === 'object' && entry !== null && entry.pid === pid) {
        entry.status = status;
        entry.exitCode = exitCode ?? null;
        entry.lastOutputAt = Date.now();
        store[key] = entry;
        await writeStore(store, filePath);
        return;
      }
    }
  });
}

/**
 * Get current status + output for an agent.
 */
export async function getProcessStatus(
  agentName: string,
  runner?: string,
  configPath?: string,
): Promise<ProcessEntry | null> {
  return registryMutex.runExclusive(async () => {
    const { store } = await readStore(configPath);
    const key = buildKey(runner, agentName);
    const entry = store[key];

    if (!entry) return null;

    if (typeof entry === 'string') {
      return { id: entry, ts: Date.now(), agentName, status: 'done', outputBuffer: '' };
    }

    // Check if running process is actually dead
    if (entry.status === 'running' && entry.pid) {
      const alive = await isPidAlive(entry.pid);
      if (!alive) {
        entry.status = 'orphaned';
      }
    }

    return entry;
  });
}

/**
 * Kill a running agent by PID.
 */
export async function killAgent(
  agentName: string,
  runner?: string,
  configPath?: string,
): Promise<{ killed: boolean; pid?: number }> {
  return registryMutex.runExclusive(async () => {
    const { store, path: filePath } = await readStore(configPath);
    const key = buildKey(runner, agentName);
    const entry = store[key];

    if (!entry || typeof entry !== 'object' || entry.status !== 'running') {
      return { killed: false };
    }

    const pid = entry.pid;
    if (!pid) return { killed: false };

    await killProcessTree(pid);

    entry.status = 'failed';
    entry.exitCode = null;
    entry.lastOutputAt = Date.now();
    store[key] = entry;
    await writeStore(store, filePath);

    return { killed: true, pid };
  });
}

/**
 * Unregister (remove) a process entry. Call after TTL expires.
 */
export async function unregisterProcess(
  pid: number,
  configPath?: string,
): Promise<void> {
  return registryMutex.runExclusive(async () => {
    const { store, path: filePath } = await readStore(configPath);
    let changed = false;

    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (typeof entry === 'object' && entry !== null && entry.pid === pid) {
        delete store[key];
        changed = true;
      }
    }

    if (changed) {
      await writeStore(store, filePath);
    }
  });
}

/**
 * Scan all entries and clean up dead processes and old entries.
 * Called on startup and periodically.
 */
export async function cleanupRegistry(configPath?: string): Promise<{
  orphaned: number;
  expired: number;
}> {
  return registryMutex.runExclusive(async () => {
    const { store, path: filePath } = await readStore(configPath);
    const now = Date.now();
    let orphaned = 0;
    let expired = 0;
    let changed = false;

    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (typeof entry !== 'object' || entry === null) continue;

      // Check running processes
      if (entry.status === 'running' && entry.pid) {
        const alive = await isPidAlive(entry.pid);
        if (!alive) {
          entry.status = 'orphaned';
          orphaned++;
          changed = true;
        }
      }

      // TTL cleanup for done/failed/orphaned
      if (entry.status !== 'running') {
        const age = now - (entry.lastOutputAt || entry.ts);
        if (age > PROCESS_TTL_MS) {
          delete store[key];
          expired++;
          changed = true;
        }
      }
    }

    if (changed) {
      await writeStore(store, filePath);
    }

    return { orphaned, expired };
  });
}

/**
 * Get all running processes.
 */
export async function getRunningProcesses(
  configPath?: string,
): Promise<ProcessEntry[]> {
  return registryMutex.runExclusive(async () => {
    const { store } = await readStore(configPath);
    const result: ProcessEntry[] = [];

    for (const entry of Object.values(store)) {
      if (typeof entry === 'object' && entry !== null && entry.status === 'running') {
        if (entry.pid) {
          const alive = await isPidAlive(entry.pid);
          if (!alive) {
            entry.status = 'orphaned';
          }
        }
        result.push(entry);
      }
    }

    return result;
  });
}
