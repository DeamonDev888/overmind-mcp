/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Privacy Guard (middleware)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Intercepte chaque flux de RP pour appliquer les contrôles Loi 25.
 * Appelé par les runners, le bridge et les outils de stockage.
 *
 * Comportement :
 *   1. Si OVERMIND_LOI25_ENABLED=false → pass-through (zero overhead, v3.8)
 *   2. Détection de la base légale (interne vs tiers)
 *   3. Validation du consentement si tiers (art. 8)
 *   4. Détection de RP dans le texte (email, NAS, téléphone, etc.)
 *   5. Pseudonymisation / anonymisation si requis (art. 23.1)
 *   6. Log du transfert si runner LLM externe (art. 21)
 *   7. Calcul de la rétention (art. 35.2)
 */

import { getPool } from 'overmind-postgres-mcp';
import { rootLogger } from '../logger.js';
import {
  type Loi25Context,
  type LegalBasis,
  type TransferRegion,
  type TransferMechanism,
  isLoi25Enabled,
  getDefaultLegalBasis,
  isInternalSubject,
} from './types.js';
import { detectPii, pseudonymize, hashShort } from './anonymize.js';
import { calculateRetentionExpiry } from './retention.js';
import { getProviderInfo, requiresExplicitConsent } from './transfer_map.js';

const logger = rootLogger.child({ module: 'Loi25Guard' });

// ── Types de réponse ─────────────────────────────────────────────────────────

export interface GuardResult {
  /** Le traitement peut continuer */
  allowed: boolean;
  /** Raison du refus si allowed = false */
  reason?: string;
  /** Contexte Loi 25 enrichi (avec legalBasis résolu, consentRef si validé) */
  context: Loi25Context;
  /** Texte sanitizé (si PII détectés et filter activé) */
  sanitizedPrompt?: string;
  /** RP détectés dans le prompt */
  piiDetected: boolean;
  /** Types de RP détectés */
  piiTypes: string[];
  /** Timestamp d'expiration de rétention */
  retentionExpiresAt: number;
}

// ── Validation de consentement ───────────────────────────────────────────────

/**
 * Valide qu'un consentement est actif pour un sujet + finalité.
 */
async function validateConsent(
  dataSubjectId: string,
  purpose: string,
): Promise<{ valid: boolean; consentRef: string | null; reason?: string }> {
  const pool = getPool();
  try {
    const res = await pool.query(
      `SELECT id, granted_at, expires_at, withdrawn_at
       FROM consent_records
       WHERE data_subject_id = $1 AND purpose = $2
       ORDER BY granted_at DESC LIMIT 1`,
      [dataSubjectId, purpose],
    );

    if (res.rows.length === 0) {
      return {
        valid: false,
        consentRef: null,
        reason: `Aucun consentement trouvé pour le sujet ${dataSubjectId} (finalité: ${purpose})`,
      };
    }

    const consent = res.rows[0];
    const now = Date.now();

    if (consent.withdrawn_at && parseInt(consent.withdrawn_at, 10) <= now) {
      return {
        valid: false,
        consentRef: null,
        reason: `Consentement révoqué pour le sujet ${dataSubjectId}`,
      };
    }

    if (consent.expires_at && parseInt(consent.expires_at, 10) <= now) {
      return {
        valid: false,
        consentRef: null,
        reason: `Consentement expiré pour le sujet ${dataSubjectId}`,
      };
    }

    return { valid: true, consentRef: consent.id };
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Loi25Guard: Failed to validate consent — allowing (fail-open to avoid blocking ops)',
    );
    // Fail-open : si la DB est down, on laisse passer pour éviter de bloquer l'Overmind
    return { valid: true, consentRef: null };
  }
}

// ── Log d'accès ──────────────────────────────────────────────────────────────

/**
 * Enregistre un accès dans access_log.
 */
export async function logAccess(params: {
  dataSubjectId: string | null;
  accessedBy: string;
  action: 'read' | 'write' | 'delete' | 'transfer';
  resourceType: string;
  resourceId: string;
  purpose?: string;
}): Promise<void> {
  if (!isLoi25Enabled()) return;

  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO access_log (id, data_subject_id, accessed_by, action, resource_type, resource_id, purpose, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        hashShort(`${Date.now()}-${Math.random()}`),
        params.dataSubjectId || null,
        params.accessedBy,
        params.action,
        params.resourceType,
        params.resourceId,
        params.purpose || null,
        Date.now(),
      ],
    );
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Loi25Guard: Failed to log access (non-blocking)',
    );
  }
}

