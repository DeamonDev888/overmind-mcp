/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A2A Hub — Outil MCP pour la communication Agent-to-Agent
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architecture distribuée — chaque bridge est un serveur HTTP indépendant:
 *
 *   a2a_hub parle DIRECTEMENT aux bridges HTTP:
 *     POST :31XX/rpc  → JSON-RPC 2.0 agent.run (NEXUS bridges)
 *     POST :30XX/send → legacy message synchrone (discord_llm bridge)
 *     GET  :XXXX/health → status live
 *
 * Découverte automatique:
 *   1. Scan ports 3101-3120 (NEXUS bridges) + 3001-3020 (legacy workers)
 *   2. Scan ~/.overmind/hermes/profiles/ (Linux) + ~/AppData/Local/hermes/profiles/ (Windows)
 *   3. Cross-reference: profile ↔ bridge port
 *   4. Lit Nexus/tmp/bridge_pids.json si présent
 *
 * PROD FIXES (2026-07-10):
 *   - fetch() async au lieu de execSync('curl') — ne bloque plus l'event loop
 *   - Vrai parallélisme pour fanout/broadcast (Promise.all)
 *   - Support dual: POST /rpc (JSON-RPC) + POST /send (legacy)
 *   - Port scan: 3101-3120 (NEXUS) + 3001-3020 (legacy)
 *   - Profils Hermes: ~/.overmind/hermes/ + ~/AppData/Local/hermes/
 *   - 127.0.0.1 au lieu de localhost (IPv4/IPv6 fix)
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

// ─── Types ─────────────────────────────────────────────────────────────────

interface BridgeInfo {
  port: number;
  url: string;
  online: boolean;
  agentName: string;
  health?: Record<string, unknown>;
  /** true if bridge supports POST /rpc (JSON-RPC 2.0), false for legacy /send */
  hasRpc: boolean;
}

interface AgentInfo {
  name: string;
  model: string;
  provider: string;
  status: 'online' | 'offline' | 'unknown';
  bridgePort: number | null;
  bridgeUrl: string | null;
  description: string;
  skillsCount: number;
  hasMemory: boolean;
  lastActivity: string | null;
}

interface Discovery {
  totalAgents: number;
  onlineBridges: number;
  agents: AgentInfo[];
  bridges: BridgeInfo[];
  selfAgent: string | null;
}

// ─── HTTP Helpers (async fetch — non-blocking) ─────────────────────────────

async function httpGet(url: string, timeoutMs = 5000): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const text = await response.text();
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function httpPost(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = 300000,
): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const text = await response.text();
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Bridge Discovery ──────────────────────────────────────────────────────

/** Get candidate Hermes profile directories (Windows + Linux) */
function getProfileDirs(): string[] {
  const dirs: string[] = [];
  const home = os.homedir();

  // Linux/Ubuntu: ~/.overmind/hermes/profiles/
  const overmindHermes = path.join(home, '.overmind', 'hermes', 'profiles');
  if (fs.existsSync(overmindHermes)) dirs.push(overmindHermes);

  // Windows: ~/AppData/Local/hermes/profiles/
  const winHermes = path.join(home, 'AppData', 'Local', 'hermes', 'profiles');
  if (fs.existsSync(winHermes)) dirs.push(winHermes);

  // Linux native: ~/.hermes/profiles/
  const nativeHermes = path.join(home, '.hermes', 'profiles');
  if (fs.existsSync(nativeHermes)) dirs.push(nativeHermes);

  return dirs;
}

