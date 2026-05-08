import { randomUUID } from 'crypto';
import { getBroker } from './rabbitmq.js';
import type { TaskResult } from './rabbitmq.js';

export interface DispatchOptions {
  waitAll?: boolean;
  timeoutMs?: number;
}

interface AgentTask {
  runner: string;
  prompt: string;
  agentName?: string;
  model?: string;
  path?: string;
  taskId?: string;
  [key: string]: unknown;
}

export interface TaskDispatchResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export async function dispatchViaRabbitMQ(
  agents: AgentTask[],
  opts: DispatchOptions = {},
): Promise<TaskDispatchResult[]> {
  const { waitAll = true, timeoutMs = 15 * 60 * 1000 } = opts;
  const broker = getBroker();

  if (!broker) {
    throw new Error('RabbitMQ broker not available (set OVERMIND_BROKER=rabbitmq)');
  }

  await broker.connect();

  const tasks: Array<{
    correlationId: string;
    agent: AgentTask;
    label: string;
    startTime: number;
  }> = agents.map((agent) => ({
    correlationId: randomUUID(),
    agent,
    label: agent.taskId || agent.agentName || agent.runner,
    startTime: Date.now(),
  }));

  // Publish all task messages
  await Promise.all(
    tasks.map((t) =>
      broker.publishTask({
        taskId: t.label,
        runner: t.agent.runner,
        prompt: t.agent.prompt,
        agentName: t.agent.agentName,
        model: t.agent.model,
        path: t.agent.path,
        correlationId: t.correlationId,
      }),
    ),
  );

  const results: Map<string, TaskDispatchResult> = new Map();
  let consumeDone = false;

  const consumePromise = new Promise<void>((resolve) => {
    broker.consumeResults((result: TaskResult) => {
      const entry = tasks.find((t) => t.correlationId === result.correlationId);
      if (!entry) return;

      const durationMs = Date.now() - entry.startTime;
      results.set(result.correlationId, {
        taskId: result.taskId,
        success: result.success,
        result: result.result,
        error: result.error,
        durationMs,
      });

      if (!waitAll && results.size === 1) {
        consumeDone = true;
        resolve();
      } else if (results.size === tasks.length) {
        resolve();
      }
    });
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      if (!consumeDone) {
        reject(new Error(`RabbitMQ dispatch timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
  });

  try {
    await Promise.race([consumePromise, timeoutPromise]);
  } finally {
    await broker.close();
  }

  // Return in original order
  return tasks.map((t) => {
    const r = results.get(t.correlationId);
    if (!r) {
      return {
        taskId: t.label,
        success: false,
        error: 'No result received',
        durationMs: Date.now() - t.startTime,
      };
    }
    return r;
  });
}
