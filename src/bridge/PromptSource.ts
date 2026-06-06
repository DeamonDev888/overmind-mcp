/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — PromptSource (Multi-Input Prompt Resolver)      ║
 * ║                                                                      ║
 * ║   Résout un prompt depuis 8 sources différentes :                    ║
 * ║     1. --prompt "..."           (string literal)                     ║
 * ║     2. --prompt-file path.txt   (fichier local)                      ║
 * ║     3. --prompt-stdin           (lit stdin si pipe)                  ║
 * ║     4. --prompt-base64 "..."    (binaire décodé)                     ║
 * ║     5. --prompt-url "https://"  (fetch HTTP/HTTPS)                   ║
 * ║     6. --prompt-file-base64 b   (fichier binaire décodé)             ║
 * ║     7. --prompt-json '{"k":"v"}' (objet JSON, reformaté)             ║
 * ║     8. --prompt-template t      (template avec ${var} interpolation) ║
 * ║                                                                      ║
 * ║   Ordre de priorité (1er match gagne) :                             ║
 * ║     1. --prompt (literal)                                            ║
 * ║     2. --prompt-file                                                ║
 * ║     3. --prompt-stdin (si TTY absent)                                ║
 * ║     4. --prompt-base64                                              ║
 * ║     5. --prompt-url                                                 ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { hasStdinData, readStdin } from './ArgParser.js';

// ─── Public API ────────────────────────────────────────────────────────────

export interface ResolvePromptOptions {
  /** --prompt "..." (string literal) */
  prompt?: string;
  /** --prompt-file path.txt */
  promptFile?: string;
  /** --prompt-stdin (true = lit stdin) */
  promptStdin?: boolean;
  /** --prompt-base64 "..." (données binaires) */
  promptBase64?: string;
  /** --prompt-file-base64 path (fichier binaire) */
  promptFileBase64?: string;
  /** --prompt-url "https://..." */
  promptUrl?: string;
  /** --prompt-json '{"k":"v"}' (objet → reformaté en texte) */
  promptJson?: string;
  /** --prompt-template "Bonjour ${name}" avec --var name=Monde */
  promptTemplate?: string;
  /** Variables pour --prompt-template et --prompt-file templating */
  vars?: Record<string, string>;
}

export interface ResolvedPrompt {
  /** Le texte résolu */
  text: string;
  /** Source effective (pour debug) */
  source: PromptSource;
  /** Métadonnées additionnelles (taille, encoding, etc.) */
  meta: {
    bytes: number;
    encoding: 'utf-8' | 'base64' | 'binary';
    origin: string;
  };
}

export type PromptSource =
  | 'literal'
  | 'file'
  | 'stdin'
  | 'base64'
  | 'file-base64'
  | 'url'
  | 'json'
  | 'template'
  | 'fallback';

/**
 * Résout le prompt depuis la première source valide.
 * Throw si aucune source ne fournit du contenu.
 */
export async function resolvePrompt(opts: ResolvePromptOptions): Promise<ResolvedPrompt> {
  // 1. Literal
  if (opts.prompt !== undefined && opts.prompt !== '') {
    return makeResolved(opts.prompt, 'literal', 'utf-8', 'arg:prompt');
  }

  // 2. File
  if (opts.promptFile) {
    const text = await fs.readFile(opts.promptFile, 'utf-8');
    const final = interpolate(text, opts.vars);
    return makeResolved(final, 'file', 'utf-8', `file:${opts.promptFile}`);
  }

  // 3. Stdin (auto si TTY absent)
  if (opts.promptStdin || (opts.promptStdin === undefined && hasStdinData())) {
    const text = await readStdin();
    if (text.length > 0) {
      const final = interpolate(text, opts.vars);
      return makeResolved(final, 'stdin', 'utf-8', 'stdin');
    }
  }

  // 4. Base64 literal
  if (opts.promptBase64) {
    const decoded = Buffer.from(opts.promptBase64, 'base64').toString('utf-8');
    return makeResolved(decoded, 'base64', 'utf-8', 'arg:base64');
  }

  // 5. Base64 from file
  if (opts.promptFileBase64) {
    const buf = await fs.readFile(opts.promptFileBase64);
    const text = buf.toString('utf-8');
    return makeResolved(text, 'file-base64', 'utf-8', `file:${opts.promptFileBase64}`);
  }

  // 6. URL
  if (opts.promptUrl) {
    const res = await fetch(opts.promptUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch prompt URL ${opts.promptUrl}: HTTP ${res.status}`);
    }
    const text = await res.text();
    return makeResolved(text, 'url', 'utf-8', `url:${opts.promptUrl}`);
  }

  // 7. JSON object → reformaté
  if (opts.promptJson) {
    const obj = JSON.parse(opts.promptJson);
    const text = jsonToText(obj);
    return makeResolved(text, 'json', 'utf-8', 'arg:json');
  }

  // 8. Template avec vars
  if (opts.promptTemplate) {
    const text = interpolate(opts.promptTemplate, opts.vars);
    return makeResolved(text, 'template', 'utf-8', 'arg:template');
  }

  throw new Error(
    'No prompt source provided. Use one of: --prompt, --prompt-file, --prompt-stdin, --prompt-base64, --prompt-file-base64, --prompt-url, --prompt-json, --prompt-template',
  );
}

// ─── Vars parsing ──────────────────────────────────────────────────────────

/**
 * Parse les --var key=value passés en argv.
 * Ex: --var name=Monde --var lang=fr → { name: 'Monde', lang: 'fr' }
 */
export function parseVars(values: string[] | string | undefined): Record<string, string> {
  if (!values) return {};
  const arr = Array.isArray(values) ? values : [values];
  const vars: Record<string, string> = {};
  for (const v of arr) {
    const eqIdx = v.indexOf('=');
    if (eqIdx === -1) {
      vars[v] = ''; // --var foo (vide)
    } else {
      const key = v.slice(0, eqIdx).trim();
      const value = v.slice(eqIdx + 1);
      if (key) vars[key] = value;
    }
  }
  return vars;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeResolved(
  text: string,
  source: PromptSource,
  encoding: 'utf-8' | 'base64' | 'binary',
  origin: string,
): ResolvedPrompt {
  return {
    text,
    source,
    meta: {
      bytes: Buffer.byteLength(text, 'utf-8'),
      encoding,
      origin,
    },
  };
}

/**
 * Interpolation ${var} dans un template.
 * Supporte ${var} et $var (simple).
 */
function interpolate(text: string, vars?: Record<string, string>): string {
  if (!vars || Object.keys(vars).length === 0) return text;
  return text.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, key) => vars[key] ?? `\${${key}}`);
}

/**
 * Convertit un objet JSON en texte lisible (clé: valeur, récursif).
 * Utile pour les prompts de type "voici les données à analyser".
 */
function jsonToText(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return `${pad}null`;
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    return `${pad}${obj}`;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return `${pad}[]`;
    return obj.map((v) => jsonToText(v, indent + 1)).join('\n');
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries.map(([k, v]) => `${pad}${k}:\n${jsonToText(v, indent + 1)}`).join('\n');
  }
  return `${pad}${String(obj)}`;
}