// ── Log de transfert ─────────────────────────────────────────────────────────

/**
 * Enregistre un transfert de RP hors Québec dans transfer_log (art. 21).
 */
export async function logTransfer(params: {
  dataSubjectId: string | null;
  destination: string;
  destinationRegion: TransferRegion;
  legalMechanism: TransferMechanism;
  dataType: string;
}): Promise<void> {
  if (!isLoi25Enabled()) return;

  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO transfer_log (id, data_subject_id, destination, destination_region, legal_mechanism, data_type, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        hashShort(`transfer-${Date.now()}-${Math.random()}`),
        params.dataSubjectId || null,
        params.destination,
        params.destinationRegion,
        params.legalMechanism,
        params.dataType,
        Date.now(),
      ],
    );
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Loi25Guard: Failed to log transfer (non-blocking)',
    );
  }
}

// ── Guard principal ──────────────────────────────────────────────────────────

export interface GuardOptions {
  prompt: string;
  dataSubjectId?: string;
  purpose?: string;
  /** Provider LLM visé (pour vérifier si transfert hors QC) */
  provider?: string;
  /** Forcer la base légale (sinon auto-détection) */
  legalBasisOverride?: LegalBasis;
  /** Sanitiser le prompt avant envoi au LLM */
  sanitize?: boolean;
}

/**
 * Applique les contrôles Loi 25 sur une requête.
 *
 * @returns GuardResult — allowed=false si la requête doit être bloquée
 */
export async function loi25Guard(opts: GuardOptions): Promise<GuardResult> {
  const now = Date.now();
  const purpose = opts.purpose || 'agent_execution';

  // ── 1. Feature flag off → pass-through ──
  if (!isLoi25Enabled()) {
    return {
      allowed: true,
      context: {
        legalBasis: 'legitimate_interest',
        purpose,
      },
      piiDetected: false,
      piiTypes: [],
      retentionExpiresAt: calculateRetentionExpiry(now),
    };
  }

  // ── 2. Détection des RP ──
  const piiResult = detectPii(opts.prompt, opts.sanitize === true);

  // ── 3. Résolution de la base légale ──
  let legalBasis: LegalBasis;
  let consentRef: string | undefined;

  const dataSubjectId = opts.dataSubjectId;

  if (opts.legalBasisOverride) {
    legalBasis = opts.legalBasisOverride;
  } else if (dataSubjectId && isInternalSubject(dataSubjectId)) {
    legalBasis = 'legitimate_interest';
  } else if (dataSubjectId) {
    // Sujet identifié mais pas interne → tiers → consentement requis
    legalBasis = 'consent';
  } else {
    legalBasis = getDefaultLegalBasis();
  }

  // ── 4. Validation du consentement (tiers uniquement) ──
  if (legalBasis === 'consent' && dataSubjectId) {
    const consentCheck = await validateConsent(dataSubjectId, purpose);
    if (!consentCheck.valid) {
      await logAccess({
        dataSubjectId,
        accessedBy: 'loi25_guard',
        action: 'read',
        resourceType: 'consent_check',
        resourceId: purpose,
        purpose: 'blocked_no_consent',
      });
      return {
        allowed: false,
        reason: consentCheck.reason || 'Consentement requis et manquant',
        context: { dataSubjectId, legalBasis, purpose },
        piiDetected: piiResult.found,
        piiTypes: piiResult.types,
        retentionExpiresAt: calculateRetentionExpiry(now),
      };
    }
    consentRef = consentCheck.consentRef || undefined;
  }

  // ── 5. Log du transfert si provider externe ──
  if (opts.provider) {
    const providerInfo = getProviderInfo(opts.provider);
    if (requiresExplicitConsent(opts.provider)) {
      logTransfer({
        dataSubjectId: dataSubjectId || null,
        destination: providerInfo.name,
        destinationRegion: providerInfo.region,
        legalMechanism: providerInfo.mechanism,
        dataType: 'prompt',
      }).catch(() => {}); // fire-and-forget
    }
  }

  // ── 6. Construction du résultat ──
  return {
    allowed: true,
    context: {
      dataSubjectId,
      legalBasis,
      consentRef,
      purpose,
    },
    sanitizedPrompt: piiResult.sanitized,
    piiDetected: piiResult.found,
    piiTypes: piiResult.types,
    retentionExpiresAt: calculateRetentionExpiry(now),
  };
}

/**
 * Helper : pseudonymise un identifiant pour stockage en DB.
 */
export function pseudonymizeSubject(rawId: string): string {
  return pseudonymize(rawId);
}