/** Get known bridge ports from pid files */
function getKnownPorts(): Array<{ port: number; agentName: string }> {
  const known: Array<{ port: number; agentName: string }> = [];
  const home = os.homedir();

  // 1. NEXUS pid file: Nexus/tmp/bridge_pids.json
  const nexusPidPath = path.join(home, 'Nexus', 'tmp', 'bridge_pids.json');
  if (fs.existsSync(nexusPidPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(nexusPidPath, 'utf8'));
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry.port && entry.name) {
            known.push({ port: entry.port, agentName: entry.name });
          }
        }
      } else if (data.workers && Array.isArray(data.workers)) {
        for (const w of data.workers) {
          if (w.port) known.push({ port: w.port, agentName: w.agentName || '' });
        }
      }
    } catch { /* ignore */ }
  }

  // 2. Legacy workers.json: ~/.overmind/bridge/workers.json
  const workersJsonPath = path.join(home, '.overmind', 'bridge', 'workers.json');
  if (fs.existsSync(workersJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(workersJsonPath, 'utf8'));
      if (Array.isArray(data.workers)) {
        for (const w of data.workers) {
          if (w.port) known.push({ port: w.port, agentName: w.agentName || '' });
        }
      }
    } catch { /* ignore */ }
  }

  return known;
}

/** Probe a single port for bridge health */
async function probeBridge(port: number, agentName: string): Promise<BridgeInfo> {
  const url = `http://127.0.0.1:${port}`;
  const health = await httpGet(`${url}/health`, 3000);

  if (health) {
    const detectedAgent =
      agentName ||
      (health.agent as string) ||
      (health.agentName as string) ||
      (health.service as string) ||
      'unknown';
    // NEXUS bridges expose rpcMethods[] in health — they support POST /rpc
    const hasRpc = Array.isArray(health.rpcMethods) || 'jsonrpc' in health;
    return { port, url, online: true, agentName: detectedAgent, health, hasRpc };
  }

  return { port, url, online: false, agentName: agentName || '', hasRpc: false };
}

/** Discover all bridges (scan ports + pid files) */
async function discoverBridges(): Promise<BridgeInfo[]> {
  const knownPorts = getKnownPorts();

  // Build port list: known ports + scan ranges
  const portSet = new Set<number>();
  const portAgentMap = new Map<number, string>();

  // Add known ports from pid files
  for (const { port, agentName } of knownPorts) {
    portSet.add(port);
    if (agentName) portAgentMap.set(port, agentName);
  }

  // NEXUS range: 3101-3120
  for (let p = 3101; p <= 3120; p++) portSet.add(p);

  // Legacy range: 3001-3020
  for (let p = 3001; p <= 3020; p++) portSet.add(p);

  // Probe all ports in parallel (true parallel — async fetch)
  const ports = Array.from(portSet).sort((a, b) => a - b);
  const results = await Promise.all(
    ports.map((port) => probeBridge(port, portAgentMap.get(port) || '')),
  );

  return results;
}

// ─── Agent Discovery ───────────────────────────────────────────────────────

