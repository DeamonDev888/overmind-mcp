/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A2A Hub — Outil MCP pour la communication Agent-to-Agent
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architecture distribuee — chaque worker est un serveur HTTP independant:
 *
 *   discord-master (:discord) → routes !trade → TV Analyst :3002
 *                             → routes !sniper → Sniperbot :3001
 *
 *   a2a_hub parle DIRECTEMENT aux workers HTTP:
 *     POST :300X/send  → message synchrone
 *     GET  :300X/health → status live
 *
 * Decouverte automatique:
 *   1. Scan ports 3001-3020 (workers connus)
 *   2. Scan ~/.overmind/hermes/profiles/ (agents Hermes)
 *   3. Cross-reference: profile ↔ worker port
 *   4. Lit ~/.overmind/bridge/workers.json si present
 */

import { z } from 'zod';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Types ─────────────────────────────────────────────────────────────────

interface WorkerInfo {
  port: number;
  url: string;
  online: boolean;
  agentName: string;
  health?: Record<string, unknown>;
}

interface AgentInfo {
  name: string;
  model: string;
  provider: string;
  status: 'online' | 'offline' | 'unknown';
  workerPort: number | null;
  workerUrl: string | null;
  description: string;
  skillsCount: number;
  hasMemory: boolean;
  lastActivity: string | null;
}

interface Discovery {
  totalAgents: number;
  onlineWorkers: number;
  agents: AgentInfo[];
  workers: WorkerInfo[];
  selfAgent: string | null;
}

// ─── HTTP Helper (curl synchrone) ──────────────────────────────────────────

function httpGet(url: string, timeoutMs = 5000): Record<string, unknown> | null {
  try {
    const result = execSync(`curl -s -m ${Math.floor(timeoutMs / 1000)} "${url}" 2>/dev/null`, {
      encoding: 'utf8',
      timeout: timeoutMs + 1000,
    });
    return JSON.parse(result) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function httpPost(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = 300000,
): Record<string, unknown> | null {
  const payload = JSON.stringify(body);
  try {
    const escapedPayload = payload.replace(/'/g, "'\\''");
    const result = execSync(
      `curl -s -m ${Math.floor(timeoutMs / 1000)} -X POST "${url}" -H "Content-Type: application/json" -d '${escapedPayload}' 2>/dev/null`,
      { encoding: 'utf8', timeout: timeoutMs + 1000, maxBuffer: 50 * 1024 * 1024 },
    );
    return JSON.parse(result) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Worker Discovery ──────────────────────────────────────────────────────

function discoverWorkers(): WorkerInfo[] {
  const workers: WorkerInfo[] = [];
  const workersJsonPath = path.join(os.homedir(), '.overmind', 'bridge', 'workers.json');

  // 1. Try reading workers registry
  let knownPorts: Array<{ port: number; agentName: string }> = [];
  if (fs.existsSync(workersJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(workersJsonPath, 'utf8'));
      if (Array.isArray(data.workers)) {
        knownPorts = data.workers.map((w: { port: number; agentName: string }) => ({
          port: w.port,
          agentName: w.agentName || 'unknown',
        }));
      }
    } catch {
      // ignore
    }
  }

  // 2. Fallback: scan ports 3001-3020
  if (knownPorts.length === 0) {
    knownPorts = [];
    for (let port = 3001; port <= 3020; port++) {
      knownPorts.push({ port, agentName: '' });
    }
  }

  // 3. Probe each port
  for (const { port, agentName } of knownPorts) {
    const url = `http://localhost:${port}`;
    const health = httpGet(`${url}/health`, 3000);

    if (health) {
      // Worker is online — extract agent name from health
      const detectedAgent =
        agentName ||
        (health.agent as string) ||
        (health.agentName as string) ||
        (health.service as string) ||
        'unknown';

      workers.push({
        port,
        url,
        online: true,
        agentName: detectedAgent,
        health,
      });
    } else {
      // Check if port is listening at all
      workers.push({
        port,
        url,
        online: false,
        agentName: agentName || '',
      });
    }
  }

  return workers;
}

// ─── Agent Discovery ───────────────────────────────────────────────────────

function discoverAgents(): Discovery {
  const home = os.homedir();
  const profilesDir = path.join(home, '.overmind', 'hermes', 'profiles');
  const selfAgent = process.env.OVERMIND_AGENT_NAME || null;

  const agents: AgentInfo[] = [];
  const workers = discoverWorkers();

  // Build worker lookup: agentName → worker
  const workerByAgent = new Map<string, WorkerInfo>();
  for (const w of workers) {
    if (w.online && w.agentName && w.agentName !== 'unknown') {
      workerByAgent.set(w.agentName, w);
    }
  }

  // Scan Hermes profiles
  if (fs.existsSync(profilesDir)) {
    const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profilePath = path.join(profilesDir, entry.name);

      // Read config.yaml
      const configPath = path.join(profilePath, 'config.yaml');
      let model = 'unknown';
      let provider = 'unknown';
      if (fs.existsSync(configPath)) {
        const config = fs.readFileSync(configPath, 'utf8');
        const modelMatch = config.match(/^\s*model:\s*(?!provider)(.+)/m);
        const providerMatch = config.match(/^\s*provider:\s*(.+)/m);
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
              if (f.isDirectory()) {
                count += walk(path.join(dir, f.name));
              } else if (f.name === 'SKILL.md') {
                count++;
              }
            }
            return count;
          };
          skillsCount = walk(skillsDir);
        } catch {
          // ignore
        }
      }

      // Check memory
      const hasMemory = fs.existsSync(path.join(profilePath, 'memories', 'MEMORY.md'));

      // Last activity
      let lastActivity: string | null = null;
      const stateDb = path.join(profilePath, 'state.db');
      if (fs.existsSync(stateDb)) {
        try {
          lastActivity = fs.statSync(stateDb).mtime.toISOString();
        } catch {
          // ignore
        }
      }

      // Cross-reference with workers
      const worker = workerByAgent.get(entry.name);

      agents.push({
        name: entry.name,
        model,
        provider,
        status: worker ? 'online' : 'offline',
        workerPort: worker?.port ?? null,
        workerUrl: worker?.url ?? null,
        description,
        skillsCount,
        hasMemory,
        lastActivity,
      });
    }
  }

  return {
    totalAgents: agents.length,
    onlineWorkers: workers.filter((w) => w.online).length,
    agents,
    workers,
    selfAgent,
  };
}

