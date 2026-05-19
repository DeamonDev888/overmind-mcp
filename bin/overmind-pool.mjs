/**
 * overmind-pool.mjs — Lightweight Node.js client for Overmind HTTP MCP
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Pure ESM — no compile step needed. Requires Node 18+.
 *
 * CLI usage:
 *   node overmind-pool.mjs --status
 *   node overmind-pool.mjs --agents
 *   node overmind-pool.mjs --pool
 *   node overmind-pool.mjs --run <name> <runner> <prompt>
 *   node overmind-pool.mjs --create <name> <runner> <prompt>
 *   node overmind-pool.mjs --kill <name>
 *
 * As module:
 *   import { OvermindPool } from './overmind-pool.mjs';
 */

const BASE   = 'http://localhost:3099/mcp';
const HEALTH = 'http://localhost:3099/health';
const AUTH   = process.env.OVERMIND_AUTH || 'changeme';

// ─── HTTP ──────────────────────────────────────────────────────────────────────

async function mcpCall(method, params = {}, timeoutMs = 90_000) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${AUTH}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('data: ')) {
      const d = JSON.parse(t.slice(6));
      if (d.result) return d.result;
      if (d.error)  throw new Error(d.error.message);
    }
  }
  throw new Error('No result in SSE response');
}

async function mcpTool(name, args = {}, timeoutMs = 90_000) {
  return mcpCall('tools/call', { name, arguments: args }, timeoutMs);
}

// ─── OvermindPool ─────────────────────────────────────────────────────────────

export class OvermindPool {
  /** Check if MCP server is alive */
  async health() {
    try {
      const r = await fetch(HEALTH, {
        headers: { 'Authorization': `Bearer ${AUTH}` },
        signal: AbortSignal.timeout(3000),
      });
      return r.ok;
    } catch { return false; }
  }

  /** List all registered agent names */
  async listAgents() {
    const r = await mcpTool('list_agents');
    const text = r.content?.[0]?.text ?? '';
    return text.split('\n').filter(l => l.trim().startsWith('- ')).map(l => l.trim().slice(2));
  }

  /** Create an agent definition in the registry */
  async createAgent({ name, runner = 'claude', prompt }) {
    return mcpTool('create_agent', { name, runner, prompt });
  }

  /** Delete an agent from the registry */
  async deleteAgent(name) {
    return mcpTool('delete_agent', { agentName: name });
  }

  /**
   * Ensure agents exist (create missing ones).
   * Returns names of agents that were created.
   */
  async ensureAgents(agents) {
    const existing = await this.listAgents();
    const created = [];
    for (const a of agents) {
      if (!existing.includes(a.agentName)) {
        await this.createAgent({ name: a.agentName, runner: a.runner, prompt: a.prompt });
        created.push(a.agentName);
        await new Promise(r => setTimeout(r, 300));
      }
    }
    return created;
  }

  /**
   * Run a single agent. runner is REQUIRED.
   * Valid runners: claude | gemini | kilo | qwencli | openclaw | cline | opencode | hermes
   */
  async runAgent({ agentName, runner, prompt, timeoutMs = 90_000 }) {
    if (!runner) throw new Error('runner is required (claude|gemini|kilo|qwencli|openclaw|cline|opencode|hermes)');
    const t0 = Date.now();
    const args = { runner, agentName, prompt, timeoutMs };
    const r = await mcpTool('run_agent', args, timeoutMs + 15_000);
    return {
      agentName,
      output:     r.content?.[0]?.text ?? '',
      sessionId:  r.sessionId,
      durationMs: Date.now() - t0,
    };
  }

  /** Run N agents in parallel; errors are captured in the result object */
  async runPool(agents) {
    const settled = await Promise.allSettled(
      agents.map(a => this.runAgent(a))
    );
    return settled.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { agentName: agents[i].agentName, output: `Error: ${r.reason?.message ?? String(r.reason)}`, durationMs: 0 }
    );
  }

  /** Lifecycle: status of an agent */
  async status(agentName, runner) {
    const r = await mcpTool('agent_control', { agentName, runner, action: 'status' });
    return r.content?.[0]?.text ?? '';
  }

  /** Lifecycle: non-blocking output stream */
  async stream(agentName, runner) {
    const r = await mcpTool('agent_control', { agentName, runner, action: 'stream' });
    const text = r.content?.[0]?.text ?? '';
    return { text, isComplete: text.includes('**isComplete:** true') };
  }

  /** Lifecycle: block until agent finishes */
  async wait(agentName, timeoutMs = 900_000, runner) {
    const r = await mcpTool('agent_control', { agentName, runner, action: 'wait', timeoutMs }, timeoutMs + 10_000);
    return r.content?.[0]?.text ?? '';
  }

  /** Lifecycle: force-kill a running agent */
  async kill(agentName, runner) {
    const r = await mcpTool('agent_control', { agentName, runner, action: 'kill' });
    return r.content?.[0]?.text ?? '';
  }
}