async function discoverAgents(): Promise<Discovery> {
  const selfAgent = process.env.OVERMIND_AGENT_NAME || null;
  const agents: AgentInfo[] = [];
  const bridges = await discoverBridges();

  // Build bridge lookup: agentName → bridge
  const bridgeByAgent = new Map<string, BridgeInfo>();
  for (const b of bridges) {
    if (b.online && b.agentName && b.agentName !== 'unknown') {
      bridgeByAgent.set(b.agentName, b);
    }
  }

  // Scan all profile directories
  for (const profilesDir of getProfileDirs()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(profilesDir, { withFileTypes: true });
    } catch { continue; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profilePath = path.join(profilesDir, entry.name);

      // Avoid duplicates (same profile name in different dirs)
      if (agents.some((a) => a.name === entry.name)) continue;

      // Read config.yaml
      const configPath = path.join(profilePath, 'config.yaml');
      let model = 'unknown';
      let provider = 'unknown';
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const modelMatch = configContent.match(/^\s*model:\s*(?!provider)(.+)/m);
        const providerMatch = configContent.match(/^\s*provider:\s*(.+)/m);
        if (modelMatch) model = modelMatch[1].trim().replace(/['"]/g, '');
        if (providerMatch) provider = providerMatch[1].trim().replace(/['"]/g, '');
      }

      // Read profile.yaml for description
      const profileYamlPath = path.join(profilePath, 'profile.yaml');
      let description = '';
      if (fs.existsSync(profileYamlPath)) {
        const py = fs.readFileSync(profileYamlPath, 'utf8');
        const descMatch = py.match(/description:\s*"?([^"\n]+)"?/);
        if (descMatch) description = descMatch[1].trim();
      }

      // Count skills
      let skillsCount = 0;
      const skillsDir = path.join(profilePath, 'skills');
      if (fs.existsSync(skillsDir)) {
        try {
          const walk = (dir: string): number => {
            let count = 0;
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
              if (f.isDirectory()) count += walk(path.join(dir, f.name));
              else if (f.name === 'SKILL.md') count++;
            }
            return count;
          };
          skillsCount = walk(skillsDir);
        } catch { /* ignore */ }
      }

      // Check memory (state.db or MEMORY.md)
      const hasMemory =
        fs.existsSync(path.join(profilePath, 'memories', 'state.db')) ||
        fs.existsSync(path.join(profilePath, 'memories', 'MEMORY.md'));

      // Last activity
      let lastActivity: string | null = null;
      const stateDb = path.join(profilePath, 'memories', 'state.db');
      if (fs.existsSync(stateDb)) {
        try { lastActivity = fs.statSync(stateDb).mtime.toISOString(); } catch { /* ignore */ }
      }

      // Cross-reference with bridges
      const bridge = bridgeByAgent.get(entry.name);

      agents.push({
        name: entry.name,
        model,
        provider,
        status: bridge ? 'online' : 'offline',
        bridgePort: bridge?.port ?? null,
        bridgeUrl: bridge?.url ?? null,
        description,
        skillsCount,
        hasMemory,
        lastActivity,
      });
    }
  }

  return {
    totalAgents: agents.length,
    onlineBridges: bridges.filter((b) => b.online).length,
    agents,
    bridges,
    selfAgent,
  };
}

// ─── Send message to a bridge (supports /rpc + /send) ──────────────────────

async function sendToBridge(
  bridge: BridgeInfo,
  message: string,
  opts: { model?: string; timeoutMs?: number } = {},
): Promise<{ success: boolean; text: string; raw: Record<string, unknown> | null }> {
  const selfAgent = process.env.OVERMIND_AGENT_NAME || 'A2A Hub';
  const enrichedMessage = `[A2A — Message from ${selfAgent}]\n${message}`;
  const timeout = opts.timeoutMs ?? 300000;

  // Strategy 1: NEXUS bridge with POST /rpc (JSON-RPC 2.0)
  if (bridge.hasRpc) {
    const rpcBody = {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'agent.run',
      params: {
        agentName: bridge.agentName,
        runner: 'hermes',
        prompt: enrichedMessage,
        ...(opts.model ? { model: opts.model } : {}),
      },
    };
    const response = await httpPost(`${bridge.url}/rpc`, rpcBody, timeout);

    if (response === null) {
      return { success: false, text: `Bridge :${bridge.port} injoignable`, raw: null };
    }
    if (response.error) {
      return { success: false, text: `Erreur :${bridge.port}: ${(response.error as { message?: string }).message || JSON.stringify(response.error)}`, raw: response };
    }

    // Extract text from JSON-RPC result
    const result = response.result as Record<string, unknown> | undefined;
    if (result) {
      const content = result.content as Array<{ text?: string }> | undefined;
      const text = content
        ? content.map((c) => c.text || '').join('\n')
        : (result.output as string) || (result.text as string) || JSON.stringify(result);
      return { success: true, text, raw: response };
    }

    return { success: true, text: JSON.stringify(response), raw: response };
  }

  // Strategy 2: Legacy bridge with POST /send
  const sendBody: Record<string, unknown> = {
    message: enrichedMessage,
    userId: `a2a_${selfAgent}`,
    username: selfAgent,
    channelId: 'a2a',
  };
  if (opts.model) sendBody.model = opts.model;

  const response = await httpPost(`${bridge.url}/send`, sendBody, timeout);

  if (response === null) {
    return { success: false, text: `Bridge :${bridge.port} injoignable`, raw: null };
  }
  if (response.error) {
    return { success: false, text: `Erreur :${bridge.port}: ${response.error}`, raw: response };
  }

  const text =
    (response.result as string) ||
    (response.response as string) ||
    (response.output as string) ||
    (Array.isArray(response.content)
      ? (response.content as Array<{ text?: string }>).map((c) => c.text || '').join('\n')
      : '') ||
    JSON.stringify(response);

  return { success: true, text, raw: response };
}

