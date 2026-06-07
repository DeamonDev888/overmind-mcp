import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { interpolateEnvVars, consumeUnresolvedVars } from '../lib/envUtils.js';

describe('interpolateEnvVars (subtilisation $VAR and ${VAR})', () => {
  // Snapshot env so tests don't leak across the suite.
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Reset to a known-clean slate, then restore only what we want.
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    process.env.TEST_HOME = '/home/test';
    process.env.TEST_REGION = 'GLOBAL';
    process.env.TEST_TOKEN = '***';
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL_ENV);
    consumeUnresolvedVars(); // reset internal list
  });

  describe('bare $VAR', () => {
    it('replaces $VAR with the env value', () => {
      expect(interpolateEnvVars('$TEST_HOME')).toBe('/home/test');
    });

    it('replaces bare $VAR inside a longer string', () => {
      expect(interpolateEnvVars('sk-cp-$TEST_REGION-abc')).toBe('sk-cp-GLOBAL-abc');
    });

    it('tracks unresolved $VAR via consumeUnresolvedVars()', () => {
      interpolateEnvVars('$DEFINITELY_NOT_SET_XYZ');
      const missing = consumeUnresolvedVars();
      expect(missing).toContain('DEFINITELY_NOT_SET_XYZ');
    });
  });

  describe('${VAR} braced form', () => {
    it('replaces ${VAR} and CONSUMES the closing brace (bug fix)', () => {
      // Bug: the previous regex `\$(\w+)|\${\w+}` did not consume the '}',
      // so '${HOME}' produced 'value}' with a leftover '}'.
      expect(interpolateEnvVars('${TEST_HOME}')).toBe('/home/test');
    });

    it('handles ${VAR}adjacent-text without leaking the }', () => {
      expect(interpolateEnvVars('${TEST_HOME}/sub')).toBe('/home/test/sub');
    });

    it('handles ${A}${B} back-to-back', () => {
      process.env.A = 'one';
      process.env.B = 'two';
      expect(interpolateEnvVars('${A}${B}')).toBe('onetwo');
    });
  });

  describe('non-string and nested', () => {
    it('leaves numbers, booleans, null, undefined alone', () => {
      expect(interpolateEnvVars(42)).toBe(42);
      expect(interpolateEnvVars(true)).toBe(true);
      expect(interpolateEnvVars(null)).toBe(null);
      expect(interpolateEnvVars(undefined)).toBe(undefined);
    });

    it('recurses into arrays', () => {
      expect(interpolateEnvVars(['$TEST_HOME', 'literal', 1])).toEqual([
        '/home/test',
        'literal',
        1,
      ]);
    });

    it('recurses into objects (the common settings.env case)', () => {
      const input = {
        env: {
          ANTHROPIC_MODEL: 'glm-5.1',
          ANTHROPIC_AUTH_TOKEN: '$TEST_TOKEN',
          ANTHROPIC_BASE_URL: 'https://api.z.ai/${TEST_REGION}/v4',
        },
      };
      expect(interpolateEnvVars(input)).toEqual({
        env: {
          ANTHROPIC_MODEL: 'glm-5.1',
          ANTHROPIC_AUTH_TOKEN: '***',
          ANTHROPIC_BASE_URL: 'https://api.z.ai/GLOBAL/v4',
        },
      });
    });
  });

  describe('defensive behavior', () => {
    it('does not crash on a literal "$" with no var name', () => {
      expect(() => interpolateEnvVars('price: $')).not.toThrow();
    });

    it('does not crash on input with no $ at all', () => {
      expect(interpolateEnvVars('plain string')).toBe('plain string');
    });
  });
});
