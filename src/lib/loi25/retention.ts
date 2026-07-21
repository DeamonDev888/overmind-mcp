/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Moteur de rétention (art. 35.2-35.3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Calcule les dates d'expiration de rétention et gère le workflow :
 *   hot (table active) → anonymisation → cold archive (5 ans) → purge définitive
 */

import type { LegalBasis } from './types.js';
import { getDefaultRetentionDays, getDefaultArchiveYears } from './types.js';

// ── Constantes ───────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_YEAR = 365 * MS_PER_DAY;

// ── Calcul d'expiration ──────────────────────────────────────────────────────

/**
 * Calcule le timestamp d'expiration de rétention active (hot).
 *
 * @param createdAt Timestamp de création (ms)
 * @param retentionDaysOverride Override du nombre de jours (défaut: .env)
 * @returns Timestamp d'expiration
 */
export function calculateRetentionExpiry(
  createdAt: number,
  retentionDaysOverride?: number,
): number {
  const days = retentionDaysOverride ?? getDefaultRetentionDays();
  return createdAt + days * MS_PER_DAY;
}

/**
 * Calcule le timestamp d'expiration de l'archivage cold storage.
 *
 * @param archivedAt Timestamp d'archivage (ms)
 * @param archiveYearsOverride Override du nombre d'années (défaut: .env)
 * @returns Timestamp d'expiration de l'archive
 */
export function calculateArchiveExpiry(
  archivedAt: number,
  archiveYearsOverride?: number,
): number {
  const years = archiveYearsOverride ?? getDefaultArchiveYears();
  return archivedAt + years * MS_PER_YEAR;
}

/**
 * Vérifie si un enregistrement est expiré.
 */
export function isExpired(expiresAt: number, now: number = Date.now()): boolean {
  return now >= expiresAt;
}

// ── Politiques de rétention par défaut ──────────────────────────────────────

export interface RetentionPolicyConfig {
  category: string;
  retentionDays: number;
  archiveYears: number;
  legalBasis: LegalBasis;
  anonymizeAfterDays: number;
}

/**
 * Politiques de rétention par défaut au moment de la migration.
 * Définition validée : 30 jours actif + 5 ans archive pour tout.
 */
export function getDefaultPolicies(): RetentionPolicyConfig[] {
  const retentionDays = getDefaultRetentionDays();
  const archiveYears = getDefaultArchiveYears();
  const anonymizeAfterDays = Math.floor(retentionDays / 2); // anonymiser à mi-rétention

  return [
    {
      category: 'agent_runs',
      retentionDays,
      archiveYears,
      legalBasis: 'legitimate_interest',
      anonymizeAfterDays,
    },
    {
      category: 'knowledge_chunks',
      retentionDays,
      archiveYears,
      legalBasis: 'legitimate_interest',
      anonymizeAfterDays,
    },
    {
      category: 'discord_messages',
      retentionDays,
      archiveYears,
      legalBasis: 'legitimate_interest',
      anonymizeAfterDays,
    },
    {
      category: 'api_requests',
      retentionDays,
      archiveYears,
      legalBasis: 'legitimate_interest',
      anonymizeAfterDays,
    },
  ];
}

/**
 * Politiques par défaut — format JSON pour la migration SQL.
 */
export function getDefaultPoliciesJson(): string {
  return JSON.stringify(getDefaultPolicies(), null, 2);
}

/**
 * Détermine si un enregistrement doit être anonymisé (mi-rétention)
 * vs supprimé (fin de rétention active).
 *
 * @param createdAt Timestamp de création
 * @param policy Politique de rétention
 * @returns 'active' | 'anonymize' | 'archive' | 'purge'
 */
export function getRetentionStage(
  createdAt: number,
  policy: RetentionPolicyConfig,
  now: number = Date.now(),
): 'active' | 'anonymize' | 'archive' | 'purge' {
  const ageDays = (now - createdAt) / MS_PER_DAY;

  if (ageDays >= policy.retentionDays + policy.archiveYears * 365) {
    return 'purge'; // > rétention active + archive → supprimer définitivement
  }
  if (ageDays >= policy.retentionDays) {
    return 'archive'; // > rétention active → archiver
  }
  if (
    policy.anonymizeAfterDays > 0 &&
    ageDays >= policy.anonymizeAfterDays
  ) {
    return 'anonymize'; // > mi-rétention → anonymiser (mais garder en table active)
  }
  return 'active'; // dans la fenêtre de rétention active
}
