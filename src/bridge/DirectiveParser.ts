/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — DirectiveParser (Agent-Side Protocol)            ║
 * ║                                                                      ║
 * ║   Permet aux agents d'injecter des directives structurées dans      ║
 * ║   leurs réponses textuelles. Le bridge les extrait et les exécute.  ║
 * ║                                                                      ║
 * ║   PATTERN                                                            ║
 * ║   ───────                                                            ║
 * ║   Inspiré du `CONTEXT_UPDATE: step=X employe_id=Y` de bt-sms.        ║
 * ║                                                                      ║
 * ║   L'agent écrit dans sa réponse :                                   ║
 * ║                                                                      ║
 * ║     "Voici mon analyse.                                             ║
 * ║      SESSION_ID: hermes-sess-abc123                                  ║
 * ║      CONTEXT_UPDATE: step=awaiting_description employe_id=42         ║
 * ║      BRIDGE_NEXT: agent=scout prompt=\"Analyse BTC\"                  ║
 * ║      BRIDGE_END"                                                      ║
 * ║                                                                      ║
 * ║   Le bridge :                                                        ║
 * ║     1. Extrait SESSION_ID, l'assigne au store                       ║
 * ║     2. Patche le context (state machine)                            ║
 * ║     3. Lance automatiquement un nouveau call vers scout              ║
 * ║     4. Supprime les directives du texte retourné au client          ║
 * ║                                                                      ║
 * ║   DIRECTIVES SUPPORTÉES                                              ║
 * ║   ──────────────────────                                             ║
 * ║   - SESSION_ID: <id>             → assigne le sessionId             ║
 * ║   - CONTEXT_UPDATE: k=v k=v      → patche le context                ║
 * ║   - BRIDGE_NEXT: method=X ...    → déclenche un appel suivant       ║
 * ║   - BRIDGE_END                   → arrête la chaîne de next calls   ║
 * ║   - BRIDGE_HINT: <text>          → tag/metadata (no action)         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { createBridgeLogger, type BridgeLogger } from './utils.js';
import type { JsonRpcRequest } from './OverBridgeServer.js';

// ─── Public Types ──────────────────────────────────────────────────────────

export type DirectiveAction =
  | { kind: 'session'; sessionId: string }
  | { kind: 'context'; patch: Record<string, string> }
  | { kind: 'next'; call: JsonRpcRequest }
  | { kind: 'end' }
  | { kind: 'hint'; text: string };

export interface ParsedDirectives {
  /** Texte original sans les directives (propre, pour le client) */
  cleanText: string;
  /** Directives extraites, dans l'ordre */
  actions: DirectiveAction[];
  /** Erreurs de parsing (lignes mal formées, ignorées mais loguées) */
  errors: string[];
}

export interface DirectiveParserOptions {
  /** Logger */
  logger?: BridgeLogger;
}

// ─── DirectiveParser ───────────────────────────────────────────────────────

export class DirectiveParser {
  private readonly log: BridgeLogger;

  constructor(opts: DirectiveParserOptions = {}) {
    this.log = opts.logger ?? createBridgeLogger('directive-parser');
  }

  /**
   * Parse un texte de réponse d'agent et extrait les directives.
   * Lignes de directive : `DIRECTIVE_NAME: value`.
   */
  parse(responseText: string): ParsedDirectives {
    const actions: DirectiveAction[] = [];
    const errors: string[] = [];
    const cleanedLines: string[] = [];

    for (const rawLine of responseText.split('\n')) {
      const line = rawLine.trim();
      // Détecte ligne "DIRECTIVE:" (case-insensitive)
      const m = line.match(/^([A-Z_]+):\s*(.*)$/);
      if (!m) {
        cleanedLines.push(rawLine);
        continue;
      }
      const [, name, rawValue] = m;
      try {
        const action = this.parseDirective(name, rawValue);
        if (action) {
          actions.push(action);
          continue; // directive consommée
        }
        cleanedLines.push(rawLine); // nom inconnu, on garde
      } catch (err) {
        errors.push(`Failed to parse ${name}: ${(err as Error).message}`);
        cleanedLines.push(rawLine); // on garde la ligne en cas d'erreur
      }
    }

    return {
      cleanText: cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      actions,
      errors,
    };
  }

  /**
   * Parse une directive individuelle. Retourne null si nom inconnu.
   */
  private parseDirective(name: string, value: string): DirectiveAction | null {
    switch (name) {
      case 'SESSION_ID':
        if (!value.trim()) throw new Error('Empty session id');
        return { kind: 'session', sessionId: value.trim() };

      case 'CONTEXT_UPDATE': {
        const patch: Record<string, string> = {};
        for (const token of value.split(/\s+/)) {
          const eqIdx = token.indexOf('=');
          if (eqIdx === -1) continue;
          const k = token.slice(0, eqIdx).trim();
          const v = token.slice(eqIdx + 1).trim();
          if (k) patch[k] = decodeURIComponentSafe(v);
        }
        if (Object.keys(patch).length === 0) throw new Error('Empty CONTEXT_UPDATE');
        return { kind: 'context', patch };
      }

      case 'BRIDGE_NEXT': {
        // Format: method=agent.run agent=scout prompt="..."
        //        method=agent.a2a from=scout to=analyst prompt="..."
        const params = parseKeyValueArgs(value);
        if (!params.method) throw new Error('BRIDGE_NEXT requires method=...');
        return {
          kind: 'next',
          call: { jsonrpc: '2.0', id: 0, method: params.method, params },
        };
      }

      case 'BRIDGE_END':
        return { kind: 'end' };

      case 'BRIDGE_HINT':
        return { kind: 'hint', text: value.trim() };

      default:
        return null; // nom inconnu, le caller garde la ligne
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse un format "key=value key2='value with spaces' key3="value with quotes"".
 * Supporte quotes simples, doubles, et backslash escape.
 */
export function parseKeyValueArgs(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)=(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const key = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    // Déchapper les séquences \\ \"
    const decoded = value.replace(/\\(.)/g, '$1');
    result[key] = decoded;
  }
  return result;
}

/**
 * Décode une valeur URI-component si elle ressemble à du %XX, sinon la retourne brute.
 */
function decodeURIComponentSafe(value: string): string {
  if (value.includes('%') && /%[0-9A-Fa-f]{2}/.test(value)) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return value;
}
