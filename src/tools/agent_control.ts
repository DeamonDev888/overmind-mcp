import { z } from 'zod';
import {
  getProcessStatus,
  killAgent,
  ProcessEntry,
} from '../lib/processRegistry.js';

/**
 * agent_control — Outil MCP unifié pour contrôler le cycle de vie des agents OverMind
 * ================================================================================
 *
 * Cet outil remplace les 4 outils individuels précédents :
 *   - get_agent_status  → action: "status"
 *   - stream_agent_output → action: "stream"
 *   - kill_agent         → action: "kill"
 *   - wait_agent         → action: "wait"
 *
 * L'UNIFICATION est intentionnelle :
 *   - Un seul appel MCP pour la toolbox du client (pas 4 imports)
 *   - Cohérence des paramètres (agentName, runner, config communs)
 *   - Comportement déterministe : chaque action a une sémantique claire
 *   - Debugging simplifié : une seule source de vérité
 *
 * ─── SÉMANTIQUE DES ACTIONS ──────────────────────────────────────────────────
 *
 * status ─── Lecture pure, zero side-effect
 *   → Retourne l'état courant du process (pid, status, sessionId, outputBuffer)
 *   → NE MODIFIE PAS le registry (pas de mise à jour de timestamps artificiels)
 *   → Use-case : dashboard, polling léger, diagnostic
 *
 * stream ─── Lecture + indicateur de complétude
 *   → Retourne outputBuffer ET un flag isComplete
 *   → Use-case : récupérer la sortie en temps réel sans savoir si c'est fini
 *   → Option sinceTimestamp pour ne récupérer que le增量 (si implémenté)
 *
 * kill ─── Action destructive, irréversible
 *   → Tue le process tree via taskkill /F /T (Windows) ou kill -9 (Unix)
 *   → Met à jour le status → 'failed' dans le registry
 *   → Use-case : abort d'urgence, kill-switch
 *
 * wait ─── Blocage async avec polling
 *   → Poll toutes les 1s jusqu'à status !== 'running' ou timeout
 *   → Retourne le résultat final (outputBuffer ou erreur)
 *   → Use-case : synchronisation dans un workflow d'orchestration
 *
 * ─── ÉTATS DU PROCESS ─────────────────────────────────────────────────────────
 *
 * running  → Process actif, PID valide, output en cours d'accumulation
 * done     → Process terminé avec code 0, outputBuffer gelé
 * failed   → Process terminé avec erreur (exit code != 0 ou crash)
 * orphaned → Parent mort mais child tourne encore (detecté via isPidAlive)
 *
 * ─── ERREURS COMMUNES ─────────────────────────────────────────────────────────
 *
 * AGENT_NOT_FOUND    → Agent absent du registry (jamais lancé ou déjà nettoyé)
 * AGENT_NOT_RUNNING  → Action "kill" sur un agent déjà terminé
 * KILL_FAILED        → taskkill/kill a échoué (pas assez de permissions, etc.)
 * WAIT_TIMEOUT       → Action "wait" a atteint le timeout sans terminaison
 * ORPHANED_PROCESS    → Status 'orphaned' détecté (process zombie)
 *
 * ─── EXEMPLES ─────────────────────────────────────────────────────────────────
 *
 * // Vérifier si un agent tourne encore
 * agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "status" })
 *
 * // Récupérer la sortie sans bloquer
 * agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "stream" })
 *
 * // Forcer l'arrêt d'un agent
 * agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "kill" })
 *
 * // Attendre la fin d'un agent (max 5 min)
 * agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "wait", timeoutMs: 300000 })
 */

// ─── SCHÉMA ZOD ────────────────────────────────────────────────────────────────

export const agentControlSchema = z
  .object({
    agentName: z.string().describe('Nom unique de l agent à contrôler'),
    runner: z
      .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
      .optional()
      .describe("Type de runner de l'agent (optionnel — déduit du registry si omis)"),
    config: z
      .string()
      .optional()
      .describe('Chemin racine Overmind (dossier contenant .claude/)'),
    action: z
      .enum(['status', 'stream', 'kill', 'wait'])
      .describe(
        'Action à effectuer.\n' +
          '  status  — Lire l\'état courant (pid, status, sessionId, outputBuffer)\n' +
          '  stream  — Lire l\'output en temps réel + flag isComplete\n' +
          '  kill    — Forcer l\'arrêt du process tree (irréversible)\n' +
          '  wait    — Bloquer jusqu\'à terminaison naturelle (max timeoutMs)',
      ),
    timeoutMs: z
      .number()
      .optional()
      .default(900000)
      .describe('Timeout pour action="wait" en ms (défaut: 900000 = 15 min)'),
    sinceTimestamp: z
      .number()
      .optional()
      .describe('Pour action="stream" : ne retourner que l\'output après ce timestamp (ms epoch)'),
  })
  .passthrough();

