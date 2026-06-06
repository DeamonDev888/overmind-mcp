/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — SessionStore (Multi-Tenant Session Map)         ║
 * ║                                                                      ║
 * ║   Gère une map clé_externe → session_id avec TTL et persistence.     ║
 * ║   Inspiré du pattern bt-sms (phone → sessionId avec TTL 4h).        ║
 * ║                                                                      ║
 * ║   USAGE                                                              ║
 * ║   ─────                                                              ║
 * ║   Clé externe = n'importe quoi : téléphone, user_id, channel_id,     ║
 * ║   conversation_id, etc. Le bridge isole les sessions par clé.        ║
 * ║                                                                      ║
 * ║   {                                                                  ║
 * ║     "agent.run": { agentName, runner, prompt, externalKey: "+1418..." } ║
 * ║   }                                                                  ║
 * ║   → le bridge retrouve ou crée une session pour cette clé,          ║
 * ║   la passe à l'agent, et la sauvegarde dans le store.               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createBridgeLogger, type BridgeLogger } from './utils.js';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface SessionEntry {
  /** Clé externe fournie par le caller (phone, userId, etc.) */
  externalKey: string;
  /** SessionId réel retourné par l'agent (Hermes/Claude/etc.) */
  sessionId: string;
  /** Agent name (pour multi-tenant multi-agent) */
  agentName: string;
  /** Runner utilisé (pour invalidation si le runner change) */
  runner: string;
  /** Timestamp dernière activité */
  lastActivityAt: number;
  /** Contexte additionnel optionnel (le CONTEXT_UPDATE de bt-sms) */
  context?: Record<string, unknown>;
  /** Statut temporaire (idle/busy — optionnel) */
  status?: 'idle' | 'busy';
}

export interface SessionStoreConfig {
  /** Chemin du fichier de persistence (optionnel — si absent, in-memory only) */
  persistPath?: string;
  /** TTL en ms (default: 4h, comme bt-sms) */
  ttlMs?: number;
  /** Cleanup interval en ms (default: 5min) */
  cleanupIntervalMs?: number;
}

export interface SessionContextPatch {
  /** Champs à patcher dans le context */
  patch: Record<string, unknown>;
}

// ─── SessionStore ──────────────────────────────────────────────────────────

