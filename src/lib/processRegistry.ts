/**
 * processRegistry.ts — Persistence layer (disk) + OS-level kill helpers
 * =====================================================================
 *
 * ONLY handles:
 *   - Read/write ProcessEntry to .claude/process-registry.json
 *   - Background sweeper (cleanupRegistry every 5min)
 *   - OS-level killProcessTree + isPidAlive (Windows tasklist / Unix kill -0)
 *
 * Hot-path state (outputBuffer, live status) lives in agent_lifecycle.
 */
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { getWorkspaceDir } from './config.js';
import pino from 'pino';

const logger = pino({ name: 'processRegistry' });


const REGISTRY_FILE = '.claude/process-registry.json';
const PROCESS_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export type ProcessStatus = 'running' | 'done' | 'failed' | 'orphaned';

export interface ProcessEntry {
  id: string;
  ts: number;
  pid?: number;
  runner?: string;
  agentName: string;
  status: ProcessStatus;
  exitCode?: number | null;
  lastOutputAt?: number;
}

interface RegistryStore {
  processes: Record<string, ProcessEntry>;
  version: number;
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function getRegistryPath(workspaceDir?: string): string {
  return path.resolve(workspaceDir || getWorkspaceDir(), REGISTRY_FILE);
}

function buildKey(runner: string | undefined, agentName: string): string {
  return runner ? `${runner}:${agentName}` : agentName;
}

// ─── Disk persistence ──────────────────────────────────────────────────────────

async function readStore(workspaceDir?: string): Promise<{ store: RegistryStore; path: string }> {
  const filePath = getRegistryPath(workspaceDir);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { store: JSON.parse(content) as RegistryStore, path: filePath };
  } catch {
    return { store: { processes: {}, version: 2 }, path: filePath };
  }
}

let writePending = false;
const pendingWrites = new Map<string, RegistryStore>();

// Mutex per file path — prevents concurrent writes to the same file
// which was causing earlier writes to be silently dropped.
const fileLocks = new Map<string, Promise<void>>();

async function writeStore(store: RegistryStore, filePath: string): Promise<void> {
  // Wait for any in-flight write to the same file before proceeding
  const existingLock = fileLocks.get(filePath);
  if (existingLock) await existingLock;

  pendingWrites.set(filePath, store);
  if (writePending) return;
  writePending = true;

  const lock = (async () => {
    try {
      await new Promise<void>((resolve) => {
        setTimeout(async () => {
          writePending = false;
          const entries = new Map(pendingWrites);
          pendingWrites.clear();
          for (const [fPath, s] of entries) {
            try {
              await fs.mkdir(path.dirname(fPath), { recursive: true });
              const tmp = fPath + '.tmp.' + Math.random().toString(36).slice(2);
              await fs.writeFile(tmp, JSON.stringify(s, null, 2), 'utf-8');
              await fs.rename(tmp, fPath);
            } catch (e) {
              logger.error({ fPath, error: e }, '[ProcessRegistry] Write failed.');
            }
          }
          resolve();
        }, 250);
      });
    } finally {
      fileLocks.delete(filePath);
    }
  })();

  fileLocks.set(filePath, lock.then(() => {}).catch(() => {}));
}

// ─── OS-level process utilities ───────────────────────────────────────────────

const pidCache = new Map<number, { alive: boolean; ts: number }>();
const PID_CACHE_TTL = 2000;

export async function isPidAlive(pid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 0) return false;

  const cached = pidCache.get(pid);
  if (cached && Date.now() - cached.ts < PID_CACHE_TTL) return cached.alive;

  try {
    if (process.platform === 'win32') {
      const result = await new Promise<boolean>((resolve) => {
        const child = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        child.on('close', () => {
          const trimmed = out.trim();
          resolve(!trimmed.includes('No tasks are running') && trimmed.includes(String(pid)));
        });
        child.on('error', () => resolve(false));
      });
      pidCache.set(pid, { alive: result, ts: Date.now() });
      return result;
    } else {
      const { execFileSync } = await import('child_process');
      try {
        execFileSync('kill', ['-0', String(pid)], { timeout: 2000 });
        pidCache.set(pid, { alive: true, ts: Date.now() });
        return true;
      } catch {
        pidCache.set(pid, { alive: false, ts: Date.now() });
        return false;
      }
    }
  } catch {
    return false;
  }
}

