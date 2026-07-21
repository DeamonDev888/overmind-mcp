/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Droit d'effacement / droit à l'oubli (art. 27 / 35.3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deux modes d'effacement :
 *   - `anonymize` (défaut) : hash les champs texte (prompt/result/text),
 *     pose anonymized=1, et null le data_subject_id. Les métadonnées non-RP
 *     (timestamps, statistiques) sont conservées.
 *   - `hard_delete` : suppression définitive des enregistrements.
 *
 * Par défaut inclut les archives cold storage (archived_runs, archived_chunks)
 * car l'art. 27 s'applique à toutes les RP détenues, y compris les archives.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { getPool } from 'overmind-postgres-mcp';
import { logAccess } from '../lib/loi25/guard.js';

export const loi25ErasureSchema = z.object({
  data_subject_id: z
    .string()
    .min(1)
    .describe('Identifiant pseudonymisé du sujet à effacer'),
  mode: z
    .enum(['hard_delete', 'anonymize'])
    .optional()
    .default('anonymize')
    .describe(
      "'anonymize' (défaut) : hash les textes + null data_subject_id | 'hard_delete' : suppression définitive",
    ),
  include_archives: z
    .boolean()
    .optional()
    .default(true)
    .describe('Effacer aussi les archives cold storage (archived_runs, archived_chunks)'),
});

interface ErasureCounts {
  agent_runs: number;
  knowledge_chunks: number;
  archived_runs: number;
  archived_chunks: number;
  total: number;
}

function hashText(text: string): string {
  // SHA-256 + salt local pour empêcher la ré-identification
  const salt = process.env.OVERMIND_LOI25_SALT || 'overmind-loi25-default-salt-v1';
  return `[ANONYMIZED:${crypto.createHash('sha256').update(`${salt}:${text}`).digest('hex').slice(0, 16)}]`;
}

export async function loi25Erasure(args: z.infer<typeof loi25ErasureSchema>) {
  try {
    const pool = getPool();
    const subjectId = args.data_subject_id;
    const mode = args.mode;
    const includeArchives = args.include_archives;

    const counts: ErasureCounts = {
      agent_runs: 0,
      knowledge_chunks: 0,
      archived_runs: 0,
      archived_chunks: 0,
      total: 0,
    };

    if (mode === 'anonymize') {
      // ── Anonymisation : on hash les textes et on null l'identifiant ────────
      // agent_runs : hash prompt + result
      const agentRunsRes = await pool.query(
        `UPDATE agent_runs
         SET prompt = CASE WHEN prompt IS NOT NULL THEN $2 ELSE prompt END,
             result = CASE WHEN result IS NOT NULL THEN $2 ELSE result END,
             anonymized = 1,
             data_subject_id = NULL,
             consent_ref = NULL
         WHERE data_subject_id = $1`,
        [subjectId, hashText('[anonymized_prompt]')],
      );
      counts.agent_runs = agentRunsRes.rowCount ?? 0;

      // knowledge_chunks : hash text
      const knowledgeRes = await pool.query(
        `UPDATE knowledge_chunks
         SET text = $2,
             anonymized = 1,
             data_subject_id = NULL,
             consent_ref = NULL
         WHERE data_subject_id = $1`,
        [subjectId, hashText('[anonymized_chunk]')],
      );
      counts.knowledge_chunks = knowledgeRes.rowCount ?? 0;

      if (includeArchives) {
        const archRunsRes = await pool.query(
          `UPDATE archived_runs
           SET prompt = CASE WHEN prompt IS NOT NULL THEN $2 ELSE prompt END,
               result = CASE WHEN result IS NOT NULL THEN $2 ELSE result END,
               anonymized = 1,
               data_subject_id = NULL,
               consent_ref = NULL
           WHERE data_subject_id = $1`,
          [subjectId, hashText('[anonymized_prompt]')],
        );
        counts.archived_runs = archRunsRes.rowCount ?? 0;

        const archChunksRes = await pool.query(
          `UPDATE archived_chunks
           SET text = $2,
               anonymized = 1,
               data_subject_id = NULL,
               consent_ref = NULL
           WHERE data_subject_id = $1`,
          [subjectId, hashText('[anonymized_chunk]')],
        );
        counts.archived_chunks = archChunksRes.rowCount ?? 0;
      }
    } else {
      // ── Hard delete ───────────────────────────────────────────────────────
      const agentRunsRes = await pool.query(
        `DELETE FROM agent_runs WHERE data_subject_id = $1`,
        [subjectId],
      );
      counts.agent_runs = agentRunsRes.rowCount ?? 0;

      const knowledgeRes = await pool.query(
        `DELETE FROM knowledge_chunks WHERE data_subject_id = $1`,
        [subjectId],
      );
      counts.knowledge_chunks = knowledgeRes.rowCount ?? 0;

      if (includeArchives) {
        const archRunsRes = await pool.query(
          `DELETE FROM archived_runs WHERE data_subject_id = $1`,
          [subjectId],
        );
        counts.archived_runs = archRunsRes.rowCount ?? 0;

        const archChunksRes = await pool.query(
          `DELETE FROM archived_chunks WHERE data_subject_id = $1`,
          [subjectId],
        );
        counts.archived_chunks = archChunksRes.rowCount ?? 0;
      }
    }

    counts.total =
      counts.agent_runs +
      counts.knowledge_chunks +
      counts.archived_runs +
      counts.archived_chunks;

    // ── Journalisation (art. 27 — preuve de l'effacement) ────────────────────
    await logAccess({
      dataSubjectId: subjectId,
      accessedBy: 'loi25_erasure',
      action: 'delete',
      resourceType: 'data_subject_records',
      resourceId: subjectId,
      purpose: `loi25_erasure_${mode}${includeArchives ? '_with_archives' : ''}`,
    }).catch(() => {}); // non-bloquant

    const modeLabel = mode === 'anonymize' ? '🛡️ Anonymisation' : '🗑️ Suppression définitive';

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `${modeLabel} — **Loi 25 art. 27/35.3**\n\n` +
            `**Sujet :** \`${subjectId}\`\n` +
            `**Mode :** \`${mode}\`\n` +
            `**Archives incluses :** ${includeArchives ? 'oui' : 'non'}\n\n` +
            `**Enregistrements affectés :** ${counts.total}\n` +
            `  • agent_runs : ${counts.agent_runs}\n` +
            `  • knowledge_chunks : ${counts.knowledge_chunks}` +
            (includeArchives
              ? `\n  • archived_runs : ${counts.archived_runs}\n` +
                `  • archived_chunks : ${counts.archived_chunks}`
              : ''),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur loi25_erasure: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
