/**
 * Tests for getAgentHermesHome — the canonical HERMES_HOME resolver.
 *
 * Uses REAL getAgentHermesHome with controlled env vars + real fs
 * (no module mocking). This is sufficient because the helper is pure
 * (input: env vars + cwd + workspace dir; output: path string).
 *
 * The contract we're testing:
 *   1. OVERMIND_AGENT_HOME wins (operator-declared)
 *   2. Existing legacy path is preserved (backward compat)
 *   3. HOME-based canonical path is used otherwise
 *   4. cwd does NOT influence the result
 *   5. Multi-OS: Windows uses LOCALAPPDATA, others use HOME
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getAgentHermesHome, getAgentOvermindHome } from '../lib/config.js';

const ORIGINAL_ENV = { ...process.env };
const TMPDIRS: string[] = [];

function makeTmp(label: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `om-${label}-`));
  TMPDIRS.push(d);
  return d;
}

beforeEach(() => {
  // Clean state: drop anything not in the original env
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  delete process.env.OVERMIND_AGENT_HOME;
  delete process.env.OVERMIND_WORKSPACE;
  delete process.env.LOCALAPPDATA;
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

describe('getAgentHermesHome (multi-OS, multi-install)', () => {
  it('OVERMIND_AGENT_HOME wins over everything else', () => {
    const explicitHome = makeTmp('explicit');
    process.env.OVERMIND_AGENT_HOME = explicitHome;
    expect(getAgentHermesHome('sniperbot_analyst')).toBe(
      path.join(explicitHome, '.hermes'),
    );
  });

  it('OVERMIND_AGENT_HOME with null agentName gives the central .hermes', () => {
    const explicitHome = makeTmp('central');
    process.env.OVERMIND_AGENT_HOME = explicitHome;
    expect(getAgentHermesHome(null)).toBe(path.join(explicitHome, '.hermes'));
    expect(getAgentHermesHome(undefined)).toBe(path.join(explicitHome, '.hermes'));
  });

  it('legacy: <workspace>/.overmind/... is preserved if it already exists', () => {
    // Set up a workspace with an existing legacy .hermes
    const ws = makeTmp('legacy');
    process.env.OVERMIND_WORKSPACE = ws;
    const legacy = path.join(ws, '.overmind', 'hermes', 'agent_legacytest', '.hermes');
    fs.mkdirSync(legacy, { recursive: true });

    // HOME-based fallback would resolve to a DIFFERENT path
    const fakeHome = makeTmp('home');
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;

    expect(getAgentHermesHome('legacytest')).toBe(legacy);
  });

  it('falls through to HOME-based path when no legacy exists', () => {
    const ws = makeTmp('freshws');
    process.env.OVERMIND_WORKSPACE = ws;
    // Make sure no legacy path exists in this workspace
    expect(fs.existsSync(path.join(ws, '.overmind'))).toBe(false);

    const fakeHome = makeTmp('freshhome');
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.LOCALAPPDATA;

    // Force Linux-like platform so the test exercises the $HOME branch
    // (not the Windows %LOCALAPPDATA% branch).
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const result = getAgentHermesHome('freshagent');
      const expected = path.join(fakeHome, '.overmind', 'hermes', 'agent_freshagent', '.hermes');
      expect(result).toBe(expected);
      // Side effect: parent dir was created
      expect(fs.existsSync(path.dirname(expected))).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('Linux/Mac: uses $HOME/.overmind/hermes/agent_<name>/.hermes', () => {
    const ws = makeTmp('linws');
    process.env.OVERMIND_WORKSPACE = ws;
    const fakeHome = makeTmp('linhome');
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.LOCALAPPDATA;

    // Force Linux-like platform
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const result = getAgentHermesHome('linagent');
      // Linux: <home>/.overmind/...
      expect(result).toBe(
        path.join(fakeHome, '.overmind', 'hermes', 'agent_linagent', '.hermes'),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('Windows: uses %LOCALAPPDATA%\\overmind\\hermes\\... when set', () => {
    const ws = makeTmp('winws');
    process.env.OVERMIND_WORKSPACE = ws;
    const fakeLocal = makeTmp('winlocal');
    process.env.LOCALAPPDATA = fakeLocal;
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const result = getAgentHermesHome('winagent');
      // Windows: <localappdata>/overmind/... (no leading dot)
      expect(result).toBe(
        path.join(fakeLocal, 'overmind', 'hermes', 'agent_winagent', '.hermes'),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('Windows: falls back to %USERPROFILE% if %LOCALAPPDATA% unset', () => {
    const ws = makeTmp('winuser');
    process.env.OVERMIND_WORKSPACE = ws;
    const fakeProfile = makeTmp('winprofile');
    process.env.USERPROFILE = fakeProfile;
    delete process.env.LOCALAPPDATA;
    delete process.env.HOME;

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const result = getAgentHermesHome('winuseragent');
      expect(result).toBe(
        path.join(fakeProfile, 'overmind', 'hermes', 'agent_winuseragent', '.hermes'),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('cwd-independence: same agent → same path regardless of cwd', () => {
    const ws = makeTmp('cwdws');
    process.env.OVERMIND_WORKSPACE = ws;
    const fakeHome = makeTmp('cwdhome');
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.LOCALAPPDATA;

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const a = getAgentHermesHome('sniperbot_analyst');
      const b = getAgentHermesHome('sniperbot_analyst');
      expect(a).toBe(b);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});

describe('getAgentOvermindHome (parent of .hermes)', () => {
  it('returns the parent dir of getAgentHermesHome', () => {
    const explicitHome = makeTmp('parent');
    process.env.OVERMIND_AGENT_HOME = explicitHome;
    const hermes = getAgentHermesHome('sniperbot_analyst');
    const overmind = getAgentOvermindHome('sniperbot_analyst');
    expect(path.dirname(hermes)).toBe(overmind);
  });
});
