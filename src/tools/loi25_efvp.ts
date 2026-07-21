/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Outil MCP : Évaluation des facteurs relatifs à la vie privée (EFVP)
 *            (art. 18.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Crée ou consulte une EFVP pour un nouveau projet, un nouveau traitement
 * ou une nouvelle technologie susceptible d'entraîner des risques pour
 * la vie privée.
 *
 * Stocké dans la table `efvp_records` (overmind_core). La table est créée
 * automatiquement (CREATE TABLE IF NOT EXISTS) au premier appel.
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPool } from 'overmind-postgres-mcp';

// ── Schéma Zod ────────────────────────────────────────────────────────────────

export const loi25EfvpSchema = z.object({
  action: z
    .enum(['create', 'list', 'get'])
    .optional()
    .default('list')
    .describe(
      'create: nouvelle EFVP | list: toutes les EFVP | get: une EFVP par project_name',
    ),
  project_name: z
    .string()
    .min(1)
    .describe(
      "Nom unique du projet/traitement évalué (ex: 'agent_memory_v2'). Requis pour create et get.",
    ),
  description: z
    .string()
    .optional()
    .describe('Description du projet et du traitement concerné.'),
  data_categories: z
    .string()
    .optional()
    .describe('Catégories de RP concernées (CSV: "prompts,embeddings,user_ids").'),
  purposes: z
    .string()
    .optional()
    .describe('Finalités du traitement (art. 4).'),
  recipients: z
    .string()
    .optional()
    .describe('Destinataires internes/externes des RP.'),
  retention: z
    .string()
    .optional()
    .describe('Durée et modalités de rétention (ex: "30 jours actif + 5 ans archive").'),
  risks: z
    .string()
    .optional()
    .describe('Risques pour la vie privée (ré-identification, fuite, corrélation...).'),
  mitigations: z
    .string()
    .optional()
    .describe("Mesures d'atténuation (anonymisation, chiffrement, consentement, etc.)."),
});

// ── Type interne pour une ligne EFVP ─────────────────────────────────────────

interface EfvpRow {
  id: string;
  project_name: string;
  description: string | null;
  data_categories: string | null;
  purposes: string | null;
  recipients: string | null;
  retention: string | null;
  risks: string | null;
  mitigations: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tsNow(): number {
  return Date.now();
}

async function ensureEfvpTable(pool: import('pg').Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS efvp_records (
      id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      description TEXT,
      data_categories TEXT,
      purposes TEXT,
      recipients TEXT,
      retention TEXT,
      risks TEXT,
      mitigations TEXT,
      status TEXT DEFAULT 'draft',
      created_at BIGINT,
      updated_at BIGINT
    )
  `);
}

function formatEfvp(row: EfvpRow): string {
  const created = new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 19);
  return [
    `🔍 **${row.project_name}** \`${row.id.slice(0, 8)}\` — _${row.status}_`,
    `  - Description: ${row.description ?? '—'}`,
    `  - Catégories: ${row.data_categories ?? '—'}`,
    `  - Finalités: ${row.purposes ?? '—'}`,
    `  - Destinataires: ${row.recipients ?? '—'}`,
    `  - Rétention: ${row.retention ?? '—'}`,
    `  - Risques: ${row.risks ?? '—'}`,
    `  - Mesures d\u2019atténuation: ${row.mitigations ?? '—'}`,
    `  - Créé: ${created}`,
  ].join('\n');
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export async function loi25Efvp(args: z.infer<typeof loi25EfvpSchema>) {
  try {
    const pool = getPool();
    await ensureEfvpTable(pool);

    const action = args.action ?? 'list';

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (action === 'create') {
      const id = randomUUID();
      const now = tsNow();

      await pool.query(
        `INSERT INTO efvp_records
          (id, project_name, description, data_categories, purposes,
           recipients, retention, risks, mitigations, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11)`,
        [
          id,
          args.project_name,
          args.description ?? null,
          args.data_categories ?? null,
          args.purposes ?? null,
          args.recipients ?? null,
          args.retention ?? null,
          args.risks ?? null,
          args.mitigations ?? null,
          now,
          now,
        ],
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ **EFVP créée** pour \`${args.project_name}\`\nID: \`${id}\`\nStatut: \`draft\` — À réviser par le responsable de la protection des RP avant publication.`,
          },
        ],
      };
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const res = await pool.query<EfvpRow>(
        `SELECT * FROM efvp_records ORDER BY created_at DESC`,
      );

      if (res.rows.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: '📭 Aucune EFVP enregistrée.' },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `🔍 **${res.rows.length} EFVP(s)**\n\n${res.rows.map(formatEfvp).join('\n\n')}`,
          },
        ],
      };
    }

    // ── GET ──────────────────────────────────────────────────────────────────
    if (action === 'get') {
      const res = await pool.query<EfvpRow>(
        `SELECT * FROM efvp_records WHERE project_name = $1`,
        [args.project_name],
      );

      if (res.rows.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `❌ Aucune EFVP pour le projet \`${args.project_name}\`.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: formatEfvp(res.rows[0]) }],
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
          text: `❌ Erreur loi25_efvp: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