// ─── Send message to a worker ──────────────────────────────────────────────

function sendToWorker(
  port: number,
  message: string,
  opts: {
    model?: string;
    timeoutMs?: number;
  } = {},
): { success: boolean; text: string; raw: Record<string, unknown> | null } {
  const url = `http://localhost:${port}/send`;
  const body: Record<string, unknown> = {
    message,
    userId: `a2a_${process.env.OVERMIND_AGENT_NAME || 'system'}`,
    username: process.env.OVERMIND_AGENT_NAME || 'A2A Hub',
    channelId: 'a2a',
  };
  if (opts.model) body.model = opts.model;

  const response = httpPost(url, body, opts.timeoutMs ?? 300000);

  if (response === null) {
    return { success: false, text: `Worker :${port} injoignable`, raw: null };
  }

  if (response.error) {
    return {
      success: false,
      text: `Erreur :${port}: ${response.error}`,
      raw: response,
    };
  }

  // Workers may return { result, content, response, output }
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
      "Action: discover=liste tous les agents+workers, status=état d'un worker, send=message synchrone, delegate=async, pipeline=chaîne A→B→C, fanout=1→N+merge, query=multi-agents, broadcast=global",
    ),

  target: z
    .string()
    .optional()
    .describe("Nom de l'agent cible (ex: 'sniperbot_analyst') OU port du worker (ex: '3001')"),

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
          .describe("Nom de l'agent ou port (ex: 'sniperbot_analyst' ou '3001')"),
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

// ─── Resolve agent name to worker port ─────────────────────────────────────

