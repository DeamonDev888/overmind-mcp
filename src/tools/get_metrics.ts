/**
 * get_metrics — Agrégated metrics for the Overmind MCP server.
 *
 * Fix #10: Exposes runtime stats: active agents, memory stats, bridge health,
 * gateway health, run history counts.
 */
import { z } from 'zod';
import { getMemoryProvider } from '../memory/MemoryFactory.js';
import { getRunningAgents, getAgentCount } from '../lib/agent_lifecycle.js';
import { HermesGatewayManager } from '../services/HermesGatewayManager.js';

export const getMetricsSchema = z.object({});

export async function getMetricsTool(_args: z.infer<typeof getMetricsSchema>) {
  try {
    const sections: string[] = [];

    // ─── Live Agents ──────────────────────────────────────────────────
    const agentCounts = getAgentCount();
    const runningAgents = getRunningAgents();

    sections.push(
      [
        '## 🤖 Live Agents',
        '',
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Running now | ${agentCounts.running} |`,
        `| Total tracked | ${agentCounts.total} |`,
      ].join('\n'),
    );

    if (runningAgents.length > 0) {
      const lines = runningAgents.map(
        (a) =>
          `  - **${a.agentName}** (${a.runner}) — PID ${a.pid}, session ${a.sessionId?.slice(0, 16) ?? '—'}`,
      );
      sections.push(`**Currently running:**\n${lines.join('\n')}`);
    }

    // ─── Memory Stats ─────────────────────────────────────────────────
    try {
      const provider = getMemoryProvider();
      const stats = provider.getStats();
      const s = stats instanceof Promise ? await stats : stats;
      sections.push(
        [
          '## 🧠 Memory',
          '',
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Total memories | ${(s as { totalMemories?: number }).totalMemories ?? '?'} |`,
          `| Total runs | ${(s as { totalRuns?: number }).totalRuns ?? '?'} |`,
        ].join('\n'),
      );
    } catch {
      sections.push('## 🧠 Memory\n\n_Memory provider unavailable_');
    }

    // ─── Gateway Health ───────────────────────────────────────────────
    try {
      const gw = HermesGatewayManager.getInstance();
      const health = await gw.getDetailedHealth();
      const h = health as Record<string, unknown> | null;
      sections.push(
        [
          '## 🌐 Hermes Gateway',
          '',
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Status | ${h?.status ?? '—'} |`,
          `| URL | ${h?.url ?? '—'} |`,
          `| Version | ${h?.version ?? '—'} |`,
        ].join('\n'),
      );
    } catch {
      sections.push('## 🌐 Hermes Gateway\n\n_Not configured_');
    }

    // ─── Process Stats ────────────────────────────────────────────────
    const memUsage = process.memoryUsage();
    const uptimeSec = Math.floor(process.uptime());
    const uptimeStr = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`;

    sections.push(
      [
        '## ⚙️ Server Process',
        '',
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Uptime | ${uptimeStr} |`,
        `| RSS Memory | ${(memUsage.rss / 1024 / 1024).toFixed(1)} MB |`,
        `| Heap Used | ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB |`,
        `| Heap Total | ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB |`,
        `| Node PID | ${process.pid} |`,
      ].join('\n'),
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: `# 📊 Overmind MCP Metrics\n\n${sections.join('\n\n')}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur get_metrics: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
