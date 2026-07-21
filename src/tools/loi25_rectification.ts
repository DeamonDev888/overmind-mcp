/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Droit de rectification (art. 27)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Modifie un renseignement personnel (RP) inexact, incomplet ou périmé.
 * Le sujet désigne l'enregistrement via :
 *   - son data_subject_id (scope de sécurité)
 *   - le nom de la table ('agent_runs' | 'knowledge_chunks')
 *   - l'ID de l'enregistrement
 *   - le champ à rectifier ('prompt', 'result' ou 'text')
 *   - la nouvelle valeur
 *
 * L'UPDATE est doublement filtrée par `id` ET `data_subject_id` pour éviter
 * qu'un sujet ne modifie les RP d'un autre (isolation forte).
 *
 * Chaque rectification est tracée dans access_log (action='write').
 */

import { z } from 'zod';
import { getPool } from 'overmind-postgres-mcp';
import { logAccess } from '../lib/loi25/guard.js';

// Allowlist stricte : empêche l'injection de noms de colonnes arbitraires
const ALLOWED_FIELDS_BY_TABLE: Record<string, Set<string>> = {
  agent_runs: new Set(['prompt', 'result']),
  knowledge_chunks: new Set(['text']),
};

export const loi25RectificationSchema = z.object({
  data_subject_id: z.string().min(1).describe('Identifiant pseudonymisé du sujet'),
  table_name: z
    .enum(['agent_runs', 'knowledge_chunks'])
    .describe('Table contenant le RP à rectifier'),
  record_id: z.string().min(1).describe('ID de l\'enregistrement à modifier'),
  field: z
    .string()
    .describe('Champ à rectifier (prompt, result pour agent_runs ; text pour knowledge_chunks)'),
  new_value: z.string().describe('Nouvelle valeur du champ'),
});

export async function loi25Rectification(args: z.infer<typeof loi25RectificationSchema>) {
  try {
    // ── Validation stricte du champ autorisé ─────────────────────────────────
    const allowedFields = ALLOWED_FIELDS_BY_TABLE[args.table_name];
    if (!allowedFields) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `❌ Table non supportée : \`${args.table_name}\`. Tables autorisées : agent_runs, knowledge_chunks`,
          },
        ],
        isError: true,
      };
    }
    if (!allowedFields.has(args.field)) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `❌ Champ non autorisé : \`${args.field}\` sur \`${args.table_name}\`.\n` +
              `Champs autorisés : ${Array.from(allowedFields).join(', ')}`,
          },
        ],
        isError: true,
      };
    }

    const pool = getPool();

    // Double filtre id + data_subject_id pour isolation
    const res = await pool.query(
      `UPDATE ${args.table_name}
       SET ${args.field} = $1,
           updated_at = $4
       WHERE id = $2 AND data_subject_id = $3
       RETURNING id, ${args.field}`,
      [args.new_value, args.record_id, args.data_subject_id, Date.now()],
    );

    const affected = res.rowCount ?? 0;

    // ── Journalisation (art. 27 — preuve de la rectification) ────────────────
    await logAccess({
      dataSubjectId: args.data_subject_id,
      accessedBy: 'loi25_rectification',
      action: 'write',
      resourceType: args.table_name,
      resourceId: args.record_id,
      purpose: `loi25_rectification:${args.table_name}.${args.field}`,
    }).catch(() => {}); // non-bloquant

    if (affected === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `⚠️ **Aucun enregistrement modifié**\n\n` +
              `Aucun enregistrement avec id=\`${args.record_id}\` et data_subject_id=\`${args.data_subject_id}\` dans \`${args.table_name}\`.\n` +
              `_Vérifiez les IDs ou l'appartenance du record au sujet._`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `✏️ **Rectification appliquée** — Loi 25 art. 27\n\n` +
            `**Sujet :** \`${args.data_subject_id}\`\n` +
            `**Table :** \`${args.table_name}\`\n` +
            `**Record ID :** \`${args.record_id}\`\n` +
            `**Champ :** \`${args.field}\`\n` +
            `**Enregistrements affectés :** ${affected}\n\n` +
            `Nouvelle valeur :\n\`\`\`\n${args.new_value.slice(0, 1000)}${args.new_value.length > 1000 ? '\n…' : ''}\n\`\`\``,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur loi25_rectification: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
