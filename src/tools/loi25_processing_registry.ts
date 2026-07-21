/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Outil MCP : Registre des traitements (art. 3-3.1 / 35.18)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Consulte, crée ou modifie le registre des traitements de renseignements
 * personnels (table `processing_registry` dans `overmind_core`).
 *
 * Liste également les providers LLM documentés depuis PROVIDER_REGISTRY
 * (cartographie des transferts hors QC — art. 21-22).
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPool } from 'overmind-postgres-mcp';
import { listDocumentedProviders } from '../lib/loi25/transfer_map.js';
import type { ProcessingEntry } from '../lib/loi25/types.js';

// ── Schéma Zod ────────────────────────────────────────────────────────────────

export const loi25ProcessingRegistrySchema = z.object({
  action: z
    .enum(['list', 'get', 'create', 'update'])
    .optional()
    .default('list')
    .describe(
      'list: tous les traitements + providers documentés | ' +
        'get: un traitement par nom | ' +
        'create: nouveau traitement | ' +
        'update: modifie un traitement existant',
    ),
  name: z
    .string()
    .optional()
    .describe("Nom unique du traitement (ex: 'llm_inference'). Requis pour get/create/update."),
  purpose: z
    .string()
    .optional()
    .describe('Finalité du traitement (art. 4). Requis pour create.'),
  legal_basis: z
    .string()
    .optional()
    .describe(
      "Base légale: 'consent' | 'contract' | 'legitimate_interest' | 'legal_obligation'.",
    ),
  data_categories: z
    .string()
    .optional()
    .describe('Catégories de RP traitées (CSV: "prompts,embeddings,user_ids").'),
  recipients: z
    .string()
    .optional()
    .describe('Destinataires des RP (CSV: "anthropic,PostgreSQL local").'),
  retention_days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Durée de rétention active en jours (défaut: .env OVERMIND_LOI25_RETENTION_DAYS).'),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function tsNow(): number {
  return Date.now();
}

function formatEntry(e: ProcessingEntry): string {
  return [
    `• **${e.name}** \`${e.id.slice(0, 8)}\``,
    `  - Finalité: ${e.purpose}`,
    `  - Base légale: \`${e.legal_basis}\``,
    `  - Catégories: ${e.data_categories ?? '—'}`,
    `  - Destinataires: ${e.recipients ?? '—'}`,
    `  - Rétention: ${e.retention_days} jours`,
  ].join('\n');
}

function formatProvider(p: {
  name: string;
  region: string;
  mechanism: string;
  documented: boolean;
  notes?: string;
}): string {
  const doc = p.documented ? '✅' : '⚠️';
  return `- ${doc} **${p.name}** — région \`${p.region}\`, mécanisme \`${p.mechanism}\`${p.notes ? ` — ${p.notes}` : ''}`;
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export async function loi25ProcessingRegistry(args: z.infer<typeof loi25ProcessingRegistrySchema>) {
  try {
    const pool = getPool();
    const action = args.action ?? 'list';

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const res = await pool.query<ProcessingEntry>(
        `SELECT * FROM processing_registry ORDER BY name ASC`,
      );

      const providers = listDocumentedProviders().map((p) => ({
        name: p.name,
        region: p.region,
        mechanism: p.mechanism,
        documented: p.documented,
        notes: p.notes,
      }));

      const entriesBlock =
        res.rows.length > 0
          ? res.rows.map(formatEntry).join('\n\n')
          : '_Aucun traitement enregistré._';

      const providersBlock =
        providers.length > 0
          ? providers.map(formatProvider).join('\n')
          : '_Aucun provider documenté._';

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `📚 **Registre des traitements** (${res.rows.length} entrée(s))`,
              '',
              entriesBlock,
              '',
              `🌐 **Cartographie des transferts** (${providers.length} provider(s))`,
              '',
              providersBlock,
            ].join('\n'),
          },
        ],
      };
    }

    // ── GET ──────────────────────────────────────────────────────────────────
    if (action === 'get') {
      if (!args.name) {
        return {
          content: [{ type: 'text' as const, text: '❌ Paramètre `name` requis pour get.' }],
          isError: true,
        };
      }
      const res = await pool.query<ProcessingEntry>(
        `SELECT * FROM processing_registry WHERE name = $1`,
        [args.name],
      );
      if (res.rows.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Aucun traitement nommé \`${args.name}\`.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: 'text' as const, text: formatEntry(res.rows[0]) },
        ],
      };
    }

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (action === 'create') {
      if (!args.name || !args.purpose) {
        return {
          content: [
            {
              type: 'text' as const,
              text: '❌ `name` et `purpose` sont requis pour create.',
            },
          ],
          isError: true,
        };
      }
      const id = randomUUID();
      const now = tsNow();
      const retentionDays =
        args.retention_days ??
        parseInt(process.env.OVERMIND_LOI25_RETENTION_DAYS || '30', 10);

      try {
        await pool.query(
          `INSERT INTO processing_registry
            (id, name, purpose, legal_basis, data_categories, recipients, retention_days, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            args.name,
            args.purpose,
            args.legal_basis ?? 'legitimate_interest',
            args.data_categories ?? null,
            args.recipients ?? null,
            retentionDays,
            now,
            now,
          ],
        );
      } catch (err) {
        // Conflit d'unicité sur name
        if (err instanceof Error && /duplicate|unique/i.test(err.message)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Un traitement nommé \`${args.name}\` existe déjà. Utilisez action="update".`,
              },
            ],
            isError: true,
          };
        }
        throw err;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ **Traitement créé**: \`${args.name}\`\nID: \`${id}\`\nBase légale: \`${args.legal_basis ?? 'legitimate_interest'}\` | Rétention: ${retentionDays} jours`,
          },
        ],
      };
    }

    // ── UPDATE ───────────────────────────────────────────────────────────────
    if (action === 'update') {
      if (!args.name) {
        return {
          content: [
            { type: 'text' as const, text: '❌ `name` requis pour update.' },
          ],
          isError: true,
        };
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if (args.purpose !== undefined) {
        sets.push(`purpose = $${i++}`);
        values.push(args.purpose);
      }
      if (args.legal_basis !== undefined) {
        sets.push(`legal_basis = $${i++}`);
        values.push(args.legal_basis);
      }
      if (args.data_categories !== undefined) {
        sets.push(`data_categories = $${i++}`);
        values.push(args.data_categories);
      }
      if (args.recipients !== undefined) {
        sets.push(`recipients = $${i++}`);
        values.push(args.recipients);
      }
      if (args.retention_days !== undefined) {
        sets.push(`retention_days = $${i++}`);
        values.push(args.retention_days);
      }

      if (sets.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: '❌ Aucun champ à mettre à jour (fournir purpose, legal_basis, data_categories, recipients ou retention_days).',
            },
          ],
          isError: true,
        };
      }

      sets.push(`updated_at = $${i++}`);
      values.push(tsNow());

      values.push(args.name); // WHERE name = $N
      const res = await pool.query(
        `UPDATE processing_registry SET ${sets.join(', ')} WHERE name = $${i}`,
        values,
      );

      if (res.rowCount === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Aucun traitement nommé \`${args.name}\`.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ **Traitement mis à jour**: \`${args.name}\` (${sets.length - 1} champ(s))`,
          },
        ],
      };
    }

    // unreachable — action est un enum exhaustif
    return {
      content: [
        { type: 'text' as const, text: `❌ Action inconnue: ${action}` },
      ],
      isError: true,
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `❌ Erreur loi25_processing_registry: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
