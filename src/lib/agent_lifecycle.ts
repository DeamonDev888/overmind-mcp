/**
 * agent_lifecycle.ts — Lightweight in-memory agent lifecycle manager
 * =================================================================
 *
 * Single source of truth for LIVE agent state during execution.
 * No disk I/O, no async on the hot path.
 *
 * Two layers working together:
 *   - agent_lifecycle (RAM): outputBuffer, status, sessionId, PID → O(1) access
 *   - processRegistry (disk): persistence, sweeper, OS-level kill
 *
 * Design goals:
 *   - appendLiveOutput() → O(1) in-memory string concat, zero disk I/O
 *   - agent_control     → direct Map read, no disk poll
 *   - 10+ agents        → all in RAM, zero contention
 *   - wait()            → AbortController-based, instant resolution
 *
 * ZOMBIE PREVENTION (v1.1):
 *   - Every entry has a maxAgeMs TTL (default 5min)
 *   - Sweeper runs every 30s and prunes dead PIDs
 *   - registerLiveAgent() refuses dead PIDs upfront
 *   - setLiveStatus() syncs to processRegistry for cross-system visibility
 */

import { ChildProcess } from 'child_process';
import { isPidAlive, unregisterProcess, updateProcessStatus } from './processRegistry.js';

export type LifecycleStatus = 'running' | 'done' | 'failed' | 'orphaned';

export interface LiveAgent {
  pid: number;
  runner: string;
  agentName: string;
  sessionId: string;
  status: LifecycleStatus;
  outputBuffer: string; // Ring buffer — last MAX_BUFFER chars
  exitCode: number | null;
  startedAt: number;
  lastOutputAt: number;
  abortController?: AbortController;
  cleanupFn: () => Promise<void>;
  childRef: ChildProcess | null;
}

const MAX_BUFFER = 256 * 1024;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5min before auto-orphan
const SWEEP_INTERVAL_MS = 30 * 1000; // sweep every 30s

// ─── In-memory store ───────────────────────────────────────────────────────────

const lifecycleMap = new Map<number, LiveAgent>();
const sessionIndex = new Map<string, number>(); // sessionId → pid

// Sweeper state
let sweepTimer: ReturnType<typeof setInterval> | undefined;
let sweepCount = 0;

// ─── Ring-buffer ───────────────────────────────────────────────────────────────

function appendToRing(existing: string, chunk: string): string {
  const combined = existing + chunk;
  return combined.length > MAX_BUFFER ? combined.slice(-MAX_BUFFER) : combined;
}

// ─── Zombie sweeper ───────────────────────────────────────────────────────────

/**
 * Periodic sweep that:
 *   1. Marks entries as 'orphaned' if their PID is dead
 *   2. Removes entries marked 'done'/'failed'/'orphaned' after TTL
 * Runs every 30s to keep the map bounded.
 */
async function sweepZombies(): Promise<void> {
  sweepCount++;
  const now = Date.now();
  let orphans = 0;
  let pruned = 0;

  for (const [pid, agent] of lifecycleMap) {
    // Skip if no PID (shouldn't happen but defensive)
    if (!pid) continue;

    // Check liveness
    if (agent.status === 'running') {
      const alive = await isPidAlive(pid);
      if (!alive) {
        agent.status = 'orphaned';
        agent.lastOutputAt = now;
        orphans++;
        // Sync to processRegistry for cross-system visibility
        updateProcessStatus(pid, 'orphaned', null).catch(() => {});
      }
    }

    // Prune if terminal and older than TTL
    if (agent.status !== 'running') {
      const age = now - agent.lastOutputAt;
      if (age > DEFAULT_TTL_MS) {
        if (agent.sessionId) sessionIndex.delete(agent.sessionId);
        // Best-effort cleanup in processRegistry too
        unregisterProcess(pid).catch(() => {});
        lifecycleMap.delete(pid);
        pruned++;
      }
    }
  }

  if (orphans > 0 || pruned > 0) {
    // Optional debug logging — silent in normal operation
  }
}

/**
 * Start the background sweeper. Idempotent — calling multiple times is a no-op.
 */
export function startZombieSweeper(): void {
  if (sweepTimer) return;
  // Run once immediately, then on interval
  sweepZombies().catch(() => {});
  sweepTimer = setInterval(() => {
    sweepZombies().catch(() => {});
  }, SWEEP_INTERVAL_MS);
}

export function stopZombieSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
}

export function getSweepStats(): { sweepCount: number; mapSize: number } {
  return { sweepCount, mapSize: lifecycleMap.size };
}

// ─── Lifecycle API ─────────────────────────────────────────────────────────────

