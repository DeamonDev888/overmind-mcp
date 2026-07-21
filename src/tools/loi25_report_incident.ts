/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Outil MCP : Notification d'incident (art. 3.5-3.8)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Signale un incident de confidentialité, liste les incidents ouverts,
 * ou résout un incident. Table `incident_log` dans `overmind_core`.
 *
 * ⚠️ Les incidents de sévérité "high" déclenchent un avertissement :
 *    notification à la Commission d'accès à l'information (CAI) requise
 *    dans les 30 jours (art. 3.5).
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPool } from 'overmind-postgres-mcp';
import type { IncidentLogEntry } from '../lib/loi25/types.js';

// ── Schéma Zod ────────────────────────────────────────────────────────────────

export const loi25ReportIncidentSchema = z.object({
  action: z
    .enum(['report', 'list', 'resolve'])
    .optional()
    .default('list')
    .describe(
      'report: signale un nouvel incident | ' +
        'list: liste les incidents (plus récents d\'abord) | ' +
        'resolve: marque un incident comme résolu',
    ),
  severity: z
    .enum(['low', 'moderate', 'high'])
    .describe(
      "Gravité de l'incident. 'high' → notification CAI obligatoire sous 30 jours.",
    ),
  category: z
    .enum([
      'data_leak',
      'unauthorized_access',
      'breach',
      'retention_violation',
      'transfer_violation',
      'consent_violation',
    ])
    .describe("Catégorie d'incident."),
  description: z
    .string()
    .min(1)
    .describe("Description factuelle de l'incident (cause, périmètre, données touchées)."),
  data_subjects_affected: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('Nombre de sujets de données affectés (0 si inconnu).'),
  incident_id: z
    .string()
    .optional()
    .describe("ID de l'incident à résoudre (requis pour action='resolve')."),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function tsNow(): number {
  return Date.now();
}

function formatIncident(row: IncidentLogEntry): string {
  const detected = new Date(row.detected_at).toISOString().replace('T', ' ').slice(0, 19);
  const resolved =
    row.resolved_at !== null && row.resolved_at !== undefined
      ? new Date(row.resolved_at).toISOString().replace('T', ' ').slice(0, 19)
      : null;
  const status = resolved ? `✅ résolu (${resolved})` : '🟡 ouvert';
  const sevLabel =
    row.severity === 'high' ? '🔴' : row.severity === 'moderate' ? '🟠' : '🟡';
  return [
    `${sevLabel} **[${row.severity.toUpperCase()}]** \`${row.category}\` — \`${row.id.slice(0, 8)}\``,
    `  - Détecté: ${detected} | ${status}`,
    `  - Sujets affectés: ${row.data_subjects_affected}`,
    `  - Description: ${row.description ?? '—'}`,
  ].join('\n');
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export async function loi25ReportIncident(args: z.infer<typeof loi25ReportIncidentSchema>) {
  try {
    const pool = getPool();
    const action = args.action ?? 'list';

    // ── REPORT ───────────────────────────────────────────────────────────────
    if (action === 'report') {
      const id = randomUUID();
      const now = tsNow();

      await pool.query(
        `INSERT INTO incident_log
          (id, detected_at, severity, category, description, data_subjects_affected,
           cai_notified, subjects_notified, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, NULL)`,
        [
          id,
          now,
          args.severity,
          args.category,
          args.description,
          args.data_subjects_affected ?? 0,
        ],
      );

      const lines = [
        `🚨 **Incident signalé** \`${id}\``,
        `  - Sévérité: \`${args.severity}\` | Catégorie: \`${args.category}\``,
        `  - Sujets affectés: ${args.data_subjects_affected ?? 0}`,
        `  - Détecté: ${new Date(now).toISOString().replace('T', ' ').slice(0, 19)}`,
      ];

      if (args.severity === 'high') {
        lines.push('');
        lines.push(
          '⚠️ **AVERTISSEMENT — Notification CAI requise (art. 3.5-3.8)**',
          `Un incident de sévérité \`high\` nécessite une notification à la ` +
            `**Commission d'accès à l'information (CAI)** dans les **30 jours** suivant la détection,`,
          `avec notification des sujets concernés lorsque le risque de préjudice sérieux est élevé.`,
          `Référence: https://www.cai.gouv.qc.ca/notification-dincident`,
        );
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const res = await pool.query<IncidentLogEntry>(
        `SELECT * FROM incident_log ORDER BY detected_at DESC`,
      );

      if (res.rows.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: '📭 Aucun incident enregistré.' },
          ],
        };
      }

      const open = res.rows.filter((r) => r.resolved_at === null || r.resolved_at === undefined);
      const block = res.rows.map(formatIncident).join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `🚨 **${res.rows.length} incident(s)** — ${open.length} ouvert(s)\n\n${block}`,
          },
        ],
      };
    }

    // ── RESOLVE ──────────────────────────────────────────────────────────────
    if (action === 'resolve') {
      if (!args.incident_id) {
        return {
          content: [
            {
              type: 'text' as const,
              text: '❌ `incident_id` est requis pour action="resolve".',
            },
          ],
          isError: true,
        };
      }

      const res = await pool.query(
        `UPDATE incident_log SET resolved_at = $1 WHERE id = $2 AND resolved_at IS NULL`,
        [tsNow(), args.incident_id],
      );

      if (res.rowCount === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Incident \`${args.incident_id}\` introuvable ou déjà résolu.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ **Incident résolu**: \`${args.incident_id}\``,
          },
        ],
      };
    }

    // unreachable
    return {
      content: [{ type: 'text' as const, text: `❌ Action inconnue: ${action}` }],
      isError: true,
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur loi25_report_incident: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