export class SessionStore {
  private readonly map = new Map<string, SessionEntry>();
  private readonly log: BridgeLogger;
  private readonly config: Required<Omit<SessionStoreConfig, 'persistPath'>> &
    Pick<SessionStoreConfig, 'persistPath'>;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(config: SessionStoreConfig = {}, logger?: BridgeLogger) {
    this.config = {
      ttlMs: config.ttlMs ?? 4 * 60 * 60 * 1000, // 4h
      cleanupIntervalMs: config.cleanupIntervalMs ?? 5 * 60 * 1000, // 5min
      persistPath: config.persistPath,
    };
    this.log = logger ?? createBridgeLogger('session-store');
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Initialise le store : charge le fichier de persistence si présent,
   * démarre le cleanup périodique.
   */
  async init(): Promise<void> {
    if (this.config.persistPath) {
      try {
        const raw = await fs.readFile(this.config.persistPath, 'utf-8');
        const parsed = JSON.parse(raw) as { sessions: SessionEntry[] };
        const now = Date.now();
        let loaded = 0;
        for (const entry of parsed.sessions ?? []) {
          // Skip les sessions expirées au load
          if (now - entry.lastActivityAt > this.config.ttlMs) continue;
          this.map.set(this.makeKey(entry.externalKey, entry.agentName), entry);
          loaded++;
        }
        this.log.info(`📂 Loaded ${loaded} session(s) from ${this.config.persistPath}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.log.warn(`⚠️  Failed to load sessions: ${(err as Error).message}`);
        }
      }
    }

    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = setInterval(() => this.purgeExpired(), this.config.cleanupIntervalMs);
  }

  /**
   * Arrête le cleanup et persiste l'état final.
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    await this.writeQueue; // attend les writes en cours
    await this.persist();
    this.log.info('🛑 SessionStore closed');
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  /**
   * Récupère une session par (externalKey, agentName).
   * Retourne undefined si absente ou expirée.
   */
  get(externalKey: string, agentName: string): SessionEntry | undefined {
    const key = this.makeKey(externalKey, agentName);
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.map.delete(key);
      return undefined;
    }
    return { ...entry };
  }

  /**
   * Sauvegarde ou met à jour une session. Retourne l'entrée.
   */
  set(entry: Omit<SessionEntry, 'lastActivityAt'> & { lastActivityAt?: number }): SessionEntry {
    const full: SessionEntry = { ...entry, lastActivityAt: entry.lastActivityAt ?? Date.now() };
    const key = this.makeKey(full.externalKey, full.agentName);
    this.map.set(key, full);
    this.schedulePersist();
    return full;
  }

  /**
   * Met à jour uniquement le sessionId (cas typique : après un run, on a le vrai ID).
   */
  updateSessionId(externalKey: string, agentName: string, sessionId: string, runner: string): SessionEntry | undefined {
    const key = this.makeKey(externalKey, agentName);
    const existing = this.map.get(key);
    if (!existing) {
      return this.set({ externalKey, agentName, runner, sessionId });
    }
    existing.sessionId = sessionId;
    existing.runner = runner;
    existing.lastActivityAt = Date.now();
    this.schedulePersist();
    return { ...existing };
  }

  /**
   * Met à jour le context (pattern CONTEXT_UPDATE de bt-sms).
   */
  updateContext(externalKey: string, agentName: string, patch: Record<string, unknown>): SessionEntry | undefined {
    const entry = this.get(externalKey, agentName);
    if (!entry) return undefined;
    entry.context = { ...(entry.context ?? {}), ...patch };
    entry.lastActivityAt = Date.now();
    this.map.set(this.makeKey(externalKey, agentName), entry);
    this.schedulePersist();
    return { ...entry };
  }

  /**
   * Supprime une session.
   */
  delete(externalKey: string, agentName: string): boolean {
    const deleted = this.map.delete(this.makeKey(externalKey, agentName));
    if (deleted) this.schedulePersist();
    return deleted;
  }

  /**
   * Purge toutes les sessions (reset complet).
   */
  clear(): void {
    this.map.clear();
    this.schedulePersist();
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  /**
   * Liste toutes les sessions actives (non expirées).
   */
  list(): SessionEntry[] {
    this.purgeExpired();
    return Array.from(this.map.values()).map((e) => ({ ...e }));
  }

  /**
   * Stats par agent.
   */
  stats(): { total: number; byAgent: Record<string, number> } {
    const byAgent: Record<string, number> = {};
    for (const entry of this.map.values()) {
      byAgent[entry.agentName] = (byAgent[entry.agentName] ?? 0) + 1;
    }
    return { total: this.map.size, byAgent };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private makeKey(externalKey: string, agentName: string): string {
    return `${agentName}::${externalKey}`;
  }

  private isExpired(entry: SessionEntry): boolean {
    return Date.now() - entry.lastActivityAt > this.config.ttlMs;
  }

  private purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.map) {
      if (now - entry.lastActivityAt > this.config.ttlMs) {
        this.map.delete(key);
        purged++;
      }
    }
    if (purged > 0) {
      this.log.info(`🧹 Purged ${purged} expired sessions`);
      this.schedulePersist();
    }
    return purged;
  }

  // ─── Persistence (queued, atomic) ───────────────────────────────────────

  private schedulePersist(): void {
    if (!this.config.persistPath) return;
    this.writeQueue = this.writeQueue.then(() => this.persist()).catch((err) => {
      this.log.error(`Persist error: ${(err as Error).message}`);
    });
  }

  private async persist(): Promise<void> {
    if (!this.config.persistPath) return;
    const data = { sessions: Array.from(this.map.values()) };
    const tmp = this.config.persistPath + '.tmp';
    try {
      await fs.mkdir(path.dirname(this.config.persistPath), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tmp, this.config.persistPath);
    } catch (err) {
      this.log.error(`Failed to persist sessions: ${(err as Error).message}`);
      try {
        await fs.unlink(tmp);
      } catch {
        // ignore
      }
    }
  }
}
