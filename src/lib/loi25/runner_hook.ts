/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Hook pour les runners LLM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Point d'entrée unique pour appliquer le guard Loi 25 avant chaque exécution LLM.
 * Évite de modifier les 8 fichiers *Runner.ts individuellement.
 *
 * Appelé par run_agent.ts (dispatcher central).
 */

import { loi25Guard, logTransfer } from './guard.js';
import { isLoi25Enabled } from './types.js';
import { getProviderInfo, requiresExplicitConsent } from './transfer_map.js';
import type { Loi25Context } from './types.js';

export interface RunnerHookResult {
  /** Le runner peut continuer */
  allowed: boolean;
  /** Raison du refus si allowed = false */
  reason?: string;
  /** Contexte Loi 25 à propager au storeRun */
  context: Loi25Context;
  /** Prompt possiblement sanitizé (si PII filter activé) */
  sanitizedPrompt?: string;
  /** Timestamp d'expiration de rétention pour storeRun */
  retentionExpiresAt: number;
}

/**
 * Map les noms de runners Overmind vers les providers Loi 25.
 * Le runner est la CLI (claude, gemini, etc.), le provider est l'infra LLM.
 */
const RUNNER_TO_PROVIDER: Record<string, string> = {
  claude: 'anthropic',
  gemini: 'google',
  kilo: 'openai', // KiloCode utilise OpenAI-compatible APIs
  qwencli: 'zai', // Qwen / Zhipu
  openclaw: 'anthropic', // OpenClaw — Anthropic-compatible
  cline: 'anthropic', // Cline — Anthropic-compatible
  opencode: 'openai', // OpenCode — OpenAI-compatible
  hermes: 'unknown', // Hermes — dépend du provider configuré dans le profile
};

/**
 * Applique le guard Loi 25 avant l'exécution d'un runner LLM.
 *
 * Si OVERMIND_LOI25_ENABLED=false → pass-through (comportement v3.8).
 * Si true → détecte les RP, valide le consentement, log le transfert.
 *
 * @param runner Nom du runner (claude, gemini, hermes, etc.)
 * @param prompt Prompt envoyé au runner
 * @param agentName Nom de l'agent (optionnel)
 * @returns RunnerHookResult — allowed=false si bloqué par le guard
 */
export async function loi25RunnerHook(
  runner: string,
  prompt: string,
  agentName?: string,
): Promise<RunnerHookResult> {
  const provider = RUNNER_TO_PROVIDER[runner] || 'unknown';
  const piiFilter = process.env.OVERMIND_PII_FILTER === 'true';

  // ── Guard principal ──
  const guardResult = await loi25Guard({
    prompt,
    dataSubjectId: agentName ? undefined : process.env.OVERMIND_CURRENT_SUBJECT_ID,
    purpose: `agent_execution_${runner}`,
    provider,
    sanitize: piiFilter,
  });

  if (!guardResult.allowed) {
    return {
      allowed: false,
      reason: guardResult.reason,
      context: guardResult.context,
      retentionExpiresAt: guardResult.retentionExpiresAt,
    };
  }

  // ── Log de transfert (documentation seule, pas de blocage) ──
  if (isLoi25Enabled() && requiresExplicitConsent(provider)) {
    const providerInfo = getProviderInfo(provider);
    logTransfer({
      dataSubjectId: guardResult.context.dataSubjectId || null,
      destination: providerInfo.name,
      destinationRegion: providerInfo.region,
      legalMechanism: providerInfo.mechanism,
      dataType: 'prompt',
    }).catch(() => {}); // fire-and-forget
  }

  return {
    allowed: true,
    context: guardResult.context,
    sanitizedPrompt: guardResult.sanitizedPrompt,
    retentionExpiresAt: guardResult.retentionExpiresAt,
  };
}

/**
 * Enrichit les paramètres de storeRun avec les champs Loi 25.
 * À appeler après l'exécution du runner pour persiste le contexte Loi 25.
 */
export function enrichStoreRunParams(
  hookResult: RunnerHookResult,
): {
  dataSubjectId?: string;
  legalBasis?: string;
  consentRef?: string;
  retentionExpiresAt?: number;
  purpose?: string;
} {
  return {
    dataSubjectId: hookResult.context.dataSubjectId,
    legalBasis: hookResult.context.legalBasis,
    consentRef: hookResult.context.consentRef,
    retentionExpiresAt: hookResult.retentionExpiresAt,
    purpose: hookResult.context.purpose,
  };
}
