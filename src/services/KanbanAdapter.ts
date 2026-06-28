/**
 * KanbanAdapter — Thin wrapper around `hermes kanban` CLI.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  PURPOSE (v3.0 — Refactored)                                             ║
 * ║                                                                          ║
 * ║  Replaces the old swarm.ts (368 lines) and the parallel orchestration    ║
 * ║  in dispatcher.ts with native Hermes Kanban tasks.                       ║
 * ║                                                                          ║
 * ║  Kanban = durable SQLite-backed task board shared across all Hermes      ║
 * ║  profiles. The dispatcher loop (60s default) atomically claims ready     ║
 * ║  tasks and spawns the assigned profile as its own OS process.            ║
 * ║                                                                          ║
 * ║  YOLO CONFIG (no human-in-the-loop):                                     ║
 * ║    - autoReclaim on crash/timeout                                        ║
 * ║    - maxRetries: 5 (vs default 2) before block                           ║
 * ║    - autoUnblock via admin API (no manual human intervention)            ║
 * ║    - dispatcherTick: 30s (vs default 60s — faster pickup)               ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { rootLogger } from '../lib/logger.js';

const execAsync = promisify(exec);
const logger = rootLogger.child({ module: 'KanbanAdapter' });

// ─── YOLO Config ──────────────────────────────────────────────────────────────

export const YOLO_CONFIG = {
  autoReclaim: true,
  maxRetries: 5,
  autoUnblock: true,
  reclaimStaleMs: 900000, // 15min
  dispatcherTickSeconds: 30,
  goalModeMaxTurns: 20,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateTaskOptions {
  title: string;
  assignee: string;
  body?: string;
  tenant?: string;
  parents?: string[];
  priority?: number;
  workspace?: 'scratch' | `dir:${string}` | 'worktree';
  idempotencyKey?: string;
  maxRuntime?: string; // e.g. "90s", "30m", "2h"
  goalMode?: boolean;
  goalMaxTurns?: number;
  skills?: string[];
}

export interface TaskStatus {
  id: string;
  title: string;
  assignee: string;
  status: string; // triage | todo | ready | running | blocked | done | archived
  body?: string;
  tenant?: string;
  workspace?: string;
}

export interface TaskResult {
  id: string;
  status: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}

export interface TaskSummary {
  id: string;
  title: string;
  assignee: string;
  status: string;
  tenant?: string;
}

// ─── Helper: run hermes kanban CLI ────────────────────────────────────────────

async function runKanban(args: string[], opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string }> {
  const timeout = opts?.timeout ?? 30000;
  const cmd = `hermes kanban ${args.join(' ')}`;
  try {
    const result = await execAsync(cmd, { timeout, maxBuffer: 5 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (e) {
    const err = e as Error & { stdout?: string; stderr?: string };
    logger.error({ cmd, error: err.message, stdout: err.stdout?.slice(0, 500), stderr: err.stderr?.slice(0, 500) }, '[KANBAN] CLI command failed.');
    throw new Error(`Kanban CLI failed: ${err.message}`);
  }
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class KanbanAdapter {
  private board?: string;

  constructor(board?: string) {
    this.board = board;
  }

  private get boardArgs(): string[] {
    return this.board ? ['--board', this.board] : [];
  }

  /**
   * Initialize the kanban board (idempotent).
   */
  async init(): Promise<void> {
    await runKanban([...this.boardArgs, 'init']);
    logger.info({ board: this.board }, '[INIT] Kanban board initialized.');
  }

  /**
   * Force a dispatcher tick immediately (don't wait for the 60s loop).
   */
  async nudge(): Promise<void> {
    try {
      await runKanban([...this.boardArgs, 'dispatch'], { timeout: 10000 });
    } catch (e) {
      logger.warn({ error: e }, '[NUDGE] Dispatcher tick failed — will retry on next interval.');
    }
  }

  /**
   * Create a single task.
   */
  async createTask(opts: CreateTaskOptions): Promise<{ taskId: string }> {
    const args: string[] = [...this.boardArgs, 'create'];

    // Title (positional)
    args.push(`"${opts.title.replace(/"/g, '\\"')}"`);

    if (opts.assignee) args.push('--assignee', opts.assignee);
    if (opts.body) args.push('--body', `"${opts.body.replace(/"/g, '\\"')}"`);
    if (opts.tenant) args.push('--tenant', opts.tenant);
    if (opts.priority !== undefined) args.push('--priority', String(opts.priority));
    if (opts.workspace) args.push('--workspace', opts.workspace);
    if (opts.idempotencyKey) args.push('--idempotency-key', opts.idempotencyKey);
    if (opts.maxRuntime) args.push('--max-runtime', opts.maxRuntime);
    if (opts.goalMode) {
      args.push('--goal');
      args.push('--goal-max-turns', String(opts.goalMaxTurns || YOLO_CONFIG.goalModeMaxTurns));
    }
    if (opts.skills) {
      for (const skill of opts.skills) {
        args.push('--skill', skill);
      }
    }
    if (opts.parents && opts.parents.length > 0) {
      for (const p of opts.parents) {
        args.push('--parent', p);
      }
    }

    // YOLO: set high retry limit
    args.push('--max-retries', String(YOLO_CONFIG.maxRetries));

    args.push('--json');

    const { stdout } = await runKanban(args);
    const parsed = JSON.parse(stdout.trim());
    const taskId = parsed.id || parsed.task_id || '';

    if (!taskId) {
      throw new Error(`Kanban create did not return a task ID. Output: ${stdout.slice(0, 200)}`);
    }

    logger.info({ taskId, title: opts.title, assignee: opts.assignee }, '[CREATE] Task created.');

    // Nudge dispatcher immediately for faster pickup
    void this.nudge();

    return { taskId };
  }

  /**
   * Create multiple independent tasks in parallel (fan-out).
   */
  async createParallelTasks(tasks: CreateTaskOptions[]): Promise<string[]> {
    const results = await Promise.all(
      tasks.map(t => this.createTask(t))
    );
    return results.map(r => r.taskId);
  }

  /**
   * Create a pipeline (sequential chain: task[0] → task[1] → task[2]...).
   * Each task has the previous one as parent.
   */
  async createPipeline(tasks: CreateTaskOptions[]): Promise<string[]> {
    const taskIds: string[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const taskOpts = { ...tasks[i] };
      if (i > 0 && taskIds[i - 1]) {
        taskOpts.parents = [...(taskOpts.parents || []), taskIds[i - 1]];
      }
      const { taskId } = await this.createTask(taskOpts);
      taskIds.push(taskId);
    }

    return taskIds;
  }

  /**
   * Get the status of a task.
   */
  async getStatus(taskId: string): Promise<TaskStatus> {
    const { stdout } = await runKanban([...this.boardArgs, 'show', taskId, '--json']);
    const parsed = JSON.parse(stdout.trim());

    // Hermes wraps the task in a "task" key
    const t = parsed.task || parsed;

    return {
      id: t.id || taskId,
      title: t.title || '',
      assignee: t.assignee || '',
      status: t.status || 'unknown',
      body: t.body,
      tenant: t.tenant,
      workspace: t.workspace_kind || t.workspace,
    };
  }

  /**
   * Wait for a task to complete (polling loop).
   * YOLO: auto-reclaim on stale claims.
   */
  async wait(taskId: string, timeoutMs: number = 600000): Promise<TaskResult> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5s poll
    let lastReclaimTime = 0;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await this.getStatus(taskId);

        // ─── Terminal states ─────────────────────────────────────────────
        if (status.status === 'done') {
          const { stdout } = await runKanban([...this.boardArgs, 'show', taskId, '--json']);
          const parsed = JSON.parse(stdout.trim());
          const t = parsed.task || parsed;
          const runs = parsed.runs || t.runs || [];
          const lastRun = runs[runs.length - 1];

          return {
            id: taskId,
            status: 'done',
            summary: lastRun?.summary || '',
            metadata: lastRun?.metadata,
            durationMs: lastRun?.started_at && lastRun?.ended_at
              ? lastRun.ended_at - lastRun.started_at
              : undefined,
          };
        }

        if (status.status === 'archived') {
          return {
            id: taskId,
            status: 'archived',
            error: 'Task was archived',
          };
        }

        // ─── Blocked → YOLO auto-unblock ─────────────────────────────────
        if (status.status === 'blocked' && YOLO_CONFIG.autoUnblock) {
          logger.warn({ taskId }, '[WAIT] Task is blocked — YOLO auto-unblock.');
          try {
            await runKanban([...this.boardArgs, 'unblock', taskId]);
            logger.info({ taskId }, '[WAIT] Task auto-unblocked.');
          } catch (e) {
            logger.error({ taskId, error: e }, '[WAIT] Auto-unblock failed.');
          }
        }

        // ─── Running → check for stale claim ─────────────────────────────
        if (status.status === 'running' && YOLO_CONFIG.autoReclaim) {
          const now = Date.now();
          if (now - lastReclaimTime > YOLO_CONFIG.reclaimStaleMs) {
            // Check if the claim is stale (no heartbeat for 15min)
            const { stdout } = await runKanban([...this.boardArgs, 'show', taskId, '--json']);
            const parsed = JSON.parse(stdout.trim());
            const runs = parsed.runs || [];
            const activeRun = runs.find((r: { outcome: string }) => r.outcome === 'active');

            if (activeRun && activeRun.started_at) {
              const claimAge = now - activeRun.started_at * 1000;
              if (claimAge > YOLO_CONFIG.reclaimStaleMs) {
                logger.warn({ taskId, claimAgeMs: claimAge }, '[WAIT] Stale claim detected — auto-reclaim.');
                try {
                  await runKanban([...this.boardArgs, 'reclaim', taskId]);
                  logger.info({ taskId }, '[WAIT] Task reclaimed.');
                } catch (e) {
                  logger.error({ taskId, error: e }, '[WAIT] Auto-reclaim failed.');
                }
                lastReclaimTime = now;
              }
            }
          }
        }
      } catch (e) {
        logger.warn({ taskId, error: e }, '[WAIT] Status check failed — will retry.');
      }

      // Sleep before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout reached
    return {
      id: taskId,
      status: 'timeout',
      error: `Task did not complete within ${timeoutMs}ms`,
    };
  }

  /**
   * Reclaim a task (abort running worker, reset to ready).
   */
  async reclaim(taskId: string): Promise<void> {
    await runKanban([...this.boardArgs, 'reclaim', taskId]);
    logger.info({ taskId }, '[RECLAIM] Task reclaimed.');
  }

  /**
   * Unblock a blocked task.
   */
  async unblock(taskId: string): Promise<void> {
    await runKanban([...this.boardArgs, 'unblock', taskId]);
    logger.info({ taskId }, '[UNBLOCK] Task unblocked.');
  }

  /**
   * Archive a task.
   */
  async archive(taskId: string): Promise<void> {
    await runKanban([...this.boardArgs, 'archive', taskId]);
    logger.info({ taskId }, '[ARCHIVE] Task archived.');
  }

  /**
   * List tasks with optional filter.
   */
  async listTasks(filter?: {
    status?: string;
    assignee?: string;
    tenant?: string;
  }): Promise<TaskSummary[]> {
    const args: string[] = [...this.boardArgs, 'list', '--json'];

    const { stdout } = await runKanban(args);
    let tasks: TaskSummary[];

    try {
      const parsed = JSON.parse(stdout.trim());
      tasks = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
    } catch {
      // Fallback: parse text output
      logger.warn('[LIST] Failed to parse JSON output — returning empty list.');
      return [];
    }

    // Apply filters
    if (filter?.status) {
      tasks = tasks.filter(t => t.status === filter.status);
    }
    if (filter?.assignee) {
      tasks = tasks.filter(t => t.assignee === filter.assignee);
    }
    if (filter?.tenant) {
      tasks = tasks.filter(t => t.tenant === filter.tenant);
    }

    return tasks;
  }

  /**
   * Add a comment to a task (inter-agent protocol).
   */
  async comment(taskId: string, body: string): Promise<void> {
    const args = [...this.boardArgs, 'comment', taskId, '--body', `"${body.replace(/"/g, '\\"')}"`];
    await runKanban(args);
  }

  /**
   * Create a board for a specific project/workstream.
   */
  async createBoard(slug: string, name: string, opts?: { description?: string; switch?: boolean }): Promise<void> {
    const args = ['boards', 'create', slug, '--name', `"${name}"`];
    if (opts?.description) args.push('--description', `"${opts.description}"`);
    if (opts?.switch) args.push('--switch');
    await runKanban(args);
    logger.info({ slug, name }, '[CREATE_BOARD] Board created.');
  }
}