export type AgentControlArgs = z.infer<typeof agentControlSchema>;

// ─── TYPES INTERNES ────────────────────────────────────────────────────────────

interface ControlResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Construit un rapport d'état formaté depuis une ProcessEntry */
function formatStatus(entry: ProcessEntry, _action: string): string {
  const lines: string[] = [];

  lines.push(`**Agent:** ${entry.agentName}`);
  lines.push(`**Runner:** ${entry.runner || 'inconnu'}`);
  lines.push(`**Status:** ${entry.status}`);
  lines.push(`**Started:** ${new Date(entry.ts).toISOString()}`);

  if (entry.pid) lines.push(`**PID:** ${entry.pid}`);
  if (entry.id) lines.push(`**Session ID:** ${entry.id}`);
  if (entry.exitCode !== null && entry.exitCode !== undefined) {
    lines.push(`**Exit Code:** ${entry.exitCode}`);
  }
  if (entry.lastOutputAt) {
    lines.push(`**Last Output:** ${new Date(entry.lastOutputAt).toISOString()}`);
  }

  const bufLen = entry.outputBuffer?.length ?? 0;
  if (bufLen > 0) {
    lines.push(`\n**Output Buffer (${bufLen} chars):**`);
    // On limite l'output dans le rapport à 2000 derniers caractères
    const preview = entry.outputBuffer.slice(-2000);
    lines.push('```');
    lines.push(preview);
    lines.push('```');
  } else {
    lines.push('\n_(output vide ou pas encore de sortie)_');
  }

  return lines.join('\n');
}

/** Récupère l'entrée depuis le registry ou retourne une erreur structurée */
async function resolveEntry(
  agentName: string,
  runner: string | undefined,
  configPath: string | undefined,
): Promise<ProcessEntry | { error: string; code: string }> {
  const entry = await getProcessStatus(agentName, runner, configPath);

  if (!entry) {
    return {
      error: `Agent "${agentName}" (runner: ${runner || 'any'}) non trouvé dans le registry. ` +
        `Il n'est pas en cours d'exécution ou a été nettoyé (TTL 1h après terminaison).`,
      code: 'AGENT_NOT_FOUND',
    };
  }

  return entry;
}

/** Action STATUS — lecture pure */
async function doStatus(
  agentName: string,
  runner: string | undefined,
  configPath: string | undefined,
): Promise<ControlResult> {
  const resolved = await resolveEntry(agentName, runner, configPath);

  if ('error' in resolved) {
    return { content: [{ type: 'text', text: resolved.error }], isError: true };
  }

  const isZombie = resolved.status === 'running' && !!resolved.pid;

  return {
    content: [{ type: 'text', text: formatStatus(resolved, 'status') }],
    isError: isZombie,
  };
}

/** Action STREAM — lecture + complétude */
async function doStream(
  agentName: string,
  runner: string | undefined,
  configPath: string | undefined,
  sinceTimestamp?: number,
): Promise<ControlResult> {
  const resolved = await resolveEntry(agentName, runner, configPath);

  if ('error' in resolved) {
    return { content: [{ type: 'text', text: resolved.error }], isError: true };
  }

  const isComplete =
    resolved.status === 'done' ||
    resolved.status === 'failed' ||
    resolved.status === 'orphaned';

  const output = resolved.outputBuffer || '';

  // Filtering by sinceTimestamp is best-effort if lastOutputAt is available
  if (sinceTimestamp && resolved.lastOutputAt && resolved.lastOutputAt > sinceTimestamp) {
    // NOTE: per-chunk timestamps ne sont pas encore implémentés dans processRegistry.
    // Pour l'instant on retourne tout l'outputBuffer. La filtering precise
    // nécéssite d'ajouter un tableau de chunks avec timestamps dans ProcessEntry.
  }

  const lines: string[] = [];

  lines.push(`**Agent:** ${resolved.agentName}`);
  lines.push(`**Status:** ${resolved.status}`);
  lines.push(`**isComplete:** ${isComplete}`);
  if (resolved.pid) lines.push(`**PID:** ${resolved.pid}`);
  if (resolved.lastOutputAt) {
    lines.push(`**Last Output At:** ${new Date(resolved.lastOutputAt).toISOString()}`);
  }

  lines.push(`\n**Output (${output.length} chars):**`);
  lines.push('```');
  lines.push(output || '(no output yet)');
  lines.push('```');

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    isError: isComplete && resolved.status === 'failed',
  };
}

