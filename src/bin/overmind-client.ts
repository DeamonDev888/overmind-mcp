/**
 * overmind-client.ts — Native Node.js client for Overmind HTTP MCP
 * ═══════════════════════════════════════════════════════════════════
 *
 * Import this module to programmatically control agents.
 * No MCP library needed — raw HTTP + JSON-RPC 2.0.
 *
 * Usage:
 *   npm run build && node dist/overmind-client.js
 *
 * Or import in your TypeScript:
 *   import { OvermindClient } from './overmind-client.js';
 */

const DEFAULT_BASE = 'http://localhost:3099/mcp';
const DEFAULT_AUTH = process.env.OVERMIND_AUTH || 'changeme';
const HEALTH_URL = 'http://localhost:3099/health';

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function jsonrpc(id: number, method: string, params: Record<string, unknown> = {}): object {
  return { jsonrpc: '2.0', id, method, params };
}

async function callMcp(
  url: string,
  auth: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${auth}`,
    },
    body: JSON.stringify(jsonrpc(Date.now(), method, params)),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  // SSE stream — read all chunks
  const text = await res.text();
  // Parse SSE: each line is "data: {json}"
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data: ')) {
      const data = JSON.parse(trimmed.slice(6));
      if (data.result) return { result: data.result };
      if (data.error) return { error: data.error as { code: number; message: string } };
    }
  }
  throw new Error('No result in SSE response');
}

// ─── Runner type ─────────────────────────────────────────────────────────────

export type RunnerType =
  'claude' | 'gemini' | 'kilo' | 'qwencli' | 'openclaw' | 'cline' | 'opencode' | 'hermes';

// ─── Agent result ────────────────────────────────────────────────────────────

export interface AgentRunResult {
  agentName: string;
  runner: RunnerType;
  output: string;
  sessionId?: string;
  error?: string;
  durationMs?: number;
}

// ─── OvermindClient ───────────────────────────────────────────────────────────

export class OvermindClient {
  private url: string;
  private auth: string;
  private id = 0;
  private nextId(): number {
    return ++this.id;
  }

  constructor(opts: { url?: string; auth?: string } = {}) {
    this.url = opts.url ?? DEFAULT_BASE;
    this.auth = opts.auth ?? DEFAULT_AUTH;
  }

  // ─── Health ──────────────────────────────────────────────────────────────

  async health(): Promise<boolean> {
    try {
      const res = await fetch(HEALTH_URL, {
        headers: { Authorization: `Bearer ${this.auth}` },
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── Agent CRUD ──────────────────────────────────────────────────────────

  /** Create a new agent definition (stored in registry) */
  async createAgent(opts: {
    name: string;
    runner: RunnerType;
    prompt: string;
  }): Promise<{ name: string; runner: RunnerType }> {
    const res = await callMcp(this.url, this.auth, 'tools/call', {
      name: 'create_agent',
      arguments: opts,
    });
    if ('error' in res) throw new Error(`create_agent failed: ${res.error?.message}`);
    return { name: opts.name, runner: opts.runner };
  }

  /** List all registered agents */
  async listAgents(): Promise<string[]> {
    const res = await callMcp(this.url, this.auth, 'tools/call', {
      name: 'list_agents',
      arguments: {},
    });
    if ('error' in res) throw new Error(`list_agents failed: ${res.error?.message}`);
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
    // Parse the markdown list
    return text
      .split('\n')
      .filter((l) => l.trim().startsWith('- '))
      .map((l) => l.trim().slice(2));
  }

  /** Delete an agent from the registry */
  async deleteAgent(name: string): Promise<void> {
    const res = await callMcp(this.url, this.auth, 'tools/call', {
      name: 'delete_agent',
      arguments: { agentName: name },
    });
    if ('error' in res) throw new Error(`delete_agent failed: ${res.error?.message}`);
  }

  // ─── Run agents ─────────────────────────────────────────────────────────

  /**
   * Run a single agent and wait for its output.
   * Timeout is per-agent, not global.
   */
  async runAgent(opts: {
    agentName: string;
    prompt: string;
    timeoutMs?: number;
  }): Promise<AgentRunResult> {
    const start = Date.now();
    const res = await callMcp(
      this.url,
      this.auth,
      'tools/call',
      {
        name: 'run_agent',
        arguments: {
          agentName: opts.agentName,
          prompt: opts.prompt,
          timeoutMs: opts.timeoutMs ?? 90_000,
        },
      },
      opts.timeoutMs ?? 120_000,
    );

    if ('error' in res) {
      return {
        agentName: opts.agentName,
        runner: 'claude',
        output: '',
        error: res.error?.message,
        durationMs: Date.now() - start,
      };
    }

    const result = res.result as { content?: Array<{ text: string }>; sessionId?: string };
    return {
      agentName: opts.agentName,
      runner: 'claude',
      output: result.content?.[0]?.text ?? '',
      sessionId: result.sessionId,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Run multiple agents in parallel. Returns results in the same order.
   */
  async runPool(
    agents: Array<{
      name: string;
      runner: RunnerType;
      prompt: string;
      timeoutMs?: number;
    }>,
  ): Promise<AgentRunResult[]> {
    return Promise.all(
      agents.map((a) =>
        this.runAgent({ agentName: a.name, prompt: a.prompt, timeoutMs: a.timeoutMs }),
      ),
    );
  }

  // ─── Lifecycle control ──────────────────────────────────────────────────

  /** Get status of a running agent (reads from RAM, no disk I/O) */
  async agentStatus(agentName: string, runner?: RunnerType): Promise<string> {
    const res = await callMcp(this.url, this.auth, 'tools/call', {
      name: 'agent_control',
      arguments: { agentName, runner, action: 'status' },
    });
    if ('error' in res) return `Error: ${res.error?.message}`;
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
    return text;
  }

  /** Stream output from a running agent (non-blocking) */
  async agentStream(
    agentName: string,
    runner?: RunnerType,
  ): Promise<{ output: string; isComplete: boolean }> {
    const res = await callMcp(this.url, this.auth, 'tools/call', {
      name: 'agent_control',
      arguments: { agentName, runner, action: 'stream' },
    });
    if ('error' in res) return { output: `Error: ${res.error?.message}`, isComplete: true };
    const text = (res.result as { content: Array<{ text: string }> }).content[0].text;
    const isComplete = text.includes('isComplete: true') || text.includes('**isComplete:** true');
    return { output: text, isComplete };
  }

  /** Wait for an agent to finish (blocking, polls every 1s) */
  async agentWait(agentName: string, timeoutMs = 900_000, runner?: RunnerType): Promise<string> {
    const res = await callMcp(
      this.url,
      this.auth,
      'tools/call',
      {
        name: 'agent_control',
        arguments: { agentName, runner, action: 'wait', timeoutMs },
      },
      timeoutMs + 10_000,
    );
    if ('error' in res) return `Error: ${res.error?.message}`;
    return (res.result as { content: Array<{ text: string }> }).content[0].text;
  }

  /** Kill a running agent */
  async agentKill(agentName: string, runner?: RunnerType): Promise<string> {
    const res = await callMcp(this.url, this.auth, 'tools/call', {
      name: 'agent_control',
      arguments: { agentName, runner, action: 'kill' },
    });
    if ('error' in res) return `Error: ${res.error?.message}`;
    return (res.result as { content: Array<{ text: string }> }).content[0].text;
  }
}

// ─── CLI demo ────────────────────────────────────────────────────────────────

async function demo() {
  const client = new OvermindClient();

  console.log('\n═══ Overmind Client Demo ═══\n');

  // Health
  const ok = await client.health();
  console.log(`[health] ${ok ? '✓' : '✗'} Overmind MCP server`);

  // List agents
  const agents = await client.listAgents();
  console.log(`[list_agents] ${agents.length} agents registered`);

  // Demo: create + run a probe agent
  const TEST_AGENT = 'client_demo_probe';

  try {
    await client.createAgent({
      name: TEST_AGENT,
      runner: 'claude',
      prompt: 'Réponds exactement: PONG',
    });
    console.log(`[create_agent] ${TEST_AGENT} créé`);

    const result = await client.runAgent({
      agentName: TEST_AGENT,
      prompt: 'PING',
      timeoutMs: 30_000,
    });

    console.log(`[run_agent] ✓ (${result.durationMs}ms)`);
    console.log(`  Output: ${result.output.slice(0, 120).trim()}`);

    await client.deleteAgent(TEST_AGENT);
    console.log(`[delete_agent] ${TEST_AGENT} supprimé`);
  } catch (e) {
    console.error('[demo] Erreur:', e);
  }
}

// Run demo if executed directly
demo().catch(console.error);

// Export for use as module
export { OvermindClient as default };
