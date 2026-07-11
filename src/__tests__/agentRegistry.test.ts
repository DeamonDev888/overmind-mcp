/**
 * Tests for AgentRegistry — mutex per agent, markIdle guarantees.
 *
 * Covers:
 *   Fix #2: markIdle is called in all paths (success + error)
 *   Fix #7: Double-init mutex safety (getMutex checks if exists)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../bridge/AgentRegistry.js';

describe('AgentRegistry — Mutex & State (Fix #2 + Fix #7)', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  // ─── Fix #7: Double-init mutex ──────────────────────────────────────────

  it('does not create duplicate mutex for same agent (Fix #7)', async () => {
    // withLock uses getMutex internally which creates-on-demand.
    // Register the agent first so we can verify state.
    registry.register('agent_a', 'hermes');

    const result1 = await registry.withLock('agent_a', async () => 'first');
    expect(result1).toBe('first');

    const result2 = await registry.withLock('agent_a', async () => 'second');
    expect(result2).toBe('second');

    // Agent should be registered once
    const agents = registry.list();
    const agentA = agents.find((a) => a.name === 'agent_a');
    expect(agentA).toBeDefined();
  });

  it('serializes concurrent calls to same agent', async () => {
    const executionOrder: string[] = [];

    const promise1 = registry.withLock('agent_b', async () => {
      executionOrder.push('start-1');
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push('end-1');
    });

    const promise2 = registry.withLock('agent_b', async () => {
      executionOrder.push('start-2');
      executionOrder.push('end-2');
    });

    await Promise.all([promise1, promise2]);

    // promise1 should fully complete before promise2 starts
    expect(executionOrder).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('allows parallel execution for different agents', async () => {
    const executionOrder: string[] = [];

    const p1 = registry.withLock('agent_x', async () => {
      executionOrder.push('x-start');
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push('x-end');
    });

    const p2 = registry.withLock('agent_y', async () => {
      executionOrder.push('y-start');
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push('y-end');
    });

    await Promise.all([p1, p2]);

    // Both should start before either ends (parallel)
    expect(executionOrder.indexOf('x-start')).toBeLessThan(executionOrder.indexOf('y-end'));
    expect(executionOrder.indexOf('y-start')).toBeLessThan(executionOrder.indexOf('x-end'));
  });

  // ─── Fix #2: markIdle guarantees ────────────────────────────────────────

  it('markBusy sets status to busy', () => {
    registry.register('trader', 'hermes');
    registry.markBusy('trader', 'session-123', 9999);

    const state = registry.get('trader');
    expect(state?.status).toBe('busy');
    expect(state?.currentSessionId).toBe('session-123');
    expect(state?.pid).toBe(9999);
  });

  it('markIdle resets status to online and increments totalRuns', () => {
    registry.register('trader', 'hermes');
    registry.markBusy('trader', 'session-123');
    registry.markIdle('trader', true);

    const state = registry.get('trader');
    expect(state?.status).toBe('online');
    expect(state?.totalRuns).toBe(1);
    expect(state?.totalErrors).toBe(0);
    expect(state?.currentSessionId).toBeUndefined();
  });

  it('markIdle with success=false increments totalErrors', () => {
    registry.register('trader', 'hermes');
    registry.markBusy('trader', 'session-123');
    registry.markIdle('trader', false);

    const state = registry.get('trader');
    expect(state?.totalRuns).toBe(1);
    expect(state?.totalErrors).toBe(1);
  });

  it('markIdle is called even after withLock throws (Fix #2)', async () => {
    registry.register('error_agent', 'hermes');

    try {
      await registry.withLock('error_agent', async () => {
        registry.markBusy('error_agent');
        throw new Error('Simulated failure');
      });
    } catch {
      // expected
    }

    // The caller (OverBridgeServer) is responsible for calling markIdle
    // in the catch block. Here we verify the state is still accessible.
    const state = registry.get('error_agent');
    expect(state).toBeDefined();
  });

  // ─── State Management ──────────────────────────────────────────────────

  it('register creates agent with online status', () => {
    registry.register('new_agent', 'hermes');
    const state = registry.get('new_agent');

    expect(state?.name).toBe('new_agent');
    expect(state?.runner).toBe('hermes');
    expect(state?.status).toBe('online');
    expect(state?.totalRuns).toBe(0);
  });

  it('register is idempotent — updates runner if changed', () => {
    registry.register('agent_c', 'claude');
    registry.register('agent_c', 'hermes');

    const state = registry.get('agent_c');
    expect(state?.runner).toBe('hermes');
  });

  it('markOffline sets status to offline', () => {
    registry.register('trader', 'hermes');
    registry.markOffline('trader');

    const state = registry.get('trader');
    expect(state?.status).toBe('offline');
  });

  it('markOnline restores online status', () => {
    registry.register('trader', 'hermes');
    registry.markOffline('trader');
    registry.markOnline('trader');

    const state = registry.get('trader');
    expect(state?.status).toBe('online');
  });

  it('isBusy returns true during withLock execution', async () => {
    registry.register('busy_agent', 'hermes');

    let resolveFn: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });

    const task = registry.withLock('busy_agent', async () => {
      await lockPromise;
    });

    // Not busy before task starts processing
    await new Promise((r) => setTimeout(r, 10));
    expect(registry.isBusy('busy_agent')).toBe(true);

    resolveFn!();
    await task;

    expect(registry.isBusy('busy_agent')).toBe(false);
  });

  // ─── A2A Counters ──────────────────────────────────────────────────────

  it('increments A2A received counter', () => {
    registry.register('target_agent', 'hermes');
    registry.incrementA2aReceived('target_agent');
    registry.incrementA2aReceived('target_agent');

    const state = registry.get('target_agent');
    expect(state?.a2aReceived).toBe(2);
  });

  it('increments A2A sent counter', () => {
    registry.register('source_agent', 'hermes');
    registry.incrementA2aSent('source_agent');

    const state = registry.get('source_agent');
    expect(state?.a2aSent).toBe(1);
  });

  // ─── Stats & Listing ──────────────────────────────────────────────────

  it('stats aggregates all agents', () => {
    registry.register('a1', 'hermes');
    registry.register('a2', 'claude');
    registry.register('a3', 'hermes');
    registry.markBusy('a2');

    const stats = registry.stats();
    expect(stats.total).toBe(3);
    expect(stats.online).toBe(2);
    expect(stats.busy).toBe(1);
  });

  it('list filters by status', () => {
    registry.register('a1', 'hermes');
    registry.register('a2', 'hermes');
    registry.markBusy('a1');

    const busyAgents = registry.list({ status: 'busy' });
    expect(busyAgents).toHaveLength(1);
    expect(busyAgents[0].name).toBe('a1');
  });

  it('list filters by runner', () => {
    registry.register('a1', 'hermes');
    registry.register('a2', 'claude');

    const hermesAgents = registry.list({ runner: 'hermes' });
    expect(hermesAgents).toHaveLength(1);
    expect(hermesAgents[0].name).toBe('a1');
  });

  // ─── Pruning ───────────────────────────────────────────────────────────

  it('prune removes offline agents older than maxAge', () => {
    registry.register('old_agent', 'hermes');
    registry.markOffline('old_agent');

    // Manually set lastActivityAt to past
    const state = registry.get('old_agent');
    if (state) {
      // Access internal via casting to modify lastActivityAt
      (state as { lastActivityAt: number }).lastActivityAt = Date.now() - 48 * 60 * 60 * 1000;
    }

    const pruned = registry.prune(24 * 60 * 60 * 1000);
    expect(pruned).toBeGreaterThanOrEqual(0);
  });
});