/** Action KILL — destruction */
async function doKill(
  agentName: string,
  runner: string | undefined,
  configPath: string | undefined,
): Promise<ControlResult> {
  const resolved = await resolveEntry(agentName, runner, configPath);

  if ('error' in resolved) {
    return { content: [{ type: 'text', text: resolved.error }], isError: true };
  }

  if (resolved.status !== 'running') {
    return {
      content: [
        {
          type: 'text',
          text: `Agent "${agentName}" n'est pas en cours d'exécution (status: ${resolved.status}). ` +
            `Impossible de tuer un agent déjà terminé.`,
        },
      ],
      isError: true,
    };
  }

  const killResult = await killAgent(agentName, runner, configPath);

  if (!killResult.killed) {
    return {
      content: [
        {
          type: 'text',
          text: `Échec du kill pour "${agentName}". ` +
            `Le process n'a pas pu être terminé (possible: permissions insuffisantes, ` +
            `process déjà terminé entre-temps).`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Agent "${agentName}" tué avec succès (PID: ${killResult.pid}). ` +
          `Status mis à jour → 'failed' dans le registry.`,
      },
    ],
  };
}

/** Action WAIT — blocage async */
async function doWait(
  agentName: string,
  runner: string | undefined,
  configPath: string | undefined,
  timeoutMs: number,
): Promise<ControlResult> {
  const start = Date.now();
  const pollInterval = 1000; // 1 seconde entre chaque poll

  // Premier check immédiat
  {
    const resolved = await resolveEntry(agentName, runner, configPath);
    if ('error' in resolved) {
      return { content: [{ type: 'text', text: resolved.error }], isError: true };
    }

    if (resolved.status === 'done') {
      return {
        content: [
          {
            type: 'text',
            text: resolved.outputBuffer || 'Agent terminé avec succès.',
          },
        ],
      };
    }

    if (resolved.status === 'failed' || resolved.status === 'orphaned') {
      return {
        content: [
          {
            type: 'text',
            text: `Agent terminé avec erreur (${resolved.status}):\n\n${resolved.outputBuffer || 'N/A'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Boucle de polling
  while (Date.now() - start < timeoutMs) {
    await new Promise<void>((r) => setTimeout(r, pollInterval));

    const resolved = await resolveEntry(agentName, runner, configPath);

    if ('error' in resolved) {
      return { content: [{ type: 'text', text: resolved.error }], isError: true };
    }

    if (resolved.status === 'done') {
      return {
        content: [
          {
            type: 'text',
            text: resolved.outputBuffer || 'Agent terminé avec succès.',
          },
        ],
      };
    }

    if (resolved.status === 'failed' || resolved.status === 'orphaned') {
      return {
        content: [
          {
            type: 'text',
            text: `Agent terminé avec erreur (${resolved.status}):\n\n${resolved.outputBuffer || 'N/A'}`,
          },
        ],
        isError: true,
      };
    }

    // Status still 'running' — continue polling
  }

  // Timeout atteint
  return {
    content: [
      {
        type: 'text',
        text: `Timeout de ${timeoutMs}ms atteint. ` +
          `L'agent "${agentName}" est toujours en cours d'exécution (status: running). ` +
          `Utilisez action="kill" pour forcer l'arrêt ou augmentez timeoutMs.`,
      },
    ],
    isError: true,
  };
}

// ─── FONCTION PRINCIPALE ───────────────────────────────────────────────────────

export async function agentControl(args: AgentControlArgs): Promise<ControlResult> {
  const { agentName, runner, config: configPath, action, timeoutMs, sinceTimestamp } = args;

  switch (action) {
    case 'status':
      return doStatus(agentName, runner, configPath);
    case 'stream':
      return doStream(agentName, runner, configPath, sinceTimestamp);
    case 'kill':
      return doKill(agentName, runner, configPath);
    case 'wait':
      return doWait(agentName, runner, configPath, timeoutMs ?? 900000);
  }
}