// ─── Schema ────────────────────────────────────────────────────────────────

export const a2aHubSchema = z.object({
  action: z
    .enum(['discover', 'status', 'send', 'delegate', 'pipeline', 'fanout', 'query', 'broadcast'])
    .describe(
      "Action: discover=liste tous les agents+bridges, status=état d'un bridge, send=message synchrone, delegate=async, pipeline=chaîne A→B→C, fanout=1→N+merge, query=multi-agents, broadcast=global",
    ),

  target: z
    .string()
    .optional()
    .describe("Nom de l'agent cible (ex: 'nexus_master') OU port du bridge (ex: '3101')"),

  message: z.string().optional().describe('Le message/prompt à envoyer aux agents'),

  targets: z
    .array(z.string())
    .optional()
    .describe('Liste des agents cibles (noms ou ports) pour fanout/query/broadcast'),

  steps: z
    .array(
      z.object({
        agentName: z
          .string()
          .describe("Nom de l'agent ou port (ex: 'nexus_master' ou '3101')"),
        promptPrefix: z.string().optional(),
      }),
    )
    .optional()
    .describe('Étapes de la pipeline (pour action=pipeline)'),

  mergeStrategy: z
    .enum(['concat', 'best', 'vote', 'first_success'])
    .optional()
    .default('concat')
    .describe('Stratégie de merge pour fanout (default: concat)'),

  race: z
    .boolean()
    .optional()
    .default(false)
    .describe('Pour broadcast: si true, premier qui répond gagne'),

  async: z
    .boolean()
    .optional()
    .default(true)
    .describe('Pour delegate: si true (default), retourne immédiatement'),

  accumulateContext: z
    .boolean()
    .optional()
    .default(false)
    .describe('Pour pipeline: chaque step reçoit tous les outputs précédents'),

  timeoutMs: z
    .number()
    .int()
    .min(5000)
    .max(600000)
    .optional()
    .describe('Timeout par agent en ms (default: 300000 = 5min)'),

  model: z.string().optional().describe('Modèle LLM override'),
});

// ─── Resolve agent name to bridge ──────────────────────────────────────────

function resolveTarget(
  target: string,
  discovery: Discovery,
): { bridge: BridgeInfo | null; agentName: string } {
  // If target is a port number
  const portMatch = target.match(/^(\d{4,5})$/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    const bridge = discovery.bridges.find((b) => b.port === port);
    return { bridge: bridge ?? null, agentName: bridge?.agentName || target };
  }

  // If target is an agent name, find its bridge
  const agent = discovery.agents.find((a) => a.name === target);
  if (agent?.bridgePort) {
    const bridge = discovery.bridges.find((b) => b.port === agent.bridgePort);
    if (bridge) return { bridge, agentName: target };
  }

  // Try online bridges by agentName
  const bridge = discovery.bridges.find((b) => b.online && b.agentName === target);
  if (bridge) return { bridge, agentName: target };

  return { bridge: null, agentName: target };
}

// ─── Execute ───────────────────────────────────────────────────────────────

