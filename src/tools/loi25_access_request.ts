/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Droit d'accès (art. 26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extrait tous les renseignements personnels (RP) liés à un data_subject_id
 * depuis les tables actives (agent_runs, knowledge_chunks) et, optionnellement,
 * les archives cold storage (archived_runs, archived_chunks).
 *
 * Le résultat est retourné sous forme JSON complet pour respecter l'obligation
 * de reddition de comptes (art. 26 — communication d'une copie des RP).
 */

import { z } from 'zod';
import { getPool } from 'overmind-postgres-mcp';
import { logAccess } from '../lib/loi25/guard.js';
import { isLoi25Enabled } from '../lib/loi25/types.js';

export const loi25AccessRequestSchema = z.object({
  data_subject_id: z
    .string()
    .min(1)
    .describe('Identifiant pseudonymisé du sujet (hash SHA-256, jamais l\'identité brute)'),
  include_archives: z
    .boolean()
    .optional()
    .default(false)
    .describe('Inclure les archives cold storage (archived_runs, archived_chunks)'),
});

export async function loi25AccessRequest(args: z.infer<typeof loi25AccessRequestSchema>) {
  try {
    const pool = getPool();
    const subjectId = args.data_subject_id;

    // ── Tables actives ──────────────────────────────────────────────────────
    const agentRunsRes = await pool.query(
      `SELECT id, runner, agent_name, prompt, result, error, duration_ms, success,
              session_id, data_subject_id, legal_basis, consent_ref,
              retention_expires_at, anonymized, created_for, created_at
       FROM agent_runs
       WHERE data_subject_id = $1
       ORDER BY created_at DESC`,
      [subjectId],
    );

    const knowledgeChunksRes = await pool.query(
      `SELECT id, source, text, model, data_subject_id, legal_basis, consent_ref,
              retention_expires_at, anonymized, created_at, updated_at
       FROM knowledge_chunks
       WHERE data_subject_id = $1
       ORDER BY created_at DESC`,
      [subjectId],
    );

    const result: {
      data_subject_id: string;
      generated_at: string;
      loi25_enabled: boolean;
      active: {
        agent_runs: unknown[];
        knowledge_chunks: unknown[];
      };
      archives?: {
        archived_runs: unknown[];
        archived_chunks: unknown[];
      };
      summary: {
        agent_runs_count: number;
        knowledge_chunks_count: number;
        archived_runs_count?: number;
        archived_chunks_count?: number;
        total: number;
      };
    } = {
      data_subject_id: subjectId,
      generated_at: new Date().toISOString(),
      loi25_enabled: isLoi25Enabled(),
      active: {
        agent_runs: agentRunsRes.rows,
        knowledge_chunks: knowledgeChunksRes.rows,
      },
      summary: {
        agent_runs_count: agentRunsRes.rowCount ?? 0,
        knowledge_chunks_count: knowledgeChunksRes.rowCount ?? 0,
        total: (agentRunsRes.rowCount ?? 0) + (knowledgeChunksRes.rowCount ?? 0),
      },
    };

    // ── Archives cold storage (optionnel) ───────────────────────────────────
    if (args.include_archives) {
      const archivedRunsRes = await pool.query(
        `SELECT id, runner, agent_name, prompt, result, error, duration_ms, success,
                session_id, data_subject_id, legal_basis, consent_ref,
                retention_expires_at, anonymized, created_for, created_at,
                archived_at, archive_expires_at
         FROM archived_runs
         WHERE data_subject_id = $1
         ORDER BY created_at DESC`,
        [subjectId],
      );

      const archivedChunksRes = await pool.query(
        `SELECT id, source, text, model, data_subject_id, legal_basis, consent_ref,
                retention_expires_at, anonymized, created_at, updated_at,
                archived_at, archive_expires_at
         FROM archived_chunks
         WHERE data_subject_id = $1
         ORDER BY created_at DESC`,
        [subjectId],
      );

      result.archives = {
        archived_runs: archivedRunsRes.rows,
        archived_chunks: archivedChunksRes.rows,
      };
      result.summary.archived_runs_count = archivedRunsRes.rowCount ?? 0;
      result.summary.archived_chunks_count = archivedChunksRes.rowCount ?? 0;
      result.summary.total +=
        (archivedRunsRes.rowCount ?? 0) + (archivedChunksRes.rowCount ?? 0);
    }

    // ── Journalisation de l'accès (art. 26 — reddition de comptes) ──────────
    await logAccess({
      dataSubjectId: subjectId,
      accessedBy: 'loi25_access_request',
      action: 'read',
      resourceType: 'data_subject_export',
      resourceId: subjectId,
      purpose: args.include_archives
        ? 'loi25_access_request_with_archives'
        : 'loi25_access_request',
    }).catch(() => {}); // non-bloquant

    const json = JSON.stringify(result, null, 2);

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `📋 **Loi 25 art. 26 — Droit d'accès**\n\n` +
            `**Sujet :** \`${subjectId}\`\n` +
            `**Total RP trouvés :** ${result.summary.total}\n` +
            `  • agent_runs : ${result.summary.agent_runs_count}\n` +
            `  • knowledge_chunks : ${result.summary.knowledge_chunks_count}` +
            (result.summary.archived_runs_count !== undefined
              ? `\n  • archived_runs : ${result.summary.archived_runs_count}\n` +
                `  • archived_chunks : ${result.summary.archived_chunks_count}`
              : '') +
            `\n\n\`\`\`json\n${json}\n\`\`\``,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur loi25_access_request: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
