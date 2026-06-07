/**
 * Hermes token resolution — canonical, side-effect-free implementation.
 *
 * This module exists for two reasons:
 *
 *   1. **Testability.** The `NousHermesRunner` defines these helpers as
 *      function-local closures (so call sites can capture `agentCustomEnv`,
 *      `TOKEN_KEYS`, `agentName`, `logger`, `tmpSettingsPath` from the
 *      enclosing scope without ceremony). That makes the logic untestable
 *      in isolation. This module is the canonical, parameterized version.
 *      Any divergence between the local closure and this module is a bug —
 *      keep them in sync.
 *
 *   2. **Audit surface.** When debugging "why did the runner pick
 *      `MINIMAX_API_KEY` over `ANTHROPIC_AUTH_TOKEN`?", you can import
 *      `resolveTokenWithDetection` from this module in a REPL or a one-off
 *      script and replay the decision without spinning up a Hermes run.
 *
 * Token detection convention (Hermes v0.16.0):
 *   MiniMax     → "sk-cp-..."  → env MINIMAX_API_KEY
 *   Z.AI / GLM  → "32hex.32hex"  → env ZAI_ANTHROPIC_FALLBACK_KEY
 *                 e.g. "c78a134949fc4c369911c24e9fa4b84c.OZhHX5Obs6qF1ISt"
 *   Z.AI alt    → 32-char hex (single block, no dot)
 *                 e.g. "5f650035e5a845549e4765184d8179b1"
 *   Anthropic   → "sk-ant-..." → env ANTHROPIC_AUTH_TOKEN
 *   OpenAI      → "sk-..."     → env OPENAI_API_KEY
 *   OpenRouter  → "sk-or-..."  → env OPENROUTER_API_KEY (BLOCKED for LLM)
 *   Mistral     → (variable)   → env MISTRAL_API_KEY_*
 *   Other       → unknown      → env ANTHROPIC_AUTH_TOKEN
 */

export interface ProviderDetection {
  provider: string;
  envKey: string;
}