/**
 * Register a new running agent. Call once per spawn.
 *
 * ZOMBIE GUARD: refuses to register if the PID is already dead.
 * This prevents stale "running" entries from accumulating.
 */
export function registerLiveAgent(agent: {
  pid: number;
  runner: string;
  agentName: string;
  sessionId: string;
  abortController?: AbortController;
  cleanupFn: () => Promise<void>;
  childRef: ChildProcess | null;
}): void {
  // ZOMBIE GUARD: evict any stale entry for the same agentName that is still 'running'
  for (const [pid, a] of lifecycleMap) {
    if (a.agentName === agent.agentName && a.status === 'running') {
      a.status = 'orphaned';
      lifecycleMap.delete(pid);
    }
  }

  const live: LiveAgent = {
    ...agent,
    status: 'running',
    outputBuffer: '',
    exitCode: null,
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
  };

  lifecycleMap.set(agent.pid, live);
  if (agent.sessionId) sessionIndex.set(agent.sessionId, agent.pid);

  // Ensure the sweeper is running
  startZombieSweeper();
}

/**
 * Append a text chunk to the agent's ring buffer. O(1).
 */
export function appendLiveOutput(pid: number, chunk: string): void {
  const agent = lifecycleMap.get(pid);
  if (!agent) return;
  agent.outputBuffer = appendToRing(agent.outputBuffer, chunk);
  agent.lastOutputAt = Date.now();
}

/**
 * Update sessionId after the runner resolves it from the JSON response.
 */
export function linkLiveSession(pid: number, sessionId: string): void {
  const agent = lifecycleMap.get(pid);
  if (!agent) return;
  agent.sessionId = sessionId;
  sessionIndex.set(sessionId, pid);
}

/**
 * Transition an agent to a terminal state.
 * Resolves any pending wait() via AbortController.abort().
 * SYNC: also updates processRegistry for cross-system visibility.
 */
export function setLiveStatus(
  pid: number,
  status: LifecycleStatus,
  exitCode: number | null = null,
): void {
  const agent = lifecycleMap.get(pid);
  if (!agent) return;
  agent.status = status;
  agent.exitCode = exitCode;
  agent.lastOutputAt = Date.now();
  if (status !== 'running' && agent.abortController) {
    agent.abortController.abort();
  }

  // Cross-system sync: write terminal status to processRegistry
  const registryStatus =
    status === 'running'
      ? 'running'
      : status === 'orphaned'
        ? 'orphaned'
        : exitCode === 0
          ? 'done'
          : 'failed';
  updateProcessStatus(pid, registryStatus, exitCode).catch(() => {});
}

/**
 * Unregister and remove from map. Called after 'exit' event in the runner.
 */
export function unregisterLiveAgent(pid: number): void {
  const agent = lifecycleMap.get(pid);
  if (agent) {
    if (agent.sessionId) sessionIndex.delete(agent.sessionId);
    lifecycleMap.delete(pid);
    // Sync removal to processRegistry
    unregisterProcess(pid).catch(() => {});
  }
}

/**
 * Get a live agent by agentName (+ optionally by runner).
 */
export function getLiveAgent(agentName: string, runner?: string): LiveAgent | undefined {
  for (const agent of lifecycleMap.values()) {
    if (agent.agentName === agentName && (runner === undefined || agent.runner === runner)) {
      return agent;
    }
  }
  return undefined;
}

/**
 * Get a live agent by PID.
 */
export function getLiveAgentByPid(pid: number): LiveAgent | undefined {
  return lifecycleMap.get(pid);
}

/**
 * All currently running agents.
 */
export function getRunningAgents(): LiveAgent[] {
  return [...lifecycleMap.values()].filter((a) => a.status === 'running');
}

/**
 * Agent counts.
 */
export function getAgentCount(): { running: number; total: number } {
  let running = 0;
  for (const a of lifecycleMap.values()) {
    if (a.status === 'running') running++;
  }
  return { running, total: lifecycleMap.size };
}

/**
 * Attach an AbortController to a running agent (for wait() resolution).
 */
export function setLiveAbortController(pid: number, ac: AbortController): void {
  const agent = lifecycleMap.get(pid);
  if (agent) agent.abortController = ac;
}

/**
 * Drain all agents — called on SIGTERM/SIGINT.
 * Best-effort cleanup of all running processes.
 */
export async function drainAllAgents(): Promise<void> {
  stopZombieSweeper();
  for (const agent of lifecycleMap.values()) {
    if (agent.status === 'running') {
      try {
        await agent.cleanupFn();
      } catch {
        /* best-effort */
      }
    }
  }
}
