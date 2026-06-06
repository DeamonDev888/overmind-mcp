/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — AgentRegistry (In-Memory State Tracker)          ║
 * ║                                                                      ║
 * ║   Tracke l'état live de chaque agent : busy / idle / offline.        ║
 * ║   Sérialise les appels concurrents vers un même agent via mutex.    ║
 * ║                                                                      ║
 * ║   ARCHITECTURE                                                       ║
 * ║   ─────────────                                                      ║
 * ║   OverBridgeServer → AgentRegistry → (mutex per agent)               ║
 * ║                       → OverBridgeService.runAgent()                ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { Mutex } from 'async-mutex';
import type { RunnerType } from './types.js';
import { createBridgeLogger, type BridgeLogger } from './utils.js';

// ─── Public Types ─────────────────────────────────────────────────────────

export type AgentLiveStatus = 'online' | 'offline' | 'busy' | 'idle';

export interface AgentLiveState {
  name: string;
  runner: RunnerType;
  status: AgentLiveStatus;
  /** PID du process si connu (via agent_control status) */
  pid?: number;
  /** SessionId de l'appel en cours (si busy) */
  currentSessionId?: string;
  /** Timestamp dernière activité (runAgent / heartbeat) */
  lastActivityAt: number;
  /** Compteur de runs total depuis le boot du bridge */
  totalRuns: number;
  /** Compteur de runs échoués */
  totalErrors: number;
  /** Compteur A2A (combien de fois cet agent a été appelé par un autre agent) */
  a2aReceived: number;
  /** Compteur A2A (combien de fois cet agent a appelé un autre agent) */
  a2aSent: number;
}

export interface ListAgentsFilter {
  /** Filtre par status (ex: tous les 'busy') */
  status?: AgentLiveStatus;
  /** Filtre par runner (ex: 'claude', 'hermes') */
  runner?: RunnerType;
}

// ─── AgentRegistry ────────────────────────────────────────────────────────

export class AgentRegistry {
  private readonly states = new Map<string, AgentLiveState>();
  private readonly mutexes = new Map<string, Mutex>();
  private readonly log: BridgeLogger;

  constructor(logger?: BridgeLogger) {
    this.log = logger ?? createBridgeLogger('agent-registry');
  }

  // ─── Mutex Helpers ──────────────────────────────────────────────────────

  /**
   * Récupère (ou crée) le mutex associé à un agent.
   * Garantit qu'un seul appel runAgent tourne à la fois par agent.
   */
  private getMutex(agentName: string): Mutex {
    let mutex = this.mutexes.get(agentName);
    if (!mutex) {
      mutex = new Mutex();
      this.mutexes.set(agentName, mutex);
    }
    return mutex;
  }

  /**
   * Exécute une fonction sous le mutex de l'agent.
   * Bloque si un autre run est en cours sur le même agent.
   */
  async withLock<T>(agentName: string, fn: () => Promise<T>): Promise<T> {
    return this.getMutex(agentName).runExclusive(fn);
  }

  /**
   * Vérifie si un run est actuellement en cours sur cet agent.
   */
  isBusy(agentName: string): boolean {
    return this.getMutex(agentName).isLocked();
  }

  // ─── State Management ───────────────────────────────────────────────────

  /**
   * Initialise ou met à jour l'état d'un agent.
   * Appelé au premier runAgent ou explicitement via register().
   */
  register(agentName: string, runner: RunnerType): AgentLiveState {
    const existing = this.states.get(agentName);
    if (existing) {
      existing.runner = runner; // Update runner if changed
      return existing;
    }
    const state: AgentLiveState = {
      name: agentName,
      runner,
      status: 'online',
      lastActivityAt: Date.now(),
      totalRuns: 0,
      totalErrors: 0,
      a2aReceived: 0,
      a2aSent: 0,
    };
    this.states.set(agentName, state);
    this.log.info(`📝 Agent registered: ${agentName} (${runner})`);
    return state;
  }