export const TOKEN_PREFIX_PROVIDERS: ReadonlyArray<{
  test: (t: string) => boolean;
  provider: string;
  envKey: string;
}> = [
  // Z.AI: c78a134949fc4c369911c24e9fa4b84c.OZhHX5Obs6qF1ISt (32hex.32hex — 2 blocks)
  { test: (t) => /^[0-9a-f]{32}\.[0-9a-zA-Z]+$/i.test(t), provider: 'zai', envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY' },
  // Z.AI: 5f6500...q3m3 (32-char hex single block, no dot, no dashes)
  { test: (t) => /^[0-9a-f]{32}$/i.test(t), provider: 'zai', envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY' },
  // MiniMax: sk-cp-...
  { test: (t) => t.startsWith('sk-cp-'), provider: 'minimax', envKey: 'MINIMAX_API_KEY' },
  // MiniMax: sk-mm-... (alternative prefix)
  { test: (t) => t.startsWith('sk-mm-'), provider: 'minimax', envKey: 'MINIMAX_API_KEY' },
  // Anthropic
  { test: (t) => t.startsWith('sk-ant-'), provider: 'anthropic', envKey: 'ANTHROPIC_AUTH_TOKEN' },
  // OpenRouter (BLOCKED for LLM, but we still detect it for diagnostic)
  { test: (t) => t.startsWith('sk-or-'), provider: 'openrouter', envKey: 'OPENROUTER_API_KEY' },
  // OpenAI (no -ant, no -cp, no -or)
  { test: (t) => t.startsWith('sk-'), provider: 'openai', envKey: 'OPENAI_API_KEY' },
  // Generic 16+ hex without dot — probably a Z.AI token variant
  { test: (t) => /^[0-9a-f]{16,}$/i.test(t), provider: 'zai', envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY' },
];

export function detectTokenProvider(token: string): ProviderDetection {
  for (const rule of TOKEN_PREFIX_PROVIDERS) {
    if (rule.test(token)) return { provider: rule.provider, envKey: rule.envKey };
  }
  return { provider: 'unknown', envKey: 'ANTHROPIC_AUTH_TOKEN' };
}

export interface ResolvedToken {
  tokenEnvKey: string;
  tokenValue: string;
  detectedProvider: string;
  source: 'settings-explicit' | 'env-fallback' | 'detected';
}

export interface ResolverLogger {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

/**
 * Resolve a token with explicit settings priority + provider detection.
 *
 * Strategy:
 *   1. Read settings_<agent>.json env block (explicitSettingsTokens).
 *      - Literal token (e.g. "sk-cp-...")  → use it directly.
 *      - $VAR reference (e.g. "$GLM_API_KEY_Y") → resolve against process.env.
 *        Missing? FAIL LOUD (no silent fallback).
 *   2. No settings token → iterate tokenKeys in priority order. THREE PASSES:
 *        Pass A: prefer a candidate whose env-var NAME already matches its
 *                detected provider (preserves explicit user choice over
 *                generic-key re-map).
 *        Pass B: re-map the first candidate to the right provider env-var
 *                name (subtilisation).
 *        Pass C: rare — everything aligned already, return as-is.
 *
 * @throws {Error} `MISSING_ENV_VAR: ...` when settings references a $VAR that
 *                 is not in process.env.
 */
export function resolveTokenWithDetection(
  agentName: string | undefined,
  explicitSettingsTokens: ReadonlyArray<{ key: string; value: string }>,
  agentCustomEnv: Record<string, string | undefined>,
  tokenKeys: ReadonlyArray<string>,
  logger: ResolverLogger,
): ResolvedToken | null {
  // Step 1: settings_<agent>.json env block takes ABSOLUTE priority
  if (explicitSettingsTokens.length > 0) {
    const t = explicitSettingsTokens[0];
    let resolvedValue = t.value;
    if (typeof t.value === 'string' && t.value.startsWith('$')) {
      const varName = t.value.slice(1);
      const fromEnv = process.env[varName];
      if (!fromEnv || fromEnv.length === 0) {
        logger.error(
          {
            agentName,
            requestedVar: varName,
            requestedKey: t.key,
          },
          '[FAIL-LOUD] settings_<agent>.json references $' + varName + ' but it is not set in process.env. ' +
          'Either export it in the parent .env, or fix the reference in settings_<agent>.json. ' +
          'Refusing to fall back to a different credential.',
        );
        throw new Error(
          `MISSING_ENV_VAR: settings_<agent>.json env.${t.key}="$` + varName + '" ' +
          `but process.env.${varName} is empty. Add it to /home/demon/.overmind/.env or fix the settings reference.`,
        );
      }
      resolvedValue = fromEnv;
      logger.info(
        { agentName, sourceKey: t.key, referencedVar: varName, resolvedLen: resolvedValue.length },
        '[SUBTILISATION] Resolved $VAR reference from settings_<agent>.json against process.env.',
      );
    }
    const detected = detectTokenProvider(resolvedValue);
    logger.info(
      { agentName, tokenKey: t.key, detectedProvider: detected.provider, mappedTo: detected.envKey },
      '[SUBTILISATION] Using explicit settings_<agent>.json token, re-mapping to detected provider env var.',
    );
    return { tokenEnvKey: t.key, tokenValue: resolvedValue, detectedProvider: detected.provider, source: 'settings-explicit' };
  }

  // Step 2: iterate tokenKeys in priority order, with 3-pass strategy.
  type Candidate = { key: string; value: string; detected: ProviderDetection };
  const candidates: Candidate[] = [];
  for (const tk of tokenKeys) {
    const v = agentCustomEnv[tk];
    if (v && typeof v === 'string' && v.length > 0) {
      candidates.push({ key: tk, value: v, detected: detectTokenProvider(v) });
    }
  }
  if (candidates.length === 0) return null;

  // Pass A: prefer the candidate whose env-var name ALREADY matches its detected provider.
  for (const c of candidates) {
    if (c.detected.provider !== 'unknown' && c.detected.envKey === c.key) {
      return {
        tokenEnvKey: c.key,
        tokenValue: c.value,
        detectedProvider: c.detected.provider,
        source: 'env-fallback',
      };
    }
  }

  // Pass B: re-map the first candidate to the right provider env-var.
  const first = candidates[0];
  if (first.detected.provider !== 'unknown' && first.detected.envKey !== first.key) {
    logger.info(
      { agentName, sourceKey: first.key, detectedProvider: first.detected.provider, remappedTo: first.detected.envKey },
      '[SUBTILISATION] Token prefix detected provider mismatch — re-mapping env var.',
    );
    return {
      tokenEnvKey: first.detected.envKey,
      tokenValue: first.value,
      detectedProvider: first.detected.provider,
      source: 'detected',
    };
  }

  // Pass C: rare — everything aligned already or all providers unknown.
  return {
    tokenEnvKey: first.key,
    tokenValue: first.value,
    detectedProvider: first.detected.provider,
    source: 'env-fallback',
  };
}