// ─── Demo pool ────────────────────────────────────────────────────────────────

export const DEMO_POOL = [
  { agentName: 'pool_dev',      runner: 'claude',  prompt: 'Réponds en 1 phrase: quelle est la couleur du ciel ?' },
  { agentName: 'pool_archi',    runner: 'kilo',    prompt: "Décris l'architecture microservices en 2 points." },
  { agentName: 'pool_probe',    runner: 'gemini',  prompt: 'Réponds exactement: PONG' },
  { agentName: 'pool_guard',    runner: 'hermes',  prompt: "Rapporte l'état du système en 1 phrase." },
  { agentName: 'pool_sentinel', runner: 'hermes',  prompt: 'Liste 2 métriques serveur importantes.' },
];

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function cli() {
  const pool = new OvermindPool();
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    const ok = await pool.health();
    console.log(ok ? '✓ Overmind MCP online' : '✗ Overmind MCP offline');
    process.exit(ok ? 0 : 1);
  }

  if (args.includes('--agents')) {
    const list = await pool.listAgents();
    console.log(`\n${list.length} agents:\n`);
    list.forEach(a => console.log(' ', a));
    process.exit(0);
  }

  if (args.includes('--pool')) {
    console.log('\n═══ Overmind Pool Demo ═══\n');
    const ok = await pool.health();
    console.log(`[health] ${ok ? '✓' : '✗'} MCP server\n`);
    if (!ok) { console.error('MCP offline'); process.exit(1); }

    const existing = await pool.listAgents();
    const toCreate = DEMO_POOL.filter(a => !existing.includes(a.agentName));
    if (toCreate.length) {
      const created = await pool.ensureAgents(toCreate);
      console.log(`[created] ${created.join(', ')}\n`);
    }

    console.log('[run] Lancement parallèle...\n');
    const results = await pool.runPool(DEMO_POOL);

    for (const r of results) {
      const raw = r.output.trim();
      // Gemini returns structured JSON, Hermes often returns empty
      const isGeminiJson = raw.startsWith('{') && raw.includes('"response"');
      const isHermesEmpty = raw === '' || raw === '{"result":null}' || raw === '{}';
      const isRealError = !isGeminiJson && !isHermesEmpty && raw.includes('Error');
      const hasContent = raw.length > 0 && !isHermesEmpty;
      console.log(`${isRealError ? '✗' : hasContent ? '✓' : '·'} [${r.agentName}] (${r.durationMs}ms): ${raw.slice(0, 100).trim() || '(empty)'}`);
    }
    process.exit(0);
  }

  if (args.includes('--run')) {
    const idx = args.indexOf('--run');
    const name    = args[idx + 1];
    const runner  = args[idx + 2];
    const prompt  = args[idx + 3] ?? 'PING';
    if (!name || !runner) { console.error('Usage: --run <name> <runner> <prompt>'); process.exit(1); }
    const r = await pool.runAgent({ agentName: name, runner, prompt, timeoutMs: 60_000 });
    console.log(`[${name}] (${r.durationMs}ms): ${r.output.slice(0, 200).trim()}`);
    process.exit(0);
  }

  if (args.includes('--create')) {
    const idx    = args.indexOf('--create');
    const name   = args[idx + 1];
    const runner = args[idx + 2] ?? 'claude';
    const prompt = args[idx + 3] ?? 'Tu es un agent de test.';
    if (!name) { console.error('Usage: --create <name> <runner> <prompt>'); process.exit(1); }
    await pool.createAgent({ name, runner, prompt });
    console.log(`✓ Agent '${name}' créé (runner: ${runner})`);
    process.exit(0);
  }

  if (args.includes('--kill')) {
    const idx = args.indexOf('--kill');
    const name = args[idx + 1];
    if (!name) { console.error('Usage: --kill <agentName>'); process.exit(1); }
    console.log(await pool.kill(name));
    process.exit(0);
  }

  // Default: info
  console.log(`OvermindPool — ${BASE}`);
  console.log('Usage: --status | --agents | --pool | --run <name> <runner> <prompt> | --create <name> <runner> <prompt> | --kill <name>');
}

cli().catch(e => { console.error(e.message); process.exit(1); });
