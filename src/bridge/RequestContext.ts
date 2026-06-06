/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — RequestContext (Correlation IDs)                 ║
 * ║                                                                      ║
 * ║   Génère des IDs courts pour corréler tous les logs d'un même       ║
 * ║   appel (request → MCP → response). Pattern bt-sms : `reqId` 8-char. ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { randomBytes } from 'node:crypto';

/**
 * Génère un requestId court (8 chars hex).
 * Utilisé pour corréler les logs d'une même requête HTTP → MCP call.
 */
export function newRequestId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Récupère le requestId depuis les headers HTTP, ou en génère un nouveau.
 * Supporte les headers `X-Request-Id` et `X-Correlation-Id`.
 */
export function getOrCreateRequestId(headers: Record<string, string | string[] | undefined>): string {
  const fromHeader = headers['x-request-id'] ?? headers['X-Request-Id'] ?? headers['x-correlation-id'];
  if (typeof fromHeader === 'string' && fromHeader) {
    return sanitizeRequestId(fromHeader);
  }
  return newRequestId();
}

/**
 * Nettoie un requestId provenant d'un header (sécurité : max 64 chars, alphanum + -_).
 */
function sanitizeRequestId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || newRequestId();
}
