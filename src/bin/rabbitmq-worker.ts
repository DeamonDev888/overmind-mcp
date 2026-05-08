import { getBroker } from '../lib/broker/rabbitmq.js';
import type { TaskMessage, TaskResult } from '../lib/broker/rabbitmq.js';
import { runAgent } from '../tools/run_agent.js';

let shuttingDown = false;

async function main() {
  const broker = getBroker();
  if (!broker) {
    console.error('RabbitMQ broker not available (set OVERMIND_BROKER=rabbitmq)');
    process.exit(1);
  }

  await broker.connect();
  console.log('[worker] Connected to RabbitMQ, consuming from overmind.tasks');

  await broker.consumeTasks(async (taskMsg: TaskMessage, ack, nack) => {
    if (shuttingDown) return nack();

    console.log(`[worker] Received task ${taskMsg.taskId} (corr: ${taskMsg.correlationId})`);

    try {
      const result = await runAgent({
        runner: taskMsg.runner as Parameters<typeof runAgent>[0]['runner'],
        prompt: taskMsg.prompt,
        agentName: taskMsg.agentName,
        model: taskMsg.model,
        path: taskMsg.path,
        autoResume: false,
        silent: false,
      });

      const taskResult: TaskResult = {
        taskId: taskMsg.taskId,
        correlationId: taskMsg.correlationId,
        success: !result.isError,
        result: result.content,
        error: result.isError ? String(result.content) : undefined,
      };

      await broker.publishResult(taskResult);
      console.log(`[worker] Published result for ${taskMsg.taskId}`);
      ack();
    } catch (err) {
      const taskResult: TaskResult = {
        taskId: taskMsg.taskId,
        correlationId: taskMsg.correlationId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
      await broker.publishResult(taskResult);
      nack();
    }
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[worker] Received ${signal}, shutting down gracefully...`);
    shuttingDown = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await broker.close();
    console.log('[worker] Connection closed, exiting');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
