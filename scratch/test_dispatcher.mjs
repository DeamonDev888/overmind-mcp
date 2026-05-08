process.env.OVERMIND_BROKER = '';
process.env.OVERMIND_WORKFLOW = '';
const { dispatchAgents } = await import('../dist/lib/orchestration/dispatcher.js');

console.log('=== TEST 1 — Default routing (local) ===');
const t0 = Date.now();
const r1 = await dispatchAgents(
  [
    {
      taskId: 'smoke',
      runner: 'claude',
      agentName: 'noexist_agent',
      prompt: 'x',
      autoResume: false,
      silent: true,
    },
  ],
  { waitAll: true },
);
console.log('  duration:', Date.now() - t0, 'ms');
console.log('  result keys:', Object.keys(r1).slice(0, 10));
console.log('  preview:', JSON.stringify(r1).slice(0, 250));

console.log('\n=== TEST 2 — OVERMIND_BROKER=rabbitmq (no infra) → fallback ===');
process.env.OVERMIND_BROKER = 'rabbitmq';
const t1 = Date.now();
const r2 = await dispatchAgents(
  [
    {
      taskId: 'smoke',
      runner: 'claude',
      agentName: 'noexist_agent',
      prompt: 'x',
      autoResume: false,
      silent: true,
    },
  ],
  { waitAll: true },
);
console.log('  duration:', Date.now() - t1, 'ms');
console.log('  preview:', JSON.stringify(r2).slice(0, 250));

console.log('\n=== TEST 3 — OVERMIND_WORKFLOW=temporal (no infra) → fallback ===');
process.env.OVERMIND_BROKER = '';
process.env.OVERMIND_WORKFLOW = 'temporal';
const t2 = Date.now();
const r3 = await dispatchAgents(
  [
    {
      taskId: 'smoke',
      runner: 'claude',
      agentName: 'noexist_agent',
      prompt: 'x',
      autoResume: false,
      silent: true,
    },
  ],
  { waitAll: true },
);
console.log('  duration:', Date.now() - t2, 'ms');
console.log('  preview:', JSON.stringify(r3).slice(0, 250));

console.log('\n=== ALL DONE ===');
process.exit(0);
