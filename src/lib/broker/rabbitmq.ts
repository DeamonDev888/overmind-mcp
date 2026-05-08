import amqp from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';

export interface TaskMessage {
  taskId: string;
  runner: string;
  prompt: string;
  agentName?: string;
  model?: string;
  path?: string;
  correlationId: string;
}

export interface TaskResult {
  taskId: string;
  correlationId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

const TASKS_QUEUE = 'overmind.tasks';
const RESULTS_QUEUE = 'overmind.results';

export class RabbitMQBroker {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  async connect(): Promise<void> {
    const url = process.env.RABBITMQ_URL || 'amqp://localhost';
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertQueue(TASKS_QUEUE, { durable: true });
    await this.channel.assertQueue(RESULTS_QUEUE, { durable: true });
  }

  async publishTask(msg: TaskMessage): Promise<void> {
    if (!this.channel) throw new Error('Not connected');
    this.channel.sendToQueue(TASKS_QUEUE, Buffer.from(JSON.stringify(msg)), {
      persistent: true,
    });
  }

  async consumeResults(handler: (r: TaskResult) => void): Promise<void> {
    if (!this.channel) throw new Error('Not connected');
    const ch = this.channel;
    await ch.consume(RESULTS_QUEUE, (msg) => {
      if (msg) {
        const result: TaskResult = JSON.parse(msg.content.toString());
        handler(result);
        ch.ack(msg);
      }
    });
  }

  async consumeTasks(
    handler: (msg: TaskMessage, ack: () => void, nack: () => void) => Promise<void>,
  ): Promise<void> {
    if (!this.channel) throw new Error('Not connected');
    await this.channel.consume(
      TASKS_QUEUE,
      async (msg) => {
        if (!msg) return;
        const taskMsg: TaskMessage = JSON.parse(msg.content.toString());
        await handler(
          taskMsg,
          () => this.channel!.ack(msg),
          () => this.channel!.nack(msg),
        );
      },
      { noAck: false },
    );
  }

  async publishResult(result: TaskResult): Promise<void> {
    if (!this.channel) throw new Error('Not connected');
    this.channel.sendToQueue(RESULTS_QUEUE, Buffer.from(JSON.stringify(result)), {
      persistent: true,
    });
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = null;
    this.connection = null;
  }
}

let brokerInstance: RabbitMQBroker | null = null;

export function getBroker(): RabbitMQBroker | null {
  if (process.env.OVERMIND_BROKER === 'rabbitmq') {
    if (!brokerInstance) {
      brokerInstance = new RabbitMQBroker();
    }
    return brokerInstance;
  }
  return null;
}
