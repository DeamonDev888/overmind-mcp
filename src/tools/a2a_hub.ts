/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A2A Hub — Outil MCP unifié pour la communication Agent-to-Agent
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cet outil donne aux agents une vue complète du système multi-agents:
 *
 *   - LISTER tous les agents persistants (Hermes profiles + live registry)
 *   - VOIR ce que chaque agent fait en temps réel (status, busy/idle, dernière activité)
 *   - DELEGUER une tâche à un autre agent (async avec callback)
 *   - PIPELINE chainé (A→B→C avec passing de contexte)
 *   - FANOUT parallèle (1→N + merge des résultats)
 *   - QUERY multi-agents (poser une question à plusieurs agents simultanément)
 *   - BROADCAST (message global à tous les agents online)
 *
 * L'agent qui appelle cet outil découvre AUTOMATIQUEMENT:
 *   - Quels agents existent sur le système (profiles Hermes)
 *   - Leur status (online/busy/idle/offline)
 *   - Leur runner (hermes, claude, kilo, etc.)
 *   - Leur modèle LLM
 *   - Leur dernière activité
 *   - Le compteur A2A (combien de messages envoyés/reçus)
 *
 * Aucune configuration manuelle — l'outil scanne ~/.overmind/hermes/profiles/
 * et croise avec le registry live du bridge.
 */

import { z } from 'zod';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Types ─────────────────────────────────────────────────────────────────

interface AgentInfo {
  name: string;
  runner: string;
  model: string;
  status: 'online' | 'busy' | 'idle' | 'offline' | 'unknown';
  provider: string;
  lastActivity: string | null;
  description: string;
  skillsCount: number;
  hasMemory: boolean;
  a2aCapabilities: string[];
}

interface A2ADiscovery {
  totalAgents: number;
  onlineAgents: number;
  busyAgents: number;
  agents: AgentInfo[];
  selfAgent: string | null;
  bridgeUrl: string;
  bridgeOnline: boolean;
}

// ─── Discovery: scan profiles + live status ────────────────────────────────

function discoverAgents(): A2ADiscovery {
  const home = os.homedir();
  const profilesDir =
    process.platform === 'win32'
      ? path.join(home, '.overmind', 'hermes', 'profiles')
      : path.join(home, '.overmind', 'hermes', 'profiles');

  const bridgeUrl = process.env.OVERMIND_BRIDGE_URL || 'http://localhost:3100/rpc';
  const selfAgent = process.env.OVERMIND_AGENT_NAME || null;

  const agents: AgentInfo[] = [];

  // 1. Scan Hermes profiles
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
        const modelMatch = config.match(/model:\s*(.+)/);
        const providerMatch = config.match(/provider:\s*(.+)/);
        if (modelMatch) model = modelMatch[1].trim();
        if (providerMatch) provider = providerMatch[1].trim();
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

      // Last activity (state.db mtime)
      let lastActivity: string | null = null;
      const stateDb = path.join(profilePath, 'state.db');
      if (fs.existsSync(stateDb)) {
        try {
          const stat = fs.statSync(stateDb);
          lastActivity = stat.mtime.toISOString();
        } catch {
          // ignore
        }
      }

      agents.push({
        name: entry.name,
        runner: 'hermes',
        model,
        status: 'unknown', // Will be enriched from bridge if available
        provider,
        lastActivity,
        description,
        skillsCount,
        hasMemory,
        a2aCapabilities: ['delegate', 'pipeline', 'fanout', 'query', 'broadcast', 'a2a'],
      });
    }
  }

  // 2. Try to get live status from bridge
  let bridgeOnline = false;
  try {
    const healthUrl = bridgeUrl.replace('/rpc', '/health');
    const result = execSync(`curl -s -m 3 "${healthUrl}" 2>/dev/null || echo '{}'`, {
      encoding: 'utf8',
      timeout: 5000,
    });
    const health = JSON.parse(result);
    bridgeOnline = health.status === 'online' || health.status === 'degraded';

    // Enrich agents with live status from registry
    if (health.agents && Array.isArray(health.agents)) {
      for (const liveAgent of health.agents) {
        const found = agents.find((a) => a.name === liveAgent.name);
        if (found) {
          found.status = liveAgent.status;
        }
      }
    }
  } catch {
    // Bridge not reachable — agents keep 'unknown' status
  }

  // Default 'offline' for agents we couldn't reach
  for (const a of agents) {
    if (a.status === 'unknown') a.status = 'offline';
  }

  return {
    totalAgents: agents.length,
    onlineAgents: agents.filter((a) => a.status === 'online').length,
    busyAgents: agents.filter((a) => a.status === 'busy').length,
    agents,
    selfAgent,
    bridgeUrl,
    bridgeOnline,
  };
}

