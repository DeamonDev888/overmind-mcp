/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Capture au niveau du Bridge
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pseudonymise les externalKeys (Discord userId, phone, Telegram id)
 * en data_subject_id Loi 25 et propage le contexte au runner.
 *
 * Appelé par OverBridgeServer avant l'auto-dispatch vers agent.run.
 */

import { pseudonymize } from './anonymize.js';
import { isLoi25Enabled, isInternalSubject } from './types.js';
import type { LegalBasis } from './types.js';

export interface BridgeCaptureResult {
  /** data_subject_id pseudonymisé (hash SHA-256 de l'externalKey) */
  dataSubjectId: string;
  /** Base légale résolue selon interne/tiers */
  legalBasis: LegalBasis;
  /** Source du sujet */
  source: 'discord' | 'telegram' | 'voipms' | 'twilio' | 'generic';
  /** True si le sujet est interne (allowlist) */
  isInternal: boolean;
}

/**
 * Map des providers webhook vers les sources Loi 25.
 */
const PROVIDER_TO_SOURCE: Record<string, BridgeCaptureResult['source']> = {
  discord: 'discord',
  telegram: 'telegram',
  voipms: 'voipms',
  twilio: 'twilio',
  generic: 'generic',
};

/**
 * Capture et pseudonymise l'identité d'un utilisateur bridge.
 *
 * @param externalKey Clé externe brute (userId Discord, phone, etc.)
 * @param provider Provider webhook source
 * @returns BridgeCaptureResult avec dataSubjectId pseudonymisé
 */
export function captureBridgeSubject(
  externalKey: string,
  provider: string,
): BridgeCaptureResult {
  const source = PROVIDER_TO_SOURCE[provider] || 'generic';
  const dataSubjectId = pseudonymize(externalKey);
  const isInternal = isInternalSubject(dataSubjectId);
  const legalBasis: LegalBasis = isInternal ? 'legitimate_interest' : 'consent';

  return {
    dataSubjectId,
    legalBasis,
    source,
    isInternal,
  };
}

/**
 * Propage le data_subject_id au contexte d'exécution via variable d'environnement.
 * Le runner_hook.ts lit OVERMIND_CURRENT_SUBJECT_ID pour le passer au guard.
 *
 * Note : cette approche est safe car le bridge est mono-request par spawn.
 */
export function propagateSubjectContext(result: BridgeCaptureResult): void {
  if (!isLoi25Enabled()) return;
  process.env.OVERMIND_CURRENT_SUBJECT_ID = result.dataSubjectId;
}

/**
 * Nettoie le contexte après exécution.
 */
export function clearSubjectContext(): void {
  delete process.env.OVERMIND_CURRENT_SUBJECT_ID;
}
