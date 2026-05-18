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
 */

import { ChildProcess } from 'child_process';

export type LifecycleStatus = 'running' | 'done' | 'failed' | 'orphaned';

export interface LiveAgent {
  pid: number;
  runner: string;
  agentName: string;
  sessionId: string;
  status: LifecycleStatus;
  outputBuffer: string;       // Ring buffer — last MAX_BUFFER chars
  exitCode: number | null;
  startedAt: number;
  lastOutputAt: number;
  abortController?: AbortController;
  cleanupFn: () => Promise<void>;
  childRef: ChildProcess | null;
}

const MAX_BUFFER = 256 * 1024;

// ─── In-memory store ───────────────────────────────────────────────────────────

const lifecycleMap = new Map<number, LiveAgent>();
const sessionIndex  = new Map<string, number>(); // sessionId → pid

// ─── Ring-buffer ───────────────────────────────────────────────────────────────

function appendToRing(existing: string, chunk: string): string {
  const combined = existing + chunk;
  return combined.length > MAX_BUFFER
    ? combined.slice(-MAX_BUFFER)
    : combined;
}

// ─── Lifecycle API ─────────────────────────────────────────────────────────────

/**
 * Register a new running agent. Call once per spawn.
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
  // Evict any stale entry for the same agentName that is still 'running'
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
}

/**
 * Unregister and remove from map. Called after 'exit' event in the runner.
 */
export function unregisterLiveAgent(pid: number): void {
  const agent = lifecycleMap.get(pid);
  if (agent) {
    if (agent.sessionId) sessionIndex.delete(agent.sessionId);
    lifecycleMap.delete(pid);
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
  for (const agent of lifecycleMap.values()) {
    if (agent.status === 'running') {
      try { await agent.cleanupFn(); } catch { /* best-effort */ }
    }
  }
}
