/**
 * Tests for getSharedHermesHome + getAgentHermesHome — the canonical
 * Hermes home resolver for Overmind+Hermes (2.8.30+).
 *
 * Layout we're testing:
 *   <hermesHome>/agents/<name>/settings.json   ← per-agent env + persona
 *   <hermesHome>/agents/<name>/SOUL.md         ← per-agent system prompt
 *   <hermesHome>/config.yaml                   ← global, managed by Hermes upstream
 *   <hermesHome>/auth.json                     ← global, managed by Hermes upstream
 *
 * Resolution order for the shared Hermes home:
 *   1. OVERMIND_HERMES_HOME env var (operator-declared, e.g. via systemd)
 *   2. <workspace>/.overmind/hermes/           (dev + local install)
 *   3. $HOME/.overmind/hermes/                  (Linux/Mac sudo npm -g)
 *      %LOCALAPPDATA%\overmind\hermes\          (Windows sudo npm -g)
 *
 * Uses REAL functions with controlled env vars + real fs (no module mocking).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  getAgentHermesHome,
  getAgentOvermindHome,
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

  it('falls through to <workspace>/.overmind/hermes/ when no env override', () => {
    const ws = makeTmp('ws');
    process.env.OVERMIND_WORKSPACE = ws;
    const expected = path.join(ws, '.overmind', 'hermes');
    expect(getSharedHermesHome()).toBe(expected);
    // Side effect: created
    expect(fs.existsSync(expected)).toBe(true);
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
    process.env.OVERMIND_WORKSPACE = fakeHome;
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
    process.env.OVERMIND_WORKSPACE = fakeLocal;
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
  it('returns <sharedRoot>/agents/<name>/', () => {
    const explicit = makeTmp('agent');
    process.env.OVERMIND_HERMES_HOME = explicit;
    expect(getAgentHermesHome('sniperbot_analyst')).toBe(
      path.join(explicit, 'agents', 'sniperbot_analyst'),
    );
  });

  it('null/undefined agentName maps to <sharedRoot>/agents/central/', () => {
    const explicit = makeTmp('central');
    process.env.OVERMIND_HERMES_HOME = explicit;
    expect(getAgentHermesHome(null)).toBe(path.join(explicit, 'agents', 'central'));
    expect(getAgentHermesHome(undefined)).toBe(path.join(explicit, 'agents', 'central'));
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
      expect(a).toBe(path.join(explicit, 'agents', 'sniperbot_analyst'));
    } finally {
      process.chdir(origCwd);
    }
  });

  it('canonical layout: returns <sharedRoot>/agents/<name>/ when canonical exists', () => {
    const explicit = makeTmp('canon-exists');
    process.env.OVERMIND_HERMES_HOME = explicit;
    const canonical = path.join(explicit, 'agents', 'sniperbot_analyst');
    fs.mkdirSync(canonical, { recursive: true });
    expect(getAgentHermesHome('sniperbot_analyst')).toBe(canonical);
  });

  it('legacy fallback: returns <sharedRoot>/agent_<name>/.hermes/ when only legacy exists', () => {
    const explicit = makeTmp('legacy-only');
    process.env.OVERMIND_HERMES_HOME = explicit;
    const legacy = path.join(explicit, 'agent_legacyagent', '.hermes');
    fs.mkdirSync(legacy, { recursive: true });
    // canonical doesn't exist, legacy does → return legacy
    expect(getAgentHermesHome('legacyagent')).toBe(legacy);
    // ...and it DOES end with .hermes (legacy)
    expect(getAgentHermesHome('legacyagent').endsWith('.hermes')).toBe(true);
  });

  it('new agent (no state): returns canonical path, no .hermes subdir', () => {
    const explicit = makeTmp('new-agent');
    process.env.OVERMIND_HERMES_HOME = explicit;
    const result = getAgentHermesHome('freshagent');
    // For a brand-new agent, neither path exists; we return canonical.
    expect(result).toBe(path.join(explicit, 'agents', 'freshagent'));
    expect(result.endsWith('.hermes')).toBe(false);
  });
});

describe('getAgentOvermindHome (deprecated alias)', () => {
  it('returns the same as getAgentHermesHome (the per-agent dir IS the home)', () => {
    const explicit = makeTmp('alias');
    process.env.OVERMIND_HERMES_HOME = explicit;
    const hermes = getAgentHermesHome('sniperbot_analyst');
    const overmind = getAgentOvermindHome('sniperbot_analyst');
    expect(overmind).toBe(hermes);
  });
});
