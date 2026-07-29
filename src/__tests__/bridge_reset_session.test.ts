/**
 * Tests unitaires — OverBridgeService.resetSession() avec purge state.db
 *
 * Valide le fix du problème de session fantôme :
 *   Le runner Hermes persiste l'historique dans <profilePath>/memories/state.db.
 *   Sans purge, un reset de l'ID mémoire laisse l'historique en place et la
 *   prochaine session réutilise le contexte obsolète.
 *
 * Scénarios testés :
 *   1. resetSession() sans agentName → reset mémoire seul (back-compat)
 *   2. resetSession(agentName) → purge state.db + WAL + SHM du profile ciblé
 *   3. Reset mémoire toujour réussi même si la purge échoue
 *   4. Anti path-traversal : refuse de purger hors du Hermes home partagé
 *   5. Profil inexistant → pas d'erreur, juste rien à purger
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ORIGINAL_ENV = { ...process.env };
const TMP_DIRS: string[] = [];

function makeTmpHermesHome(label: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `om-reset-${label}-`));
  TMP_DIRS.push(d);
  return d;
}

/** Create a fake profile layout with state.db + WAL/SHM files. */
function createFakeProfile(hermesHome: string, agentName: string): string {
  const profilePath = path.join(hermesHome, 'profiles', agentName);
  const memoriesDir = path.join(profilePath, 'memories');
  fs.mkdirSync(memoriesDir, { recursive: true });
  // Simulate an active SQLite DB with its WAL and SHM siblings
  fs.writeFileSync(path.join(memoriesDir, 'state.db'), 'SQLITE-CONTENT-MAIN');
  fs.writeFileSync(path.join(memoriesDir, 'state.db-wal'), 'SQLITE-CONTENT-WAL');
  fs.writeFileSync(path.join(memoriesDir, 'state.db-shm'), 'SQLITE-CONTENT-SHM');
  return profilePath;
}

beforeEach(() => {
  // Clean env so each test starts fresh
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  delete process.env.OVERMIND_HERMES_HOME;
});