  /**
   * Marque un agent comme busy (run en cours).
   */
  markBusy(agentName: string, sessionId?: string, pid?: number): void {
    const state = this.states.get(agentName);
    if (!state) return;
    state.status = 'busy';
    state.currentSessionId = sessionId;
    state.pid = pid;
    state.lastActivityAt = Date.now();
  }

  /**
   * Marque un agent comme idle (run terminé, agent dispo).
   */
  markIdle(agentName: string, success: boolean): void {
    const state = this.states.get(agentName);
    if (!state) return;
    state.status = 'online';
    state.currentSessionId = undefined;
    state.lastActivityAt = Date.now();
    state.totalRuns++;
    if (!success) state.totalErrors++;
  }

  /**
   * Marque un agent comme offline (kill, crash, ou jamais vu).
   */
  markOffline(agentName: string): void {
    const state = this.states.get(agentName);
    if (!state) return;
    state.status = 'offline';
    state.currentSessionId = undefined;
    state.pid = undefined;
  }

  /**
   * Marque un agent comme online (vu récemment, pas en cours).
   */
  markOnline(agentName: string): void {
    const state = this.states.get(agentName);
    if (!state) return;
    state.status = 'online';
    state.lastActivityAt = Date.now();
  }

  /**
   * Incrémente le compteur A2A received (cet agent a été appelé par un autre).
   */
  incrementA2aReceived(agentName: string): void {
    const state = this.states.get(agentName);
    if (state) state.a2aReceived++;
  }

  /**
   * Incrémente le compteur A2A sent (cet agent a appelé un autre).
   */
  incrementA2aSent(agentName: string): void {
    const state = this.states.get(agentName);
    if (state) state.a2aSent++;
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  /**
   * Récupère l'état d'un agent. Retourne undefined si jamais vu.
   */
  get(agentName: string): AgentLiveState | undefined {
    const state = this.states.get(agentName);
    return state ? { ...state } : undefined;
  }

  /**
   * Liste tous les agents connus, optionnellement filtrés.
   */
  list(filter?: ListAgentsFilter): AgentLiveState[] {
    const all = Array.from(this.states.values()).map((s) => ({ ...s }));
    if (!filter) return all;

    return all.filter((s) => {
      if (filter.status && s.status !== filter.status) return false;
      if (filter.runner && s.runner !== filter.runner) return false;
      return true;
    });
  }

  /**
   * Liste les agents actuellement busy (utile pour /status global).
   */
  listBusy(): AgentLiveState[] {
    return this.list({ status: 'busy' });
  }

  /**
   * Liste les agents online et idle (disponibles pour run).
   */
  listAvailable(): AgentLiveState[] {
    return this.list().filter((s) => s.status === 'online' || s.status === 'idle');
  }

  /**
   * Statistiques globales du registry.
   */
  stats(): {
    total: number;
    online: number;
    busy: number;
    offline: number;
    totalRuns: number;
    totalErrors: number;
  } {
    const all = Array.from(this.states.values());
    return {
      total: all.length,
      online: all.filter((s) => s.status === 'online').length,
      busy: all.filter((s) => s.status === 'busy').length,
      offline: all.filter((s) => s.status === 'offline').length,
      totalRuns: all.reduce((acc, s) => acc + s.totalRuns, 0),
      totalErrors: all.reduce((acc, s) => acc + s.totalErrors, 0),
    };
  }

  /**
   * Purge les agents offline depuis plus de `maxAgeMs`.
   * Évite que la map grossisse indéfiniment.
   */
  prune(maxAgeMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;
    for (const [name, state] of this.states) {
      if (state.status === 'offline' && state.lastActivityAt < cutoff) {
        this.states.delete(name);
        this.mutexes.delete(name);
        pruned++;
      }
    }
    if (pruned > 0) {
      this.log.info(`🧹 Pruned ${pruned} stale offline agents`);
    }
    return pruned;
  }
}
