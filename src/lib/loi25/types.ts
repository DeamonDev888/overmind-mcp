/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Types partagés
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Conformité Loi 25 (Québec) pour Overmind-MCP.
 * Voir docs/PLAN_LOI25_INTEGRATION.md pour le plan complet.
 */

/** Bases légales au sens de la Loi 25 */
export type LegalBasis =
  | 'consent' // art. 8.1-8.2 — consentement explicite (tiers externes)
  | 'contract' // art. 7.1.1 — exécution d'un contrat
  | 'legitimate_interest' // art. 7.1 — intérêt légitime (usage interne)
  | 'legal_obligation'; // art. 7.1.2 — obligation légale

/** Catégories de données personnelles */
export type DataCategory =
  | 'agent_runs' // prompts et résultats d'agents
  | 'knowledge_chunks' // texte vectorisé + embeddings
  | 'discord_messages' // messages captés par le bridge
  | 'api_requests' // requêtes MCP externes
  | 'credentials'; // tokens, clés API (jamais stockés en clair)

/** Régions de transfert pour les providers LLM */
export type TransferRegion = 'QC' | 'CA' | 'US' | 'EU' | 'CN' | 'OTHER';

/** Mécanismes légaux pour les transferts hors Québec */
export type TransferMechanism =
  | 'standard_contractual_clauses' // clauses contractuelles types
  | 'adequacy' // décision d'adéquation
  | 'explicit_consent' // consentement explicite du sujet
  | 'binding_corporate_rules' // règles internes contraignantes
  | 'unspecified'; // pas encore documenté

/** Niveaux de gravité d'incident (art. 12.1) */
export type IncidentSeverity = 'low' | 'moderate' | 'high';

/** Catégories d'incident */
export type IncidentCategory =
  | 'data_leak' // fuite de RP
  | 'unauthorized_access' // accès non autorisé
  | 'breach' // violation de sécurité
  | 'retention_violation' // rétention au-delà du délai
  | 'transfer_violation' // transfert non documenté
  | 'consent_violation'; // traitement sans base légale

/**
 * Contexte Loi 25 propagé à travers chaque outil et runner.
 * Obligatoire quand OVERMIND_LOI25_ENABLED=true.
 */
export interface Loi25Context {
  /** Identifiant pseudonymisé de la personne (hash SHA-256, jamais l'identité brute) */
  dataSubjectId?: string;
  /** Base légale du traitement */
  legalBasis: LegalBasis;
  /** Référence au consentement si legalBasis = 'consent' */
  consentRef?: string;
  /** Finalité du traitement (art. 4 — doit être légitime et pertinente) */
  purpose: string;
  /** Anonymiser les RP avant stockage (art. 23.1) */
  anonymize?: boolean;
}

/** Enregistrement de consentement (table consent_records) */
export interface ConsentRecord {
  id: string;
  data_subject_id: string;
  purpose: string;
  legal_basis: LegalBasis;
  granted_at: number;
  expires_at: number | null;
  withdrawn_at: number | null;
  evidence: string | null;
}

/** Sujet de données (table data_subjects) */
export interface DataSubject {
  id: string;
  display_name: string | null;
  source: 'discord' | 'api' | 'manual' | 'bridge';
  created_at: number;
  metadata: Record<string, unknown> | null;
}

/** Entrée du registre des traitements (table processing_registry) */
export interface ProcessingEntry {
  id: string;
  name: string;
  purpose: string;
  legal_basis: LegalBasis;
  data_categories: string;
  recipients: string;
  retention_days: number;
  created_at: number;
  updated_at: number;
}

/** Journal d'incident (table incident_log) */
export interface IncidentLogEntry {
  id: string;
  detected_at: number;
  severity: IncidentSeverity;
  category: IncidentCategory;
  description: string | null;
  data_subjects_affected: number;
  cai_notified: number;
  subjects_notified: number;
  resolved_at: number | null;
}

/** Journal d'accès (table access_log) */
export interface AccessLogEntry {
  id: string;
  data_subject_id: string | null;
  accessed_by: string;
  action: 'read' | 'write' | 'delete' | 'transfer';
  resource_type: string;
  resource_id: string;
  purpose: string | null;
  timestamp: number;
}

/** Journal de transfert hors QC (table transfer_log) */
export interface TransferLogEntry {
  id: string;
  data_subject_id: string | null;
  destination: string;
  destination_region: TransferRegion;
  legal_mechanism: TransferMechanism;
  data_type: string;
  timestamp: number;
}

/** Politique de rétention (table retention_policies) */
export interface RetentionPolicy {
  id: string;
  category: string;
  retention_days: number;
  legal_basis: LegalBasis;
  anonymize_after_days: number | null;
  active: boolean;
}

/**
 * Vérifie si la Loi 25 est activée (master feature flag).
 * Si false, tous les guards sont passifs (comportement v3.8).
 */
export function isLoi25Enabled(): boolean {
  return process.env.OVERMIND_LOI25_ENABLED === 'true';
}

/** Lit la rétention par défaut depuis .env (défaut: 30 jours) */
export function getDefaultRetentionDays(): number {
  return parseInt(process.env.OVERMIND_LOI25_RETENTION_DAYS || '30', 10);
}

/** Lit la durée d'archivage cold storage depuis .env (défaut: 5 ans) */
export function getDefaultArchiveYears(): number {
  return parseInt(process.env.OVERMIND_LOI25_ARCHIVE_YEARS || '5', 10);
}

/** Lit la base légale par défaut depuis .env */
export function getDefaultLegalBasis(): LegalBasis {
  const val = process.env.OVERMIND_LOI25_DEFAULT_BASIS || 'legitimate_interest';
  if (
    val === 'consent' ||
    val === 'contract' ||
    val === 'legitimate_interest' ||
    val === 'legal_obligation'
  ) {
    return val;
  }
  return 'legitimate_interest';
}

/**
 * Allowlist des sujets internes (intérêt légitime suffisant, pas de consentement requis).
 * Format .env : OVERMIND_LOI25_INTERNAL_SUBJECTS=hash1,hash2,hash3
 */
export function getInternalSubjects(): Set<string> {
  const raw = process.env.OVERMIND_LOI25_INTERNAL_SUBJECTS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Détermine si un sujet est interne (intérêt légitime) ou tiers (consentement requis).
 */
export function isInternalSubject(dataSubjectId: string): boolean {
  return getInternalSubjects().has(dataSubjectId);
}
