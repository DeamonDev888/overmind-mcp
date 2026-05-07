import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { getWorkspaceDir } from '../lib/config.js';

const SESSIONS_FILE = '.claude/sessions.json';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionEntry {
  id: string;
  ts: number;
}

interface SessionDetails {
  id: string;
  agentName: string;
  runner: string | null;
  timestamp: number;
  date: string;
  key: string;
  age: string;
  expired: boolean;
}

function getSessionsPath(workspaceDir?: string): string {
  return path.resolve(workspaceDir || getWorkspaceDir(), SESSIONS_FILE);
}

async function loadSessions(workspaceDir?: string): Promise<Record<string, SessionEntry | string>> {
  try {
    const filePath = getSessionsPath(workspaceDir);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (_error) {
    return {};
  }
}

async function saveSessions(sessions: Record<string, SessionEntry | string>, workspaceDir?: string): Promise<void> {
  const filePath = getSessionsPath(workspaceDir);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(sessions, null, 2), 'utf-8');
}

function parseKey(key: string): { agentName: string; runner: string | null } {
  const parts = key.split(':');
  if (parts.length === 2) {
    return { runner: parts[0], agentName: parts[1] };
  }
  return { runner: null, agentName: key };
}

function extractSessionInfo(key: string, val: SessionEntry | string, now: number): SessionDetails | null {
  if (!val) return null;

  const sessionId = typeof val === 'string' ? val : val.id;
  const timestamp = typeof val === 'string' ? 0 : val.ts;
  const { agentName, runner } = parseKey(key);

  const age = timestamp > 0 ? formatAge(timestamp) : 'Inconnu';
  const expired = timestamp > 0 && (now - timestamp > SESSION_TTL_MS);

  return {
    id: sessionId,
    agentName,
    runner,
    timestamp,
    date: timestamp > 0 ? new Date(timestamp).toISOString() : 'Unknown',
    key,
    age,
    expired,
  };
}

function formatAge(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `il y a ${days}j`;
  } else if (hours > 0) {
    return `il y a ${hours}h`;
  } else if (minutes > 0) {
    return `il y a ${minutes}min`;
  } else {
    return 'à l\'instant';
  }
}

// Schéma unifié pour le gestionnaire de sessions
export const sessionManagerSchema = z
  .object({
    action: z
      .enum(['list', 'copy', 'delete', 'rename', 'purge', 'stats'])
      .describe("Action à effectuer: 'list', 'copy', 'delete', 'rename', 'purge', 'stats'"),
    // Filtres pour 'list'
    runner: z.string().optional().describe('Filtrer par runner spécifique'),
    agentName: z.string().optional().describe('Nom de l\'agent concerné'),
    includeExpired: z.boolean().optional().default(false).describe('Inclure les sessions expirées (pour list)'),
    // Pour 'copy'
    sourceAgentName: z.string().optional().describe('Nom de l\'agent source (pour copy)'),
    targetAgentName: z.string().optional().describe('Nom de l\'agent cible (pour copy)'),
    sourceRunner: z.string().optional().describe('Runner source (pour copy)'),
    targetRunner: z.string().optional().describe('Runner cible (pour copy)'),
    // Pour 'rename'
    oldAgentName: z.string().optional().describe('Ancien nom de l\'agent (pour rename)'),
    newAgentName: z.string().optional().describe('Nouveau nom de l\'agent (pour rename)'),
    // Optionnel
    workspaceDir: z.string().optional().describe('Répertoire de travail spécifique'),
  })
  .refine(
    (data) => {
      // Validation supplémentaire selon l'action
      if (data.action === 'copy') {
        return data.sourceAgentName && data.targetAgentName;
      }
      if (data.action === 'rename') {
        return data.oldAgentName && data.newAgentName;
      }
      if (data.action === 'delete') {
        return data.agentName;
      }
      return true;
    },
    {
      message: 'Paramètres manquants pour cette action',
    },
  );