// ─── RPC Helper ────────────────────────────────────────────────────────────

function rpcCall(method: string, params: Record<string, unknown>): unknown {
  const bridgeUrl = process.env.OVERMIND_BRIDGE_URL || 'http://localhost:3100/rpc';
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  });

  try {
    const result = execSync(
      `curl -s -m 300 -X POST "${bridgeUrl}" -H "Content-Type: application/json" -d '${payload.replace(/'/g, "'\\''")}' 2>/dev/null`,
      { encoding: 'utf8', timeout: 310000, maxBuffer: 50 * 1024 * 1024 },
    );
    const response = JSON.parse(result);
    if (response.error) {
      return {
        error: response.error.message,
        code: response.error.code,
      };
    }
    return response.result;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ─── Schema ────────────────────────────────────────────────────────────────

export const a2aHubSchema = z.object({
  action: z
    .enum(['discover', 'status', 'send', 'delegate', 'pipeline', 'fanout', 'query', 'broadcast'])
    .describe(
      "Action à effectuer: discover=liste tous les agents, status=état d'un agent, send=message synchrone, delegate=async+callback, pipeline=chaîne A→B→C, fanout=1→N parallèle+merge, query=question multi-agents, broadcast=message global",
    ),

  // ─── Target (for send/delegate/status) ──────────────────────────────────
  target: z.string().optional().describe("Nom de l'agent cible (ex: 'sniperbot_analyst')"),

  // ─── Message ─────────────────────────────────────────────────────────────
  message: z.string().optional().describe('Le message/prompt à envoyer aux agents'),

  // ─── Targets (for fanout/query/broadcast/pipeline) ──────────────────────
  targets: z
    .array(z.string())
    .optional()
    .describe(
      'Liste des agents cibles (pour fanout/query). Si absent pour broadcast → tous les agents online',
    ),

  // ─── Pipeline steps ──────────────────────────────────────────────────────
  steps: z
    .array(
      z.object({
        agentName: z.string(),
        promptPrefix: z.string().optional(),
      }),
    )
    .optional()
    .describe('Étapes de la pipeline (pour action=pipeline)'),

  // ─── Options ─────────────────────────────────────────────────────────────
  runner: z.string().optional().default('hermes').describe('Runner à utiliser (default: hermes)'),

  model: z.string().optional().describe('Modèle LLM à utiliser (override)'),

  mergeStrategy: z
    .enum(['concat', 'best', 'vote', 'first_success'])
    .optional()
    .default('concat')
    .describe('Stratégie de merge pour fanout (default: concat)'),

  race: z
    .boolean()
    .optional()
    .default(false)
    .describe("Pour broadcast: si true, retourne dès qu'un agent répond"),

  async: z
    .boolean()
    .optional()
    .default(true)
    .describe('Pour delegate: si true (default), retourne immédiatement avec un taskId'),

  callbackUrl: z
    .string()
    .optional()
    .describe("Pour delegate: URL appelée quand l'agent termine (POST result)"),

  accumulateContext: z
    .boolean()
    .optional()
    .default(false)
    .describe('Pour pipeline: si true, chaque step reçoit tous les outputs précédents'),

  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .optional()
    .describe('Timeout en ms (défaut selon action)'),
});

// ─── Execute ───────────────────────────────────────────────────────────────

export async function a2aHub(args: z.infer<typeof a2aHubSchema>) {
  const selfAgent = process.env.OVERMIND_AGENT_NAME || 'unknown';
  const { action } = args;

  try {
    switch (action) {
      // ═══════════════════════════════════════════════════════════════════════
      // DISCOVER — Liste TOUS les agents + leur status temps réel
      // ═══════════════════════════════════════════════════════════════════════
      case 'discover': {
        const discovery = discoverAgents();

        const lines: string[] = [
          `🌐 **A2A Hub — Découverte du système multi-agents**`,
          ``,
          `**Self:** ${discovery.selfAgent || '(inconnu)'}`,
          `**Bridge:** ${discovery.bridgeUrl} (${discovery.bridgeOnline ? '✅ online' : '❌ offline'})`,
          `**Total agents:** ${discovery.totalAgents} | **Online:** ${discovery.onlineAgents} | **Busy:** ${discovery.busyAgents}`,
          ``,
        ];

        if (discovery.agents.length === 0) {
          lines.push('Aucun agent trouvé dans ~/.overmind/hermes/profiles/');
        } else {
          lines.push('| Agent | Status | Model | Provider | Skills | Description |');
          lines.push('|-------|--------|-------|----------|--------|-------------|');
          for (const a of discovery.agents) {
            const statusIcon =
              a.status === 'online'
                ? '🟢'
                : a.status === 'busy'
                  ? '🟡'
                  : a.status === 'idle'
                    ? '⚪'
                    : '🔴';
            lines.push(
              `| ${a.name === selfAgent ? '**' + a.name + ' (self)**' : a.name} | ${statusIcon} ${a.status} | ${a.model} | ${a.provider} | ${a.skillsCount} | ${a.description.slice(0, 40)} |`,
            );
          }

          lines.push('');
          lines.push('**Capacités A2A disponibles:**');
          lines.push('  • `send` — Message synchrone A→B');
          lines.push('  • `delegate` — Tâche async + callback');
          lines.push('  • `pipeline` — Chaîne A→B→C');
          lines.push('  • `fanout` — 1→N parallèle + merge');
          lines.push('  • `query` — Question multi-agents');
          lines.push('  • `broadcast` — Message global');
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // STATUS — État détaillé d'un agent
      // ═══════════════════════════════════════════════════════════════════════
      case 'status': {
        if (!args.target) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '❌ Paramètre `target` requis pour action=status',
              },
            ],
            isError: true,
          };
        }

        const result = rpcCall('agent.status', {
          agentName: args.target,
          runner: args.runner,
          action: 'status',
        });

        const r = result as Record<string, unknown>;
        if (r.error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Erreur status ${args.target}: ${r.error}`,
              },
            ],
            isError: true,
          };
        }

        const local = (r.local || (r.result as Record<string, unknown>)?.local) as
          Record<string, unknown> | undefined;
        const lines: string[] = [`📊 **Status: ${args.target}**`, ``];

        if (local) {
          lines.push(`**État local:** ${local.status || 'unknown'}`);
          lines.push(`**Runner:** ${local.runner || 'unknown'}`);
          lines.push(`**Total runs:** ${local.totalRuns || 0}`);
          lines.push(`**Erreurs:** ${local.totalErrors || 0}`);
          lines.push(`**A2A reçus:** ${local.a2aReceived || 0}`);
          lines.push(`**A2A envoyés:** ${local.a2aSent || 0}`);
          if (local.currentSessionId) {
            lines.push(`**Session:** ${local.currentSessionId}`);
          }
          if (local.lastActivityAt) {
            lines.push(
              `**Dernière activité:** ${new Date(local.lastActivityAt as number).toISOString()}`,
            );
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // SEND — Message synchrone A→B (via agent.a2a)
      // ═══════════════════════════════════════════════════════════════════════
      case 'send': {
        if (!args.target || !args.message) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '❌ Paramètres `target` et `message` requis pour action=send',
              },
            ],
            isError: true,
          };
        }

        const result = rpcCall('agent.a2a', {
          fromAgent: selfAgent,
          toAgent: args.target,
          runner: args.runner,
          prompt: args.message,
          ...(args.model ? { model: args.model } : {}),
        });

        const r = result as Record<string, unknown>;
        if (r.error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Erreur send → ${args.target}: ${r.error}`,
              },
            ],
            isError: true,
          };
        }

        const content = (r.content || []) as Array<{ type: string; text: string }>;
        const responseText = content.map((c) => c.text).join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `📤 **Message envoyé à ${args.target}**\n\n${responseText}`,
            },
          ],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // DELEGATE — Async fire-and-forget + callback
      // ═══════════════════════════════════════════════════════════════════════
      case 'delegate': {
        if (!args.target || !args.message) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '❌ Paramètres `target` et `message` requis pour action=delegate',
              },
            ],
            isError: true,
          };
        }

        const result = rpcCall('agent.delegate', {
          fromAgent: selfAgent,
          toAgent: args.target,
          runner: args.runner,
          prompt: args.message,
          async: args.async,
          ...(args.model ? { model: args.model } : {}),
          ...(args.callbackUrl ? { callbackUrl: args.callbackUrl } : {}),
        });

        const r = result as Record<string, unknown>;
        if (r.error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Erreur delegate → ${args.target}: ${r.error}`,
              },
            ],
            isError: true,
          };
        }

        if (args.async) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `🤝 **Tâche déléguée à ${args.target}**\n\n**TaskId:** ${r.taskId}\n**Status:** ${r.status}\n${r.message || ''}`,
              },
            ],
          };
        }

        const content = (r.content || []) as Array<{ type: string; text: string }>;
        return {
          content: [
            {
              type: 'text' as const,
              text: `✅ **${args.target} a terminé**\n\n${content.map((c) => c.text).join('\n')}`,
            },
          ],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // PIPELINE — Chaîne séquentielle A→B→C
      // ═══════════════════════════════════════════════════════════════════════
      case 'pipeline': {
        if (!args.message || !args.steps || args.steps.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: "❌ Paramètres `message` (prompt initial) et `steps` (chaîne d'agents) requis pour action=pipeline",
              },
            ],
            isError: true,
          };
        }

        const result = rpcCall('agent.pipeline', {
          initiator: selfAgent,
          runner: args.runner,
          prompt: args.message,
          steps: args.steps,
          accumulateContext: args.accumulateContext,
          ...(args.timeoutMs ? { totalTimeoutMs: args.timeoutMs } : {}),
        });

        const r = result as Record<string, unknown>;
        if (r.error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Erreur pipeline: ${r.error}`,
              },
            ],
            isError: true,
          };
        }

        const outputs = (r.outputs || []) as Array<{
          agentName: string;
          output: string;
          success: boolean;
        }>;
        const lines: string[] = [
          `🔗 **Pipeline terminé** (${r.executedSteps}/${r.totalSteps} steps)`,
          ``,
        ];

        for (const o of outputs) {
          lines.push(`**${o.success ? '✅' : '❌'} ${o.agentName}:**`);
          lines.push(o.output.slice(0, 500) + (o.output.length > 500 ? '...' : ''));
          lines.push('');
        }

        lines.push(`**Output final:**`);
        lines.push(((r.finalOutput as string) || '').slice(0, 1000));

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // FANOUT — 1→N parallèle + merge
      // ═══════════════════════════════════════════════════════════════════════
      case 'fanout': {
        if (!args.message || !args.targets || args.targets.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '❌ Paramètres `message` et `targets` requis pour action=fanout',
              },
            ],
            isError: true,
          };
        }

        const result = rpcCall('agent.fanout', {
          fromAgent: selfAgent,
          runner: args.runner,
          prompt: args.message,
          targets: args.targets,
          mergeStrategy: args.mergeStrategy,
          ...(args.model ? { model: args.model } : {}),
          ...(args.timeoutMs ? { agentTimeoutMs: args.timeoutMs } : {}),
        });

        const r = result as Record<string, unknown>;
        if (r.error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Erreur fanout: ${r.error}`,
              },
            ],
            isError: true,
          };
        }

        const lines: string[] = [
          `🌐 **Fanout terminé** (${r.successCount}/${r.totalResults} succès, merge=${r.mergeStrategy})`,
          ...(r.winner ? [`**Gagnant:** ${r.winner}`] : []),
          ``,
          `**Résultat fusionné:**`,
          ((r.merged as string) || '').slice(0, 2000),
        ];

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // QUERY — Question multi-agents rapide
      // ═══════════════════════════════════════════════════════════════════════
      case 'query': {
        if (!args.message || !args.targets || args.targets.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '❌ Paramètres `message` et `targets` requis pour action=query',
              },
            ],
            isError: true,
          };
        }

        const result = rpcCall('agent.query', {
          fromAgent: selfAgent,
          runner: args.runner,
          prompt: args.message,
          targets: args.targets,
          ...(args.model ? { model: args.model } : {}),
          ...(args.timeoutMs ? { agentTimeoutMs: args.timeoutMs } : {}),
        });

        const r = result as Record<string, unknown>;
        if (r.error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Erreur query: ${r.error}`,
              },
            ],
            isError: true,
          };
        }

        const results = (r.results || []) as Array<{
          agentName: string;
          success: boolean;
          text: string;
        }>;
        const lines: string[] = [
          `❓ **Query multi-agents** (${r.successCount}/${r.totalQueried} réponses)`,
          ``,
        ];

        for (const res of results) {
          lines.push(`**${res.success ? '✅' : '❌'} ${res.agentName}:**`);
          lines.push(res.text.slice(0, 500) + (res.text.length > 500 ? '...' : ''));
          lines.push('');
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      }

      // ═══════════════════════════════════════════════════════════════════════
      // BROADCAST — Message global à tous les agents online
      // ═══════════════════════════════════════════════════════════════════════
      case 'broadcast': {
        if (!args.message) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '❌ Paramètre `message` requis pour action=broadcast',
              },
            ],
            isError: true,
          };
        }

        const result = rpcCall('agent.broadcast', {
          fromAgent: selfAgent,
          runner: args.runner,
          prompt: args.message,
          race: args.race,
          ...(args.targets ? { targets: args.targets } : {}),
          ...(args.model ? { model: args.model } : {}),
          ...(args.timeoutMs ? { agentTimeoutMs: args.timeoutMs } : {}),
        });

        const r = result as Record<string, unknown>;
        if (r.error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Erreur broadcast: ${r.error}`,
              },
            ],
            isError: true,
          };
        }

        const results = (r.results || []) as Array<{
          agentName: string;
          success: boolean;
          content?: Array<{ text: string }>;
          error?: string;
        }>;
        const lines: string[] = [
          `📡 **Broadcast ${r.race ? '(race mode)' : ''}** — ${r.successCount}/${r.total} succès`,
          ``,
        ];

        for (const res of results) {
          const text = res.content?.map((c) => c.text).join('\n') || res.error || '';
          lines.push(`**${res.success ? '✅' : '❌'} ${res.agentName}:**`);
          lines.push(text.slice(0, 300) + (text.length > 300 ? '...' : ''));
          lines.push('');
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Action inconnue: ${action}. Actions: discover, status, send, delegate, pipeline, fanout, query, broadcast`,
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
