/**
 * Provider configuration constants for the Hermes runner.
 *
 * Extracted from NousHermesRunner.ts to reduce file size and improve
 * discoverability. These are static lookups — no runtime side-effects.
 */

/**
 * Default base URL for a given provider. Used when settings.json
 * doesn't specify ANTHROPIC_BASE_URL. Each provider has its canonical
 * endpoint baked in here so the runner doesn't need an external config.
 */
export function defaultBaseUrlFor(provider: string): string {
  switch (provider) {
    case 'minimax-cn': return 'https://api.minimaxi.com/anthropic';
    case 'minimax':    return 'https://api.minimax.com/anthropic';
    case 'zai':
    case 'z-ai':       return 'https://api.z.ai/api/coding/paas/v4';
    case 'anthropic':  return 'https://api.anthropic.com';
    case 'openai':     return 'https://api.openai.com/v1';
    default:           return 'https://api.z.ai/api/coding/paas/v4';
  }
}

/**
 * Every env-var name the runner knows about for credential resolution.
 * Declared at module scope so it's available for the RAW pre-interpolation
 * capture. 100% exhaustive — every token key the runner checks.
 */
export const TOKEN_KEYS = [
  // Generic Anthropic-compatible (Hermes v0.16.0)
  'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN_E', 'ANTHROPIC_AUTH_TOKEN_F', 'ANTHROPIC_AUTH_TOKEN_Y',
  // Suffixes numériques 1..9 (convention observée dans les .env prod)
  'ANTHROPIC_AUTH_TOKEN_1', 'ANTHROPIC_AUTH_TOKEN_2', 'ANTHROPIC_AUTH_TOKEN_3', 'ANTHROPIC_AUTH_TOKEN_4', 'ANTHROPIC_AUTH_TOKEN_5',
  'ANTHROPIC_AUTH_TOKEN_6', 'ANTHROPIC_AUTH_TOKEN_7', 'ANTHROPIC_AUTH_TOKEN_8', 'ANTHROPIC_AUTH_TOKEN_9',
  'ANTHROPIC_AUTH_TOKEN_0',
  // Z.AI / GLM
  'GLM_API_KEY', 'GLM_API_KEY_E', 'GLM_API_KEY_Y',
  'Z_AI_API_KEY', 'ZAI_ANTHROPIC_FALLBACK_KEY',
  'ZAI_API_KEY_E', 'ZAI_API_KEY_Y',
  'ZAI_API_KEY_1', 'ZAI_API_KEY_2', 'ZAI_API_KEY_3', 'ZAI_API_KEY_4', 'ZAI_API_KEY_5',
  'ZAI_API_KEY_6', 'ZAI_API_KEY_7', 'ZAI_API_KEY_8', 'ZAI_API_KEY_9', 'ZAI_API_KEY_0',
  // MiniMax
  'MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY',
  'MINIMAX_API_KEY_E', 'MINIMAX_API_KEY_Y',
  'MINIMAX_API_KEY_1', 'MINIMAX_API_KEY_2', 'MINIMAX_API_KEY_3', 'MINIMAX_API_KEY_4', 'MINIMAX_API_KEY_5',
  'MINIMAX_CN_API_KEY_E', 'MINIMAX_CN_API_KEY_Y',
  'MINIMAX_CN_API_KEY_1', 'MINIMAX_CN_API_KEY_2', 'MINIMAX_CN_API_KEY_3', 'MINIMAX_CN_API_KEY_4', 'MINIMAX_CN_API_KEY_5',
  // OpenAI fallback
  'OPENAI_API_KEY', 'OPENAI_AUTH_TOKEN',
  // Mistral
  'MISTRAL_API_KEY', 'MISTRAL_API_KEY_1', 'MISTRAL_API_KEY_2', 'MISTRAL_API_KEY_3', 'MISTRAL_API_KEY_4', 'MISTRAL_API_KEY_5',
  'MISTRAL_API_KEY_6', 'MISTRAL_API_KEY_7', 'MISTRAL_API_KEY_E', 'MISTRAL_API_KEY_Y',
];