function resolveTarget(
  target: string,
  discovery: Discovery,
): { port: number | null; agentName: string } {
  // If target is a port number
  const portMatch = target.match(/^(\d{4,5})$/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    const worker = discovery.workers.find((w) => w.port === port);
    return { port, agentName: worker?.agentName || target };
  }

  // If target is an agent name, find its worker
  const agent = discovery.agents.find((a) => a.name === target);
  if (agent?.workerPort) {
    return { port: agent.workerPort, agentName: target };
  }

  // Try online workers
  const worker = discovery.workers.find((w) => w.online && w.agentName === target);
  if (worker) {
    return { port: worker.port, agentName: target };
  }

  return { port: null, agentName: target };
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
        const d = discoverAgents();

        const lines: string[] = [
          `🌐 **A2A Hub — Découverte du système multi-agents**`,
          ``,
          `**Self:** ${d.selfAgent || '(inconnu)'}`,
          `**Workers online:** ${d.onlineWorkers}`,
          `**Total agents:** ${d.totalAgents}`,
          ``,
          `### Workers HTTP`,
          ``,
        ];

        const onlineWorkers = d.workers.filter((w) => w.online);
        if (onlineWorkers.length === 0) {
          lines.push('Aucun worker HTTP en ligne.');
        } else {
          lines.push('| Port | Agent | Status | URL |');
          lines.push('|------|-------|--------|-----|');
          for (const w of onlineWorkers) {
            lines.push(`| :${w.port} | ${w.agentName} | 🟢 online | ${w.url} |`);
          }
        }

        lines.push('');
        lines.push('### Agents Hermes');
        lines.push('');

        if (d.agents.length === 0) {
          lines.push('Aucun agent trouvé dans ~/.overmind/hermes/profiles/');
        } else {
          lines.push('| Agent | Status | Worker | Model | Provider | Skills | Description |');
          lines.push('|-------|--------|--------|-------|----------|--------|-------------|');
          for (const a of d.agents) {
            const statusIcon = a.status === 'online' ? '🟢' : '🔴';
            const workerInfo = a.workerPort ? `:${a.workerPort}` : '—';
            const nameDisplay = a.name === selfAgent ? `**${a.name} (self)**` : a.name;
            lines.push(
              `| ${nameDisplay} | ${statusIcon} ${a.status} | ${workerInfo} | ${a.model} | ${a.provider} | ${a.skillsCount} | ${a.description.slice(0, 40)} |`,
            );
          }
        }

        lines.push('');
        lines.push('**Actions disponibles:** send, delegate, pipeline, fanout, query, broadcast');
        lines.push(
          '**Exemple:** a2a_hub(action: "send", target: "sniperbot_analyst", message: "Analyse BTC")',
        );

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

        const d = discoverAgents();
        const { port, agentName } = resolveTarget(args.target, d);

        if (!port) {
          return {
            content: [
              { type: 'text' as const, text: `❌ Worker pour "${args.target}" introuvable` },
            ],
            isError: true,
          };
        }

        const health = httpGet(`http://localhost:${port}/health`);
        if (!health) {
          return {
            content: [{ type: 'text' as const, text: `❌ Worker :${port} injoignable` }],
            isError: true,
          };
        }

        const lines: string[] = [`📊 **Status: ${agentName} (:${port})**`, ``];
        for (const [key, value] of Object.entries(health)) {
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

        const d = discoverAgents();
        const { port, agentName } = resolveTarget(args.target, d);

        if (!port) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Worker pour "${args.target}" introuvable. Utilisez action=discover pour lister les agents.`,
              },
            ],
            isError: true,
          };
        }

        const enrichedMessage = `[A2A — Message from ${selfAgent}]\n${args.message}`;
        const result = sendToWorker(port, enrichedMessage, {
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
          content: [
            {
              type: 'text' as const,
              text: `📤 **Message envoyé à ${agentName} (:${port})**\n\n${result.text}`,
            },
          ],
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

        const d = discoverAgents();
        const { port, agentName } = resolveTarget(args.target, d);

        if (!port) {
          return {
            content: [
              { type: 'text' as const, text: `❌ Worker pour "${args.target}" introuvable` },
            ],
            isError: true,
          };
        }

        // Fire and forget — don't wait for response
        const enrichedMessage = `[A2A — Delegate from ${selfAgent}]\n${args.message}`;
        const url = `http://localhost:${port}/send`;
        const body = {
          message: enrichedMessage,
          userId: `a2a_${selfAgent}`,
          username: selfAgent,
          channelId: 'a2a_delegate',
          ...(args.model ? { model: args.model } : {}),
        };

        // Spawn curl in background (fire-and-forget)
        try {
          const payload = JSON.stringify(body).replace(/'/g, "'\\''");
          execSync(
            `nohup curl -s -m ${Math.floor(timeout / 1000)} -X POST "${url}" -H "Content-Type: application/json" -d '${payload}' > /dev/null 2>&1 &`,
            { timeout: 2000 },
          );
        } catch {
          // ignore — fire and forget
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `🤝 **Tâche déléguée à ${agentName} (:${port})**\n\nLe worker traite la requête en arrière-plan. Le résultat sera disponible dans sa session.`,
            },
          ],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // PIPELINE
      // ═══════════════════════════════════════════════════════════════════════
      case 'pipeline': {
        if (!args.message || !args.steps || args.steps.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '❌ `message` (prompt initial) et `steps` requis pour pipeline',
              },
            ],
            isError: true,
          };
        }

        const d = discoverAgents();
        const outputs: Array<{ agent: string; output: string; success: boolean }> = [];
        let currentPrompt = args.message;

        for (let i = 0; i < args.steps.length; i++) {
          const step = args.steps[i];
          const { port, agentName } = resolveTarget(step.agentName, d);

          if (!port) {
            outputs.push({ agent: step.agentName, output: 'Worker introuvable', success: false });
            break;
          }

          const stepPrompt =
            (step.promptPrefix ? step.promptPrefix + '\n\n' : '') +
            `[Pipeline Step ${i + 1}/${args.steps.length}]\n${currentPrompt}`;

          const result = sendToWorker(port, stepPrompt, { timeoutMs: timeout });

          outputs.push({
            agent: `${agentName} (:${port})`,
            output: result.text,
            success: result.success,
          });

          if (!result.success) break;

          currentPrompt = args.accumulateContext
            ? outputs.map((o) => `[${o.agent}]: ${o.output}`).join('\n\n---\n\n')
            : result.text;
        }

        const lines: string[] = [
          `🔗 **Pipeline terminé** (${outputs.length}/${args.steps.length} steps)`,
          ``,
        ];
        for (const o of outputs) {
          lines.push(`**${o.success ? '✅' : '❌'} ${o.agent}:**`);
          lines.push(o.output.slice(0, 800) + (o.output.length > 800 ? '...' : ''));
          lines.push('');
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // FANOUT
      // ═══════════════════════════════════════════════════════════════════════
      case 'fanout': {
        if (!args.message || !args.targets || args.targets.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '❌ `message` et `targets` requis' }],
            isError: true,
          };
        }

        const d = discoverAgents();
        const enrichedMessage = `[A2A — Fanout from ${selfAgent}]\n${args.message}`;

        // Run all in parallel
        const results = args.targets
          .map((target) => {
            const { port } = resolveTarget(target, d);
            if (!port) {
              return { agent: target, success: false, text: 'Worker introuvable' };
            }
            return sendToWorker(port, enrichedMessage, { model: args.model, timeoutMs: timeout });
          })
          .map((r, i) => ({
            agent: args.targets![i],
            success: r.success,
            text: r.text,
          }));

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
      // QUERY
      // ═══════════════════════════════════════════════════════════════════════
      case 'query': {
        if (!args.message || !args.targets || args.targets.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '❌ `message` et `targets` requis' }],
            isError: true,
          };
        }

        const d = discoverAgents();
        const enrichedMessage = `[A2A — Query from ${selfAgent}]\n${args.message}`;
        const queryTimeout = Math.min(timeout, 60000);

        const results = args.targets
          .map((target) => {
            const { port } = resolveTarget(target, d);
            if (!port) {
              return { agent: target, success: false, text: 'Worker introuvable' };
            }
            return sendToWorker(port, enrichedMessage, {
              model: args.model,
              timeoutMs: queryTimeout,
            });
          })
          .map((r, i) => ({
            agent: args.targets![i],
            success: r.success,
            text: r.text,
          }));

        const lines: string[] = [
          `❓ **Query multi-agents** (${results.filter((r) => r.success).length}/${results.length} réponses)`,
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

        const d = discoverAgents();

        // Determine targets
        let targetWorkers: WorkerInfo[];
        if (args.targets && args.targets.length > 0) {
          // Resolve each target to a worker
          targetWorkers = args.targets
            .map((t) => {
              const { port } = resolveTarget(t, d);
              return d.workers.find((w) => w.port === port);
            })
            .filter((w): w is WorkerInfo => w !== undefined);
        } else {
          // All online workers
          targetWorkers = d.workers.filter((w) => w.online);
        }

        if (targetWorkers.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '❌ Aucun worker online pour broadcast' }],
            isError: true,
          };
        }

        const enrichedMessage = `[A2A — Broadcast from ${selfAgent}]\n${args.message}`;

        if (args.race) {
          // First to respond wins
          for (const w of targetWorkers) {
            const result = sendToWorker(w.port, enrichedMessage, {
              model: args.model,
              timeoutMs: timeout,
            });
            if (result.success) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `📡 **Broadcast race — ${w.agentName} (:${w.port}) a gagné!**\n\n${result.text}`,
                  },
                ],
              };
            }
          }
          return {
            content: [{ type: 'text' as const, text: '❌ Tous les workers ont échoué' }],
            isError: true,
          };
        }

        // Send to all in parallel
        const results = targetWorkers.map((w) => {
          const r = sendToWorker(w.port, enrichedMessage, {
            model: args.model,
            timeoutMs: timeout,
          });
          return { agent: `${w.agentName} (:${w.port})`, success: r.success, text: r.text };
        });

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
          content: [
            {
              type: 'text' as const,
              text: `❌ Action inconnue: ${args.action}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur A2A Hub: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