// Fonction principale unifiée
export async function sessionManager(args: z.infer<typeof sessionManagerSchema>): Promise<string> {
  const { action } = args;

  try {
    switch (action) {
      case 'list':
        return await listSessionsAction(args);
      case 'copy':
        return await copySessionAction(args);
      case 'delete':
        return await deleteSessionAction(args);
      case 'rename':
        return await renameSessionAction(args);
      case 'purge':
        return await purgeSessionsAction(args);
      case 'stats':
        return await statsSessionsAction(args);
      default:
        return `❌ Action inconnue: ${action}`;
    }
  } catch (error) {
    return `❌ Erreur lors de l'exécution de l'action '${action}': ${error}`;
  }
}

// Action: Lister les sessions
async function listSessionsAction(
  args: z.infer<typeof sessionManagerSchema>,
): Promise<string> {
  const { runner, agentName, includeExpired, workspaceDir } = args;

  const sessions = await loadSessions(workspaceDir);
  const now = Date.now();
  const sessionList: SessionDetails[] = [];

  for (const [key, val] of Object.entries(sessions)) {
    const info = extractSessionInfo(key, val, now);
    if (!info) continue;

    // Filtres
    if (runner && info.runner !== runner) continue;
    if (agentName && info.agentName !== agentName) continue;
    if (!includeExpired && info.expired) continue;

    sessionList.push(info);
  }

  // Trier par date (plus récent en premier)
  sessionList.sort((a, b) => b.timestamp - a.timestamp);

  if (sessionList.length === 0) {
    return '📋 Aucune session trouvée.';
  }

  let output = `📋 **Sessions trouvées : ${sessionList.length}**\n\n`;

  // Grouper par runner
  const groupedByRunner: Record<string, SessionDetails[]> = {};
  const ungrouped: SessionDetails[] = [];

  for (const session of sessionList) {
    if (session.runner) {
      if (!groupedByRunner[session.runner]) {
        groupedByRunner[session.runner] = [];
      }
      groupedByRunner[session.runner].push(session);
    } else {
      ungrouped.push(session);
    }
  }

  // Afficher par runner
  for (const [runnerName, sessions] of Object.entries(groupedByRunner)) {
    const activeCount = sessions.filter((s) => !s.expired).length;
    const expiredCount = sessions.length - activeCount;

    output += `**🤖 ${runnerName}** (${sessions.length} sessions`;
    if (expiredCount > 0) {
      output += `, ⏰ ${expiredCount} expirées`;
    }
    output += ')\n';

    for (const session of sessions) {
      const status = session.expired ? '⏰' : '✅';
      output += `  ${status} ${session.agentName}: ${session.id.substring(0, 8)}... (${session.age})\n`;
    }
    output += '\n';
  }

  // Afficher les sessions sans runner
  if (ungrouped.length > 0) {
    output += `**📁 Sans runner** (${ungrouped.length} sessions)\n`;
    for (const session of ungrouped) {
      const status = session.expired ? '⏰' : '✅';
      output += `  ${status} ${session.agentName}: ${session.id.substring(0, 8)}... (${session.age})\n`;
    }
  }

  return output;
}

// Action: Copier une session
async function copySessionAction(args: z.infer<typeof sessionManagerSchema>): Promise<string> {
  const { sourceAgentName, targetAgentName, sourceRunner, targetRunner, workspaceDir } = args;

  if (!sourceAgentName || !targetAgentName) {
    return '❌ Paramètres manquants: sourceAgentName et targetAgentName sont requis pour copy';
  }

  const sessions = await loadSessions(workspaceDir);

  const sourceKey = sourceRunner ? `${sourceRunner}:${sourceAgentName}` : sourceAgentName;
  const sourceSession = sessions[sourceKey];

  if (!sourceSession) {
    return `❌ Session source non trouvée: ${sourceKey}`;
  }

  const targetKey = targetRunner ? `${targetRunner}:${targetAgentName}` : targetAgentName;

  if (sessions[targetKey]) {
    return `⚠️ Une session existe déjà pour: ${targetKey}. Supprimez-la d'abord avec delete.`;
  }

  const sessionData = typeof sourceSession === 'string'
    ? { id: sourceSession, ts: Date.now() }
    : { ...sourceSession, ts: Date.now() };

  sessions[targetKey] = sessionData;
  await saveSessions(sessions, workspaceDir);

  return `✅ Session copiée avec succès:
  📍 Source: ${sourceKey}
  🎯 Cible: ${targetKey}
  🆔 ID: ${sessionData.id}`;
}