afterEach(() => {
  for (const d of TMP_DIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  TMP_DIRS.length = 0;
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

// ═══════════════════════════════════════════════════════════════════════════════
// resetSession() sans agentName — back-compat
// ═══════════════════════════════════════════════════════════════════════════════

describe('OverBridgeService.resetSession() — back-compat (no agentName)', () => {
  it('MUST clear in-memory session when called with no arguments', async () => {
    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    // Simulate a session being set
    service.setSession('fake-session-id-123');
    expect(service.sessionId).toBe('fake-session-id-123');

    const result = service.resetSession();

    expect(service.sessionId).toBeUndefined();
    expect(result.inMemorySessionCleared).toBe(true);
    expect(result.memoryCleared).toBe(false);
    expect(result.purgedFiles).toEqual([]);
  });

  it('MUST return the new structured shape (not void)', async () => {
    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    const result = service.resetSession();
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('inMemorySessionCleared');
    expect(result).toHaveProperty('memoryCleared');
    expect(result).toHaveProperty('purgedFiles');
  });

  it('MUST be idempotent (calling twice is safe)', async () => {
    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    service.resetSession();
    const second = service.resetSession();
    expect(second.inMemorySessionCleared).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// resetSession(agentName) — purge state.db
// ═══════════════════════════════════════════════════════════════════════════════

describe('OverBridgeService.resetSession(agentName) — state.db purge', () => {
  it('MUST delete state.db + WAL + SHM when profile exists', async () => {
    const hermesHome = makeTmpHermesHome('purge');
    process.env.OVERMIND_HERMES_HOME = hermesHome;
    const agentName = 'striker_comptaria';
    const profilePath = createFakeProfile(hermesHome, agentName);
    const memoriesDir = path.join(profilePath, 'memories');

    // Sanity: files exist before reset
    expect(fs.existsSync(path.join(memoriesDir, 'state.db'))).toBe(true);
    expect(fs.existsSync(path.join(memoriesDir, 'state.db-wal'))).toBe(true);
    expect(fs.existsSync(path.join(memoriesDir, 'state.db-shm'))).toBe(true);

    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    service.setSession('session-to-reset');

    const result = service.resetSession(agentName);

    // Assertions: files gone, result shape correct
    expect(result.inMemorySessionCleared).toBe(true);
    expect(result.memoryCleared).toBe(true);
    expect(result.purgedFiles).toHaveLength(3);
    expect(result.profilePath).toBe(profilePath);

    // Files actually deleted from disk
    expect(fs.existsSync(path.join(memoriesDir, 'state.db'))).toBe(false);
    expect(fs.existsSync(path.join(memoriesDir, 'state.db-wal'))).toBe(false);
    expect(fs.existsSync(path.join(memoriesDir, 'state.db-shm'))).toBe(false);
  });

  it('MUST NOT delete unrelated files in the memories dir', async () => {
    const hermesHome = makeTmpHermesHome('scoped');
    process.env.OVERMIND_HERMES_HOME = hermesHome;
    const agentName = 'careful_agent';
    const profilePath = createFakeProfile(hermesHome, agentName);
    const memoriesDir = path.join(profilePath, 'memories');

    // Add unrelated files that MUST NOT be touched
    fs.writeFileSync(path.join(memoriesDir, 'MEMORY.md'), '# agent memory');
    fs.writeFileSync(path.join(memoriesDir, 'notes.txt'), 'important notes');
    fs.writeFileSync(path.join(memoriesDir, 'custom.db'), 'other db');

    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    service.resetSession(agentName);

    // Unrelated files preserved
    expect(fs.existsSync(path.join(memoriesDir, 'MEMORY.md'))).toBe(true);
    expect(fs.existsSync(path.join(memoriesDir, 'notes.txt'))).toBe(true);
    expect(fs.existsSync(path.join(memoriesDir, 'custom.db'))).toBe(true);
    // Only state.db + siblings deleted
    expect(fs.existsSync(path.join(memoriesDir, 'state.db'))).toBe(false);
  });

  it('MUST succeed (no throw) when profile does not exist', async () => {
    const hermesHome = makeTmpHermesHome('nopfile');
    process.env.OVERMIND_HERMES_HOME = hermesHome;
    const agentName = 'ghost_agent'; // no profile created

    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    const result = service.resetSession(agentName);

    expect(result.inMemorySessionCleared).toBe(true);
    expect(result.memoryCleared).toBe(false);
    expect(result.purgedFiles).toEqual([]);
    // Should not surface an error — no files to purge is a normal state
    expect(result.error).toBeUndefined();
  });

  it('MUST NOT throw when memories dir does not exist', async () => {
    const hermesHome = makeTmpHermesHome('nomemdir');
    process.env.OVERMIND_HERMES_HOME = hermesHome;
    const agentName = 'minimal_agent';
    // Create the profile dir but NOT the memories subdir
    fs.mkdirSync(path.join(hermesHome, 'profiles', agentName), { recursive: true });

    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    const result = service.resetSession(agentName);

    expect(result.inMemorySessionCleared).toBe(true);
    expect(result.memoryCleared).toBe(false);
    expect(result.purgedFiles).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Anti path-traversal — refuse de purger hors du Hermes home
// ═══════════════════════════════════════════════════════════════════════════════

describe('OverBridgeService.resetSession() — anti path-traversal guard', () => {
  it('MUST refuse to purge if profile path escapes the shared Hermes home', async () => {
    // We simulate an operator override that points OUTSIDE the shared home.
    // OVERMIND_HERMES_HOME controls getSharedHermesHome(), and getAgentHermesHome()
    // builds <shared>/profiles/<name>. So under normal config the guard never trips.
    // To exercise the guard, we point OVERMIND_HERMES_HOME at one dir but create
    // a profile in another, then swap the env AFTER getAgentHermesHome would resolve.
    //
    // Since getAgentHermesHome reads env live, we craft a scenario where the
    // profile dir exists in a sibling tmp dir that is NOT under the shared home.
    const sharedHome = makeTmpHermesHome('shared');
    const outsideHome = makeTmpHermesHome('outside');
    process.env.OVERMIND_HERMES_HOME = sharedHome;

    // Plant a fake "outside" state.db that we do NOT want deleted
    const outsideProfile = path.join(outsideHome, 'profiles', 'rogue');
    const outsideMemories = path.join(outsideProfile, 'memories');
    fs.mkdirSync(outsideMemories, { recursive: true });
    fs.writeFileSync(path.join(outsideMemories, 'state.db'), 'DO-NOT-DELETE');

    // Monkey-patch getAgentHermesHome via module mock to return the rogue path
    vi.resetModules();
    vi.doMock('../lib/config.js', () => ({
      getAgentHermesHome: () => outsideProfile,
      getSharedHermesHome: () => sharedHome,
    }));

    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    const result = service.resetSession('rogue');

    expect(result.inMemorySessionCleared).toBe(true);
    expect(result.memoryCleared).toBe(false);
    expect(result.error).toMatch(/outside shared Hermes home/i);
    // Crucially: the file outside the shared home MUST still exist
    expect(fs.existsSync(path.join(outsideMemories, 'state.db'))).toBe(true);

    vi.doUnmock('../lib/config.js');
    vi.resetModules();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Couplage reset mémoire + state.db purge
// ═══════════════════════════════════════════════════════════════════════════════

describe('OverBridgeService.resetSession(agentName) — memory + DB coupling', () => {
  it('MUST clear in-memory session AND purge DB when both are present', async () => {
    const hermesHome = makeTmpHermesHome('coupled');
    process.env.OVERMIND_HERMES_HOME = hermesHome;
    const agentName = 'coupled_agent';
    createFakeProfile(hermesHome, agentName);

    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    service.setSession('active-session-xyz');
    expect(service.sessionId).toBe('active-session-xyz');

    const result = service.resetSession(agentName);

    // Memory session cleared
    expect(service.sessionId).toBeUndefined();
    expect(result.inMemorySessionCleared).toBe(true);
    // DB purged
    expect(result.memoryCleared).toBe(true);
  });

  it('MUST still clear in-memory session even if state.db purge throws', async () => {
    const hermesHome = makeTmpHermesHome('errpurge');
    process.env.OVERMIND_HERMES_HOME = hermesHome;
    const agentName = 'error_agent';
    createFakeProfile(hermesHome, agentName);

    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();
    service.setSession('session-before-failure');

    // Monkey-patch fs.unlinkSync to throw on state.db deletion
    const originalUnlink = fs.unlinkSync;
    (fs as { unlinkSync: typeof fs.unlinkSync }).unlinkSync = function (p: fs.PathLike) {
      if (String(p).endsWith('state.db')) {
        throw new Error('EBUSY: file locked by active runner');
      }
      return originalUnlink(p);
    };

    try {
      const result = service.resetSession(agentName);
      // The reset MUST still succeed at the memory level
      expect(service.sessionId).toBeUndefined();
      expect(result.inMemorySessionCleared).toBe(true);
      // The state.db file failed to delete but WAL/SHM might have succeeded
      // before — what matters is the error didn't propagate
      expect(result.purgedFiles.length).toBeLessThan(3);
    } finally {
      (fs as { unlinkSync: typeof fs.unlinkSync }).unlinkSync = originalUnlink;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Idempotence — multiple resets on the same profile
// ═══════════════════════════════════════════════════════════════════════════════

describe('OverBridgeService.resetSession(agentName) — idempotence', () => {
  it('MUST be safe to call multiple times in a row', async () => {
    const hermesHome = makeTmpHermesHome('idempotent');
    process.env.OVERMIND_HERMES_HOME = hermesHome;
    const agentName = 'repeat_agent';
    createFakeProfile(hermesHome, agentName);

    const { OverBridgeService } = await import('../bridge/OverBridgeService.js');
    const service = new OverBridgeService();

    const first = service.resetSession(agentName);
    expect(first.memoryCleared).toBe(true);
    expect(first.purgedFiles).toHaveLength(3);

    // Second call: nothing left to purge, but no error
    const second = service.resetSession(agentName);
    expect(second.memoryCleared).toBe(false);
    expect(second.purgedFiles).toEqual([]);
    expect(second.inMemorySessionCleared).toBe(true);

    // Third call: still safe
    const third = service.resetSession(agentName);
    expect(third.memoryCleared).toBe(false);
    expect(third.inMemorySessionCleared).toBe(true);
  });
});
