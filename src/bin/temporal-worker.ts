import { Worker } from '@temporalio/worker';
import * as activities from '../lib/workflow/temporal/activities.js';

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve('../lib/workflow/temporal/workflows.js'),
    activities,
    taskQueue: 'overmind-agents',
  });

  console.log('Temporal worker started on taskQueue: overmind-agents');
  await worker.run();
}

run().catch((err) => {
  console.error('Temporal worker failed:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('Shutting down Temporal worker...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down Temporal worker...');
  process.exit(0);
});