// Action: Supprimer une session
async function deleteSessionAction(args: z.infer<typeof sessionManagerSchema>): Promise<string> {
  const { agentName, runner, workspaceDir } = args;

  if (!agentName) {
    return '❌ Paramètre manquant: agentName est requis pour delete';
  }

  const sessions = await loadSessions(workspaceDir);

  const key = runner ? `${runner}:${agentName}` : agentName;

  if (!sessions[key]) {
    return `❌ Session non trouvée: ${key}`;
  }

  delete sessions[key];
  await saveSessions(sessions, workspaceDir);

  return `✅ Session supprimée avec succès: ${key}`;
}

// Action: Renommer une session
async function renameSessionAction(args: z.infer<typeof sessionManagerSchema>): Promise<string> {
  const { oldAgentName, newAgentName, runner, workspaceDir } = args;

  if (!oldAgentName || !newAgentName) {
    return '❌ Paramètres manquants: oldAgentName et newAgentName sont requis pour rename';
  }

  const sessions = await loadSessions(workspaceDir);

  const oldKey = runner ? `${runner}:${oldAgentName}` : oldAgentName;
  const newKey = runner ? `${runner}:${newAgentName}` : newAgentName;

  if (!sessions[oldKey]) {
    return `❌ Session source non trouvée: ${oldKey}`;
  }

  if (sessions[newKey]) {
    return `⚠️ Une session existe déjà pour: ${newKey}. Supprimez-la d'abord.`;
  }

  sessions[newKey] = sessions[oldKey];
  delete sessions[oldKey];
  await saveSessions(sessions, workspaceDir);

  return `✅ Session renommée avec succès:
  📝 Ancien: ${oldKey}
  ✨ Nouveau: ${newKey}`;
}

// Action: Purger les sessions expirées
async function purgeSessionsAction(args: z.infer<typeof sessionManagerSchema>): Promise<string> {
  const { workspaceDir } = args;

  const sessions = await loadSessions(workspaceDir);
  const now = Date.now();
  let deletedCount = 0;

  for (const [key, val] of Object.entries(sessions)) {
    if (typeof val === 'object' && val !== null && 'ts' in val) {
      if (now - val.ts > SESSION_TTL_MS) {
        delete sessions[key];
        deletedCount++;
      }
    }
  }

  if (deletedCount > 0) {
    await saveSessions(sessions, workspaceDir);
    return `✅ Purge terminée: ${deletedCount} session(s) expirée(s) supprimée(s)`;
  }

  return 'ℹ️ Aucune session expirée à purger';
}

// Action: Statistiques des sessions
async function statsSessionsAction(args: z.infer<typeof sessionManagerSchema>): Promise<string> {
  const { runner, workspaceDir } = args;

  const sessions = await loadSessions(workspaceDir);
  const now = Date.now();

  let totalSessions = 0;
  let expiredSessions = 0;
  let activeSessions = 0;

  const runnerStats: Record<string, { total: number; active: number; expired: number }> = {};

  for (const [key, val] of Object.entries(sessions)) {
    const info = extractSessionInfo(key, val, now);
    if (!info) continue;

    // Filtrer par runner si spécifié
    if (runner && info.runner !== runner) continue;

    totalSessions++;

    if (info.expired) {
      expiredSessions++;
    } else {
      activeSessions++;
    }

    // Statistiques par runner
    if (info.runner) {
      if (!runnerStats[info.runner]) {
        runnerStats[info.runner] = { total: 0, active: 0, expired: 0 };
      }
      runnerStats[info.runner].total++;
      if (info.expired) {
        runnerStats[info.runner].expired++;
      } else {
        runnerStats[info.runner].active++;
      }
    }
  }

  let output = `📊 **Statistiques des sessions**\n\n`;
  output += `**Total:** ${totalSessions} sessions\n`;
  output += `**✅ Actives:** ${activeSessions} sessions\n`;
  output += `**⏰ Expirées:** ${expiredSessions} sessions\n\n`;

  if (Object.keys(runnerStats).length > 0) {
    output += `**Par Runner:**\n`;
    for (const [runnerName, stats] of Object.entries(runnerStats)) {
      const percentage = stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0;
      output += `  🤖 **${runnerName}:** ${stats.active}/${stats.total} actives (${percentage}%)\n`;
    }
  }

  return output;
}