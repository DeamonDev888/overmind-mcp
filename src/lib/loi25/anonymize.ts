/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Loi 25 — Anonymisation technique (art. 23.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Techniques d'anonymisation pour empêcher la ré-identification :
 *   1. Pseudonymisation — remplace identifiants directs par hash SHA-256 + salt
 *   2. Généralisation — tronque timestamps, géoloc
 *   3. Bruit sur embeddings — réduit la ré-identification par recherche vectorielle
 */

import crypto from 'crypto';

// ── Salt rotatif ─────────────────────────────────────────────────────────────

/**
 * Salt pour la pseudonymisation. En production, devrait être stocké séparément
 * des données (key vault, variable d'environnement séparée).
 */
function getAnonymizationSalt(): string {
  return process.env.OVERMIND_LOI25_SALT || 'overmind-loi25-default-salt-v1';
}

// ── Pseudonymisation ─────────────────────────────────────────────────────────

/**
 * Hash un identifiant direct (email, Discord ID, téléphone) en ID pseudonymisé.
 * SHA-256 + salt → impossible de remonter à l'original sans le salt.
 *
 * @param identifier Identifiant direct (email, ID Discord, etc.)
 * @returns Pseudonyme stable (32 chars hex)
 */
export function pseudonymize(identifier: string): string {
  const salted = `${getAnonymizationSalt()}:${identifier}`;
  return crypto.createHash('sha256').update(salted).digest('hex');
}

/**
 * Hash court pour les clés de référence (consent_ref, etc.).
 */
export function hashShort(text: string): string {
  const salted = `${getAnonymizationSalt()}:${text}`;
  return crypto.createHash('sha256').update(salted).digest('hex').slice(0, 16);
}

// ── Généralisation ───────────────────────────────────────────────────────────

/**
 * Généralise un timestamp en tronquant à la journée (supprime heures/minutes/secondes).
 * Réduit la précision → moins de risque de ré-identification par corrélation.
 *
 * @param timestampMs Timestamp en millisecondes
 * @returns Timestamp tronqué au jour (00:00:00 UTC)
 */
export function generalizeTimestamp(timestampMs: number): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor(timestampMs / dayMs) * dayMs;
}

// ── Détection de RP ──────────────────────────────────────────────────────────

export interface PiiDetection {
  found: boolean;
  types: string[];
  /** Le texte contient des RP identifiés */
  sanitized?: string;
}

/**
 * Regex pour détecter les renseignements personnels les plus courants.
 * Conservateur : mieux vaut faux positif que faux négatif.
 */
const PII_PATTERNS: Array<{ type: string; pattern: RegExp; replacement: string }> = [
  // Email
  {
    type: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_ANONYMIZED]',
  },
  // Numéro de téléphone QC (format NXX NXX-XXXX ou +1)
  {
    type: 'phone',
    pattern: /(\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    replacement: '[PHONE_ANONYMIZED]',
  },
  // Numéro d'assurance sociale (NAS) — format 123 456 789 ou 123-456-789
  {
    type: 'sin',
    pattern: /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g,
    replacement: '[SIN_ANONYMIZED]',
  },
  // Carte de crédit (Visa/MC/Amex — 13-19 chiffres groupés)
  {
    type: 'credit_card',
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: '[CARD_ANONYMIZED]',
  },
  // Code postal QC (H1A 1A1)
  {
    type: 'postal_code',
    pattern: /\b[ABCEGHJKLMNPRSTVXY]\d[A-Z][ -]?\d[A-Z]\d\b/gi,
    replacement: '[POSTAL_ANONYMIZED]',
  },
  // Discord ID (snowflake 17-20 chiffres)
  {
    type: 'discord_id',
    pattern: /\b\d{17,20}\b/g,
    replacement: '[DISCORD_ID_ANONYMIZED]',
  },
];

/**
 * Détecte les renseignements personnels dans un texte.
 *
 * @param text Texte à analyser
 * @param sanitize Si true, remplace les RP détectés par des placeholders
 * @returns Résultat de la détection + texte sanitizé si demandé
 */
export function detectPii(text: string, sanitize = false): PiiDetection {
  const foundTypes = new Set<string>();
  let sanitized = text;

  for (const { type, pattern, replacement } of PII_PATTERNS) {
    if (pattern.test(text)) {
      foundTypes.add(type);
      pattern.lastIndex = 0; // reset regex state
      if (sanitize) {
        sanitized = sanitized.replace(pattern, replacement);
      }
    }
  }

  const types = Array.from(foundTypes);
  return {
    found: types.length > 0,
    types,
    sanitized: sanitize ? sanitized : undefined,
  };
}

/**
 * Sanitize un texte en remplaçant tous les RP détectés.
 * Utilisé avant l'envoi à un LLM si OVERMIND_PII_FILTER=true.
 */
export function sanitizeText(text: string): string {
  return detectPii(text, true).sanitized || text;
}

// ── Bruit sur embeddings ─────────────────────────────────────────────────────

/**
 * Ajoute un bruit gaussien à un embedding pour réduire la ré-identification
 * par recherche vectorielle (K-anonymité approximative).
 *
 * Le bruit est proportionnel à l'écart-type des composantes → préserve
 * la structure globale tout en empêchant le matching exact.
 *
 * @param embedding Vecteur d'embedding
 * @param noiseLevel Niveau de bruit (0 = aucun, 0.1 = léger, 0.3 = fort)
 * @returns Embedding bruité
 */
export function addEmbeddingNoise(
  embedding: number[],
  noiseLevel: number = 0.1,
): number[] {
  if (noiseLevel <= 0) return embedding;

  // Calculer l'écart-type
  const mean = embedding.reduce((sum, v) => sum + v, 0) / embedding.length;
  const variance =
    embedding.reduce((sum, v) => sum + (v - mean) ** 2, 0) / embedding.length;
  const stdDev = Math.sqrt(variance);

  // Bruit gaussien via Box-Muller transform
  return embedding.map((val) => {
    const u1 = Math.random() || 1e-10; // éviter log(0)
    const u2 = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return val + gaussian * stdDev * noiseLevel;
  });
}
