/**
 * Error Classifier - Unified error classification for all runners
 * Parses raw output (stdout/stderr/exit code) and returns a structured error code + details
 */

export interface ErrorClassification {
  code: string; // Short error code (e.g., 'QUOTA_EXCEEDED')
  message: string; // Human readable summary
  retryable: boolean; // Whether a retry might succeed
  recoverable: boolean; // Whether we can recover automatically
  details?: string; // Original error details
  raw?: string; // Raw error text
}

// ErrorClassifier type kept for future extensibility

/**
 * Unified error classifier for Claude and Kilo runners
 * Returns structured ErrorClassification with retry/recover hints
 */
export function classifyError(
  raw: string,
  exitCode: number | null,
  extra?: Record<string, unknown>,
): ErrorClassification {
  const lowerRaw = raw.toLowerCase();
  const exitCodeStr = exitCode !== null && exitCode !== undefined ? String(exitCode) : 'null';

  // ─── 1. SPAWN / INSTALLATION ERRORS ──────────────────────────────────────────
  if (
    raw.includes('ENOENT') ||
    raw.includes('command not found') ||
    raw.includes('is not recognized') ||
    raw.includes('not found') ||
    raw.includes('not installed')
  ) {
    return {
      code: 'SPAWN_ERROR',
      message: 'CLI non installée ou non trouvée dans le PATH',
      retryable: false,
      recoverable: false,
      details: 'Vérifiez que la CLI est correctement installée',
      raw,
    };
  }

  // ─── 2. QUOTA / EXHAUSTION ERRORS ─────────────────────────────────────────────
  if (
    lowerRaw.includes('quota') ||
    lowerRaw.includes('insufficient_quota') ||
    lowerRaw.includes('quota exceeded') ||
    lowerRaw.includes('monthly limit') ||
    lowerRaw.includes('daily limit') ||
    lowerRaw.includes('credit') ||
    lowerRaw.includes('credits exhausted') ||
    lowerRaw.includes('credits limit')
  ) {
    return {
      code: 'QUOTA_EXCEEDED',
      message: 'Quota API épuisé — Limite de credits/mois atteinte',
      retryable: false,
      recoverable: false,
      details: 'Contactez votre provider pour augmenter le quota',
      raw,
    };
  }

  if (
    lowerRaw.includes('token limit') ||
    lowerRaw.includes('token_exhausted') ||
    lowerRaw.includes('max tokens') ||
    lowerRaw.includes('too many tokens') ||
    lowerRaw.includes('context_length') ||
    lowerRaw.includes('context overflow') ||
    lowerRaw.includes('maximum context') ||
    lowerRaw.includes('exceeds maximum')
  ) {
    return {
      code: 'CONTEXT_OVERFLOW',
      message: 'Contexte trop long — Limite de tokens dépassée',
      retryable: true,
      recoverable: false,
      details: 'Réduisez la taille du prompt ou utilisez un modèle avec plus de contexte',
      raw,
    };
  }

  if (
    lowerRaw.includes('rate limit') ||
    lowerRaw.includes('rate_limit') ||
    lowerRaw.includes('too many requests') ||
    lowerRaw.includes('429') ||
    lowerRaw.includes('retry after') ||
    lowerRaw.includes('request rate')
  ) {
    return {
      code: 'RATE_LIMIT',
      message: 'Rate limit atteint — Trop de requêtes',
      retryable: true,
      recoverable: true,
      details: 'Attendez quelques secondes avant de réessayer',
      raw,
    };
  }

  // ─── 3. AUTH / PERMISSION ERRORS ─────────────────────────────────────────────
  if (
    lowerRaw.includes('api_key') ||
    lowerRaw.includes('auth') ||
    lowerRaw.includes('unauthorized') ||
    lowerRaw.includes('invalid authentication') ||
    lowerRaw.includes('authentication') ||
    lowerRaw.includes('permission') ||
    lowerRaw.includes('access denied') ||
    lowerRaw.includes('403') ||
    lowerRaw.includes('401')
  ) {
    return {
      code: 'AUTH_ERROR',
      message: 'Erreur d\'authentification — Clé API invalide ou manquante',
      retryable: false,
      recoverable: false,
      details: 'Vérifiez votre API key dans le .env',
      raw,
    };
  }

  if (
    lowerRaw.includes('permission denied') ||
    lowerRaw.includes('eacces') ||
    lowerRaw.includes('eperm') ||
    lowerRaw.includes('access denied')
  ) {
    return {
      code: 'PERMISSION_DENIED',
      message: 'Permission refusée — Problème d\'accès fichier/dossier',
      retryable: false,
      recoverable: false,
      details: 'Vérifiez les permissions du répertoire de travail',
      raw,
    };
  }

  // ─── 4. NETWORK / CONNECTION ERRORS ──────────────────────────────────────────
  if (
    lowerRaw.includes('connection') ||
    lowerRaw.includes('timeout') ||
    lowerRaw.includes('etimedout') ||
    lowerRaw.includes('socket') ||
    lowerRaw.includes('network') ||
    lowerRaw.includes('econnrefused') ||
    lowerRaw.includes('econnreset') ||
    lowerRaw.includes('fetch failed') ||
    lowerRaw.includes('dns') ||
    lowerRaw.includes('enotfound')
  ) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Erreur réseau — Problème de connexion',
      retryable: true,
      recoverable: true,
      details: 'Vérifiez votre connexion internet',
      raw,
    };
  }

  // ─── 5. TIMEOUT ERRORS ───────────────────────────────────────────────────────
  if (lowerRaw.includes('timeout') && lowerRaw.includes('hard')) {
    return {
      code: 'HARD_TIMEOUT',
      message: 'Timeout dur dépassé — L\'agent ne répond plus',
      retryable: true,
      recoverable: false,
      details: 'L\'agent était stagnant. Timeout: ' + (extra?.timeoutMs ?? 'inconnu') + 'ms',
      raw,
    };
  }

  if (lowerRaw.includes('timeout') || lowerRaw.includes('timed out')) {
    return {
      code: 'TIMEOUT_EXHAUST',
      message: 'Timeout dépassé — L\'agent a mis trop de temps',
      retryable: true,
      recoverable: false,
      details: 'Timeout: ' + (extra?.timeoutMs ?? 'inconnu') + 'ms',
      raw,
    };
  }

  // ─── 6. SESSION ERRORS ──────────────────────────────────────────────────────
  if (
    lowerRaw.includes('no conversation found') ||
    lowerRaw.includes('session') ||
    lowerRaw.includes('session not found') ||
    lowerRaw.includes('invalid session') ||
    lowerRaw.includes('conversation not found')
  ) {
    return {
      code: 'SESSION_ERROR',
      message: 'Session invalide ou expirée',
      retryable: true,
      recoverable: true,
      details: 'Nouvelle session sera créée automatiquement',
      raw,
    };
  }

  // ─── 7. AGENT ERRORS ────────────────────────────────────────────────────────
  if (
    lowerRaw.includes('agent') &&
    (lowerRaw.includes('not found') || lowerRaw.includes('not exist') || lowerRaw.includes('invalid agent'))
  ) {
    return {
      code: 'INVALID_AGENT',
      message: 'Agent introuvable — Vérifiez le nom',
      retryable: false,
      recoverable: false,
      details: 'L\'agent n\'existe pas dans le registre OverMind',
      raw,
    };
  }

  // ─── 8. PARSING / FORMAT ERRORS ─────────────────────────────────────────────
  if (
    lowerRaw.includes('json') ||
    lowerRaw.includes('parse') ||
    lowerRaw.includes('invalid response') ||
    lowerRaw.includes('unexpected token')
  ) {
    return {
      code: 'PARSE_ERROR',
      message: 'Erreur de parsing — Réponse malformée',
      retryable: true,
      recoverable: false,
      details: 'La sortie du modèle n\'a pas pu être parsée',
      raw,
    };
  }

  // ─── 9. MODEL ERRORS ────────────────────────────────────────────────────────
  if (
    lowerRaw.includes('model') &&
    (lowerRaw.includes('not found') || lowerRaw.includes('unknown model') || lowerRaw.includes('unsupported model'))
  ) {
    return {
      code: 'MODEL_NOT_FOUND',
      message: 'Modèle non trouvé — Vérifiez le nom du modèle',
      retryable: false,
      recoverable: false,
      details: 'Le modèle spécifié n\'est pas disponible',
      raw,
    };
  }

  // ─── 10. INTERNAL ERRORS ─────────────────────────────────────────────────────
  if (
    lowerRaw.includes('internal error') ||
    lowerRaw.includes('internal_server_error') ||
    lowerRaw.includes('500') ||
    lowerRaw.includes('502') ||
    lowerRaw.includes('503')
  ) {
    return {
      code: 'INTERNAL_ERROR',
      message: 'Erreur interne du serveur API',
      retryable: true,
      recoverable: true,
      details: 'Erreur serveur provider — réessayez plus tard',
      raw,
    };
  }

  // ─── 11. EXIT CODE BASED ERRORS ──────────────────────────────────────────────
  if (exitCode !== null && exitCode !== 0) {
    // Known exit codes mapping
    const exitCodeMap: Record<string, { message: string; retryable: boolean }> = {
      '1': { message: 'Erreur générale — Le processus a échoué', retryable: true },
      '126': { message: 'Permission refusée — Fichier non exécutable', retryable: false },
      '127': { message: 'Commande non trouvée — CLI non installée', retryable: false },
      '128': { message: 'Signal reçu — Processus interrompu', retryable: true },
      '130': { message: 'Interrompu par Ctrl+C', retryable: true },
      '137': { message: 'Killed (SIGKILL) — Mémoire insuffisante ou timeout dur', retryable: true },
      '143': { message: 'Terminé par signal (SIGTERM)', retryable: true },
      '144': { message: 'Signal 144 — Proxy/annulation', retryable: true },
      '255': { message: 'Erreur critique — Vérifiez les logs', retryable: true },
    };

    const mapped = exitCodeMap[exitCodeStr];
    return {
      code: `EXIT_CODE_${exitCode}`,
      message: mapped?.message ?? `Processus terminé avec code ${exitCode}`,
      retryable: mapped?.retryable ?? true,
      recoverable: false,
      details: 'Code de sortie: ' + exitCode,
      raw,
    };
  }

  // ─── 12. EMPTY RESPONSE ──────────────────────────────────────────────────────
  if (!raw || raw.trim() === '') {
    return {
      code: 'EMPTY_RESPONSE',
      message: 'Réponse vide — Pas de sortie du modèle',
      retryable: true,
      recoverable: false,
      details: 'Le modèle n\'a produit aucune sortie',
      raw,
    };
  }

  // ─── 13. FALLBACK ───────────────────────────────────────────────────────────
  return {
    code: 'UNKNOWN_ERROR',
    message: 'Erreur inconnue — ' + (raw.substring(0, 100) || 'pas de détails'),
    retryable: true,
    recoverable: false,
    details: 'Erreur non classifiée',
    raw,
  };
}

/**
 * Format ErrorClassification for user display
 */
export function formatError(err: ErrorClassification): string {
  const emoji = err.retryable ? '🔄' : '❌';
  const retryHint = err.retryable && err.recoverable ? ' (recovery automatique possible)' : err.retryable ? ' (réessayable)' : ' (irréversible)';

  let msg = `${emoji} **[${err.code}]** ${err.message}${retryHint}`;
  if (err.details) {
    msg += `\n   └─ 💡 ${err.details}`;
  }
  return msg;
}