export async function a2aHub(args: z.infer<typeof a2aHubSchema>) {
  const selfAgent = process.env.OVERMIND_AGENT_NAME || 'unknown';
  const timeout = args.timeoutMs ?? 300000;

  try {
    switch (args.action) {
      // ═══════════════════════════════════════════════════════════════════════
      // DISCOVER
      // ═══════════════════════════════════════════════════════════════════════
      case 'discover': {
        const d = await discoverAgents();

        const lines: string[] = [
          `🌐 **A2A Hub — Découverte du système multi-agents**`,
          ``,
          `**Self:** ${d.selfAgent || '(inconnu)'}`,
          `**Bridges online:** ${d.onlineBridges}`,
          `**Total agents:** ${d.totalAgents}`,
          ``,
          `### Bridges HTTP`,
          ``,
        ];

        const onlineBridges = d.bridges.filter((b) => b.online);
        if (onlineBridges.length === 0) {
          lines.push('Aucun bridge HTTP en ligne.');
        } else {
          lines.push('| Port | Agent | Type | URL |');
          lines.push('|------|-------|------|-----|');
          for (const b of onlineBridges) {
            const type = b.hasRpc ? 'RPC' : 'Legacy';
            lines.push(`| :${b.port} | ${b.agentName} | ${type} | ${b.url} |`);
          }
        }

        lines.push('');
        lines.push('### Agents');
        lines.push('');

        if (d.agents.length === 0) {
          lines.push('Aucun agent trouvé.');
        } else {
          lines.push('| Agent | Status | Bridge | Model | Provider | Skills | Description |');
          lines.push('|-------|--------|--------|-------|----------|--------|-------------|');
          for (const a of d.agents) {
            const statusIcon = a.status === 'online' ? '🟢' : '🔴';
            const bridgeInfo = a.bridgePort ? `:${a.bridgePort}` : '—';
            const nameDisplay = a.name === selfAgent ? `**${a.name} (self)**` : a.name;
            lines.push(
              `| ${nameDisplay} | ${statusIcon} ${a.status} | ${bridgeInfo} | ${a.model} | ${a.provider} | ${a.skillsCount} | ${a.description.slice(0, 40)} |`,
            );
          }
        }

        lines.push('');
        lines.push('**Actions disponibles:** send, delegate, pipeline, fanout, query, broadcast');

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // STATUS
      // ═══════════════════════════════════════════════════════════════════════
      case 'status': {
        if (!args.target) {
          return {
            content: [{ type: 'text' as const, text: '❌ `target` requis (nom ou port)' }],
            isError: true,
          };
        }

        const d = await discoverAgents();
        const { bridge, agentName } = resolveTarget(args.target, d);

        if (!bridge || !bridge.online) {
          return {
            content: [{ type: 'text' as const, text: `❌ Bridge pour "${args.target}" introuvable` }],
            isError: true,
          };
        }

        const lines: string[] = [`📊 **Status: ${agentName} (:${bridge.port})**`, ``];
        for (const [key, value] of Object.entries(bridge.health ?? {})) {
          lines.push(
            `**${key}:** ${typeof value === 'object' ? JSON.stringify(value).slice(0, 100) : value}`,
          );
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // SEND
      // ═══════════════════════════════════════════════════════════════════════
      case 'send': {
        if (!args.target || !args.message) {
          return {
            content: [{ type: 'text' as const, text: '❌ `target` et `message` requis' }],
            isError: true,
          };
        }

        const d = await discoverAgents();
        const { bridge, agentName } = resolveTarget(args.target, d);

        if (!bridge || !bridge.online) {
          return {
            content: [{ type: 'text' as const, text: `❌ Bridge pour "${args.target}" introuvable. Utilisez action=discover.` }],
            isError: true,
          };
        }

        const result = await sendToBridge(bridge, args.message, {
          model: args.model,
          timeoutMs: timeout,
        });

        if (!result.success) {
          return {
            content: [{ type: 'text' as const, text: `❌ ${result.text}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text' as const, text: `📤 **Message envoyé à ${agentName} (:${bridge.port})**\n\n${result.text}` }],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // DELEGATE (async — fire and forget)
      // ═══════════════════════════════════════════════════════════════════════
      case 'delegate': {
        if (!args.target || !args.message) {
          return {
            content: [{ type: 'text' as const, text: '❌ `target` et `message` requis' }],
            isError: true,
          };
        }

        const d = await discoverAgents();
        const { bridge, agentName } = resolveTarget(args.target, d);

        if (!bridge || !bridge.online) {
          return {
            content: [{ type: 'text' as const, text: `❌ Bridge pour "${args.target}" introuvable` }],
            isError: true,
          };
        }

        // Fire and forget — don't await
        void sendToBridge(bridge, args.message, { model: args.model, timeoutMs: timeout })
          .catch(() => {});

        return {
          content: [{
            type: 'text' as const,
            text: `🤝 **Tâche déléguée à ${agentName} (:${bridge.port})**\n\nLe bridge traite la requête en arrière-plan.`,
          }],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // PIPELINE
      // ═══════════════════════════════════════════════════════════════════════
      case 'pipeline': {
        if (!args.message || !args.steps || args.steps.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '❌ `message` (prompt initial) et `steps` requis' }],
            isError: true,
          };
        }

        const d = await discoverAgents();
        const outputs: Array<{ agent: string; output: string; success: boolean }> = [];
        let currentPrompt = args.message;

        for (let i = 0; i < args.steps.length; i++) {
          const step = args.steps[i];
          const { bridge, agentName } = resolveTarget(step.agentName, d);

          if (!bridge || !bridge.online) {
            outputs.push({ agent: step.agentName, output: 'Bridge introuvable', success: false });
            break;
          }

          const stepPrompt =
            (step.promptPrefix ? step.promptPrefix + '\n\n' : '') +
            `[Pipeline Step ${i + 1}/${args.steps.length}]\n${currentPrompt}`;

          const result = await sendToBridge(bridge, stepPrompt, { timeoutMs: timeout });

          outputs.push({
            agent: `${agentName} (:${bridge.port})`,
            output: result.text,
            success: result.success,
          });

          if (!result.success) break;

          currentPrompt = args.accumulateContext
            ? outputs.map((o) => `[${o.agent}]: ${o.output}`).join('\n\n---\n\n')
            : result.text;
        }

        const lines: string[] = [`🔗 **Pipeline** (${outputs.length}/${args.steps.length} steps)`, ``];
        for (const o of outputs) {
          lines.push(`**${o.success ? '✅' : '❌'} ${o.agent}:**`);
          lines.push(o.output.slice(0, 800) + (o.output.length > 800 ? '...' : ''));
          lines.push('');
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // FANOUT (true parallel — Promise.all)
      // ═══════════════════════════════════════════════════════════════════════
      case 'fanout': {
        if (!args.message || !args.targets || args.targets.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '❌ `message` et `targets` requis' }],
            isError: true,
          };
        }

        const d = await discoverAgents();

        // Run ALL targets in parallel (true parallel — async fetch)
        const results = await Promise.all(
          args.targets.map(async (target) => {
            const { bridge, agentName } = resolveTarget(target, d);
            if (!bridge || !bridge.online) {
              return { agent: target, success: false, text: 'Bridge introuvable' };
            }
            const r = await sendToBridge(bridge, args.message!, {
              model: args.model,
              timeoutMs: timeout,
            });
            return { agent: `${agentName} (:${bridge.port})`, success: r.success, text: r.text };
          }),
        );

        // Merge
        let merged: string;
        let winner: string | undefined;

        switch (args.mergeStrategy) {
          case 'first_success': {
            const first = results.find((r) => r.success);
            merged = first ? first.text : 'Tous ont échoué';
            winner = first?.agent;
            break;
          }
          case 'best': {
            const sorted = results
              .filter((r) => r.success)
              .sort((a, b) => b.text.length - a.text.length);
            merged = sorted.length > 0 ? sorted[0].text : 'Tous ont échoué';
            winner = sorted[0]?.agent;
            break;
          }
          case 'concat':
          default: {
            merged = results
              .map((r) => `### ${r.agent}${r.success ? '' : ' (ÉCHEC)'}\n${r.text}`)
              .join('\n\n---\n\n');
            break;
          }
        }

        const successCount = results.filter((r) => r.success).length;
        const lines: string[] = [
          `🌐 **Fanout** (${successCount}/${results.length} succès, merge=${args.mergeStrategy})`,
          ...(winner ? [`**Gagnant:** ${winner}`] : []),
          ``,
          merged.slice(0, 3000),
        ];

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // QUERY (parallel, short timeout)
      // ═══════════════════════════════════════════════════════════════════════
      case 'query': {
        if (!args.message || !args.targets || args.targets.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '❌ `message` et `targets` requis' }],
            isError: true,
          };
        }

        const d = await discoverAgents();
        const queryTimeout = Math.min(timeout, 60000);

        const results = await Promise.all(
          args.targets.map(async (target) => {
            const { bridge, agentName } = resolveTarget(target, d);
            if (!bridge || !bridge.online) {
              return { agent: target, success: false, text: 'Bridge introuvable' };
            }
            const r = await sendToBridge(bridge, args.message!, {
              model: args.model,
              timeoutMs: queryTimeout,
            });
            return { agent: `${agentName} (:${bridge.port})`, success: r.success, text: r.text };
          }),
        );

        const lines: string[] = [
          `❓ **Query** (${results.filter((r) => r.success).length}/${results.length} réponses)`,
          ``,
        ];

        for (const r of results) {
          lines.push(`**${r.success ? '✅' : '❌'} ${r.agent}:**`);
          lines.push(r.text.slice(0, 500) + (r.text.length > 500 ? '...' : ''));
          lines.push('');
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // BROADCAST
      // ═══════════════════════════════════════════════════════════════════════
      case 'broadcast': {
        if (!args.message) {
          return {
            content: [{ type: 'text' as const, text: '❌ `message` requis' }],
            isError: true,
          };
        }

        const d = await discoverAgents();

        let targetBridges: BridgeInfo[];
        if (args.targets && args.targets.length > 0) {
          targetBridges = args.targets
            .map((t) => resolveTarget(t, d).bridge)
            .filter((b): b is BridgeInfo => b !== null && b.online);
        } else {
          targetBridges = d.bridges.filter((b) => b.online);
        }

        if (targetBridges.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '❌ Aucun bridge online pour broadcast' }],
            isError: true,
          };
        }

        if (args.race) {
          // First to respond wins — use Promise.any
          try {
            const firstResult = await Promise.any(
              targetBridges.map(async (b) => {
                const r = await sendToBridge(b, args.message!, { model: args.model, timeoutMs: timeout });
                if (!r.success) throw new Error(r.text);
                return { bridge: b, text: r.text };
              }),
            );
            return {
              content: [{
                type: 'text' as const,
                text: `📡 **Broadcast race — ${firstResult.bridge.agentName} (:${firstResult.bridge.port}) a gagné!**\n\n${firstResult.text}`,
              }],
            };
          } catch {
            return {
              content: [{ type: 'text' as const, text: '❌ Tous les bridges ont échoué' }],
              isError: true,
            };
          }
        }

        // Send to all in parallel
        const results = await Promise.all(
          targetBridges.map(async (b) => {
            const r = await sendToBridge(b, args.message!, { model: args.model, timeoutMs: timeout });
            return { agent: `${b.agentName} (:${b.port})`, success: r.success, text: r.text };
          }),
        );

        const successCount = results.filter((r) => r.success).length;
        const lines: string[] = [`📡 **Broadcast** — ${successCount}/${results.length} succès`, ``];

        for (const r of results) {
          lines.push(`**${r.success ? '✅' : '❌'} ${r.agent}:**`);
          lines.push(r.text.slice(0, 300) + (r.text.length > 300 ? '...' : ''));
          lines.push('');
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      default:
        return {
          content: [{ type: 'text' as const, text: `❌ Action inconnue: ${args.action}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: `❌ Erreur A2A Hub: ${error instanceof Error ? error.message : String(error)}`,
      }],
      isError: true,
    };
  }
}