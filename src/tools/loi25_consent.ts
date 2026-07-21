/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Gestion du consentement (art. 8.1-8.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Trois actions :
 *   - `grant`   : enregistre un nouveau consentement dans consent_records
 *   - `revoke`  : marque withdrawn_at = now() sur le consentement actif
 *   - `check`   : vérifie la validité d'un consentement pour une finalité
 *
 * Le consentement doit être libre, éclairé, spécifique à une finalité (art. 8.1)
 * et peut être révoqué à tout moment (art. 8.2). Une preuve (evidence) peut être
 * attachée pour audit (hash du message Discord, log, etc.).
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getPool } from 'overmind-postgres-mcp';
import { logAccess } from '../lib/loi25/guard.js';
import type { LegalBasis } from '../lib/loi25/types.js';

export const loi25ConsentSchema = z.object({
  action: z
    .enum(['grant', 'revoke', 'check'])
    .describe("'grant' : accorder | 'revoke' : révoquer | 'check' : vérifier"),
  data_subject_id: z.string().min(1).describe('Identifiant pseudonymisé du sujet'),
  purpose: z
    .string()
    .optional()
    .default('agent_execution')
    .describe("Finalité du traitement (ex: 'agent_execution', 'memory_storage', 'embedding')"),
  legal_basis: z
    .enum(['consent', 'contract', 'legitimate_interest', 'legal_obligation'])
    .optional()
    .default('consent')
    .describe('Base légale invoquée'),
  expires_in_days: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Durée de validité en jours (optionnel, sinon perpétuel tant que non révoqué)'),
  evidence: z
    .string()
    .optional()
    .describe('Preuve du consentement (hash du message, ID log, etc.) pour audit'),
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function loi25Consent(args: z.infer<typeof loi25ConsentSchema>) {
  try {
    const pool = getPool();
    const subjectId = args.data_subject_id;
    const purpose = args.purpose;
    const now = Date.now();

    // ── Action : GRANT ──────────────────────────────────────────────────────
    if (args.action === 'grant') {
      const consentId = randomUUID();
      const expiresAt = args.expires_in_days
        ? now + args.expires_in_days * MS_PER_DAY
        : null;

      // S'assurer que le sujet existe dans data_subjects (upsert minimal)
      await pool.query(
        `INSERT INTO data_subjects (id, display_name, source, created_at, metadata)
         VALUES ($1, NULL, 'api', $2, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [subjectId, now],
      );

      await pool.query(
        `INSERT INTO consent_records
           (id, data_subject_id, purpose, legal_basis, granted_at, expires_at, withdrawn_at, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
        [
          consentId,
          subjectId,
          purpose,
          args.legal_basis,
          now,
          expiresAt,
          args.evidence ?? null,
        ],
      );

      await logAccess({
        dataSubjectId: subjectId,
        accessedBy: 'loi25_consent',
        action: 'write',
        resourceType: 'consent_record',
        resourceId: consentId,
        purpose: `loi25_consent_grant:${purpose}`,
      }).catch(() => {});

      return {
        content: [
          {
            type: 'text' as const,
            text:
              `✅ **Consentement accordé** — Loi 25 art. 8.1\n\n` +
              `**Sujet :** \`${subjectId}\`\n` +
              `**Consent ID :** \`${consentId}\`\n` +
              `**Finalité :** ${purpose}\n` +
              `**Base légale :** ${args.legal_basis}\n` +
              `**Expire :** ${expiresAt ? new Date(expiresAt).toISOString() : 'jamais (jusqu\'à révocation)'}\n` +
              (args.evidence ? `**Preuve :** \`${args.evidence}\`\n` : ''),
          },
        ],
      };
    }

    // ── Action : REVOKE ─────────────────────────────────────────────────────
    if (args.action === 'revoke') {
      // Révoque le consentement le plus récent pour cette finalité
      const res = await pool.query(
        `UPDATE consent_records
         SET withdrawn_at = $3
         WHERE data_subject_id = $1
           AND purpose = $2
           AND withdrawn_at IS NULL
         RETURNING id, granted_at, expires_at`,
        [subjectId, purpose, now],
      );

      const revokedCount = res.rowCount ?? 0;

      await logAccess({
        dataSubjectId: subjectId,
        accessedBy: 'loi25_consent',
        action: 'write',
        resourceType: 'consent_record',
        resourceId: revokedCount > 0 ? (res.rows[0] as { id: string }).id : 'none',
        purpose: `loi25_consent_revoke:${purpose}`,
      }).catch(() => {});

      if (revokedCount === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `⚠️ **Aucun consentement actif à révoquer**\n\n` +
                `Sujet : \`${subjectId}\` | Finalité : \`${purpose}\`\n` +
                `_Aucun enregistrement trouvé ou déjà révoqué._`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text:
              `🚫 **Consentement révoqué** — Loi 25 art. 8.2\n\n` +
              `**Sujet :** \`${subjectId}\`\n` +
              `**Finalité :** ${purpose}\n` +
              `**Révoqué le :** ${new Date(now).toISOString()}\n` +
              `**Enregistrements affectés :** ${revokedCount}`,
          },
        ],
      };
    }

    // ── Action : CHECK ──────────────────────────────────────────────────────
    const res = await pool.query(
      `SELECT id, purpose, legal_basis, granted_at, expires_at, withdrawn_at, evidence
       FROM consent_records
       WHERE data_subject_id = $1 AND purpose = $2
       ORDER BY granted_at DESC
       LIMIT 1`,
      [subjectId, purpose],
    );

    await logAccess({
      dataSubjectId: subjectId,
      accessedBy: 'loi25_consent',
      action: 'read',
      resourceType: 'consent_record',
      resourceId: purpose,
      purpose: 'loi25_consent_check',
    }).catch(() => {});

    if (res.rows.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `❓ **Aucun consentement trouvé**\n\n` +
              `Sujet : \`${subjectId}\` | Finalité : \`${purpose}\`\n` +
              `_Aucun consentement enregistré pour cette finalité._`,
          },
        ],
      };
    }

    const consent = res.rows[0] as {
      id: string;
      purpose: string;
      legal_basis: string;
      granted_at: string;
      expires_at: string | null;
      withdrawn_at: string | null;
      evidence: string | null;
    };

    const grantedAt = parseInt(consent.granted_at, 10);
    const expiresAt = consent.expires_at ? parseInt(consent.expires_at, 10) : null;
    const withdrawnAt = consent.withdrawn_at ? parseInt(consent.withdrawn_at, 10) : null;

    let status: string;
    let statusEmoji: string;
    if (withdrawnAt && withdrawnAt <= now) {
      status = 'révoqué';
      statusEmoji = '🚫';
    } else if (expiresAt && expiresAt <= now) {
      status = 'expiré';
      statusEmoji = '⏰';
    } else {
      status = 'valide';
      statusEmoji = '✅';
    }

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `${statusEmoji} **Consentement ${status}**\n\n` +
            `**Sujet :** \`${subjectId}\`\n` +
            `**Consent ID :** \`${consent.id}\`\n` +
            `**Finalité :** ${consent.purpose}\n` +
            `**Base légale :** ${consent.legal_basis as LegalBasis}\n` +
            `**Accordé le :** ${new Date(grantedAt).toISOString()}\n` +
            (expiresAt ? `**Expire le :** ${new Date(expiresAt).toISOString()}\n` : '') +
            (withdrawnAt ? `**Révoqué le :** ${new Date(withdrawnAt).toISOString()}\n` : '') +
            (consent.evidence ? `**Preuve :** \`${consent.evidence}\`\n` : ''),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur loi25_consent: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
