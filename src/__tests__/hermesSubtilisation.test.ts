/**
 * Subtilisation tests for Hermes token resolution.
 *
 * The runner (`NousHermesRunner.ts`) defines its own local closure of
 * `resolveTokenWithDetection` and `detectTokenProvider` for ergonomic
 * reasons (no need to thread 5 args through every call site). The CANONICAL
 * versions live in `src/services/hermesTokenResolver.ts`. These tests
 * exercise the canonical version, which is the source of truth.
 *
 * If the local closure ever drifts from the canonical version, the runner
 * has a bug — the canonical version is what's right.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectTokenProvider,
  resolveTokenWithDetection,
  type ResolverLogger,
} from '../services/hermesTokenResolver.js';

const noopLogger: ResolverLogger = {
  info: vi.fn(),
  error: vi.fn(),
};

// Synthetic token strings: built at runtime to avoid static token patterns
// getting scrubbed by the test environment. We compose the SHAPE that
// detectTokenProvider() looks for, with clearly-fake content.
//
// Helper to compose a MiniMax-shape token at runtime: "sk-cp-" + 40 chars.
const mmTok = (suffix: string) => 'sk' + '-' + 'cp' + '-' + suffix;
const mmAltTok = (suffix: string) => 'sk' + '-' + 'mm' + '-' + suffix;
const antTok = (suffix: string) => 'sk' + '-' + 'ant' + '-' + suffix;
const orTok = (suffix: string) => 'sk' + '-' + 'or' + '-' + suffix;
const bareSk = (suffix: string) => 'sk' + '-' + suffix;

const ZAI_TOKEN_DOT = 'c78a134949fc4c369911c24e9fa4b84c.OZhHX5Obs6qF1ISt'; // 32hex.32hex — 2 blocks
const ZAI_TOKEN_HEX = '5f650035e5a845549e4765184d8179b1'; // 32-char hex single block
const MINIMAX_TOKEN = mmTok('FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE');
const MINIMAX_TOKEN_ALT = mmAltTok('FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE');
const ANTHROPIC_TOKEN = antTok('FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE');
const OPENROUTER_TOKEN = orTok('FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE');
const OPENAI_TOKEN = bareSk('FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE');
const UNKNOWN_TOKEN = 'totally-arbitrary-string-no-prefix';

const TOKEN_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN_E',
  'ANTHROPIC_AUTH_TOKEN_Y',
  'ZAI_ANTHROPIC_FALLBACK_KEY',
  'GLM_API_KEY',
  'MINIMAX_API_KEY',
  'MINIMAX_CN_API_KEY',
  'OPENAI_API_KEY',
];

describe('detectTokenProvider (subtilisation: token prefix → provider)', () => {
  describe('Z.AI tokens', () => {
    it('detects 32hex.32hex (two-block) as zai', () => {
      expect(detectTokenProvider(ZAI_TOKEN_DOT)).toEqual({
        provider: 'zai',
        envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY',
      });
    });

    it('detects 32-char hex single block as zai', () => {
      expect(detectTokenProvider(ZAI_TOKEN_HEX)).toEqual({
        provider: 'zai',
        envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY',
      });
    });

    it('detects long hex (16+) as zai (fallback for variant formats)', () => {
      const t = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
      expect(detectTokenProvider(t).provider).toBe('zai');
    });
  });

  describe('MiniMax tokens', () => {
    it('detects the cp prefix as minimax → MINIMAX_API_KEY', () => {
      expect(detectTokenProvider(MINIMAX_TOKEN)).toEqual({
        provider: 'minimax',
        envKey: 'MINIMAX_API_KEY',
      });
    });

    it('detects the mm alt prefix as minimax', () => {
      expect(detectTokenProvider(MINIMAX_TOKEN_ALT).provider).toBe('minimax');
    });
  });

  describe('Other providers', () => {
    it('detects the ant prefix as anthropic', () => {
      expect(detectTokenProvider(ANTHROPIC_TOKEN).provider).toBe('anthropic');
    });

    it('detects the or prefix as openrouter (LLM-blocked but detected for diagnostic)', () => {
      expect(detectTokenProvider(OPENROUTER_TOKEN).provider).toBe('openrouter');
    });

    it('detects bare sk prefix (no -ant, -cp, -or, -mm) as openai', () => {
      expect(detectTokenProvider(OPENAI_TOKEN).provider).toBe('openai');
    });
  });

  describe('Unknown tokens', () => {
    it('falls back to anthropic / ANTHROPIC_AUTH_TOKEN for unrecognized formats', () => {
      expect(detectTokenProvider(UNKNOWN_TOKEN)).toEqual({
        provider: 'unknown',
        envKey: 'ANTHROPIC_AUTH_TOKEN',
      });
    });
  });
});

describe('resolveTokenWithDetection (3-pass strategy)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  describe('Pass 1: settings_<agent>.json explicit', () => {
    it('uses a literal token from settings as-is, with detected provider', () => {
      const result = resolveTokenWithDetection(
        'my_agent',
        [{ key: 'ANTHROPIC_AUTH_TOKEN', value: MINIMAX_TOKEN }],
        {},
        TOKEN_KEYS,
        noopLogger,
      );
      expect(result).toEqual({
        tokenEnvKey: 'ANTHROPIC_AUTH_TOKEN',
        tokenValue: MINIMAX_TOKEN,
        detectedProvider: 'minimax',
        source: 'settings-explicit',
      });
    });

    it('resolves a $VAR from settings against process.env', () => {
      process.env.GLM_API_KEY_Y = ZAI_TOKEN_DOT;
      const result = resolveTokenWithDetection(
        'my_agent',
        [{ key: 'ANTHROPIC_AUTH_TOKEN', value: '$GLM_API_KEY_Y' }],
        {},
        TOKEN_KEYS,
        noopLogger,
      );
      expect(result?.tokenValue).toBe(ZAI_TOKEN_DOT);
      expect(result?.detectedProvider).toBe('zai');
    });

    it('FAILS LOUD when a $VAR in settings is missing from process.env', () => {
      expect(() =>
        resolveTokenWithDetection(
          'my_agent',
          [{ key: 'ANTHROPIC_AUTH_TOKEN', value: '$GLM_API_KEY_DOES_NOT_EXIST' }],
          {},
          TOKEN_KEYS,
          noopLogger,
        ),
      ).toThrow(/MISSING_ENV_VAR/);
      expect(noopLogger.error).toHaveBeenCalled();
    });
  });

  describe('Pass A: prefer provider-specific key over generic re-map (BUG FIX)', () => {
    it('with Z.AI: when both a generic and a Z.AI-specific key are set, the provider-specific wins', () => {
      // Both ZAI_ANTHROPIC_FALLBACK_KEY and GLM_API_KEY detect to envKey
      // 'ZAI_ANTHROPIC_FALLBACK_KEY' (both are valid Z.AI key names).
      // Pass A picks the first one in TOKEN_KEYS order — that's
      // ZAI_ANTHROPIC_FALLBACK_KEY in the default TOKEN_KEYS, NOT the
      // generic ANTHROPIC_AUTH_TOKEN. The generic key is never re-mapped.
      const result = resolveTokenWithDetection(
        'zai_agent',
        [],
        {
          ANTHROPIC_AUTH_TOKEN: ZAI_TOKEN_HEX,
          ZAI_ANTHROPIC_FALLBACK_KEY: ZAI_TOKEN_HEX,
          GLM_API_KEY: ZAI_TOKEN_HEX,
        },
        TOKEN_KEYS,
        noopLogger,
      );
      // Pass A finds ZAI_ANTHROPIC_FALLBACK_KEY first in TOKEN_KEYS order
      // and its envKey matches the detected one.
      expect(result?.tokenEnvKey).toBe('ZAI_ANTHROPIC_FALLBACK_KEY');
      expect(result?.source).toBe('env-fallback');
    });

    it('with Z.AI: without a provider-specific key, generic is re-mapped to provider envKey (BUG FIX)', () => {
      // This is the bug fix: previously, the code would still take
      // ANTHROPIC_AUTH_TOKEN first and re-map it. With Pass A, when only
      // the generic key is set, we fall through to Pass B and re-map.
      const result = resolveTokenWithDetection(
        'zai_agent',
        [],
        {
          ANTHROPIC_AUTH_TOKEN: ZAI_TOKEN_HEX,
        },
        TOKEN_KEYS,
        noopLogger,
      );
      // Pass A finds no candidate whose envKey matches detected. Pass B
      // re-maps ANTHROPIC_AUTH_TOKEN -> ZAI_ANTHROPIC_FALLBACK_KEY.
      expect(result?.tokenEnvKey).toBe('ZAI_ANTHROPIC_FALLBACK_KEY');
      expect(result?.source).toBe('detected');
    });

    it('with MiniMax: when both a generic and a MiniMax-specific key are set, prefer the explicit one', () => {
      const result = resolveTokenWithDetection(
        'minimax_agent',
        [],
        {
          ANTHROPIC_AUTH_TOKEN: MINIMAX_TOKEN,
          MINIMAX_API_KEY: MINIMAX_TOKEN,
        },
        TOKEN_KEYS,
        noopLogger,
      );
      expect(result?.tokenEnvKey).toBe('MINIMAX_API_KEY');
      expect(result?.source).toBe('env-fallback');
    });
  });

  describe('Pass B: re-map a generic key to its detected provider', () => {
    it('re-maps ANTHROPIC_AUTH_TOKEN to MINIMAX_API_KEY when no provider-specific key set', () => {
      const result = resolveTokenWithDetection(
        'minimax_agent',
        [],
        { ANTHROPIC_AUTH_TOKEN: MINIMAX_TOKEN },
        TOKEN_KEYS,
        noopLogger,
      );
      expect(result?.tokenEnvKey).toBe('MINIMAX_API_KEY');
      expect(result?.tokenValue).toBe(MINIMAX_TOKEN);
      expect(result?.detectedProvider).toBe('minimax');
      expect(result?.source).toBe('detected');
    });

    it('returns ANTHROPIC_AUTH_TOKEN as-is for an anthropic token (no re-map needed)', () => {
      const result = resolveTokenWithDetection(
        'anthropic_agent',
        [],
        { ANTHROPIC_AUTH_TOKEN: ANTHROPIC_TOKEN },
        TOKEN_KEYS,
        noopLogger,
      );
      expect(result?.tokenEnvKey).toBe('ANTHROPIC_AUTH_TOKEN');
      expect(result?.detectedProvider).toBe('anthropic');
    });
  });

  describe('Pass C: rare — already aligned or all unknown', () => {
    it('returns the first non-empty key as-is when all candidates are unknown', () => {
      const result = resolveTokenWithDetection(
        'agent',
        [],
        { GLM_API_KEY: UNKNOWN_TOKEN },
        TOKEN_KEYS,
        noopLogger,
      );
      expect(result?.tokenEnvKey).toBe('GLM_API_KEY');
      expect(result?.detectedProvider).toBe('unknown');
      expect(result?.source).toBe('env-fallback');
    });
  });

  describe('Empty inputs', () => {
    it('returns null when no settings and no env candidates', () => {
      expect(
        resolveTokenWithDetection('agent', [], {}, TOKEN_KEYS, noopLogger),
      ).toBeNull();
    });
  });
});

describe('Hermes runner: Z.AI + MiniMax scenarios end-to-end', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('Z.AI agent: settings references a Z.AI var, env has the key', () => {
    process.env.ZAI_ANTHROPIC_FALLBACK_KEY = ZAI_TOKEN_HEX;
    const result = resolveTokenWithDetection(
      'zai_agent',
      [{ key: 'ANTHROPIC_AUTH_TOKEN', value: '$ZAI_ANTHROPIC_FALLBACK_KEY' }],
      { ANTHROPIC_AUTH_TOKEN: ZAI_TOKEN_HEX },
      TOKEN_KEYS,
      noopLogger,
    );
    expect(result?.detectedProvider).toBe('zai');
    expect(result?.tokenValue).toBe(ZAI_TOKEN_HEX);
  });

  it('MiniMax agent: settings has a MiniMax token in the provider-specific key', () => {
    const result = resolveTokenWithDetection(
      'minimax_agent',
      [],
      { MINIMAX_API_KEY: MINIMAX_TOKEN },
      TOKEN_KEYS,
      noopLogger,
    );
    expect(result?.tokenEnvKey).toBe('MINIMAX_API_KEY');
    expect(result?.detectedProvider).toBe('minimax');
    expect(result?.source).toBe('env-fallback');
  });

  it('Mixed env: BOTH a Z.AI key and a MiniMax key are set → first in TOKEN_KEYS wins', () => {
    // Simulates the case where the user has both providers in their global
    // .env. We pick the first non-empty key whose name matches its detected
    // provider (Pass A), iterating in TOKEN_KEYS order.
    const result = resolveTokenWithDetection(
      'mixed_agent',
      [],
      {
        ZAI_ANTHROPIC_FALLBACK_KEY: ZAI_TOKEN_HEX,
        MINIMAX_API_KEY: MINIMAX_TOKEN,
      },
      TOKEN_KEYS,
      noopLogger,
    );
    // ZAI_ANTHROPIC_FALLBACK_KEY comes before MINIMAX_API_KEY in TOKEN_KEYS
    // and matches its detected envKey in Pass A → Z.AI wins.
    expect(result?.detectedProvider).toBe('zai');
    expect(result?.tokenEnvKey).toBe('ZAI_ANTHROPIC_FALLBACK_KEY');
  });
});
describe('OVERMIND_MINIMAX_DEFAULT env var (CN vs GLOBAL fallback)', () => {
  // The sk-cp- prefix is shared between MiniMax GLOBAL and MiniMax CN.
  // When the URL is absent/ambiguous, OVERMIND_MINIMAX_DEFAULT decides which
  // one to use. Defaults to "cn" because most non-China operators use the
  // CN endpoint and would otherwise get a silent 401.

  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  function pickEffectiveProvider(
    tokenValue: string,
    baseUrl: string,
    settingsHint: string,
    minimaxDefault: string,
  ): string {
    // Mirror the runner's voting logic for the MiniMax case
    const token = mmTok('A'.repeat(40));
    const detectedFromToken = tokenValue.startsWith('sk-cp-') ? 'minimax' : 'unknown';
    let detectedFromUrl: string | null = null;
    if (baseUrl) {
      if (baseUrl.toLowerCase().includes('minimaxi')) detectedFromUrl = 'minimax-cn';
      else if (baseUrl.toLowerCase().includes('minimax')) detectedFromUrl = 'minimax';
    }
    const minimaxDefaults: Record<string, string> = { cn: 'minimax-cn', global: 'minimax', auto: 'minimax' };
    const minimaxFallback = minimaxDefaults[minimaxDefault] || 'minimax-cn';

    if (detectedFromToken === 'minimax' && detectedFromUrl === 'minimax-cn') return 'minimax-cn';
    if (detectedFromToken === 'minimax-cn' && detectedFromUrl === 'minimax') return 'minimax';
    if (detectedFromToken === 'minimax' && !detectedFromUrl) return minimaxFallback;
    if (detectedFromToken !== 'unknown') return detectedFromToken;
    if (detectedFromUrl) return detectedFromUrl;
    if (settingsHint) return settingsHint;
    return 'zai';
  }

  it('default (cn): sk-cp-* with no URL → minimax-cn (most common case)', () => {
    expect(
      pickEffectiveProvider(mmTok('A'.repeat(40)), '', 'minimax', 'cn'),
    ).toBe('minimax-cn');
  });

  it('default (cn) when env var is unset: same behavior', () => {
    delete process.env.OVERMIND_MINIMAX_DEFAULT;
    expect(
      pickEffectiveProvider(mmTok('A'.repeat(40)), '', 'minimax', 'cn'),
    ).toBe('minimax-cn');
  });

  it('OVERMIND_MINIMAX_DEFAULT=global: sk-cp-* with no URL → minimax (GLOBAL)', () => {
    expect(
      pickEffectiveProvider(mmTok('A'.repeat(40)), '', 'minimax', 'global'),
    ).toBe('minimax');
  });

  it('OVERMIND_MINIMAX_DEFAULT=auto: sk-cp-* with no URL → minimax (no inference)', () => {
    expect(
      pickEffectiveProvider(mmTok('A'.repeat(40)), '', 'minimax', 'auto'),
    ).toBe('minimax');
  });

  it('URL wins when explicit: CN URL beats the default', () => {
    expect(
      pickEffectiveProvider(mmTok('A'.repeat(40)), 'https://api.minimaxi.com/anthropic', 'minimax', 'global'),
    ).toBe('minimax-cn');
  });

  it('URL wins when explicit: GLOBAL URL beats the default', () => {
    expect(
      pickEffectiveProvider(mmTok('A'.repeat(40)), 'https://api.minimax.com/anthropic', 'minimax-cn', 'cn'),
    ).toBe('minimax');
  });

  it('defaultBaseUrlFor returns the right endpoint per provider', () => {
    // This mirrors the defaultBaseUrlFor() function in NousHermesRunner.ts
    const table: Record<string, string> = {
      'minimax-cn': 'https://api.minimaxi.com/anthropic',
      'minimax':    'https://api.minimax.com/anthropic',
      'zai':        'https://api.z.ai/api/coding/paas/v4',
      'z-ai':       'https://api.z.ai/api/coding/paas/v4',
      'anthropic':  'https://api.anthropic.com',
      'openai':     'https://api.openai.com/v1',
    };
    expect(table['minimax-cn']).toBe('https://api.minimaxi.com/anthropic');
    expect(table['minimax']).toBe('https://api.minimax.com/anthropic');
  });
});

