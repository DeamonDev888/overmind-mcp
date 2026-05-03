/**
 * Shared model mappings for Overmind agents.
 *
 * NICKNAME_TO_MODEL  — custom nicknames → real model IDs
 *   Used by ClaudeRunner (Anthropic-compatible API) to resolve BEFORE calling the API.
 *
 * PROVIDER_MAPPING  — provider shorthand → full kilo-prefixed model IDs
 *   Used by KiloRunner (CLI) to build the correct --model arg.
 *
 * Both maps are case-insensitive via toLowerCase() lookup.
 */

export const NICKNAME_TO_MODEL: Record<string, string> = {
  // ── Anthropic / z.ai ──────────────────────────────────────────────────────────
  'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
  'claude-opus-4-7': 'claude-opus-4-7',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  // z.ai custom nicknames
  'the data alchemist': 'claude-opus-4-7',
  'oracle prime': 'claude-opus-4-7',
  'imperial mind': 'claude-opus-4-7',
  'the chaos prophet': 'claude-sonnet-4-6',
  'time weaver': 'claude-sonnet-4-6',
  'the heavy lifter': 'claude-sonnet-4-6',
  // z.ai GLM models (Anthropic-compatible endpoint)
  'glm-4.5-flash': 'z-ai/glm-4.5-flash',
  'glm-4.6': 'z-ai/glm-4.6',
  'glm-4.7': 'z-ai/glm-4.7',
  'glm-5-turbo': 'z-ai/glm-5-turbo',
  // ── OpenAI ─────────────────────────────────────────────────────────────────────
  'gpt-5.5-pro-2026-04-23': 'openai/gpt-5.5-pro-2026-04-23',
  // ── DeepSeek ────────────────────────────────────────────────────────────────────────
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-reasoner': 'deepseek/deepseek-reasoner',
  // ── Moonshot ──────────────────────────────────────────────────────────────────
  'moonshot-v1-8k': 'moonshot/moonshot-v1-8k',
  'moonshot-v1-32k': 'moonshot/moonshot-v1-32k',
  'moonshot-v1-128k': 'moonshot/moonshot-v1-128k',
  // ── MiniMax ───────────────────────────────────────────────────────────────────
  'minimax-text-01': 'MiniMax-Text-01',
  'mini-max-m2.7-highspeed': 'mini-max-m2.7-highspeed',
  // ── Mistral / Codestral ─────────────────────────────────────────────────────
  'codestral-latest': 'mistral/codestral-latest',
  // ── ILMU ─────────────────────────────────────────────────────────────────────
  ilmu: 'ilmu/ilmu-glm-5.1',
  'ilmu-glm': 'ilmu/ilmu-glm-5.1',
  'ilmu-glm-5.1': 'ilmu/ilmu-glm-5.1',
  // ── Gemini ────────────────────────────────────────────────────────────────────────
  'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
};

export const PROVIDER_MAPPING: Record<string, string> = {
  // ── Kilo free-tier / openrouter ────────────────────────────────────────────────
  'tencent hy3': 'kilo/tencent/hy3-preview:free',
  'tencent/hy3-preview:free': 'kilo/tencent/hy3-preview:free',
  'step 3.5 flash': 'kilo/stepfun/step-3.5-flash:free',
  'stepfun/step-3.5-flash:free': 'kilo/stepfun/step-3.5-flash:free',
  'grok code': 'kilo/x-ai/grok-code-fast-1:optimized:free',
  'grok code fast 1 optimised': 'kilo/x-ai/grok-code-fast-1:optimized:free',
  elephant: 'kilo/openrouter/elephant-alpha',
  free: 'kilo/openrouter/free',
  // ── ILMU ─────────────────────────────────────────────────────────────────────
  ilmu: 'ilmu/ilmu-glm-5.1',
  'ilmu-glm': 'ilmu/ilmu-glm-5.1',
  'ilmu-glm-5.1': 'ilmu/ilmu-glm-5.1',
  // ── GLM / z.ai ───────────────────────────────────────────────────────────────
  glm: 'z-ai/glm-4.7',
  'z ai': 'z-ai/glm-4.7',
  // ── MiniMax ──────────────────────────────────────────────────────────────────
  minimax: 'MiniMax-Text-01',
  'minimax-text-01': 'MiniMax-Text-01',
  'mini-max-m2.7-highspeed': 'anthropic/mini-max-m2.7-highspeed',
  // ── DeepSeek ─────────────────────────────────────────────────────────────────
  'deepseek-reasoner': 'deepseek/deepseek-reasoner',
  // ── Moonshot ─────────────────────────────────────────────────────────────────
  'moonshot-v1-32k': 'moonshot/moonshot-v1-32k',
  // ── Mistral ──────────────────────────────────────────────────────────────────
  devstral: 'mistral/devstral-medium-latest',
  'codestral-latest': 'mistral/codestral-latest',
};

/** Resolve a model value for Anthropic-compatible API calls (ClaudeRunner). */
export function resolveModel(model: string): string {
  return NICKNAME_TO_MODEL[model.toLowerCase()] ?? model;
}

/** Resolve a model value for Kilo CLI calls (KiloRunner). */
export function resolveKiloModel(model: string): string {
  const lower = model.toLowerCase();
  return PROVIDER_MAPPING[lower] ?? NICKNAME_TO_MODEL[lower] ?? model;
}
