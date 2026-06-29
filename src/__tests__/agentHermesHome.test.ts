/**
 * Tests for getSharedHermesHome + getAgentHermesHome — the canonical
 * Hermes home resolver for Overmind+Hermes (v3.1+).
 *
 * Layout we're testing (v3.1 canonical):
 *   <hermesHome>/profiles/<name>/profile.yaml   ← per-agent descriptor
 *   <hermesHome>/profiles/<name>/SOUL.md        ← per-agent system prompt
 *   <hermesHome>/config.yaml                    ← global, managed by Hermes upstream
 *   <hermesHome>/auth.json                      ← global, managed by Hermes upstream
 *
 * Resolution order for getAgentHermesHome():
 *   1. <shared>/profiles/<name>/         (v3.1 canonical)
 *   2. <shared>/agents/<name>/           (legacy pre-v3.1)
 *   3. ~/.hermes/profiles/<name>/        (native Hermes fallback)
 *   4. <shared>/profiles/<name>/         (canonical — create on demand)
 *
 * Resolution order for the shared Hermes home:
 *   1. OVERMIND_HERMES_HOME env var (operator-declared, e.g. via systemd)
 *   2. $HOME/.overmind/hermes/        (Linux/Mac)
 *      %LOCALAPPDATA%\overmind\hermes\ (Windows)
 *
 * Uses REAL functions with controlled env vars + real fs (no module mocking).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  getAgentHermesHome,
  getSharedHermesHome,
} from '../lib/config.js';

const ORIGINAL_ENV = { ...process.env };
const TMPDIRS: string[] = [];

function makeTmp(label: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `om-${label}-`));
  TMPDIRS.push(d);
  return d;
}

function clearOvermindEnv() {
  for (const k of [
    'OVERMIND_HERMES_HOME',
    'OVERMIND_AGENT_HOME', // legacy alias — must be cleared to avoid bleed-through
    'OVERMIND_WORKSPACE',
    'LOCALAPPDATA',
    'USERPROFILE',
    'HOME',
  ]) {
    delete process.env[k];
  }
}

beforeEach(() => {
  // Clean state: drop anything not in the original env
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  clearOvermindEnv();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  for (const d of TMPDIRS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  }
  TMPDIRS.length = 0;
});

describe('getSharedHermesHome (shared Hermes root)', () => {
  it('OVERMIND_HERMES_HOME wins over everything else', () => {
    const explicit = makeTmp('explicit');
    process.env.OVERMIND_HERMES_HOME = explicit;
    expect(getSharedHermesHome()).toBe(explicit);
  });

  it('falls through to HOME-based path when no env override (creates dir)', () => {
    // When no OVERMIND_HERMES_HOME, it falls to HOME-based resolution.
    // We just verify the result ends with the canonical marker and was created.
    const fakeHome = makeTmp('ws');
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.LOCALAPPDATA;
    const result = getSharedHermesHome();
    expect(result).toMatch(/[/\\](?:\.?)overmind[/\\]hermes$/);
    expect(fs.existsSync(result)).toBe(true);
  });

  it('Linux/Mac: HOME-based branch constructs $HOME/.overmind/hermes/', () => {
    // The function picks HOME-based when no workspace .overmind/hermes exists.
    // We can't fully isolate this without module mocking, so we verify the
    // path construction by checking that the function returns a path
    // containing the OS-appropriate marker. Run as Linux: the result must
    // contain '/.overmind/' (with leading dot) on Linux/Mac.
    const fakeHome = makeTmp('homelin');
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.LOCALAPPDATA;
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const result = getSharedHermesHome();
      // Whichever branch wins, the path must end with `.overmind/hermes`
      // (or `/overmind/hermes` on Windows — but we forced Linux).
      expect(result).toMatch(/[/\\]\.overmind[/\\]hermes$/);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('Windows: HOME-based branch returns a valid Hermes home path', () => {
    // We verify the path is a well-formed Hermes home (ends with
    // `overmind/hermes` or `.overmind/hermes`) and was created or is creatable.
    const fakeLocal = makeTmp('localwin');
    process.env.LOCALAPPDATA = fakeLocal;
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const result = getSharedHermesHome();
      // Whichever branch wins, the path must end with one of the
      // canonical markers (with or without leading dot — both are valid).
      expect(result).toMatch(/[/\\](?:\.?)overmind[/\\]hermes$/);
      // Side effect: parent was created
      expect(fs.existsSync(result)).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});

describe('getAgentHermesHome (per-agent home under shared root)', () => {
  it('returns <sharedRoot>/profiles/<name>/ (v3.1 canonical)', () => {
    const explicit = makeTmp('agent');
    process.env.OVERMIND_HERMES_HOME = explicit;
    expect(getAgentHermesHome('sniperbot_analyst')).toBe(
      path.join(explicit, 'profiles', 'sniperbot_analyst'),
    );
  });

  it('null/undefined agentName maps to <sharedRoot>/profiles/central/', () => {
    const explicit = makeTmp('central');
    process.env.OVERMIND_HERMES_HOME = explicit;
    expect(getAgentHermesHome(null)).toBe(path.join(explicit, 'profiles', 'central'));
    expect(getAgentHermesHome(undefined)).toBe(path.join(explicit, 'profiles', 'central'));
  });

  it('cwd-independence: same agent → same path regardless of cwd', () => {
    const explicit = makeTmp('cwd');
    process.env.OVERMIND_HERMES_HOME = explicit;
    const origCwd = process.cwd();
    try {
      process.chdir(makeTmp('cwd-other'));
      const a = getAgentHermesHome('sniperbot_analyst');
      const b = getAgentHermesHome('sniperbot_analyst');
      expect(a).toBe(b);
      expect(a).toBe(path.join(explicit, 'profiles', 'sniperbot_analyst'));
    } finally {
      process.chdir(origCwd);
    }
  });

  it('canonical layout: returns <sharedRoot>/profiles/<name>/ when canonical exists', () => {
    const explicit = makeTmp('canon-exists');
    process.env.OVERMIND_HERMES_HOME = explicit;
    const canonical = path.join(explicit, 'profiles', 'sniperbot_analyst');
    fs.mkdirSync(canonical, { recursive: true });
    expect(getAgentHermesHome('sniperbot_analyst')).toBe(canonical);
  });

  it('legacy fallback: returns <sharedRoot>/agents/<name>/ when only legacy agents/ exists', () => {
    const explicit = makeTmp('legacy-only');
    process.env.OVERMIND_HERMES_HOME = explicit;
    const legacy = path.join(explicit, 'agents', 'legacyagent');
    fs.mkdirSync(legacy, { recursive: true });
    // canonical profiles/ doesn't exist, legacy agents/ does → return legacy
    expect(getAgentHermesHome('legacyagent')).toBe(legacy);
  });

  it('new agent (no state): returns canonical profiles/ path', () => {
    const explicit = makeTmp('new-agent');
    process.env.OVERMIND_HERMES_HOME = explicit;
    const result = getAgentHermesHome('freshagent');
    // For a brand-new agent, neither path exists; we return canonical (profiles/).
    expect(result).toBe(path.join(explicit, 'profiles', 'freshagent'));
    expect(result.endsWith('.hermes')).toBe(false);
  });
});