export async function killProcessTree(pid: number): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const child = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
          windowsHide: true,
          stdio: 'pipe',
        });
        child.on('close', () => resolve());
        child.on('error', () => resolve());
      });
    } else {
      await new Promise<void>((resolve) => {
        const child = spawn('kill', ['-9', String(pid)], { stdio: 'pipe' });
        child.on('close', () => resolve());
        child.on('error', () => resolve());
      });
    }
    pidCache.delete(pid);
  } catch {
    // Already dead — fine
  }
}

// ─── Registry operations ──────────────────────────────────────────────────────

export async function registerProcess(
  pid: number,
  meta: { agentName: string; runner?: string; configPath?: string },
): Promise<void> {
  const { store, path: filePath } = await readStore(meta.configPath);
  const key = buildKey(meta.runner, meta.agentName);
  store.processes[key] = {
    id: '',
    ts: Date.now(),
    pid,
    runner: meta.runner,
    agentName: meta.agentName,
    status: 'running',
    exitCode: null,
  };
  await writeStore(store, filePath);
}

export async function linkSessionToPid(
  sessionId: string,
  pid: number,
  configPath?: string,
): Promise<void> {
  const { store, path: filePath } = await readStore(configPath);
  for (const key of Object.keys(store.processes)) {
    const entry = store.processes[key];
    if (entry.pid === pid) {
      entry.id = sessionId;
      entry.ts = Date.now();
      store.processes[key] = entry;
      await writeStore(store, filePath);
      return;
    }
  }
}

/** appendOutput — NO-OP: agent_lifecycle handles output in RAM */
export async function appendOutput(pid: number, chunk: string, configPath?: string): Promise<void> {
  void pid; void chunk; void configPath;
}

export async function updateProcessStatus(
  pid: number,
  status: ProcessStatus,
  exitCode?: number | null,
  configPath?: string,
): Promise<void> {
  const { store, path: filePath } = await readStore(configPath);
  for (const key of Object.keys(store.processes)) {
    const entry = store.processes[key];
    if (entry.pid === pid) {
      entry.status = status;
      entry.exitCode = exitCode ?? null;
      entry.lastOutputAt = Date.now();
      store.processes[key] = entry;
      await writeStore(store, filePath);
      return;
    }
  }
}

export async function getProcessStatus(
  agentName: string,
  runner?: string,
  configPath?: string,
): Promise<ProcessEntry | null> {
  const { store } = await readStore(configPath);
  const key = buildKey(runner, agentName);
  return store.processes[key] ?? null;
}

export async function killAgent(
  agentName: string,
  runner?: string,
  configPath?: string,
): Promise<{ killed: boolean; pid?: number }> {
  const { store, path: filePath } = await readStore(configPath);
  const key = buildKey(runner, agentName);
  const entry = store.processes[key];
  if (!entry || entry.status !== 'running') return { killed: false };

  const pid = entry.pid;
  if (pid) await killProcessTree(pid);

  entry.status = 'failed';
  entry.exitCode = null;
  entry.lastOutputAt = Date.now();
  store.processes[key] = entry;
  await writeStore(store, filePath);

  return { killed: true, pid };
}

export async function unregisterProcess(pid: number, configPath?: string): Promise<void> {
  const { store, path: filePath } = await readStore(configPath);
  let changed = false;
  for (const key of Object.keys(store.processes)) {
    if (store.processes[key].pid === pid) {
      delete store.processes[key];
      changed = true;
    }
  }
  if (changed) await writeStore(store, filePath);
}

export async function cleanupRegistry(configPath?: string): Promise<{
  orphaned: number;
  expired: number;
}> {
  const { store, path: filePath } = await readStore(configPath);
  const now = Date.now();
  let orphaned = 0;
  let expired = 0;
  let changed = false;

  for (const key of Object.keys(store.processes)) {
    const entry = store.processes[key];
    if (entry.status === 'running' && entry.pid) {
      const alive = await isPidAlive(entry.pid);
      if (!alive) { entry.status = 'orphaned'; orphaned++; changed = true; }
    }
    if (entry.status !== 'running') {
      const age = now - (entry.lastOutputAt || entry.ts);
      if (age > PROCESS_TTL_MS) { delete store.processes[key]; expired++; changed = true; }
    }
  }
  if (changed) await writeStore(store, filePath);
  return { orphaned, expired };
}

export async function getRunningProcesses(configPath?: string): Promise<ProcessEntry[]> {
  const { store } = await readStore(configPath);
  return Object.values(store.processes).filter((e) => e.status === 'running');
}

export function startAutoCleanup(configPath?: string): void {
  cleanupRegistry(configPath).catch(() => {});
  setInterval(() => { cleanupRegistry(configPath).catch(() => {}); }, CLEANUP_INTERVAL_MS);
}
