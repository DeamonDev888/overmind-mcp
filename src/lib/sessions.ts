import fs from 'fs/promises';
import path from 'path';
import { getWorkspaceDir } from './config.js';

const SESSIONS_FILE = '.claude/sessions.json';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionEntry {
  id: string;
  ts: number;
}

function getSessionsPath(workspaceDir?: string): string {
  return path.resolve(workspaceDir || getWorkspaceDir(), SESSIONS_FILE);
}

function buildKey(runner: string | undefined, agentName: string): string {
  return runner ? `${runner}:${agentName}` : agentName;
}

async function purgeExpired(sessions: Record<string, SessionEntry | string>): Promise<Record<string, SessionEntry | string>> {
  const now = Date.now();
  const purged: Record<string, SessionEntry | string> = {};
  let changed = false;
  for (const [key, val] of Object.entries(sessions)) {
    if (typeof val === 'object' && val !== null && 'ts' in val) {
      if (now - val.ts < SESSION_TTL_MS) {
        purged[key] = val;
      } else {
        changed = true;
      }
    } else {
      purged[key] = val;
    }
  }
  return changed ? purged : sessions;
}

function normalizeToEntry(val: SessionEntry | string | null | undefined): SessionEntry | null {
  if (!val) return null;
  if (typeof val === 'string') {
    return { id: val, ts: Date.now() };
  }
  return val;
}

function extractId(val: SessionEntry | string | null | undefined): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  return val.id || null;
}

export async function getLastSessionId(agentName: string, workspaceDir?: string, runner?: string): Promise<string | null> {
  try {
    const filePath = getSessionsPath(workspaceDir);
    const content = await fs.readFile(filePath, 'utf-8');
    let sessions: Record<string, SessionEntry | string> = JSON.parse(content);
    sessions = await purgeExpired(sessions);

    const namespacedKey = buildKey(runner, agentName);
    if (sessions[namespacedKey]) {
      return extractId(sessions[namespacedKey]);
    }
    return extractId(sessions[agentName]) || null;
  } catch (_error) {
    return null;
  }
}

export async function saveSessionId(agentName: string, sessionId: string, workspaceDir?: string, runner?: string): Promise<void> {
  const filePath = getSessionsPath(workspaceDir);
  const dir = path.dirname(filePath);

  try {
    await fs.mkdir(dir, { recursive: true });

    let sessions: Record<string, SessionEntry | string> = {};
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      sessions = JSON.parse(content);
      sessions = await purgeExpired(sessions);
    } catch (_e) {
      // Ignore error (file new)
    }

    const key = buildKey(runner, agentName);
    sessions[key] = { id: sessionId, ts: Date.now() };
    await fs.writeFile(filePath, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Failed to save session ID for ${agentName}:`, error);
  }
}

export async function deleteSessionId(agentName: string, workspaceDir?: string, runner?: string): Promise<void> {
  const filePath = getSessionsPath(workspaceDir);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    let sessions: Record<string, SessionEntry | string> = JSON.parse(content);

    const namespacedKey = buildKey(runner, agentName);
    let deleted = false;
    if (sessions[namespacedKey]) {
      delete sessions[namespacedKey];
      deleted = true;
    }
    if (sessions[agentName]) {
      delete sessions[agentName];
      deleted = true;
    }

    if (deleted) {
      sessions = await purgeExpired(sessions);
      await fs.writeFile(filePath, JSON.stringify(sessions, null, 2), 'utf-8');
    }
  } catch (_e) {
    // Ignore
  }
}
