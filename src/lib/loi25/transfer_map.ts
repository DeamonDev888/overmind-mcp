/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Cartographie des transferts (registre des providers LLM)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Référentiel des 8 providers LLM supportés par Overmind.
 * Documente la région et le mécanisme légal de chaque transfert (art. 21-22).
 *
 * Décision validée : documentation seule, aucun blocage de providers.
 */

import type { TransferRegion, TransferMechanism } from './types.js';

export interface ProviderTransferInfo {
  /** Nom canonique du provider (doit matcher modelMapping.ts / Hermes config) */
  name: string;
  /** Région d'hébergement principale */
  region: TransferRegion;
  /** Mécanisme légal pour le transfert hors QC */
  mechanism: TransferMechanism;
  /** Le transfert est-il documenté et conforme ? */
  documented: boolean;
  /** Notes sur les sous-traitants / hébergeurs */
  notes?: string;
}

/**
 * Registre des providers LLM connus.
 * À étendre quand de nouveaux providers sont ajoutés.
 */
export const PROVIDER_REGISTRY: Record<string, ProviderTransferInfo> = {
  // ── Providers US ──
  anthropic: {
    name: 'anthropic',
    region: 'US',
    mechanism: 'standard_contractual_clauses',
    documented: true,
    notes: 'Claude — hébergé US (Oregon/Virginia)',
  },
  openai: {
    name: 'openai',
    region: 'US',
    mechanism: 'standard_contractual_clauses',
    documented: true,
    notes: 'GPT — hébergé US',
  },
  google: {
    name: 'google',
    region: 'US',
    mechanism: 'standard_contractual_clauses',
    documented: true,
    notes: 'Gemini — hébergé US',
  },

  // ── Providers EU ──
  mistral: {
    name: 'mistral',
    region: 'EU',
    mechanism: 'standard_contractual_clauses',
    documented: true,
    notes: 'Mistral AI — hébergé EU (Paris)',
  },

  // ── Providers CN ──
  'z-ai': {
    name: 'z-ai',
    region: 'CN',
    mechanism: 'explicit_consent',
    documented: false,
    notes: 'Zhipu AI (GLM) — hébergé Chine. Consentement explicite recommandé.',
  },
  kimi: {
    name: 'kimi',
    region: 'CN',
    mechanism: 'explicit_consent',
    documented: false,
    notes: 'Moonshot AI — hébergé Chine. Consentement explicite recommandé.',
  },
  'minimax-cn': {
    name: 'minimax-cn',
    region: 'CN',
    mechanism: 'explicit_consent',
    documented: false,
    notes: 'MiniMax — hébergé Chine. Consentement explicite recommandé.',
  },
  zai: {
    name: 'zai',
    region: 'CN',
    mechanism: 'explicit_consent',
    documented: false,
    notes: 'Alias z-ai (legacy). Consentement explicite recommandé.',
  },
  minimax: {
    name: 'minimax',
    region: 'CN',
    mechanism: 'explicit_consent',
    documented: false,
    notes: 'MiniMax (international). Consentement explicite recommandé.',
  },

  // ── Providers QC/CA (aucun actuellement) ──
  // Quand un provider QC sera ajouté, région = 'QC', mechanism = 'adequacy'

  // ── Fallback ──
  unknown: {
    name: 'unknown',
    region: 'OTHER',
    mechanism: 'unspecified',
    documented: false,
    notes: 'Provider non répertorié — à documenter',
  },
};

/**
 * Récupère les infos de transfert pour un provider.
 * @param providerName Nom du provider (ex: 'anthropic', 'zai', 'mistral')
 * @returns Infos de transfert, ou unknown si non trouvé
 */
export function getProviderInfo(providerName: string): ProviderTransferInfo {
  const normalized = providerName.toLowerCase().trim();
  return PROVIDER_REGISTRY[normalized] || PROVIDER_REGISTRY.unknown;
}

/**
 * Liste tous les providers documentés pour le registre des traitements.
 */
export function listDocumentedProviders(): ProviderTransferInfo[] {
  return Object.values(PROVIDER_REGISTRY).filter((p) => p.name !== 'unknown');
}

/**
 * Indique si un provider nécessite un consentement explicite (transfert hors QC/CA).
 */
export function requiresExplicitConsent(providerName: string): boolean {
  const info = getProviderInfo(providerName);
  return info.region !== 'QC' && info.region !== 'CA';
}
